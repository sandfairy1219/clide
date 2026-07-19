import { useEffect, useRef } from "react";
import type { ClaudeEvent } from "./types";
import { MessageBubble } from "./MessageBubble";
import { CodeCard } from "./CodeCard";
import { ToolResult } from "./ToolResult";
import { Markdown } from "./Markdown";
import { StatusPill } from "./StatusPill";
import { CostFooter } from "./CostFooter";

interface ChatLogProps {
  events: ClaudeEvent[];
}

export function ChatLog({ events }: ChatLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="cl-chat">
      {events.map((ev, i) => {
        switch (ev.type) {
          case "system": {
            if (ev.subtype === "status") {
              return <StatusPill key={i} status={ev.status ?? ""} />;
            }
            if (ev.subtype === "init") {
              return (
                <div key={i} className="cl-chat__system">
                  model: {ev.model ?? "?"} · session:{" "}
                  {ev.session_id?.slice(0, 8) ?? "?"}
                </div>
              );
            }
            return null;
          }

          case "assistant": {
            const textBlocks = ev.message.content.filter((b) => b.type === "text");
            const toolBlocks = ev.message.content.filter((b) => b.type === "tool_use");
            const resultBlocks = ev.message.content.filter(
              (b): b is Extract<typeof b, { type: "tool_result" }> =>
                b.type === "tool_result",
            );
            return (
              <MessageBubble key={i} role="assistant">
                {textBlocks.map((b, j) => (
                  <Markdown
                    key={`t${j}`}
                    text={(b as { type: "text"; text: string }).text}
                  />
                ))}
                {toolBlocks.map((b, j) => {
                  const tb = b as {
                    type: "tool_use";
                    id: string;
                    name: string;
                    input: Record<string, unknown>;
                  };
                  return <CodeCard key={`tool${j}`} name={tb.name} input={tb.input} />;
                })}
                {resultBlocks.map((b, j) => (
                  <ToolResult
                    key={`res${j}`}
                    tool_use_id={b.tool_use_id}
                    content={b.content}
                    is_error={b.is_error}
                  />
                ))}
              </MessageBubble>
            );
          }

          case "user": {
            // tool_use_result(stdout/stderr) 가 있으면 그쪽이 Bash 출력의 진짜
            // 소스 → content 의 tool_result 블록은 같은 내용이라 중복이므로 스킵.
            // content 가 tool_result 없는 (echo 한 user 텍스트) 경우는 그대로 렌더.
            const hasToolUseResult = !!ev.tool_use_result;
            return (
              <MessageBubble key={i} role="user">
                {ev.message.content.map((c, j) => {
                  const block = c as {
                    type?: string;
                    text?: string;
                    content?: string;
                    tool_use_id?: string;
                    is_error?: boolean;
                  };
                  if (block.type === "tool_result") {
                    if (hasToolUseResult) return null;
                    return (
                      <ToolResult
                        key={`res${j}`}
                        tool_use_id={block.tool_use_id ?? ""}
                        content={block.content}
                        is_error={block.is_error}
                      />
                    );
                  }
                  if (block.text) return <Markdown key={`t${j}`} text={block.text} />;
                  return <Markdown key={`t${j}`} text={JSON.stringify(block)} />;
                })}
                {ev.tool_use_result && (
                  <ToolResult
                    tool_use_id="result"
                    stdout={ev.tool_use_result.stdout}
                    stderr={ev.tool_use_result.stderr}
                    is_error={ev.tool_use_result.isImage ? false : false}
                  />
                )}
              </MessageBubble>
            );
          }

          case "stream_event": {
            return null;
          }

          case "result": {
            // result.result 텍스트는 바로 앞 assistant 버블과 같은 답이라 중복.
            // 비용/turns 요약(CostFooter)만 표시.
            return (
              <div key={i} className="cl-chat__result">
                <CostFooter
                  usage={ev.usage}
                  total_cost_usd={ev.total_cost_usd}
                  num_turns={ev.num_turns}
                />
              </div>
            );
          }

          default:
            return null;
        }
      })}
      <div ref={bottomRef} />
    </div>
  );
}