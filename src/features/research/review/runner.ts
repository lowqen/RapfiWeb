import { result as refereeResult } from "../../../core/model/referee";
import type { Move } from "../../../core/model/move";
import {
  EMPTY_RECORD,
  SKIP_OPENING_N,
  type PositionRecord,
} from "../../../core/review/move-quality";
import { budgetLabel, watchdogSeconds, type ReviewBudget } from "../../../core/review/report";
import type {
  AnalysisSnapshot,
  EngineCommand,
  PvSnapshot,
  Placement,
} from "../../../engine/engine-types";
import { winRateFromEval } from "../../../engine/eval-view";

/**
 * 리뷰 파이프라인 — 앱 `ReviewRepositoryImpl` 의 루프(원본은 main.c:6964-7260
 * `game_review` · `review_analyze_current` · `review_on_bestmove` · `review_finish`).
 *
 * 국면마다 `YXNBEST 2` 로 읽는다: PV0 이 국면의 값과 엔진의 최선수를, PV1 과의 차가
 * 판정기가 쓰는 «유일한 수» 신호를 준다. 데스크톱의 네 배열이 국면마다 `PositionRecord`
 * 하나가 된다.
 *
 * 앱처럼 **보이는 판을 걷지 않는다** — 리뷰는 제 수순 사본을 들고 국면만 엔진에 밀어 넣으므로,
 * 리뷰가 도는 동안 사용자는 다른 것을 볼 수 있다.
 *
 * 엔진과 시계는 `ReviewPort` 로 받는다 — 시험이 진짜 엔진 없이 루프를 돌린다.
 */

/** `yxnbest 2` — 둘째 PV 가 «유일한 수» 등급에 필요하다. */
export const REVIEW_PV = 2;

/** 렌주에서 장목은 흑의 금수라 승패 판정에서는 장목을 인정한다(대국과 같다). */
const ALLOW_OVERLINE = true;

export interface ReviewPort {
  /** 독점 탐색 하나. 끝나면 마지막 스냅샷, 엔진이 사라지면 `null`. */
  search(
    stones: readonly Placement[],
    opts: { totalMs: number; nbest: number; info: readonly EngineCommand[] },
    onSnapshot: (s: AnalysisSnapshot) => void,
  ): Promise<AnalysisSnapshot | null>;
  /** 도는 탐색을 멈춘다 — `search` 는 그때까지의 스냅샷으로 끝난다. */
  stop(): void;
}

export interface RunState {
  readonly moves: readonly Move[];
  readonly size: number;
  /** 국면마다 기록(길이 `moves.length + 1`). 이어서 할 때는 앞부분이 이미 차 있다. */
  readonly records: readonly PositionRecord[];
  /** 다음에 읽을 국면 번호 0..moves.length. */
  readonly index: number;
}

export interface RunHooks {
  /** 국면 하나를 끝낼 때마다 — 체크포인트. */
  onCheckpoint(records: readonly PositionRecord[], index: number): void | Promise<void>;
  onProgress(index: number, total: number): void;
  isCancelled(): boolean;
  log(text: string): void;
}

export type RunOutcome =
  | { kind: "done"; records: PositionRecord[] }
  | { kind: "cancelled"; records: PositionRecord[]; index: number }
  | { kind: "failed"; records: PositionRecord[]; index: number; reason: string };

/** 엔진이 받는 모양으로 — `own` 은 «엔진이 둘 색», 곧 다음 차례다. */
export function placementsOf(moves: readonly Move[]): Placement[] {
  const blackToMove = moves.length % 2 === 0;
  return moves.map((move, i) => ({ move, own: (i % 2 === 0) === blackToMove }));
}

