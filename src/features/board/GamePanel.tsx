import { useEngineStore } from "../../engine/engine-state";
import { COMPUTER_SIDE_LABEL } from "../../core/model/game";
import { isUnlimitedTurn, LEVELS, useGameStore } from "./gameStore";
import { ThreadControl } from "../settings/engineControls";
import {
  ComputerControl,
  LevelControl,
  MoveTimeControl,
  Row,
  RulesetControl,
} from "./boardControls";
import { STATUS_TEXT } from "./analysisActions";

/**
 * [대국] 탭의 카드 — 사람 대 컴퓨터 한 판에 필요한 것만.
 *
 * 맨 위는 **지금 누가 무엇을 하는가**(엔진 상태 · 「지금 두기」), 그 아래가 대국 설정:
 * 흑/백 선택 · 시간 제어 · 레벨 · 스레드 · 개시. 예전에는 설정 화면에 있던 줄들이다 —
 * 대국을 시작하는 바로 이 자리로 옮기고 설정 화면에서는 뺐다.
 *
 * 깊이·노드·PV 같은 분석 수치는 여기 없다 — 그건 [분석] 탭의 일이고, 대국 중에 상대
 * 엔진의 속을 들여다보는 화면이 되지 않게 한다. (평가 바는 표시 설정을 따른다.)
 *
 * 엔진 스모크가 상태를 `.panel__badge` 로 읽으므로 이 탭에도 **꼭 하나** 둔다.
 */
export function GamePanel() {
  const status = useEngineStore((s) => s.status);
  const caps = useEngineStore((s) => s.capabilities);
  const error = useEngineStore((s) => s.error);
  const start = useEngineStore((s) => s.start);
  const thinking = useGameStore((s) => s.thinking);
  const unlimited = useGameStore((s) => isUnlimitedTurn(s));
  const moveNow = useGameStore((s) => s.moveNow);
  const side = useGameStore((s) => s.computerSide);
  const level = useGameStore((s) => s.level);

  const levelLabel = LEVELS.find((l) => l.level === level)?.label ?? String(level);
  const statusText = thinking ? "엔진이 생각 중" : STATUS_TEXT[status];

  return (
    <section className="panel panel--engine panel--game" aria-labelledby="game-panel-title">
      <h2 id="game-panel-title" className="panel__title">
        대국 <span className="panel__badge" data-status={thinking ? "searching" : status} />
        <span className="panel__status">{statusText}</span>
      </h2>
      <p className="engine-mode" data-on={thinking || undefined}>
        <span className="engine-mode__dot" aria-hidden="true" />
        {COMPUTER_SIDE_LABEL[side]} · 레벨 {levelLabel}
      </p>

      {(status === "idle" || status === "error") && caps.variant && (
        <div className="panel__actions">
          <button type="button" onClick={() => void start()}>
            엔진 시작
          </button>
        </div>
      )}

      {/* 무제한 대국: 엔진은 여기를 누를 때까지 생각한다(데스크톱·앱의 기본 레벨과 같다).
          시간·노드로 끝나는 대국은 엔진이 스스로 둔다. */}
      {thinking && unlimited && (
        <div className="panel__actions">
          <button type="button" className="button--primary" onClick={moveNow}>
            지금 두기
          </button>
          <span className="panel__hint panel__hint--inline">
            무제한 — 누를 때까지 엔진이 계속 읽습니다
          </span>
        </div>
      )}

      {error && <p className="panel__error">{error}</p>}

      <div className="panel__rows">
        <Row id="computer" label="흑 / 백" note="엔진 차례에 판을 누르면 엔진이 둡니다." wide>
          <ComputerControl />
        </Row>
        <Row
          id="moveTime"
          label="시간 제어"
          note="엔진이 한 수에 쓰는 시간. 무제한 + 최강이면 「지금 두기」까지 읽습니다."
          wide
        >
          <MoveTimeControl />
        </Row>
        <Row
          id="level"
          label="레벨"
          note="한 수에 읽을 노드 수로 세기를 정합니다(대국에만 — 분석은 그대로)."
          wide
        >
          <LevelControl />
        </Row>
        <Row id="threads" label="스레드" wide>
          <ThreadControl />
        </Row>
        <Row
          id="ruleset"
          label="룰셋"
          note="기반 규칙은 렌주이고, 고르는 것은 개시입니다. 바꾸면 새 대국이 시작됩니다."
          wide
        >
          <RulesetControl />
        </Row>
      </div>
    </section>
  );
}
