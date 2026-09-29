import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { useEngineStore } from "../../engine/engine-state";
import { COMPUTER_SIDE_LABEL, swappedSide } from "../../core/model/game";
import { Icon, ICON } from "./icons";

/**
 * 보드 위의 퀵 액션 바 — 가장 자주 누르는 다섯: **분석 켜기/끄기 · 무르기 ·
 * 되돌리기 · 새 판 · 진영 전환.**
 *
 * 보드 밑의 이동 바(`MoveTransport`)는 **기보 이동**(처음·끝으로)이고, 이 바는
 * **대국 조작**이다. 무르기·되돌리기는 둘 다에 있지만 쓰임이 다르다 — 이동 바는 아이콘만
 * 있는 재생기이고, 여기는 이름이 적힌 버튼이라 처음 온 사람이 찾는 자리다.
 *
 * 이름(aria-label)은 스모크가 집는 「분석」「정지」「엔진 시작」「지금 두기」와 겹치지
 * 않게 지었다 — 겹치면 이름으로 찾는 시험이 두 버튼을 동시에 집는다.
 *
 * 좁은 화면에서는 글자를 숨기고 아이콘만 남긴다(이름은 aria-label·title 이 말한다).
 */
export function QuickActions() {
  const stones = useBoardStore((s) => s.render.stones.length);
  const ahead = useBoardStore((s) => s.future.length);
  const placements = useBoardStore((s) => s.placements);

  const thinking = useGameStore((s) => s.thinking);
  const prompt = useGameStore((s) => s.prompt);
  const side = useGameStore((s) => s.computerSide);
  const undoMove = useGameStore((s) => s.undoMove);
  const redoMove = useGameStore((s) => s.redoMove);
  const newGame = useGameStore((s) => s.newGame);
  const swapSides = useGameStore((s) => s.swapSides);

  const status = useEngineStore((s) => s.status);
  const analyzing = useEngineStore((s) => s.analyzing);
  const available = useEngineStore((s) => Boolean(s.capabilities.variant));
  const analyze = useEngineStore((s) => s.analyze);
  const stop = useEngineStore((s) => s.stop);

  const blocked = thinking || prompt !== null;
  const canSwap = (side === "white" || side === "black") && !blocked;
  const swapTitle = canSwap
    ? `진영 전환 — ${COMPUTER_SIDE_LABEL[side]} → ${COMPUTER_SIDE_LABEL[swappedSide(side)]}`
    : "진영 전환 — 컴퓨터가 한쪽을 맡은 대국에서만(설정 ▸ 컴퓨터가 둘 색)";

  return (
    <nav className="quickbar" aria-label="퀵 액션">
      <button
        type="button"
        className="quickbar__btn quickbar__btn--primary"
        data-on={analyzing || undefined}
        aria-pressed={analyzing}
        aria-label={analyzing ? "분석 끄기" : "분석 켜기"}
        title={analyzing ? "분석 끄기" : "분석 켜기 — 수를 두면 새 국면을 이어 읽습니다"}
        disabled={!available || thinking || status === "starting"}
        onClick={() => (analyzing ? stop() : void analyze(placements()))}
      >
        <Icon d={analyzing ? ICON.stop : ICON.play} />
        <span className="quickbar__label">{analyzing ? "분석 끄기" : "분석 켜기"}</span>
      </button>
      <span className="quickbar__sep" aria-hidden="true" />
      <button
        type="button"
        className="quickbar__btn"
        aria-label="무르기"
        title="무르기 — 한 수 뒤로"
        disabled={stones === 0}
        onClick={undoMove}
      >
        <Icon d={ICON.undo} />
        <span className="quickbar__label">무르기</span>
      </button>
      <button
        type="button"
        className="quickbar__btn"
        aria-label="되돌리기"
        title="되돌리기 — 무른 수를 다시"
        disabled={ahead === 0 || blocked}
        onClick={redoMove}
      >
        <Icon d={ICON.redo} />
        <span className="quickbar__label">되돌리기</span>
      </button>
      <span className="quickbar__sep" aria-hidden="true" />
      <button
        type="button"
        className="quickbar__btn"
        aria-label="새 판"
        title="새 판 — 판·물음을 비우고 새로 시작합니다(개시·컴퓨터 색은 그대로)"
        onClick={newGame}
      >
        <Icon d={ICON.restart} />
        <span className="quickbar__label">새 판</span>
      </button>
      <button
        type="button"
        className="quickbar__btn"
        aria-label="진영 전환"
        title={swapTitle}
        disabled={!canSwap}
        onClick={swapSides}
      >
        <Icon d={ICON.swap} />
        <span className="quickbar__label">진영 전환</span>
      </button>
      {/* 지금 누가 무엇을 맡았는지 — 바꾸기 전에 보여야 누를지 정한다. */}
      <span className="quickbar__side" data-k="computer-side">
        {COMPUTER_SIDE_LABEL[side]}
      </span>
    </nav>
  );
}
