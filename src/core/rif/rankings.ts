import type { RenjuPack } from "./pack";
import { RES_BLACK, RES_DRAW, RES_WHITE } from "./rif-parse";

/**
 * 랭킹 — 앱 `FreqAnalyzer` · `Rankings.kt`(원본 `freq35.rankings`)의 이식. 팩의 대국 열을 거르고
 * 26주형(3수) · 5수 모양별로 센다. 순수 함수.
 */

export type RankSide = "either" | "black" | "white";

export interface RankingFilter {
  /** 고른 선수(팩의 조밀한 번호). 비면 모두. */
  readonly players: ReadonlySet<number>;
  /** 고른 규칙. 비면 모두. */
  readonly rules: ReadonlySet<number>;
  /** 선수가 그 색을 잡은 판만(선수를 골랐을 때) · 승률 정렬이 읽는 쪽. */
  readonly side: RankSide;
}

export const NO_FILTER: RankingFilter = { players: new Set(), rules: new Set(), side: "either" };

export const filterActive = (f: RankingFilter): boolean =>
  f.players.size > 0 || f.rules.size > 0 || f.side !== "either";

/** 결과 나눔 — 앱 `ResultSplit`(«모름»은 `total` 에만). */
export interface Split {
  total: number;
  black: number;
  white: number;
  draw: number;
}

const emptySplit = (): Split => ({ total: 0, black: 0, white: 0, draw: 0 });

function add(s: Split, res: number): void {
  s.total++;
  if (res === RES_BLACK) s.black++;
  else if (res === RES_WHITE) s.white++;
  else if (res === RES_DRAW) s.draw++;
}

export const decided = (s: Split): number => s.black + s.white + s.draw;

/** `side` 의 점수(무 = 반 점). 결과가 난 판이 없으면 null — 0 과 다르다. */
export function score(s: Split, side: RankSide): number | null {
  const n = decided(s);
  if (!n) return null;
  return ((side === "white" ? s.white : s.black) + s.draw * 0.5) / n;
}

/**
 * 승률 정렬의 열쇠 — 점수 둘레 95% 윌슨 구간의 **아래 끝**(앱 `rankingScore`). 한 판 이겨 100% 인
 * 모양이 20판 11승보다 위에 서지 않게 — 표본이 얕으면 아래 끝이 낮다.
 */
export function rankingScore(s: Split, side: RankSide): number {
  const n = decided(s);
  const p = score(s, side);
  if (p === null) return 0;
  const z = 1.96;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, Math.max(0, (centre - margin) / (1 + z2 / n)));
}

/** 이름 · 나라에 `query` 가 든 선수(대소문자 무시). */
export function matchPlayers(p: RenjuPack, query: string, limit = 20): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  for (let i = 0; i < p.players.length && out.length < limit; i++) {
    if (p.players[i]!.toLowerCase().includes(q) || p.playerCountry[i]!.toLowerCase().includes(q))
      out.push(i);
  }
  return out;
}

/**
 * 판 g 가 고른 범위에 드는가. 색을 고르면 선수가 **그 색을** 잡은 판만 — «Alice 의 흑» 은 «Alice» 와
 * 다른 판 묶음이다. 색만으로는 아무것도 줄지 않는다(모든 판에 흑과 백이 있다).
 */
function matches(p: RenjuPack, g: number, f: RankingFilter): boolean {
  if (f.rules.size && !f.rules.has(p.games.rule[g]!)) return false;
  if (!f.players.size) return true;
  const b = f.players.has(p.games.black[g]!);
  const w = f.players.has(p.games.white[g]!);
  return f.side === "black" ? b : f.side === "white" ? w : b || w;
}

export interface OpeningRow {
  /** 0..25, 26 = 규칙 밖. */
  readonly opening: number;
  readonly split: Split;
}

/** 26주형(3수) 랭킹 — 판 수 내림차순. */
export function openingRanking(
  p: RenjuPack,
  f: RankingFilter,
): { total: number; rows: OpeningRow[] } {
  const splits = new Map<number, Split>();
  let total = 0;
  for (let g = 0; g < p.games.o3.length; g++) {
    if (!matches(p, g, f)) continue;
    total++;
    const o = p.games.o3[g]!;
    let s = splits.get(o);
    if (!s) splits.set(o, (s = emptySplit()));
    add(s, p.games.res[g]!);
  }
  const rows = [...splits].map(([opening, split]) => ({ opening, split }));
  rows.sort((a, b) => b.split.total - a.split.total || a.opening - b.opening);
  return { total, rows };
}

export interface ShapeRow {
  readonly shape: number;
  /** 대표 수순 `"h8 h9 …"`. */
  readonly moves: string;
  readonly opening: number;
  readonly split: Split;
}

/** 5수 모양 랭킹 — 많이 둔 순, `top` 개까지. */
export function fiveMoveRanking(p: RenjuPack, f: RankingFilter, top = 60): ShapeRow[] {
  const splits = new Map<number, Split>();
  const opening = new Map<number, number>();
  for (let g = 0; g < p.games.k5.length; g++) {
    const k = p.games.k5[g]!;
    if (k < 0 || !matches(p, g, f)) continue;
    let s = splits.get(k);
    if (!s) {
      splits.set(k, (s = emptySplit()));
      opening.set(k, p.games.o3[g]!);
    }
    add(s, p.games.res[g]!);
  }
  return [...splits]
    .sort((a, b) => b[1].total - a[1].total || a[0] - b[0])
    .slice(0, top)
    .map(([shape, split]) => ({
      shape,
      moves: p.shapes[shape] ?? "",
      opening: opening.get(shape) ?? 26,
      split,
    }));
}
