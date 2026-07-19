import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
  /** PTY에 키스트로크를 직접 전송 (크롬 버튼/입력바용). */
  send: (data: string) => void;
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

/** 세션 하나에 대한 xterm 터미널을 열고 PTY 입출력을 묶어준다. */
export async function attachTerminal(
  container: HTMLElement,
  session: string,
): Promise<TerminalHandle> {
  // internals 가 없으면 listen()이 즉시 throw → 여기서 먼저 검증
  await waitForInternals();

  const term = new Terminal({
    // xterm v6: rendererType 옵션 삭제됨. webgl/canvas addon 안 넣으면
    // DOM 렌더러가 기본 → WebView2에서 main thread 잡아먹는 문제 없음.
    fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(container);
  fit.fit();

  const send = (data: string) => {
    invoke("pty_write", { session, data }).catch(() => {});
  };

  const initial = fit.proposeDimensions();
  if (initial) {
    await invoke("pty_spawn", {
      session,
      cols: initial.cols,
      rows: initial.rows,
    }).catch((e) => term.writeln(`\x1b[31m[spawn error] ${e}\x1b[0m`));
  }

  const unlistenData: UnlistenFn = await listen<{ session: string; data: string }>(
    "pty-data",
    (e) => {
      if (e.payload.session === session) term.write(e.payload.data);
    },
  );
  const unlistenExit: UnlistenFn = await listen<{ session: string; exit_code: number | null }>(
    "pty-exit",
    (e) => {
      if (e.payload.session === session)
        term.writeln(`\x1b[33m[claude exited · code ${e.payload.exit_code}]\x1b[0m`);
    },
  );

  term.onData(send);
  term.onResize((dims) => {
    invoke("pty_resize", { session, cols: dims.cols, rows: dims.rows }).catch(() => {});
  });

  // ResizeObserver 루프 방지: fit이 서로를 트리거해 메인 스레드를
  // 잡아먹지 않도록 rAF로 합치고 재진입 가드.
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
      unlistenData();
      unlistenExit();
      invoke("pty_kill", { session }).catch(() => {});
      term.dispose();
    },
  };
}