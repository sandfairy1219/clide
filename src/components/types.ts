export type ClaudeEvent =
  | { type: "system"; subtype: "init" | "status"; status?: string; model?: string; session_id?: string }
  | { type: "stream_event"; event: { type: string; [k: string]: unknown } }
  | { type: "assistant"; message: { content: ContentBlock[] } }
  | { type: "user"; message: { content: unknown[] }; tool_use_result?: { stdout: string; stderr: string; isImage: boolean } }
  | { type: "result"; subtype: string; result: string; usage?: unknown; total_cost_usd?: number; num_turns?: number };

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };
