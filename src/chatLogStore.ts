import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ClaudeEvent } from "./components/types";

// stream_event (partial chunks) 는 폭증만 유발하고 assistant 완성본이
// 같은 내용을 다 들고 오므로 스토어에서 아예 걸러낸다 — React 재렌더/메모리 절약.
const KEEP = new Set(["system", "assistant", "user", "result"]);

function isKeptEvent(x: unknown): x is ClaudeEvent {
  if (!x || typeof x !== "object") return false;
  const t = (x as { type?: unknown }).type;
  return typeof t === "string" && KEEP.has(t);
}

/**
 * 세션 하나의 claude-event NDJSON 을 ClaudeEvent[] 상태로 누적.
 * pty.rs 가 emit 한 {session, event} 페이로드에서 event 만 타입가드로 취해
 * 시스템/assistant/user/result 만 보관. pty-log(ocgo stderr 노이즈)는 콘솔.
 */
export function useChatLog(session: string) {
  const [events, setEvents] = useState<ClaudeEvent[]>([]);
  const [exited, setExited] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const uns: UnlistenFn[] = [];

    listen<{ session: string; event: unknown }>("claude-event", (e) => {
      if (e.payload.session !== session) return;
      if (!isKeptEvent(e.payload.event)) return;
      setEvents((prev) => [...prev, e.payload.event as ClaudeEvent]);
    }).then((u) => {
      if (cancelled) u();
      else uns.push(u);
    });

    listen<{ session: string; exit_code: number | null }>("pty-exit", (e) => {
      if (e.payload.session !== session) return;
      setExited(e.payload.exit_code ?? 0);
    }).then((u) => {
      if (cancelled) u();
      else uns.push(u);
    });

    listen<{ session: string; data: string }>("pty-log", (e) => {
      if (e.payload.session !== session) return;
      console.warn("[clide pty-log]", e.payload.data);
    }).then((u) => {
      if (cancelled) u();
      else uns.push(u);
    });

    return () => {
      cancelled = true;
      uns.forEach((u) => u());
    };
  }, [session]);

  /** user 가 입력한 텍스트를 우측 버블로 바로 띄우기 — claude 는 user 입력을
   *  echo 하지 않으므로 클라이언트에서 추가. (실제 전송은 App 쪽 send) */
  const pushUser = useCallback((text: string) => {
    setEvents((prev) => [
      ...prev,
      {
        type: "user",
        message: { role: "user", content: [{ type: "text", text }] },
      } as ClaudeEvent,
    ]);
  }, []);

  return { events, pushUser, exited };
}