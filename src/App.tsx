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

  const send = (s: string) => {
    const h = handleRef.current;
    if (!h) return;
    h.send(s);
    h.term.focus();
  };

  // 빠른 승인/거부/항상허용 — Claude Code 권한 프롬프트 키스트로크.
  // 승인=y, 거부=n, 항상=a, 취소/인터럽트=Esc, 엔터=Enter
  const quickSend = (key: string) => () => send(key);

  const submitCmd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd) return;
    send(cmd.endsWith("\n") ? cmd : cmd + "\n");
    setCmd("");
  };

  const focusTerm = () => handleRef.current?.term.focus();

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__title">clide</span>
        <span className="app__badge" title="model">● {MODEL}</span>
        <span className="app__spacer" />
        <span className="app__session">{SESSION_ID.slice(0, 8)}</span>
      </header>

      <div
        className="app__terminal"
        ref={containerRef}
        onMouseDown={focusTerm}
        aria-label="terminal"
      />

      <div className="app__quick">
        <button type="button" className="qk qk--yes" onClick={quickSend("y")} title="승인 (y)">✅ 승인</button>
        <button type="button" className="qk qk--no"  onClick={quickSend("n")} title="거부 (n)">❌ 거부</button>
        <button type="button" className="qk qk--always" onClick={quickSend("a")} title="항상 허용 (a)">⭐ 항상</button>
        <button type="button" className="qk qk--esc" onClick={quickSend("\x1b")} title="취소 (Esc)">⏹ Esc</button>
        <button type="button" className="qk qk--enter" onClick={quickSend("\r")} title="엔터 (Enter)">↵ Enter</button>
      </div>

      <form className="app__input" onSubmit={submitCmd}>
        <span className="app__inputprompt">〉</span>
        <input
          className="app__inputfield"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="메시지 또는 // 커맨드 입력 — Enter로 전송"
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