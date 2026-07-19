interface CodeCardProps {
  name: string;
  input: Record<string, unknown>;
}

function formatInput(name: string, input: Record<string, unknown>): { label: string; content: string }[] {
  const blocks: { label: string; content: string }[] = [];

  const command = input.command;
  if ((name === "Bash" || name === "PowerShell" || name === "Shell" || name === "Execute") && typeof command === "string") {
    blocks.push({ label: name, content: command });
  }

  const filePath = input.file_path;
  if (typeof filePath === "string") {
    blocks.push({ label: "file", content: filePath });
  }

  const content = input.content;
  if (typeof content === "string") {
    blocks.push({ label: "content", content });
  }

  const pattern = input.pattern;
  if (typeof pattern === "string") {
    blocks.push({ label: "pattern", content: pattern });
  }

  const path = input.path;
  if (typeof path === "string") {
    blocks.push({ label: "path", content: path });
  }

  const spec = input.spec;
  if (typeof spec === "string") {
    blocks.push({ label: "spec", content: spec });
  }

  if (blocks.length === 0) {
    blocks.push({ label: "input", content: JSON.stringify(input, null, 2) });
  }

  return blocks;
}

export function CodeCard({ name, input }: CodeCardProps) {
  const blocks = formatInput(name, input);

  return (
    <div className="cl-card">
      <div className="cl-card__header">
        <span className={`cl-card__badge cl-card__badge--${name.toLowerCase()}`}>{name}</span>
      </div>
      {blocks.map((b, i) => (
        <div key={i} className="cl-card__block">
          {b.label !== name && <div className="cl-card__block-label">{b.label}</div>}
          <pre className="cl-card__pre"><code>{b.content}</code></pre>
        </div>
      ))}
    </div>
  );
}
