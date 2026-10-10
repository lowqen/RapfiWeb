import { label } from "../../core/model/move";
import type { JosekiNode } from "../../core/joseki/tree";
import { t } from "../../i18n/i18n";

/**
 * 정석 트리 — 기보 편집기의 줄글 모양. 주 변화는 한 줄로 이어 쓰고, 갈래가 있는 수 뒤에 다른 변화를
 * 들여 쓴 줄로 단다(`1. H8 2. I9 3. J10 (3. G10 …)`). 수를 누르면 그 마디로 간다.
 *
 * 마디가 많아도 가볍게 — 줄 하나가 `<span>` 몇 개다. 펼치고 접는 상태는 두지 않는다(갈래 줄은
 * 늘 보인다; 큰 정석은 «이 마디 아래만» 으로 좁혀 본다).
 */
export function TreeView({
  root,
  path,
  size,
  onGo,
  scope = [],
}: {
  root: JosekiNode;
  path: readonly number[];
  size: number;
  onGo: (p: number[]) => void;
  /** 이 경로 아래만 그린다. */
  scope?: readonly number[];
}) {
  let start: JosekiNode = root;
  for (const i of scope) start = start.children[i] ?? start;
  const here = path.join(".");
  if (start.children.length === 0)
    return <p className="jtree__empty">{t("아직 수가 없습니다. 판을 눌러 첫 수를 두세요.")}</p>;
  return (
    <div className="jtree" role="tree" aria-label={t("정석 트리")}>
      <Line
        node={start}
        prefix={[...scope]}
        ply={scope.length}
        size={size}
        here={here}
        onGo={onGo}
        first={0}
      />
    </div>
  );
}

/** `node` 의 자식 `[first]` 부터 주 변화를 따라 한 줄. 갈래마다 다른 자식을 들여 쓴 줄로. */
function Line({
  node,
  prefix,
  ply,
  size,
  here,
  onGo,
  first,
}: {
  node: JosekiNode;
  prefix: number[];
  ply: number;
  size: number;
  here: string;
  onGo: (p: number[]) => void;
  first: number;
}) {
  const items: JSX.Element[] = [];
  let n = node;
  let p = prefix;
  let k = ply;
  let idx = first;
  let lead = true;
  for (;;) {
    const c = n.children[idx];
    if (!c) break;
    const cp = [...p, idx];
    const key = cp.join(".");
    const black = k % 2 === 0;
    items.push(
      <button
        key={key}
        type="button"
        role="treeitem"
        aria-selected={key === here}
        className={`jtree__move${key === here ? " is-here" : ""}${c.comment ? " has-note" : ""}`}
        onClick={() => onGo(cp)}
      >
        {(black || lead) && (
          <span className="jtree__num tnum">
            {k + 1}
            {black ? "." : "…"}
          </span>
        )}
        {label(c.move!, size)}
        {c.mark && <span className="jtree__mark">{c.mark}</span>}
      </button>,
    );
    lead = false;
    // 이 마디의 형제(갈래) — 주 변화(0) 줄일 때만 여기서 단다.
    if (idx === 0 && n.children.length > 1) {
      for (let j = 1; j < n.children.length; j++) {
        items.push(
          <div key={`${key}/${j}`} className="jtree__var" role="group">
            <Line node={n} prefix={p} ply={k} size={size} here={here} onGo={onGo} first={j} />
          </div>,
        );
      }
      lead = true;
    }
    n = c;
    p = cp;
    k++;
    idx = 0;
  }
  return <div className="jtree__line">{items}</div>;
}
