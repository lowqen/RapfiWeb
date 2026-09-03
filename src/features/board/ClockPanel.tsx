import { useEffect } from "react";
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
 * **틱은 250ms 다.** 초 단위 표시에 16ms 마다 리렌더할 이유가 없고, 초가 바뀌는
 * 순간을 놓치지도 않는다. 그리고 `Motion.kt` 의 규칙대로 **숫자를 보간하지 않는다** —
 * 시계는 실시간 값이라 애니메이션이 곧 거짓말이다.
 */
const TICK_MS = 250;

export function ClockPanel() {
  const clock = useGameStore((s) => s.clock);
  const advance = useGameStore((s) => s.advanceClock);
  const running = clock.running;

  useEffect(() => {
    if (!running) return;
    // 벽시계로 잰다. setInterval 은 밀리므로 간격을 믿고 더하면 시계가 느려진다.
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      advance(now - last);
      last = now;
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running, advance]);

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
