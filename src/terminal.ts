import { invoke } from "@tauri-apps/api/core";

export interface SessionHandle {
  session: string;
  /** user 텍스트를 stream-json user 메시지(NDJSON)로 감싸 PTY stdin 에 전송. */
  send: (text: string) => void;
  dispose: () => void;
}

/** user 텍스트 한 줄을 stream-json user 메시지 NDJSON 으로 감싼다. */
function wrapUserNdjson(text: string): string {
  return (
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n"
  );
}

/**
 * claude 파이프 세션을 열어 send/dispose 만 반환.
 * xterm/fit/clipboard 전부 제거 — stream-json 은 라인 지향이라 터미널 제어가
 * 필요 없고, 렌더는 ChatLog 로 netive DOM 텍스트가 되어 복사도 걍 된다.
 * (piped std::process: stdin non-tty → claude 자동 streaming 모드 — 5e44802 참고)
 */
export async function attachSession(session: string): Promise<SessionHandle> {
  // cols/rows 는 piped pty.rs 에서 no-op 이라 생략 (Option → None).
  await invoke("pty_spawn", { session }).catch(() => {});
  return {
    session,
    send: (text: string) =>
      invoke("pty_write", { session, data: wrapUserNdjson(text) }).catch(
        () => {},
      ),
    dispose: () => {
      invoke("pty_kill", { session }).catch(() => {});
    },
  };
}