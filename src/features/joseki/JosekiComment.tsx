import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "../../core/joseki/markdown";
import type { Move } from "../../core/model/move";

/**
 * 정석 메모 그리기 — `core/joseki/markdown.ts` 의 나무를 React 요소로. HTML 문자열을 만들지 않으므로
 * 메모의 `<script>` 는 글자다. 좌표(`h8`)는 버튼이 되어 누르면 그 수로 간다.
 */
export function JosekiComment({ text, onCoord }: { text: string; onCoord?: (m: Move) => void }) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <div className="jmd">
      {blocks.map((b, i) =>
        b.t === "p" ? (
          <p key={i}>{inline(b.c, onCoord)}</p>
        ) : b.t === "ul" ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, onCoord)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, onCoord)}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

function inline(nodes: readonly Inline[], onCoord?: (m: Move) => void): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "br":
        return <br key={i} />;
      case "b":
        return <strong key={i}>{inline(n.c, onCoord)}</strong>;
      case "i":
        return <em key={i}>{inline(n.c, onCoord)}</em>;
      case "code":
        return <code key={i}>{n.v}</code>;
      case "link":
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {inline(n.c, onCoord)}
          </a>
        );
      case "coord":
        return onCoord ? (
          <button key={i} type="button" className="jmd__coord" onClick={() => onCoord(n.move)}>
            {n.label}
          </button>
        ) : (
          <Fragment key={i}>{n.label}</Fragment>
        );
    }
  });
}
