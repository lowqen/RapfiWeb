import type { ReactNode } from "react";
import { useGameStore } from "./gameStore";
import { useBoardStore } from "./boardStore";
import {
  COMPUTER_SIDE_LABEL,
  OPENING_HINT,
  OPENING_LABEL,
  describeResult,
  type ComputerSide,
  type OpeningProtocol,
} from "../../core/model/game";

/**
 * 대국 패널 — 앱의 대국 도구를 옮긴 것.
 *
 * **규칙은 렌주 하나이고, 고르는 것은 오프닝 협상이다.** 데스크톱의 `specialrule`
 * 은 기반 규칙 위에 얹히는 층이라, 렌주 전용인 웹에서 「규칙 선택」은 곧 「협상
 * 선택」이 된다. 그래서 칩이 다섯 개다.
 */

const SIDES: readonly ComputerSide[] = ["none", "black", "white", "both"];
const OPENINGS: readonly OpeningProtocol[] = ["none", "rif", "swapFirst", "soosorv", "swap2"];

/** 시간 제한 프리셋. 데스크톱의 커스텀 레벨(settings.txt 6행 = 1)에 해당한다. */
const TIME_PRESETS = [
  { label: "무제한", limited: false, turn: 0, match: 0 },
  { label: "5분", limited: true, turn: 30_000, match: 300_000 },
  { label: "15분", limited: true, turn: 60_000, match: 900_000 },
  { label: "30분", limited: true, turn: 120_000, match: 1_800_000 },
] as const;

export function GamePanel() {
  const g = useGameStore();
  const stones = useBoardStore((s) => s.render.stones.length);
  const playing = !g.result && stones > 0;

  return (
    <section className="panel">
      <h2 className="panel__title">대국</h2>

      {g.result && (
        <p className="gameover" data-winner={g.result.winner ?? "draw"}>
          {describeResult(g.result)}
        </p>
      )}

      <ChipGroup label="오프닝">
        {OPENINGS.map((o) => (
          <Chip
            key={o}
            on={g.opening === o}
            title={OPENING_HINT[o]}
            onClick={() => g.setOpening(o)}
          >
            {OPENING_LABEL[o]}
          </Chip>
        ))}
      </ChipGroup>
      <p className="panel__hint">{OPENING_HINT[g.opening]}</p>

      <ChipGroup label="컴퓨터">
        {SIDES.map((s) => (
          <Chip key={s} on={g.computerSide === s} onClick={() => g.setComputerSide(s)}>
            {COMPUTER_SIDE_LABEL[s]}
          </Chip>
        ))}
      </ChipGroup>

      <ChipGroup label="시간 제한">
        {TIME_PRESETS.map((p) => (
          <Chip
            key={p.label}
            on={
              g.clock.limited === p.limited &&
              (!p.limited ||
                (g.clock.turnLimitMs === p.turn && g.clock.matchLimitMs === p.match))
            }
            onClick={() =>
              g.setClockLimits({
                limited: p.limited,
                turnLimitMs: p.turn,
                matchLimitMs: p.match,
              })
            }
          >
            {p.label}
          </Chip>
        ))}
      </ChipGroup>

      <div className="panel__actions">
        <button type="button" onClick={g.newGame}>
          새 대국
        </button>
        <button type="button" onClick={g.resign} disabled={!playing}>
          기권
        </button>
        <button type="button" onClick={g.offerDraw} disabled={!playing}>
          무승부
        </button>
        <button type="button" onClick={g.toggleForbidden}>
          금수 {g.showForbidden ? "끄기" : "켜기"}
        </button>
      </div>

      <p className="panel__hint">금수는 엔진이 알려 주는 것을 그립니다.</p>
    </section>
  );
}

/**
 * 칩 한 줄. `fieldset`/`legend` 를 쓰지 않는 이유가 있다 — flex 컨테이너 안의
 * legend 는 브라우저마다 배치가 달라 첫 줄이 어긋난다. 묶음의 뜻은 `role`+라벨로.
 */
function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      <span className="chips__legend">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={"chip" + (on ? " is-on" : "")}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
