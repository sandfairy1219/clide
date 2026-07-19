import type { ReactNode } from "react";

interface MessageBubbleProps {
  role: "user" | "assistant";
  children: ReactNode;
}

export function MessageBubble({ role, children }: MessageBubbleProps) {
  return (
    <div className={`cl-chat__bubble cl-chat__bubble--${role}`}>
      {children}
    </div>
  );
}
