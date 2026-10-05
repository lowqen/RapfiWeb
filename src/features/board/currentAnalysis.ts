import { useMemo } from "react";
import { create } from "zustand";
import { isSameOrAncestorKey, positionKey } from "../../core/model/move";
import { useEngineStore } from "../../engine/engine-state";
import { EMPTY_SNAPSHOT, type AnalysisSnapshot } from "../../engine/engine-types";
import type { EvalView } from "../../engine/eval-view";
import { useBoardStore } from "./boardStore";

/**
 * 엔진의 답을 **지금 판에** 짝짓는 곳.
 *
 * 엔진 스토어의 스냅샷·평가에는 그 탐색 국면의 키가 붙어 온다(`snapshotKey`·`evalKey`).
 * 화면은 그 키를 지금 판의 키와 견줘서만 그린다 — 그래서 무르기·처음으로·새 판 직후,
 * 새 탐색의 첫 스냅샷이 오기 전에 **옛 국면의 값 칩·PV·최선수·평가가 새 판에 남지
 * 않는다.** 따로 「지우기」를 부를 곳을 하나하나 챙기는 대신, 키가 어긋나면 비어 보인다.
 */

/** 지금 판의 국면 키. */
export function useBoardKey(): string {
  const stones = useBoardStore((s) => s.render.stones);
  return useMemo(() => positionKey(stones), [stones]);
}

/** 지금 판의 분석 — 엔진이 다른 국면을 말하고 있으면 빈 스냅샷. */
export function useCurrentAnalysis(): AnalysisSnapshot {
  const key = useBoardKey();
  const snapshot = useEngineStore((s) => s.snapshot);
  const snapshotKey = useEngineStore((s) => s.snapshotKey);
  return snapshotKey === key ? snapshot : EMPTY_SNAPSHOT;
}

/**
 * 평가 바가 그릴 값. **지금 국면이나 그 앞 국면**의 값만 쓴다 — 수를 두면 새 값이 올
 * 때까지 앞 값을 그대로 두고(체스닷컴처럼 비지 않는다), 무르면 **뒤 국면**의 값이므로
 * 버린다. 무른 판에서 바가 앞날의 형세를 말하면 그것이 곧 「정리되지 않은 상태」다.
 */
export function useCurrentEval(): EvalView | null {
  const key = useBoardKey();
  const view = useEngineStore((s) => s.evalView);
  const evalKey = useEngineStore((s) => s.evalKey);
  return view && evalKey !== null && isSameOrAncestorKey(evalKey, key) ? view : null;
}

// ── 형세 기록 ───────────────────────────────────────────────────────

/** 기억할 국면 수 상한. 넘으면 오래된 것부터 버린다(225수 대국 열여섯 판 남짓). */
const HISTORY_MAX = 4000;

interface EvalHistory {
  /** 국면 키 → 그 국면에서 엔진이 마지막으로 말한 평가(흑 관점). */
  byKey: Map<string, EvalView>;
  /** 바뀔 때마다 오른다 — 화면은 맵 대신 이것을 구독한다(맵은 제자리에서 고친다). */
  version: number;
}

/**
 * 형세 그래프의 자료 — 엔진이 평가를 낼 때마다 **그 국면의 키로** 적어 둔다. 분석이든
 * 대국의 착수 탐색이든 같은 국면의 같은 평가다. 키가 수순이라 무르기·앞으로·갈래가
 * 바뀌어도 그래프는 기보를 따라 저절로 맞는다.
 */
export const useEvalHistory = create<EvalHistory>(() => ({ byKey: new Map(), version: 0 }));

useEngineStore.subscribe((s, prev) => {
  if (!s.evalView || s.evalKey === null) return;
  if (s.evalView === prev.evalView && s.evalKey === prev.evalKey) return;
  const { byKey } = useEvalHistory.getState();
  byKey.delete(s.evalKey); // 다시 넣어 「최근」으로 — 상한에서 버리는 순서가 오래된 것부터다
  byKey.set(s.evalKey, s.evalView);
  if (byKey.size > HISTORY_MAX) {
    const oldest = byKey.keys().next().value;
    if (oldest !== undefined) byKey.delete(oldest);
  }
  useEvalHistory.setState((h) => ({ version: h.version + 1 }));
});
