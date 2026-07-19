interface ToolResultProps {
  tool_use_id: string;
  content?: string;
  stdout?: string;
  stderr?: string;
  is_error?: boolean;
}

export function ToolResult({ tool_use_id, content, stdout, stderr, is_error }: ToolResultProps) {
  const body = content || stdout || stderr || "";
  return (
    <div className={`cl-card cl-card--result${is_error ? " cl-card--error" : ""}`}>
      <div className="cl-card__header">
        <span className="cl-card__badge cl-card__badge--result">result</span>
        {is_error && <span className="cl-card__err-tag">error</span>}
        <span className="cl-card__id">{tool_use_id.slice(0, 8)}</span>
      </div>
      {body && <pre className="cl-card__pre"><code>{body}</code></pre>}
      {stderr && stderr !== body && (
        <details className="cl-card__details">
          <summary>stderr</summary>
          <pre className="cl-card__pre"><code>{stderr}</code></pre>
        </details>
      )}
    </div>
  );
}
