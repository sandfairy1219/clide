import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
  /** user 텍스트를 stream-json NDJSON(user 메시지)으로 감싸 PTY stdin에 전송. */
  send: (text: string) => void;
  /** 현재 xterm 선택 영역을 클립보드로 복사 (선택 없으면 no-op). */
  copySelection: () => Promise<boolean>;
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
  return (
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n"
  );
}

/** 포커스가 (편집 가능한) 입력 요소에 있는지 — 거기선 복사 단축키를 가로채면 안 됨. */
function focusIsEditable(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * 세션 하나에 대한 xterm 터미널을 열고 PTY 입출력을 묶어준다.
 * stream-json 모드 — xterm은 "파이프 테스트용 raw NDJSON 로그 뷰"로 쓴다.
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

  // --- 클립보드 복사 ---
  // disableStdin:true 라 xterm helper textarea 가 포커스를 안 받아서
  // 컨테이너 keydown 은 안 터짐 → window 단에서 잡고(포커스 무관),
  // 우클릭=복사, 그리고 외부 복사 버튼까지 3중으로 둔다.
  // navigator.clipboard 가 WebView2 에서 조용히 실패할 수 있어서,
  // 실패하면 execCommand('copy') 폴백(임시 textarea)으로 복사한다.
  // writeClipboard — 3단계 폴백.
  // ⚠ 순서 중요: (1) execCommand('copy') 를 **동기적으로 가장 먼저** 실행.
  //   keydown/contextmenu user-gesture 안에서 즉시 실행돼야 WebView2 가 수락.
  //   여기서 먼저 `await` 가 들어가면(구버전에선 Tauri writeText 가 첫 줄) 제스처가
  //   비동기로 넘어가면서 execCommand 폴백이 다 실패한다 — 이게 복사 안 된 진짜 원인.
  // (2) Tauri clipboard-manager 플러그인: JS 바인딩 → Rust → OS 클립보드 (WebView2 우회).
  // (3) navigator.clipboard (웹 표준).
  const writeClipboard = async (text: string): Promise<boolean> => {
    // (1) 동기 execCommand — user-gesture 안에서 즉시 (WebView2 신뢰도 최고).
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) return true;
    } catch {
      /* 폴백 */
    }
    // (2) Tauri 플러그인 (Rust → OS).
    try {
      await writeText(text);
      return true;
    } catch {
      /* 폴백 */
    }
    // (3) navigator.clipboard (웹 표준).
    try {
      await navigator.clipboard?.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const copySelection = async (): Promise<boolean> => {
    const sel = term.getSelection();
    // 디버그: 선택 길이/내용을 콘솔에 찍어 어디서 끊기는지 보이게.
    console.log("[clide] copySelection getSelection() =>", JSON.stringify(sel));
    if (!sel) return false;
    const ok = await writeClipboard(sel);
    console.log("[clide] writeClipboard result =>", ok);
    return ok;
  };

  // (1) window 단 keydown.
  // 핵심: xterm 에 선택이 있으면 → 무조건 그걸 복사 (포커스 무관).
  //       xterm 선택이 없을 때만 입력 필드의 일반 Ctrl+C 로 넘김.
  // (이전엔 !focusIsEditable() 가드가 먼저라, 입력바가 포커스면
  //  터미널 선택을 해놓고 Ctrl+C 눌러도 복사가 스킵되는 게 원인이었음.)
  const onKeydown = (e: KeyboardEvent) => {
    const isCopy =
      (e.ctrlKey && (e.key === "c" || e.key === "C" || e.key === "Insert")) ||
      (e.ctrlKey && e.shiftKey && (e.key === "c" || e.key === "C"));
    if (isCopy) {
      const sel = term.getSelection();
      if (sel) {
        e.preventDefault();
        void writeClipboard(sel);
        return;
      }
      // xterm 선택 없음 → 입력 필드의 일반 Ctrl+C 정상 동작
    }
    if (e.ctrlKey && (e.key === "a" || e.key === "A") && !focusIsEditable()) {
      e.preventDefault();
      term.selectAll();
    }
  };
  window.addEventListener("keydown", onKeydown, true);

  // (2) 우클릭 = 선택 영역 복사 (터미널 콘솔 감성 + 컨텍스트메뉴 방지).
  const onContextmenu = (e: MouseEvent) => {
    const sel = term.getSelection();
    if (sel) {
      e.preventDefault();
      void writeClipboard(sel);
    }
  };
  container.addEventListener("contextmenu", onContextmenu);

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
    copySelection,
    dispose: () => {
      ro.disconnect();
      window.removeEventListener("keydown", onKeydown, true);
      container.removeEventListener("contextmenu", onContextmenu);
      unlistenEvent();
      unlistenLog();
      unlistenExit();
      invoke("pty_kill", { session }).catch(() => {});
      term.dispose();
    },
  };
}