import type { ReactNode } from "react";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { OPENING_LABEL, negotiates, type OpeningProtocol } from "../../core/model/game";
import { label } from "../../core/model/move";

/**
 * 개시 진행 — 지금 어느 단계인지. 설정 화면의 「대국 진행」 줄이 그린다.
 *
 * 개시 절차가 없는 규칙(자유 렌주)에서는 **아예 그리지 않는다.** 언제나 자리를
 * 차지하는 빈 줄은 화면에서 「여기 뭔가 있어야 하는데 없다」로 읽힌다.
 */
export function OpeningProgress() {
  const opening = useGameStore((s) => s.opening);
  const stones = useBoardStore((s) => s.render.stones.length);
  if (!negotiates(opening)) return null;

  return (
    <div className="opening-progress" role="group" aria-label={`${OPENING_LABEL[opening]} 진행`}>
      <Timeline opening={opening} stones={stones} />
    </div>
  );
}

/**
 * 물음 상자 — **개시 pane 과 따로 산다.**
 *
 * 예전에는 개시 pane 안에 있었는데, 그 pane 은 자유 렌주에서 그려지지 않는다.
 * 그런데 금수·시간 초과·엔진 무응답 물음은 자유 렌주에서도 뜬다 — 그러면 물음이
 * **보이지 않는 채로** 상태에만 남고, `tap` 이 「먼저 위 물음에 답해 주세요」로
 * 모든 탭을 거절해 판이 잠긴다. 보이지 않는 것을 답하라고 하는 화면이었다.
 */
export function PromptPanel() {
  const p = useGameStore((s) => s.prompt);
  if (!p) return null;
  return (
    <section className="panel panel--prompt">
      <Prompt />
    </section>
  );
}

/** 개시의 단계들을 한 줄로. 지금 어디인지가 한눈에 보여야 한다. */
function Timeline({ opening, stones }: { opening: OpeningProtocol; stones: number }) {
  const steps = stepsFor(opening);
  const at = currentStep(opening, stones);
  return (
    <ol className="timeline">
      {steps.map((s, i) => (
        <li
          key={s}
          className="timeline__step"
          data-state={i < at ? "done" : i === at ? "now" : "todo"}
        >
          {s}
        </li>
      ))}
    </ol>
  );
}

function stepsFor(o: OpeningProtocol): string[] {
  switch (o) {
    case "swapFirst":
      return ["흑 1수", "색 결정", "대국"];
    case "rif":
      return ["첫 3수", "대국"];
    case "none":
      return [];
  }
}

function currentStep(o: OpeningProtocol, n: number): number {
  switch (o) {
    case "swapFirst":
      return n < 1 ? 0 : n === 1 ? 1 : 2;
    case "rif":
      return n < 3 ? 0 : 1;
    case "none":
      return 0;
  }
}

/** 개시 영역을 어긴 안내. `Referee.openingAreaOk` 가 보는 조건 그대로다. */
const ILLEGAL_OPENING =
  "개시 영역을 벗어났습니다 — 판을 되돌렸습니다. " +
  "1수는 천원, 2수는 그 한 점 이내, 3수는 두 점 이내여야 합니다.";

/** 지금 물어보고 있는 것. 데스크톱의 대화상자 하나에 대응한다. */
function Prompt() {
  const g = useGameStore();
  const p = g.prompt;
  if (!p) return null;

  switch (p.kind) {
    case "swap":
      return (
        <Ask kind={p.kind} text="색을 교환하시겠습니까?">
          <button type="button" onClick={() => g.answerSwap(true)}>
            교환
          </button>
          <button type="button" onClick={() => g.answerSwap(false)}>
            그대로
          </button>
        </Ask>
      );

    case "swapInfo":
      return (
        <Ask kind={p.kind} text="상대가 색을 가져갔습니다.">
          <button type="button" onClick={g.dismissPrompt}>
            확인
          </button>
        </Ask>
      );

    case "illegalOpening":
      return (
        <Ask kind={p.kind} text={ILLEGAL_OPENING}>
          <button type="button" onClick={g.dismissPrompt}>
            확인
          </button>
        </Ask>
      );

    case "forbidden":
      return (
        <Ask kind={p.kind} text={`${label(p.cell)} 은 흑의 금수입니다.`}>
          <button type="button" onClick={g.dismissPrompt}>
            확인
          </button>
        </Ask>
      );

    case "info":
      return (
        <Ask kind={p.kind} text={p.text}>
          <button type="button" onClick={g.dismissPrompt}>
            확인
          </button>
        </Ask>
      );
  }
}

function Ask({ kind, text, children }: { kind: string; text: string; children: ReactNode }) {
  return (
    // `data-prompt` 는 스모크가 «지금 무엇을 묻고 있나»를 문구가 아니라
    // 종류로 집게 한다 — 문구는 다듬을 수 있고 종류는 프로토콜의 것이다.
    <div className="ask panel-enter" data-prompt={kind}>
      <p className="ask__text">{text}</p>
      <div className="ask__actions">{children}</div>
    </div>
  );
}
