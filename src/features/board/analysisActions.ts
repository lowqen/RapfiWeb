import { REVIEW_BUSY, useGameStore } from "./gameStore";
import { useBoardStore } from "./boardStore";
import { useEngineStore } from "../../engine/engine-state";
import { useSettingsStore } from "../settings/settingsStore";
import { useBoardNotice } from "./boardNotice";

/** 엔진 상태의 짧은 이름 — 분석 카드와 대국 카드가 함께 쓴다. */
export const STATUS_TEXT: Record<string, string> = {
  idle: "꺼짐",
  starting: "기동 중",
  ready: "대기",
  searching: "탐색 중",
  error: "오류",
};

/**
 * 분석 시작 — 카드의 「분석」과 이동 바의 ▶ 가 같은 길을 걷는다. 게임 리뷰가 엔진을 쥐고
 * 있으면 시작하지 않고 그 까닭을 보드 위에 띄운다(엔진 스토어는 조용히 거절만 한다).
 */
export function useStartAnalysis(): () => void {
  const analyze = useEngineStore((s) => s.analyze);
  const placements = useBoardStore((s) => s.placements);
  const show = useBoardNotice((s) => s.show);
  return () => {
    if (useEngineStore.getState().owner) {
      show(REVIEW_BUSY);
      return;
    }
    void analyze(placements());
  };
}

/**
 * 분석 정지 — 카드의 「정지」와 이동 바의 ⏸ 가 같은 길을 걷는다. 설정이 켜져 있으면
 * 최선수를 두고, 못 두면(새 국면의 답이 아직 없음 · 금수 등) 그 까닭을 보드 위에 띄운다.
 */
export function useStopAnalysis(): () => void {
  const stopAnalysis = useGameStore((s) => s.stopAnalysis);
  const playBest = useSettingsStore((s) => s.playBestOnStop);
  const show = useBoardNotice((s) => s.show);
  return () => {
    const r = stopAnalysis({ playBest });
    show(r.kind === "rejected" ? `정지했습니다 — ${r.reason}` : null);
  };
}
