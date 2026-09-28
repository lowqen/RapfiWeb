import { useGameStore } from "./gameStore";
import {
  formatShort,
  isUrgent,
  leftMatchMs,
  leftTurnMs,
  usedMatchMs,
  usedTurnMs,
  format,
  type ClockSide,
} from "../../core/model/clock";

/**
 * 두 시계 — `GameClock.kt` 가 계산하고 여기는 보여 주기만 한다.
 *
 * **시계를 돌리는 것은 이 카드가 아니다**(`gameStore` 의 틱). 예전엔 여기서
 * 돌렸는데, 대국 설정이 설정 탭으로 가면서 화면을 옮기면 시계가 멈췄다 — 시간은
 * 화면이 보이든 말든 간다. `Motion.kt` 의 규칙대로 **숫자를 보간하지 않는다** —
 * 시계는 실시간 값이라 애니메이션이 곧 거짓말이다.
 */
export function ClockPanel() {
  const clock = useGameStore((s) => s.clock);

  return (
    <section className="panel">
      <h2 className="panel__title">시계</h2>
      <div className="clocks">
        <ClockFace side="human" label="사람" />
        <ClockFace side="computer" label="컴퓨터" />
      </div>
      {!clock.limited && <p className="panel__hint">제한 없음 — 쓴 시간만 셉니다.</p>}
    </section>
  );
}

function ClockFace({ side, label }: { side: ClockSide; label: string }) {
  const clock = useGameStore((s) => s.clock);
  const active = clock.running === side;
  const urgent = isUrgent(clock, side);

  return (
    <div
      className="clock"
      // 스모크가 순서가 아니라 **이름**으로 집는다 — 시계 두 칸의 좌우가 바뀌어도
      // 시험이 헛짚지 않게. W3 에서 `.kv dd` 의 순서로 집었다가 두 번 깨졌다.
      data-side={side}
      data-active={active || undefined}
      data-urgent={urgent || undefined}
    >
      <span className="clock__label">{label}</span>
      <span className="clock__big tnum" data-k="big">
        {clock.limited
          ? formatShort(leftTurnMs(clock, side))
          : formatShort(usedTurnMs(clock, side))}
      </span>
      <span className="clock__sub tnum" data-k="sub">
        {clock.limited
          ? `대국 ${format(leftMatchMs(clock, side))}`
          : `합계 ${format(usedMatchMs(clock, side))}`}
      </span>
    </div>
  );
}
