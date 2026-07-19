import ReactDOM from "react-dom/client";
import { useState, useEffect, useCallback } from "react";
import { ChatLog } from "../../src/components/ChatLog";
import "../../src/components/chatlog.css";
import type { ClaudeEvent } from "../../src/components/types";

const vscode = acquireVsCodeApi();

function App() {
  const [events, setEvents] = useState<ClaudeEvent[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg?.event || !msg?.payload) return;

      if (msg.event === "claude-event") {
        const ev = msg.payload.event as ClaudeEvent;
        setEvents((prev) => [...prev, ev]);
      }
    };

    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" });

    return () => window.removeEventListener("message", handler);
  }, []);

  const send = useCallback((text: string) => {
    vscode.postMessage({ type: "pty_write", data: text });
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    send(input.trim());
    setInput("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#1a1b26", color: "#c0caf5" }}>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <ChatLog events={events} />
      </div>
      <form
        onSubmit={submit}
        style={{
          display: "flex",
          gap: 8,
          padding: "8px 10px",
          background: "#16161e",
          borderTop: "1px solid #2a2b3a",
        }}
      >
        <span style={{ color: "#7aa2f7", fontFamily: "'Cascadia Code', monospace", fontWeight: 700 }}>〉</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="메시지 입력"
          spellCheck={false}
          style={{
            flex: 1,
            background: "#1a1b26",
            border: "1px solid #2a2b3a",
            borderRadius: 6,
            color: "#c0caf5",
            padding: "0.5em 0.7em",
            fontSize: 13,
            fontFamily: "'Cascadia Code', monospace",
            outline: "none",
          }}
        />
        <button
          type="submit"
          style={{
            border: "1px solid #7aa2f7",
            background: "rgba(122, 162, 247, 0.14)",
            color: "#7aa2f7",
            borderRadius: 6,
            padding: "0.45em 1em",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          전송
        </button>
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
