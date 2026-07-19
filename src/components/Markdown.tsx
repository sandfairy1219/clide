import { Fragment } from "react";

interface MarkdownProps {
  text: string;
}

type MdNode =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "italic"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string }
  | { t: "br" };

function parseInline(s: string): MdNode[] {
  const nodes: MdNode[] = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\n)/g;
  let last = 0;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    if (m.index > last) nodes.push({ t: "text", v: s.slice(last, m.index) });
    if (m[2]) nodes.push({ t: "bold", v: m[2] });
    else if (m[3]) nodes.push({ t: "bold", v: m[3] });
    else if (m[4]) nodes.push({ t: "italic", v: m[4] });
    else if (m[5]) nodes.push({ t: "code", v: m[5] });
    else if (m[6]) nodes.push({ t: "link", v: m[6], href: m[7] });
    else if (m[0] === "\n") nodes.push({ t: "br" });
    last = re.lastIndex;
  }
  if (last < s.length) nodes.push({ t: "text", v: s.slice(last) });
  return nodes;
}

function renderInline(nodes: MdNode[]) {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text": return <Fragment key={i}>{n.v}</Fragment>;
      case "bold": return <strong key={i}>{n.v}</strong>;
      case "italic": return <em key={i}>{n.v}</em>;
      case "code": return <code key={i} className="cl-md__code">{n.v}</code>;
      case "link": return <a key={i} href={n.href} target="_blank" rel="noreferrer">{n.v}</a>;
      case "br": return <br key={i} />;
    }
  });
}

function parseCodeFence(text: string): { lang: string; code: string } | null {
  const m = /^```(\w*)\n?([\s\S]*?)```/.exec(text);
  if (!m) return null;
  return { lang: m[1], code: m[2].replace(/\n$/, "") };
}

export function Markdown({ text }: MarkdownProps) {
  const fence = parseCodeFence(text);
  if (fence) {
    const before = text.slice(0, text.indexOf("```"));
    const after = text.slice(text.lastIndexOf("```") + 3);
    return (
      <div className="cl-md">
        {before && <p className="cl-md__p">{renderInline(parseInline(before))}</p>}
        <pre className="cl-md__pre">
          {fence.lang && <div className="cl-md__lang">{fence.lang}</div>}
          <code>{fence.code}</code>
        </pre>
        {after && <p className="cl-md__p">{renderInline(parseInline(after))}</p>}
      </div>
    );
  }

  const lines = text.split("\n");
  const headingTags: Record<number, "h1" | "h2" | "h3" | "h4" | "h5" | "h6"> = {
    1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6",
  };
  return (
    <div className="cl-md">
      {lines.map((line, i) => {
        if (!line) return <br key={i} />;
        const heading = /^(#{1,6})\s+(.+)/.exec(line);
        if (heading) {
          const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
          const Tag = headingTags[level];
          return <Tag key={i} className="cl-md__h">{renderInline(parseInline(heading[2]))}</Tag>;
        }
        const bullet = /^[-*]\s+(.+)/.exec(line);
        if (bullet) {
          return <li key={i} className="cl-md__li">{renderInline(parseInline(bullet[1]))}</li>;
        }
        return <p key={i} className="cl-md__p">{renderInline(parseInline(line))}</p>;
      })}
    </div>
  );
}
