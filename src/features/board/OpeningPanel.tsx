import type { ReactNode } from "react";
import { useBoardStore } from "./boardStore";
import { FIFTH_COUNT_RANGE, useGameStore } from "./gameStore";
import {
  OPENING_LABEL,
  SWAP2_CHOICE_LABEL,
  negotiates,
  type OpeningProtocol,
  type Swap2Choice,
} from "../../core/model/game";
import { label } from "../../core/model/move";

/**
 * 오프닝 협상 pane — 지금 어느 단계인지, 무엇을 고를 수 있는지.
 *
 * 협상이 없는 규칙(자유 렌주)에서는 **아예 그리지 않는다.** 언제나 자리를 차지하는
 * 빈 패널은 화면에서 「여기 뭔가 있어야 하는데 없다」로 읽힌다.
 */
export function OpeningPanel() {
  const g = useGameStore();
  const stones = useBoardStore((s) => s.render.stones.length);
  if (!negotiates(g.opening)) return null;

  return (
    <section className="panel">
      <h2 className="panel__title">{OPENING_LABEL[g.opening]}</h2>

      <Timeline opening={g.opening} stones={stones} fifthCount={g.fifthCount} done={g.swapDone} />

      {g.prompt && <Prompt />}

      {g.offeringFifth && !g.prompt && (
        <p className="panel__hint">
          5수 후보를 <strong>{g.fifthCount}개</strong> 놓으세요. 지금까지{" "}
          {Math.max(0, stones - 4)}개 — 다 놓으면 상대가 그중 하나를 고릅니다.
        </p>
      )}
    </section>
  );
}

/** 협상의 단계들을 한 줄로. 지금 어디인지가 한눈에 보여야 한다. */
function Timeline({
  opening,
  stones,
  fifthCount,
  done,
}: {
  opening: OpeningProtocol;
  stones: number;
  fifthCount: number;
  done: boolean;
}) {
  const steps = stepsFor(opening, fifthCount);
  const at = currentStep(opening, stones, done, fifthCount);
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

function stepsFor(o: OpeningProtocol, fifthCount: number): string[] {
  switch (o) {
    case "swapFirst":
      return ["흑 1수", "색 결정", "대국"];
    case "swap2":
      return ["흑2·백1", "선택", "(두 수 추가)", "대국"];
    case "rif":
      // 앱과 같다: RIF 에서 협상 명령은 오가지 않고, 첫 세 수를 손으로 놓는 것만
      // 다르다. 없는 단계를 그려 두면 오지 않는 물음을 기다리게 된다.
      return ["첫 3수", "대국"];
    case "soosorv":
      return ["첫 3수", "백 4수", `5수 후보 ${fifthCount}개`, "선택", "대국"];
    case "none":
      return [];
  }
}

function currentStep(o: OpeningProtocol, n: number, done: boolean, fifthCount: number): number {
  switch (o) {
    case "swapFirst":
      return n < 1 ? 0 : n === 1 ? 1 : 2;
    case "swap2":
      if (n < 3) return 0;
      if (n === 3) return 1;
      if (n < 5 && !done) return 2;
      return 3;
    case "rif":
      return n < 3 ? 0 : 1;
    case "soosorv":
      if (n < 3) return 0;
      if (n === 3) return 1;
      if (n < 4 + fifthCount) return 2;
      if (n === 4 + fifthCount) return 3;
      return 4;
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
        <Ask
          text={
            p.fifthCount === undefined
              ? "색을 교환하시겠습니까?"
              : `5수 후보 ${p.fifthCount}개가 올라왔습니다. 색을 교환하시겠습니까?`
          }
        >
          <button type="button" onClick={() => g.answerSwap(true)}>
            교환
          </button>
          <button type="button" onClick={() => g.answerSwap(false)}>
            그대로
          </button>
        </Ask>
      );

    case "swap2":
      return (
        <Ask text="셋 중 하나를 고르세요.">
          {(["stayWhite", "swap", "addTwo"] as Swap2Choice[]).map((c) => (
            <button key={c} type="button" onClick={() => g.answerSwap2(c)}>
              {SWAP2_CHOICE_LABEL[c]}
            </button>
          ))}
        </Ask>
      );

    case "fifthCount":
      return (
        <Ask text="5수 후보를 몇 개 낼까요?">
          {FIFTH_COUNT_RANGE.map((n) => (
            <button key={n} type="button" onClick={() => g.answerFifthCount(n)}>
              {n}
            </button>
          ))}
        </Ask>
      );

    case "swapInfo":
      return (
        <Ask text="상대가 색을 가져갔습니다.">
          <button type="button" onClick={g.dismissPrompt}>
            확인
          </button>
        </Ask>
      );

    case "illegalOpening":
      return (
        <Ask text={ILLEGAL_OPENING}>
          <button type="button" onClick={g.dismissPrompt}>
            확인
          </button>
        </Ask>
      );

    case "forbidden":
      return (
        <Ask text={`${label(p.cell)} 은 흑의 금수입니다.`}>
          <button type="button" onClick={g.dismissPrompt}>
            확인
          </button>
        </Ask>
      );

    case "timeout":
      return (
        <Ask text="시간이 다 됐습니다.">
          <button type="button" onClick={g.dismissPrompt}>
            확인
          </button>
        </Ask>
      );

    case "info":
      return (
        <Ask text={p.text}>
          <button type="button" onClick={g.dismissPrompt}>
            확인
          </button>
        </Ask>
      );
  }
}

function Ask({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="ask panel-enter">
      <p className="ask__text">{text}</p>
      <div className="ask__actions">{children}</div>
    </div>
  );
}
