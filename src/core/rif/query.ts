import { move, type Move } from "../model/move";
import { inverse, tf } from "../model/pos-key";
import type { RenjuPack } from "./pack";
import { ZobristScanner, canonicalHash } from "./zobrist";

/**
 * 팩 조회 — 앱 `ExplorerLookup` 의 «둔 수» 절반. 순수 함수라 화면 · 워커 어디서든 부른다.
 *
 * 저장된 다음 수는 **정규 프레임**의 칸이다. 지금 판의 해시가 고른 대표 대칭(`transform`)의
 * 역으로 판 위에 되돌린다(`pos-key.toBoard` 와 같은 식). 대칭 국면이면 같은 수의 상이 여럿인데
 * 그중 하나에 그린다(데스크톱 · 앱과 같다).
 */

export interface ResultSplit {
  readonly n: number;
  readonly b: number;
  readonly d: number;
  readonly w: number;
}

export interface NextMoveStat extends ResultSplit {
  readonly move: Move;
}

export interface PositionStat extends ResultSplit {
  readonly next: readonly NextMoveStat[];
}

/** (hi, lo) 의 국면 번호, 없으면 -1. */
export function findPosition(p: RenjuPack, hi: number, lo: number): number {
  const H = p.pos.hi;
  const L = p.pos.lo;
  let a = 0;
  let b = H.length - 1;
  while (a <= b) {
    const m = (a + b) >>> 1;
    const h = H[m]!;
    const l = L[m]!;
    if (h === hi && l === lo) return m;
    if (h < hi || (h === hi && l < lo)) a = m + 1;
    else b = m - 1;
  }
  return -1;
}

/** 지금 판의 국면 통계와 다음 수(판 수 내림차순). 팩이 모르는 국면이면 null. */
export function lookup(p: RenjuPack, moves: readonly Move[]): PositionStat | null {
  if (moves.length > p.maxPlies) return null;
  const c = canonicalHash(moves, p.size);
  const i = findPosition(p, c.hi, c.lo);
  if (i < 0) return null;
  const inv = inverse(c.transform);
  const next: NextMoveStat[] = [];
  for (let k = p.pos.edgeStart[i]!; k < p.pos.edgeStart[i + 1]!; k++) {
    const cell = p.edges.cell[k]!;
    next.push({
      move: tf(inv, p.size, move(cell % p.size, Math.floor(cell / p.size))),
      n: p.edges.n[k]!,
      b: p.edges.b[k]!,
      d: p.edges.d[k]!,
      w: p.edges.w[k]!,
    });
  }
  return { n: p.pos.n[i]!, b: p.pos.b[i]!, d: p.pos.d[i]!, w: p.pos.w[i]!, next };
}

/**
 * 지금 국면을 지난 판들(판 번호) — 수순 열을 훑어 그 자리에서 센다. 전치도 걸린다: 첫 n 수의
 * 돌 집합이 같으면(정규 해시가 같으면) 수순이 달라도 같은 국면이다. `accept` 로 선수 이름 따위를
 * 거르고, `limit` 개까지 담되 `matched` 는 끝까지 센다(데스크톱 · 앱처럼 «n판 중 m판 표시»).
 */
export function gamesThrough(
  p: RenjuPack,
  moves: readonly Move[],
  opts: { accept?: (game: number) => boolean; limit?: number } = {},
): { games: number[]; matched: number } {
  const n = moves.length;
  const want = canonicalHash(moves, p.size);
  const z = new ZobristScanner(p.size);
  const G = p.games;
  const limit = opts.limit ?? Infinity;
  const out: number[] = [];
  let matched = 0;
  for (let g = 0; g < G.moveLen.length; g++) {
    if (G.moveLen[g]! < n) continue;
    const s = G.moveStart[g]!;
    z.reset();
    for (let i = 0; i < n; i++) z.push(G.moves[s + i]!);
    z.canonical();
    if (z.hi !== want.hi || z.lo !== want.lo) continue;
    if (opts.accept && !opts.accept(g)) continue;
    matched++;
    if (out.length < limit) out.push(g);
  }
  return { games: out, matched };
}

/** 판 하나의 수순(판 위 좌표). */
export function gameMoves(p: RenjuPack, game: number): Move[] {
  const s = p.games.moveStart[game]!;
  const out: Move[] = [];
  for (let i = 0; i < p.games.moveLen[game]!; i++) {
    const c = p.games.moves[s + i]!;
    out.push(move(c % p.size, Math.floor(c / p.size)));
  }
  return out;
}

/** 흑 점수(무 = 반 점) — 결과가 난 판이 없으면 null. */
export function blackScore(s: ResultSplit): number | null {
  const decided = s.b + s.d + s.w;
  return decided ? (s.b + s.d * 0.5) / decided : null;
}
