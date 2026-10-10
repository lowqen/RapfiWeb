import { DEFAULT_SIZE, inBoard, moveKey, sameMove, type Move } from "../model/move";
import { localized, msg, t } from "../../i18n/i18n";

/**
 * 정석 한 벌 = 문서 하나(W9, 계획서 §7). 사람이 쓰는 **문서**라 증명 트리(`ProveTree`)와 섞지
 * 않는다 — 공유하는 것은 «경로를 `Move[]` 로 적는다»는 관례뿐이다.
 *
 * 마디는 위치(`path` — 뿌리에서 자식 번호의 배열)로 가리키고, 고치기는 모두 **새 뿌리를 돌려준다**
 * (바뀐 길만 새로 만들고 나머지는 나눠 쓴다). 화면이 React 상태로 들고 있기 좋고, 무르기도 쉽다.
 */

/** 수 평가 기호 — 기보 주석의 관례. */
export type JosekiMark = "!!" | "!" | "!?" | "?!" | "?" | "??";
export const MARKS: readonly JosekiMark[] = ["!!", "!", "!?", "?!", "?", "??"];
export const MARK_LABEL: Readonly<Record<JosekiMark, string>> = localized({
  "!!": msg("최선"),
  "!": msg("좋은 수"),
  "!?": msg("흥미로운 수"),
  "?!": msg("의문수"),
  "?": msg("나쁜 수"),
  "??": msg("큰 실수"),
});

export interface JosekiNode {
  /** 뿌리만 null. */
  move: Move | null;
  /** 마크다운(굵게 · 기울임 · 목록 · 링크 · 좌표). */
  comment: string;
  mark?: JosekiMark;
  /** `[0]` 이 주 변화. */
  children: JosekiNode[];
}

export interface JosekiTree {
  id: string;
  title: string;
  /** 주형 이름 — 비우면 수순에서 유도한다(`classify.ts`). */
  category: string;
  tags: string[];
  boardSize: number;
  rule: "renju";
  root: JosekiNode;
  createdAt: number;
  updatedAt: number;
  schema: 1;
}

export type Path = readonly number[];

/** 노드 수 경고선 — 한 문서 저장이 무거워지기 전에 말한다(계획서 §7 리스크). */
export const NODE_WARN = 2000;

export const emptyNode = (move: Move | null = null): JosekiNode => ({
  move,
  comment: "",
  children: [],
});

export function newId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function newTree(title = t("새 정석"), now = Date.now()): JosekiTree {
  return {
    id: newId(),
    title,
    category: "",
    tags: [],
    boardSize: DEFAULT_SIZE,
    rule: "renju",
    root: emptyNode(),
    createdAt: now,
    updatedAt: now,
    schema: 1,
  };
}

// ── 읽기 ─────────────────────────────────────────────────────────────

/** 경로의 마디. 경로가 틀리면 null. */
export function nodeAt(root: JosekiNode, path: Path): JosekiNode | null {
  let n: JosekiNode | undefined = root;
  for (const i of path) {
    n = n.children[i];
    if (!n) return null;
  }
  return n;
}

/** 뿌리에서 경로까지의 수. */
export function movesTo(root: JosekiNode, path: Path): Move[] {
  const out: Move[] = [];
  let n: JosekiNode = root;
  for (const i of path) {
    const c = n.children[i];
    if (!c) break;
    out.push(c.move!);
    n = c;
  }
  return out;
}

/** 경로에서 주 변화(`[0]`)를 끝까지 따라간 경로. */
export function mainLineFrom(root: JosekiNode, path: Path = []): number[] {
  const out = [...path];
  let n = nodeAt(root, path);
  while (n && n.children.length > 0) {
    out.push(0);
    n = n.children[0]!;
  }
  return out;
}

export function countNodes(root: JosekiNode): number {
  let n = 0;
  walk(root, () => n++);
  return n - 1; // 뿌리는 수가 아니다
}

/** 모든 마디를 깊이 우선으로 — 뿌리 포함, 수순과 함께. */
export function walk(
  root: JosekiNode,
  fn: (node: JosekiNode, path: number[], moves: Move[]) => void,
): void {
  const stack: { node: JosekiNode; path: number[]; moves: Move[] }[] = [
    { node: root, path: [], moves: [] },
  ];
  while (stack.length) {
    const { node, path, moves } = stack.pop()!;
    fn(node, path, moves);
    for (let i = node.children.length - 1; i >= 0; i--) {
      const c = node.children[i]!;
      stack.push({ node: c, path: [...path, i], moves: [...moves, c.move!] });
    }
  }
}

/** 이 수를 이 경로 끝에 둘 수 있나 — 판 밖이나 이미 돌이 있으면 까닭. */
export function illegal(root: JosekiNode, path: Path, m: Move, size = DEFAULT_SIZE): string | null {
  if (!inBoard(m, size)) return t("판 밖입니다");
  const k = moveKey(m, size);
  if (movesTo(root, path).some((x) => moveKey(x, size) === k))
    return t("이미 돌이 있는 자리입니다");
  return null;
}

