import { describe, it, expect } from "vitest";
import {
  EMPTY_CLOCK,
  addIncrement,
  engineTimeLeftMs,
  format,
  formatShort,
  isUrgent,
  leftMatchMs,
  leftTurnMs,
  playerTimedOut,
  start,
  stop,
  tick,
  usedMatchMs,
  usedTurnMs,
  withLimits,
  type GameClock,
} from "./clock";

/** 5분 대국 · 차례 30초 · 가산 2초. */
const limited = (): GameClock =>
  withLimits(EMPTY_CLOCK, {
    limited: true,
    turnLimitMs: 30_000,
    matchLimitMs: 300_000,
    incrementMs: 2_000,
  });

describe("시계 — 흐름", () => {
  it("멈춰 있으면 틱이 아무것도 하지 않는다", () => {
    const c = tick(limited(), 1_000);
    expect(usedTurnMs(c, "human")).toBe(0);
    expect(usedTurnMs(c, "computer")).toBe(0);
  });

  it("도는 쪽만 쌓인다", () => {
    const c = tick(start(limited(), "human"), 3_000);
    expect(usedTurnMs(c, "human")).toBe(3_000);
    expect(usedTurnMs(c, "computer")).toBe(0);
  });

  it("차례를 넘기면 덜 끝난 차례가 그쪽 대국 합계로 접힌다", () => {
    let c = start(limited(), "human");
    c = tick(c, 4_000);
    c = start(c, "computer"); // 사람 → 컴퓨터
    expect(usedTurnMs(c, "human")).toBe(0);
    expect(usedMatchMs(c, "human")).toBe(4_000);
    // 새 차례는 0부터.
    expect(usedTurnMs(c, "computer")).toBe(0);
  });

  it("stop 은 시간을 잃지 않는다 — 세는 것을 멈출 뿐이다", () => {
    let c = tick(start(limited(), "human"), 2_500);
    c = stop(c);
    expect(c.running).toBeNull();
    expect(usedMatchMs(c, "human")).toBe(2_500);
    expect(usedMatchMs(tick(c, 9_999), "human")).toBe(2_500);
  });
});

describe("시계 — 남은 시간", () => {
  it("남은 차례는 대국 잔량에도 눌린다", () => {
    // 대국 예산이 10초뿐이면 차례 제한 30초는 의미가 없다.
    let c = withLimits(EMPTY_CLOCK, {
      limited: true,
      turnLimitMs: 30_000,
      matchLimitMs: 10_000,
      incrementMs: 0,
    });
    c = start(c, "human");
    expect(leftTurnMs(c, "human")).toBe(10_000);
  });

  it("가산은 대국 잔량에 더해진다", () => {
    let c = start(limited(), "human");
    c = tick(c, 5_000);
    c = addIncrement(c, "human");
    // 5분 - 5초 + 2초.
    expect(leftMatchMs(c, "human")).toBe(300_000 - 5_000 + 2_000);
  });

  it("음수로 내려가지 않는다", () => {
    let c = start(limited(), "human");
    c = tick(c, 600_000);
    expect(leftMatchMs(c, "human")).toBe(0);
    expect(leftTurnMs(c, "human")).toBe(0);
  });

  it("INFO time_left 는 진행 중인 차례를 빼지 않는다", () => {
    // 데스크톱이 일부러 그렇게 한다(main.c:2742). 진행분까지 빼면 엔진이
    // 자기 시간을 두 번 세는 셈이 된다.
    let c = start(limited(), "computer");
    c = tick(c, 7_000);
    expect(engineTimeLeftMs(c)).toBe(300_000);
    c = start(c, "human"); // 컴퓨터 차례가 끝나 대국 합계로 접힌다
    expect(engineTimeLeftMs(c)).toBe(300_000 - 7_000);
  });
});

describe("시계 — 시간 초과", () => {
  it("제한이 없으면 초과가 없다", () => {
    const c = tick(start(EMPTY_CLOCK, "human"), 10 * 3_600_000);
    expect(playerTimedOut(c)).toBe(false);
  });

  it("사람 쪽만 본다 — 데스크톱이 그렇다", () => {
    let c = start(limited(), "computer");
    c = tick(c, 400_000);
    expect(playerTimedOut(c)).toBe(false);
  });

  it("차례 제한을 넘기면 참", () => {
    const c = tick(start(limited(), "human"), 30_001);
    expect(playerTimedOut(c)).toBe(true);
  });
});

describe("시계 — 표시", () => {
  it("format 은 hh:mm:ss", () => {
    expect(format(0)).toBe("00:00:00");
    expect(format(61_000)).toBe("00:01:01");
    expect(format(3_723_000)).toBe("01:02:03");
  });

  it("100시간을 넘으면 데스크톱 라벨과 같이 99:59:59 에서 멈춘다", () => {
    expect(format(100 * 3_600_000)).toBe("99:59:59");
  });

  it("음수는 0 으로 — 시계가 «-00:01» 을 보여 주지 않는다", () => {
    expect(format(-5_000)).toBe("00:00:00");
    expect(formatShort(-5_000)).toBe("00:00");
  });

  it("formatShort 는 한 시간 미만에서 mm:ss", () => {
    expect(formatShort(65_000)).toBe("01:05");
    expect(formatShort(3_599_000)).toBe("59:59");
    expect(formatShort(3_600_000)).toBe("01:00:00");
  });

  it("10초 이하가 다급함이고, 제한이 없으면 결코 다급하지 않다", () => {
    const c = tick(start(limited(), "human"), 20_500);
    expect(isUrgent(c, "human")).toBe(true);
    expect(isUrgent(tick(start(limited(), "human"), 19_000), "human")).toBe(false);
    expect(isUrgent(start(EMPTY_CLOCK, "human"), "human")).toBe(false);
  });
});
