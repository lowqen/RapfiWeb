import { useGameStore } from "./gameStore";
import { COMPUTER_SIDE_LABEL, swappedSide } from "../../core/model/game";
import { Icon } from "../../components/icons";
import { ICON } from "../../components/icon-paths";
import { t } from "../../i18n/i18n";

/**
 * 보드 위의 퀵 액션 바 — **새 판 · 진영 전환**. 진영 전환과 컴퓨터 색 표시는 [대국] 탭에만
 * 있다 — [분석] 탭에서는 엔진이 차례를 받지 않으므로 바꿀 진영이 없다.
 *
 * 분석 켜기/끄기 · 무르기 · 되돌리기는 여기 두지 않는다. 셋 다 보드 밑의 이동 바
 * (`MoveTransport` — ▶ 와 ‹ ›)가 이미 하는 일이라, 위아래에 같은 버튼이 두 벌 있으면
 * 어느 쪽을 눌러야 하는지 되묻게 된다. 이 바에는 이동 바에 **없는** 대국 조작만 남긴다.
 *
 * 이름(aria-label)은 스모크가 집는 「분석」「정지」「엔진 시작」「지금 두기」와 겹치지
 * 않게 지었다 — 겹치면 이름으로 찾는 시험이 두 버튼을 동시에 집는다.
 */
export function QuickActions() {
  const thinking = useGameStore((s) => s.thinking);
  const prompt = useGameStore((s) => s.prompt);
  const side = useGameStore((s) => s.computerSide);
  const newGame = useGameStore((s) => s.newGame);
  const swapSides = useGameStore((s) => s.swapSides);
  const game = useGameStore((s) => s.mode === "game");

  const canSwap = (side === "white" || side === "black") && !thinking && prompt === null;
  const swapTitle = canSwap
    ? t("진영 전환: {from} → {to}", {
        from: COMPUTER_SIDE_LABEL[side],
        to: COMPUTER_SIDE_LABEL[swappedSide(side)],
      })
    : t("진영 전환은 컴퓨터가 한쪽을 맡은 대국에서만 됩니다(대국 탭 ▸ 흑 / 백)");

  return (
    <nav className="quickbar" aria-label={t("퀵 액션")}>
      <button
        type="button"
        className="quickbar__btn"
        aria-label={t("새 판")}
        title={t("새 판: 판과 물음을 비우고 새로 시작합니다(개시와 컴퓨터 색은 그대로)")}
        onClick={newGame}
      >
        <Icon d={ICON.restart} />
        <span className="quickbar__label">{t("새 판")}</span>
      </button>
      {game && (
        <>
          <button
            type="button"
            className="quickbar__btn"
            aria-label={t("진영 전환")}
            title={swapTitle}
            disabled={!canSwap}
            onClick={swapSides}
          >
            <Icon d={ICON.swap} />
            <span className="quickbar__label">{t("진영 전환")}</span>
          </button>
          <span className="quickbar__sep" aria-hidden="true" />
          {/* 지금 누가 무엇을 맡았는지 — 바꾸기 전에 보여야 누를지 정한다. */}
          <span className="quickbar__side" data-k="computer-side">
            {COMPUTER_SIDE_LABEL[side]}
          </span>
        </>
      )}
    </nav>
  );
}
