import type { KeyboardEvent } from "react";
import { useGameStore, type BoardMode } from "./gameStore";
import { msg, t } from "../../i18n/i18n";

/** 분석이 먼저다 — 처음 여는 사람의 기본 탭이기도 하다(`gameStore` 의 `loadMode`). */
const TABS: readonly { mode: BoardMode; label: string; hint: string }[] = [
  { mode: "analysis", label: msg("분석"), hint: msg("엔진이 국면을 읽고, 판은 자유롭게 둡니다") },
  { mode: "game", label: msg("대국"), hint: msg("사람 대 컴퓨터. 엔진이 제 차례에 둡니다") },
];

/** 옆 칸 패널의 id — 탭이 `aria-controls` 로 가리킨다. */
export const MODE_PANEL_ID = "board-mode-panel";

/**
 * 보드 위의 [분석] | [대국] 탭. 판(기보)은 둘이 함께 쓰고, 탭을 바꾸면 엔진의 쓰임이
 * 갈린다 — 생각하던 대국의 수는 버리고, 도는 분석은 멈춘다(`gameStore` 의 `BoardMode`).
 *
 * WAI-ARIA 탭 패턴: 고른 탭만 Tab 순서에 들고, ← → 로 옮기면 곧바로 그 탭이 된다.
 */
export function ModeTabs() {
  const mode = useGameStore((s) => s.mode);
  const setMode = useGameStore((s) => s.setMode);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // 이동 바의 ← → (기보 이동)와 겹치지 않게 여기서 멈춘다.
    e.preventDefault();
    e.stopPropagation();
    const i = TABS.findIndex((tab) => tab.mode === mode);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    setMode(next.mode);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next.mode}"]`)?.focus();
  };

  return (
    <div className="modetabs" role="tablist" aria-label={t("보드 모드")} onKeyDown={onKey}>
      {TABS.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          role="tab"
          className="modetabs__tab"
          data-mode={tab.mode}
          aria-selected={mode === tab.mode}
          aria-controls={MODE_PANEL_ID}
          tabIndex={mode === tab.mode ? 0 : -1}
          title={t(tab.hint)}
          onClick={() => setMode(tab.mode)}
        >
          {t(tab.label)}
        </button>
      ))}
    </div>
  );
}
