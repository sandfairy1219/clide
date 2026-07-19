import { useEffect, useRef, useState } from "react";
import { attachTerminal, type TerminalHandle } from "./terminal";
import "./App.css";

const SESSION_ID = crypto.randomUUID();
const MODEL = "glm-5.2";

type Phase = "attaching" | "ready" | "error";

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const [phase, setPhase] = useState<Phase>("attaching");
  const [error, setError] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");

  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    attachTerminal(container, SESSION_ID)
      .then((h) => {
        if (disposed) {
          h.dispose();
          return;
        }
        handleRef.current = h;
        setPhase("ready");
        h.term.focus();
      })
      .catch((e) => {
        setError(String(e));
        setPhase("error");
      });

    return () => {
      disposed = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  // send: user 텍스트를 stream-json user 메시지(NDJSON)로 PTY stdin에 전송.
  // stream-json 모드에선 빠른 승인(y/n/a) 키스트로크가 의미 없음 —
  // 권한은 백엔드 --yes 로 자동 승인되고, permission_request 이벤트가 안 옴.
  // 입력은 오직 이 입력바를 통해서만.
  const send = (s: string) => {
    const h = handleRef.current;
    if (!h) return;
    h.send(s);
    h.term.focus();
  };

  const submitCmd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd) return;
    // send() 가 NDJSON user 메시지로 감싸 \n 까지 붙여주므로 텍스트만 전달.
    send(cmd);
    setCmd("");
  };

  const focusTerm = () => handleRef.current?.term.focus();

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__title">clide</span>
        <span className="app__badge" title="model">● {MODEL}</span>
        <span className="app__spacer" />
        <button
          type="button"
          className="app__copybtn"
          onClick={() => {
            // 포커스/키보드 타이밍 무관 — 버튼 클릭(user-gesture) → Tauri 플러그인
            // (Rust → OS 클립보드, WebView2 우회) 로 터미널 선택 영역 복사.
            handleRef.current?.copySelection().then((ok) => {
              const b = document.querySelector<HTMLButtonElement>(".app__copybtn");
              if (b) {
                b.textContent = ok ? "복사됨 ✓" : "선택 없음";
                setTimeout(() => (b.textContent = "복사"), 1200);
              }
            });
          }}
          title="터미널에서 드래그로 선택 후 클릭 → 클립보드로 복사"
        >
          복사
        </button>
        <span className="app__session">{SESSION_ID.slice(0, 8)}</span>
      </header>

      <div
        className="app__terminal"
        ref={containerRef}
        onMouseDown={focusTerm}
        aria-label="terminal"
      />

      <form className="app__input" onSubmit={submitCmd}>
        <span className="app__inputprompt">〉</span>
        <input
          className="app__inputfield"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="메시지 입력 — Enter로 stream-json 전송"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="app__send">전송</button>
      </form>

      {phase !== "ready" && (
        <div className={`app__overlay${phase === "error" ? " app__overlay--err" : ""}`}>
          {phase === "error" ? error : "spawning claude…"}
        </div>
      )}
    </div>
  );
}

export default App;