// ── 고치기(새 뿌리를 돌려준다) ─────────────────────────────────────────

/** 경로의 마디를 `f` 로 바꾼 새 뿌리. */
function replaceAt(root: JosekiNode, path: Path, f: (n: JosekiNode) => JosekiNode): JosekiNode {
  if (path.length === 0) return f(root);
  const [i, ...rest] = path;
  const child = root.children[i!];
  if (!child) return root;
  const children = root.children.slice();
  children[i!] = replaceAt(child, rest, f);
  return { ...root, children };
}

/**
 * 경로 끝에 수 하나. **이미 있는 수면 더하지 않고 그 자식으로 간다**(기보 편집기의 표준 동작).
 * 둘 수 없으면 null.
 */
export function addMove(
  root: JosekiNode,
  path: Path,
  m: Move,
  size = DEFAULT_SIZE,
): { root: JosekiNode; path: number[]; added: boolean } | null {
  const at = nodeAt(root, path);
  if (!at) return null;
  const existing = at.children.findIndex((c) => sameMove(c.move, m));
  if (existing >= 0) return { root, path: [...path, existing], added: false };
  if (illegal(root, path, m, size)) return null;
  const next = replaceAt(root, path, (n) => ({ ...n, children: [...n.children, emptyNode(m)] }));
  return { root: next, path: [...path, at.children.length], added: true };
}

/** 수순 하나를 뿌리(또는 `from`)부터 잇는다 — 있는 마디는 따라가고 없는 곳부터 더한다. */
export function addLine(
  root: JosekiNode,
  moves: readonly Move[],
  from: Path = [],
  size = DEFAULT_SIZE,
): { root: JosekiNode; path: number[]; added: number; stoppedAt: number | null } {
  let r = root;
  let p: number[] = [...from];
  let added = 0;
  for (let i = 0; i < moves.length; i++) {
    const step = addMove(r, p, moves[i]!, size);
    if (!step) return { root: r, path: p, added, stoppedAt: i };
    r = step.root;
    p = step.path;
    if (step.added) added++;
  }
  return { root: r, path: p, added, stoppedAt: null };
}

/** 마디(와 그 아래)를 지운다. 뿌리는 지울 수 없다. 부모 경로를 돌려준다. */
export function removeAt(
  root: JosekiNode,
  path: Path,
): { root: JosekiNode; path: number[] } | null {
  if (path.length === 0 || !nodeAt(root, path)) return null;
  const parent = path.slice(0, -1);
  const i = path[path.length - 1]!;
  return {
    root: replaceAt(root, parent, (n) => ({
      ...n,
      children: n.children.filter((_, j) => j !== i),
    })),
    path: parent,
  };
}

/**
 * 이 줄을 주 변화로 — 경로의 모든 단계에서 그 자식을 `[0]` 으로 올린다. 새 경로(전부 0)를 돌려준다.
 */
export function promoteLine(root: JosekiNode, path: Path): { root: JosekiNode; path: number[] } {
  let r = root;
  for (let d = 0; d < path.length; d++) {
    const parent = path.slice(0, d);
    const i = path[d]!;
    if (i === 0) continue;
    r = replaceAt(r, parent, (n) => {
      const children = n.children.slice();
      const [c] = children.splice(i, 1);
      return { ...n, children: [c!, ...children] };
    });
  }
  return { root: r, path: path.map(() => 0) };
}

/** 형제 사이에서 한 칸 옮긴다(`-1` 앞으로 · `+1` 뒤로). 새 경로. */
export function moveSibling(
  root: JosekiNode,
  path: Path,
  dir: -1 | 1,
): { root: JosekiNode; path: number[] } {
  if (path.length === 0) return { root, path: [] };
  const parent = path.slice(0, -1);
  const i = path[path.length - 1]!;
  const sibs = nodeAt(root, parent)?.children.length ?? 0;
  const j = i + dir;
  if (j < 0 || j >= sibs) return { root, path: [...path] };
  const next = replaceAt(root, parent, (n) => {
    const children = n.children.slice();
    [children[i], children[j]] = [children[j]!, children[i]!];
    return { ...n, children };
  });
  return { root: next, path: [...parent, j] };
}

export function setComment(root: JosekiNode, path: Path, comment: string): JosekiNode {
  return replaceAt(root, path, (n) => ({ ...n, comment }));
}

export function setMark(root: JosekiNode, path: Path, mark: JosekiMark | null): JosekiNode {
  return replaceAt(root, path, (n) => {
    const next = { ...n };
    if (mark) next.mark = mark;
    else delete next.mark;
    return next;
  });
}

/** 경로에서 한 걸음 — 앞으로는 주 변화, 뒤로는 부모. */
export const stepBack = (path: Path): number[] => path.slice(0, -1);
export function stepForward(root: JosekiNode, path: Path): number[] {
  const n = nodeAt(root, path);
  return n && n.children.length > 0 ? [...path, 0] : [...path];
}
