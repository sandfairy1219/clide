import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
  /** user 텍스트를 stream-json NDJSON(user 메시지)으로 감싸 PTY stdin에 전송. */
  send: (text: string) => void;
  dispose: () => void;
}

/** __TAURI_INTERNALS__ 가 주입될 때까지 폴링. race condition 방어. */
function waitForInternals(timeoutMs = 5000): Promise<void> {
  const w = globalThis as unknown as {
    __TAURI_INTERNALS__?: unknown;
    isTauri?: unknown;
  };
  if (w.__TAURI_INTERNALS__) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const id = setInterval(() => {
      if (w.__TAURI_INTERNALS__) {
        clearInterval(id);
        resolve();
      } else if (performance.now() - start > timeoutMs) {
        clearInterval(id);
        reject(
          new Error(
            `__TAURI_INTERNALS__ not injected after ${timeoutMs}ms (isTauri=${!!w.isTauri})`,
          ),
        );
      }
    }, 50);
  });
}

/** user 텍스트 한 줄을 stream-json user 메시지 NDJSON으로 감싼다. */
function wrapUserNdjson(text: string): string {
  const msg = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
  return JSON.stringify(msg) + "\n";
}

/**
 * 세션 하나에 대한 xterm 터미널을 열고 PTY 입출력을 묶어준다.
 * stream-json 모드 — xterm은 "파이프 테스트용 raw NDJSON 로그 뷰"로 쓴다.
 *   - claude 가 뱉은 JSON 한 줄 → claude-event → xterm 에 JSON 그대로 찍음
 *   - 비-JSON 라인(ocgo stderr 노이즈 등) → pty-log → 회색으로 찍음
 *   - user 입력: xterm 키스트로크 ❌ (stream-json stdin 이 raw 거부),
 *     상위 입력바에서 send(text) 로 NDJSON 전송
 */
export async function attachTerminal(
  container: HTMLElement,
  session: string,
): Promise<TerminalHandle> {
  await waitForInternals();

  const term = new Terminal({
    fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: false,
    disableStdin: true, // raw keystroke 안 보냄 — stream-json stdin 전용
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(container);
  fit.fit();

  // stream-json user 메시지 래핑 전송
  const send = (text: string) => {
    invoke("pty_write", { session, data: wrapUserNdjson(text) }).catch(() => {});
  };

  const initial = fit.proposeDimensions();
  if (initial) {
    await invoke("pty_spawn", {
      session,
      cols: initial.cols,
      rows: initial.rows,
    }).catch((e) => term.writeln(`\x1b[31m[spawn error] ${e}\x1b[0m`));
  }

  // claude 가 뱉은 JSON 라인 → xterm 에 그대로 출력
  const unlistenEvent: UnlistenFn = await listen<{
    session: string;
    event: unknown;
  }>("claude-event", (e) => {
    if (e.payload.session === session) {
      term.writeln(JSON.stringify(e.payload.event));
    }
  });

  // 비-JSON 라인(ocgo "No OCGO model mappings..." 등) → 회색
  const unlistenLog: UnlistenFn = await listen<{ session: string; data: string }>(
    "pty-log",
    (e) => {
      if (e.payload.session === session)
        term.writeln(`\x1b[2m${e.payload.data}\x1b[0m`);
    },
  );

  const unlistenExit: UnlistenFn = await listen<{
    session: string;
    exit_code: number | null;
  }>("pty-exit", (e) => {
    if (e.payload.session === session)
      term.writeln(
        `\x1b[33m[claude exited · code ${e.payload.exit_code}]\x1b[0m`,
      );
  });

  term.onResize((dims) => {
    invoke("pty_resize", { session, cols: dims.cols, rows: dims.rows }).catch(
      () => {},
    );
  });

  // ResizeObserver 루프 방지.
  let fitting = false;
  let pending = false;
  const safeFit = () => {
    if (fitting) {
      pending = true;
      return;
    }
    fitting = true;
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      fitting = false;
      if (pending) {
        pending = false;
        safeFit();
      }
    });
  };
  const ro = new ResizeObserver(safeFit);
  ro.observe(container);

  return {
    term,
    fit,
    send,
    dispose: () => {
      ro.disconnect();
      unlistenEvent();
      unlistenLog();
      unlistenExit();
      invoke("pty_kill", { session }).catch(() => {});
      term.dispose();
    },
  };
}