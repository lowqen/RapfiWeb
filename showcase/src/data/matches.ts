/**
 * gomocalc 대조 대국 — `bench/sprt/match-report.mjs` 가 CI 기보(match-gomocalc.yml)에서 만든 JSON 그대로.
 * 다시 만들려면 보고서 `docs/gomocalc-대국-분석.md` 의 「재현」 절.
 */
import mainRaw from "./match-relaxed.json";
import controlRaw from "./match-simd.json";

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

/** 본 매치 — RapfiWeb single-simd128-relaxed(배포 1 스레드 최강) vs gomocalc single-simd128 */
export const MAIN = mainRaw as unknown as MatchReport;
/** 대조 — 같은 ISA(일반 SIMD)끼리: relaxed 몫을 빼고 소스 · 패치 몫만 */
export const CONTROL = controlRaw as unknown as MatchReport;