/** 독점 탐색에 얹는 `INFO` — `review_send_budget`(main.c:7073). 노드는 무제한. */
export function budgetInfo(b: ReviewBudget, size: number): EngineCommand[] {
  return [
    { kind: "info", key: "max_node", value: -1 },
    { kind: "info", key: "max_depth", value: b.byDepth ? b.depth : size * size },
  ];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** PV 하나의 승률(두는 쪽 관점) — 메이트는 1 / 0 으로 붙인다(`review_on_pvdone`). */
function pvWinRate(pv: PvSnapshot): number | null {
  if ((pv.mate ?? 0) > 0) return 1;
  if ((pv.mate ?? 0) < 0) return 0;
  if (pv.winRate !== null) return clamp01(pv.winRate);
  return pv.evalCp !== null ? winRateFromEval(pv.evalCp) / 100 : null;
}

/**
 * 탐색 결과 → 국면 기록(`review_on_bestmove`, main.c:7167). `ply` 는 그 국면의 돌 수.
 *
 * 데스크톱의 평가 바는 메이트를 1.0 / 0.0 으로 붙인 뒤 `wrhistory` 에 넣는다 — 여기도 같다.
 * PV 목록이 비었으면(즉답 등) 전체 통계로 물러서고, 그것도 없으면 값 없이 최선수만 남긴다.
 */
export function recordFromSnapshot(snap: AnalysisSnapshot | null, ply: number): PositionRecord {
  if (!snap) return EMPTY_RECORD;
  const blackToMove = ply % 2 === 0;
  const pvs = [...snap.pvs].sort((a, b) => a.index - b.index);
  const top = pvs[0];
  const mate = top ? (top.mate ?? 0) : (snap.stats.mate ?? 0);
  const blackMate = blackToMove ? mate : -mate;
  let rate: number | null;
  if (top) rate = pvWinRate(top);
  else if (snap.stats.winRatePct !== null) rate = clamp01(snap.stats.winRatePct / 100);
  else rate = snap.stats.evalCp !== null ? winRateFromEval(snap.stats.evalCp) / 100 : null;
  const blackWinRate =
    blackMate > 0 ? 1 : blackMate < 0 ? 0 : rate === null ? null : blackToMove ? rate : 1 - rate;
  let gap: number | null = null;
  if (pvs.length >= 2) {
    const a = pvWinRate(pvs[0]!);
    const b = pvWinRate(pvs[1]!);
    gap = a === null || b === null ? null : Math.max(0, a - b);
  }
  const best = snap.bestMove ?? top?.line[0] ?? null;
  return { blackWinRate, blackMate, best, gap };
}

/** 깊이 예산을 다 읽었나 — 둘째 PV 까지 그 깊이에 닿아야(있다면) 차이가 그 깊이의 값이다. */
export function depthReached(snap: AnalysisSnapshot, depth: number): boolean {
  if (snap.stats.depth < depth) return false;
  const deep = snap.pvs.filter((p) => p.depth >= depth).length;
  return snap.pvs.length < 2 ? true : deep >= 2;
}

/**
 * 한 수순을 리뷰한다. `state` 의 `index` 부터 이어 간다(체크포인트에서 되살린 경우).
 * 취소되거나 엔진이 사라지면 그 자리까지의 기록과 번호를 돌려준다 — 다음에 거기서 잇는다.
 */
export async function runReview(
  state: RunState,
  opts: { budget: ReviewBudget; skipOpening: boolean },
  port: ReviewPort,
  hooks: RunHooks,
): Promise<RunOutcome> {
  const { moves, size } = state;
  const total = moves.length;
  const records: PositionRecord[] = Array.from(
    { length: total + 1 },
    (_, i) => state.records[i] ?? EMPTY_RECORD,
  );
  const { budget, skipOpening } = opts;
  const info = budgetInfo(budget, size);
  const totalMs = budget.byDepth ? Infinity : budget.seconds * 1000;
  let index = Math.max(0, Math.min(state.index, total + 1));

  if (index === 0) hooks.log(`게임 리뷰 시작: ${total + 1}개 국면, 수당 ${budgetLabel(budget)}`);
  else hooks.log(`게임 리뷰 이어서: ${index}/${total + 1}부터, 수당 ${budgetLabel(budget)}`);

  while (index <= total) {
    if (hooks.isCancelled()) return { kind: "cancelled", records, index };
    hooks.onProgress(index, total);
    // 첫 국면들은 아예 읽지 않는다(등급도 매기지 않는다).
    if (skipOpening && index < SKIP_OPENING_N) {
      index++;
      continue;
    }
    const prefix = moves.slice(0, index);
    if (refereeResult(prefix, size, ALLOW_OVERLINE) !== null) {
      // 여기서 대국이 끝났다 — 마지막에 둔 쪽이 이겼다. 탐색할 것이 없다.
      records[index] = {
        blackWinRate: index % 2 === 1 ? 1 : 0,
        blackMate: 0,
        best: null,
        gap: null,
      };
      index++;
      await hooks.onCheckpoint(records, index);
      continue;
    }

    let stopped = false;
    const stopOnce = () => {
      if (stopped) return;
      stopped = true;
      port.stop();
    };
    // 감시견: 엔진이 답하지 않으면 그때까지 읽은 것으로 넘어간다.
    const watchdog = setTimeout(
      () => {
        hooks.log(`리뷰: 엔진 응답이 없어 ${index}번 국면을 그때까지의 값으로 넘깁니다`);
        stopOnce();
      },
      watchdogSeconds(budget) * 1000,
    );
    const snap = await port.search(
      placementsOf(prefix),
      { totalMs, nbest: REVIEW_PV, info },
      (s) => {
        // 즉답(막아야만 하는 수 · 오목을 만드는 수)은 더 읽을 것이 없다 — 예산을 기다리지 않는다.
        if (s.instant) stopOnce();
        else if (budget.byDepth && depthReached(s, budget.depth)) stopOnce();
        else if (hooks.isCancelled()) stopOnce();
      },
    );
    clearTimeout(watchdog);
    if (hooks.isCancelled()) return { kind: "cancelled", records, index };
    if (!snap) {
      return { kind: "failed", records, index, reason: "엔진이 내려가 리뷰를 멈췄습니다" };
    }
    records[index] = recordFromSnapshot(snap, index);
    index++;
    await hooks.onCheckpoint(records, index);
  }
  hooks.onProgress(total + 1, total);
  hooks.log(`게임 리뷰 완료: ${total + 1}개 국면`);
  return { kind: "done", records };
}
