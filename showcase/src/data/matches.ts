/**
 * gomocalc 대조 대국 — `bench/sprt/match-report.mjs` 가 CI 기보(match-gomocalc.yml)에서 만든 JSON 그대로.
 * 다시 만들려면 보고서 `docs/gomocalc-대국-분석.md` 의 「재현」 절.
 */
// 있는 것만 싣는다 — CPU 별 재측정(match-relaxed-<cpu>.json)은 런이 끝나 파일이 생기면 저절로 화면에 나온다.
const FILES = import.meta.glob<MatchReport>("./match-*.json", { eager: true, import: "default" });
const need = (name: string): MatchReport => {
  const m = FILES[`./${name}`];
  if (!m) throw new Error(`쇼케이스 데이터가 없습니다: ${name}`);
  return m;
};

export interface Interval {
  elo: number;
  low: number;
  high: number;
}

export interface SearchStat {
  moves: number;
  nps: number | null;
  avgDepth: number | null;
  avgSelDepth: number | null;
  avgMoveMs: number | null;
}

export interface MatchReport {
  label: string;
  run: string | null;
  runner: string | null;
  engines: { A: string; B: string };
  tc: { A: { turn: number } };
  openingsCount: number;
  concurrency: number;
  sprt: {
    elo0: number;
    elo1: number;
    llr: number;
    lower: number;
    upper: number;
    decided: { decision: "H0" | "H1"; game: number; llr: number } | null;
  };
  games: number;
  wdl: { w: number; d: number; l: number };
  drawRatio: number;
  penta: number[];
  elo: {
    pentanomial: Interval & { score: number; los: number };
    trinomial: Interval & { score: number; los: number };
  };
  colors: Record<"black" | "white", { w: number; d: number; l: number }>;
  reasons: Record<string, number>;
  faults: Record<string, Record<string, number>>;
  faultRate: number;
  plies: {
    median: number;
    p10: number;
    p90: number;
    mean: number;
    bins: { from: number; to: number; n: number }[];
  };
  avgGameSec: number;
  wallSec: number;
  leaked: number;
  search: { A: SearchStat; B: SearchStat } | null;
  speedElo: { npsRatio: number; predicted: number; low: number; high: number } | null;
  trajectory: { games: number; elo: number; low: number; high: number; llr: number }[];
  openings: { opening: string; games: number; score: number; pct: number }[];
}

/** 본 매치 — Zenyth Web single-simd128-relaxed(배포 1 스레드 최강) vs gomocalc single-simd128 */
export const MAIN = need("match-relaxed.json");
/** 대조 — 같은 ISA(일반 SIMD)끼리: relaxed 몫을 빼고 소스 · 패치 몫만 */
export const CONTROL = need("match-simd.json");
/** 본 매치를 AMD EPYC 7B13 에서 다시 둔 것 — 없으면 null */
export const AMD: MatchReport | null = FILES["./match-relaxed-amd7b13.json"] ?? null;
/** 멀티스레드 — 둘 다 multi-simd128-relaxed · 2 스레드(Intel Xeon 8581C) — 없으면 null */
export const MULTI: MatchReport | null = FILES["./match-multi-t2.json"] ?? null;
