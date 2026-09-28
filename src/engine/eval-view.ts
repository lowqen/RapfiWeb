import type { SearchStats } from "./engine-types";

/**
 * 평가 바가 그릴 값 — **흑의 관점**으로 돌려 놓은 것.
 *
 * 엔진의 EVAL·WINRATE 는 **둘 차례**의 관점이다(Rapfi 가 탐색 루트에서 잰 값).
 * 흑 차례 국면이면 그대로 흑의 값이고, 백 차례면 뒤집어야 흑의 값이 된다. 뒤집지
 * 않으면 수를 둘 때마다 바가 위아래로 널뛴다.
 */
export interface EvalView {
  /** 흑의 승률 0..100 — 바에서 흑이 차지하는 몫. */
  blackPct: number;
  /** 흑 관점 평가값. 외통이면 null. */
  blackEval: number | null;
  /** 외통이면 이기는 쪽과 수. */
  mate: { winner: "black" | "white"; plies: number } | null;
}

/**
 * Rapfi 의 승률은 평가값의 로지스틱이고 척도는 200 이다. 엔진 출력 캡처에서
 * 되짚었다: EVAL −223 ↔ WINRATE 0.24694, −338 ↔ 0.155776 — 둘 다
 * `1 / (1 + e^(−eval/200))` 와 소수 넷째 자리까지 맞는다. 승률 줄이 아직 없고
 * 평가값만 있을 때(사람이 읽는 줄뿐일 때) 이것으로 채운다.
 */
export const WINRATE_SCALE = 200;
export const winRateFromEval = (evalCp: number): number =>
  100 / (1 + Math.exp(-evalCp / WINRATE_SCALE));

/**
 * `ply` 는 그 탐색 국면의 돌 수다 — 짝수면 흑 차례. 그릴 값이 없으면 `null`
 * (새 탐색의 첫 스냅샷처럼 아직 아무것도 모를 때).
 */
export function toEvalView(stats: SearchStats, ply: number): EvalView | null {
  const blackToMove = ply % 2 === 0;
  if (stats.mate !== null && stats.mate !== 0) {
    const moverWins = stats.mate > 0;
    const winner = moverWins === blackToMove ? "black" : "white";
    return {
      blackPct: winner === "black" ? 100 : 0,
      blackEval: null,
      mate: { winner, plies: Math.abs(stats.mate) },
    };
  }
  const moverPct =
    stats.winRatePct ?? (stats.evalCp !== null ? winRateFromEval(stats.evalCp) : null);
  if (moverPct === null) return null;
  const pct = Math.min(100, Math.max(0, moverPct));
  return {
    blackPct: blackToMove ? pct : 100 - pct,
    blackEval: stats.evalCp === null ? null : blackToMove ? stats.evalCp : -stats.evalCp,
    mate: null,
  };
}
