interface StatusPillProps {
  status: string;
}

export function StatusPill({ status }: StatusPillProps) {
  return <span className="cl-chat__pill">{status === "requesting" ? "● thinking…" : status}</span>;
}
