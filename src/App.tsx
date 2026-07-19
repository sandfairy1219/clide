import { useEffect, useRef, useState } from "react";
import { attachSession, type SessionHandle } from "./terminal";
import { useChatLog } from "./chatLogStore";
import { ChatLog } from "./components/ChatLog";
import "./App.css";
import "./components/chatlog.css";

const SESSION_ID = crypto.randomUUID();
const MODEL = "glm-5.2";

function App() {
  const sessionRef = useRef<SessionHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cmd, setCmd] = useState("");
  const [ready, setReady] = useState(false);
  const { events, pushUser, exited } = useChatLog(SESSION_ID);

  // claude 세션 1회 시작. StrictMode 빠져있어 이중 spawn 우려 없음.
  useEffect(() => {
    let disposed = false;
    attachSession(SESSION_ID).then((h) => {
      if (disposed) {
        h.dispose();
        return;
      }
      sessionRef.current = h;
      setReady(true);
    });
    return () => {
      disposed = true;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, []);

  // 새 이벤트 오면 자동 스크롤.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = cmd.trim();
    if (!text || !ready || exited !== null) return;
    pushUser(text); // 우측 user 버블 즉시 렌더
    sessionRef.current?.send(text); // NDJSON 으로 claude stdin 전송
    setCmd("");
  };

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__title">clide</span>
        <span className="app__badge" title="model">● {MODEL}</span>
        <span className="app__spacer" />
        <span className="app__session">{SESSION_ID.slice(0, 8)}</span>
      </header>

      <div className="app__chat" ref={scrollRef}>
        <ChatLog events={events} />
        {exited !== null && (
          <div className="app__exited">claude exited · code {exited}</div>
        )}
      </div>

      <form className="app__input" onSubmit={submit}>
        <span className="app__inputprompt">〉</span>
        <input
          className="app__inputfield"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="메시지 입력 — Enter로 stream-json 전송"
          disabled={!ready || exited !== null}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          className="app__send"
          disabled={!ready || exited !== null}
        >
          전송
        </button>
      </form>
    </div>
  );
}

export default App;