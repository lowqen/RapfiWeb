import { writePsq } from "../model/game-file";
import { DEFAULT_SIZE, inBoard, moveKey, type Move } from "../model/move";
import { keyOf as posKeyOf } from "../model/pos-key";
import {
  MARKS,
  emptyNode,
  movesTo,
  newId,
  walk,
  type JosekiMark,
  type JosekiNode,
  type JosekiTree,
  type Path,
} from "./tree";

/**
 * 정석 주고받기 — 자체 JSON(`schema: 1`) 과 변화 하나의 `.psq`(계획서 §7). RenjuNet 과 무관한
 * 사용자 자신의 데이터라 공유에 제약이 없다.
 *
 * 가져오기는 **검증한다**: 판 밖 · 겹친 수 · 모르는 기호는 버리고(그 아래 가지째), 글은 문자열만,
 * 크기에 상한을 둔다. 남의 파일이 화면을 깨거나 문서를 부풀리지 못하게.
 */

export const FORMAT = "rapfiweb-joseki";
const MAX_COMMENT = 20_000;
const MAX_TITLE = 200;

export interface JosekiFile {
  format: typeof FORMAT;
  schema: 1;
  exportedAt: number;
  trees: JosekiTree[];
}

export function exportJson(trees: readonly JosekiTree[], now = Date.now()): string {
  const file: JosekiFile = { format: FORMAT, schema: 1, exportedAt: now, trees: [...trees] };
  return JSON.stringify(file, null, 1);
}

export type ImportResult =
  { ok: true; trees: JosekiTree[]; dropped: number } | { ok: false; error: string };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** 마디 하나를 검증하며 옮긴다. 둘 수 없는 수는 그 가지째 버리고 센다. */
function cleanNode(
  raw: unknown,
  line: Set<number>,
  size: number,
  drop: { n: number },
  depth: number,
): JosekiNode {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out = emptyNode(null);
  out.comment = str(r.comment, MAX_COMMENT);
  if (typeof r.mark === "string" && (MARKS as readonly string[]).includes(r.mark))
    out.mark = r.mark as JosekiMark;
  const kids = Array.isArray(r.children) ? r.children : [];
  if (depth >= size * size) {
    drop.n += kids.length;
    return out;
  }
  for (const k of kids) {
    const kr = (k ?? {}) as Record<string, unknown>;
    const mv = kr.move as { x?: unknown; y?: unknown } | null | undefined;
    const m: Move | null =
      mv && Number.isInteger(mv.x) && Number.isInteger(mv.y)
        ? { x: mv.x as number, y: mv.y as number }
        : null;
    if (
      !m ||
      !inBoard(m, size) ||
      line.has(moveKey(m, size)) ||
      out.children.some((c) => c.move!.x === m.x && c.move!.y === m.y)
    ) {
      drop.n++;
      continue;
    }
    const key = moveKey(m, size);
    line.add(key);
    const child = cleanNode(k, line, size, drop, depth + 1);
    line.delete(key);
    out.children.push({ ...child, move: m });
  }
  return out;
}

export function cleanTree(
  raw: unknown,
  now = Date.now(),
): { tree: JosekiTree; dropped: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.root || typeof r.root !== "object") return null;
  const size = r.boardSize === DEFAULT_SIZE || r.boardSize === undefined ? DEFAULT_SIZE : null;
  if (size === null) return null; // 렌주 전용(15×15)
  const drop = { n: 0 };
  const root = cleanNode(r.root, new Set(), size, drop, 0);
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    dropped: drop.n,
    tree: {
      id: typeof r.id === "string" && r.id ? r.id.slice(0, 64) : newId(),
      title: str(r.title, MAX_TITLE) || "가져온 정석",
      category: str(r.category, MAX_TITLE),
      tags: Array.isArray(r.tags)
        ? r.tags
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.slice(0, 40))
            .slice(0, 32)
        : [],
      boardSize: size,
      rule: "renju",
      root,
      createdAt: num(r.createdAt, now),
      updatedAt: num(r.updatedAt, now),
      schema: 1,
    },
  };
}

/** JSON 하나 — 우리 내보내기(`{format, trees}`) · 정석 하나 · 정석 배열을 다 받는다. */
export function importJson(text: string, now = Date.now()): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON 이 아닙니다" };
  }
  const list: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as JosekiFile).trees)
      ? (data as JosekiFile).trees
      : [data];
  const trees: JosekiTree[] = [];
  let dropped = 0;
  for (const raw of list) {
    const c = cleanTree(raw, now);
    if (!c) continue;
    trees.push(c.tree);
    dropped += c.dropped;
  }
  if (trees.length === 0) return { ok: false, error: "정석이 들어 있지 않습니다" };
  return { ok: true, trees, dropped };
}

/** 경로까지의 변화 하나를 `.psq` 로. */
export const exportPsq = (t: JosekiTree, path: Path): Uint8Array<ArrayBuffer> =>
  writePsq(movesTo(t.root, path), t.boardSize);

/** 국면 색인 한 줄 — 정규 키(대칭 · 회전이 같은 키)와 그 마디. */
export interface JosekiKey {
  key: string;
  path: number[];
  ply: number;
}

/** 수가 있는 모든 마디의 정규 키(`PosKey.canonical`). 같은 문서 안의 같은 키는 처음 것만. */
export function indexKeys(t: JosekiTree): JosekiKey[] {
  const out: JosekiKey[] = [];
  const seen = new Set<string>();
  walk(t.root, (_n, path, moves) => {
    if (moves.length === 0) return;
    const key = posKeyOf(moves, t.boardSize);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, path, ply: moves.length });
  });
  return out;
}
