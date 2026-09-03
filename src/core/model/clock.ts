/**
 * 시계 — `core/model/GameClock.kt` 의 이식본.
 *
 * 데스크톱의 네 타이머(`timercomputerturn/match`, `timerhumanturn/match`)와 두
 * 가산 크레딧을 그대로 옮긴다(`clock_timer_update` / `clock_label_refresh`,
 * main.c:11875 / 11713).
 *
 * **커스텀 레벨(settings.txt 6행 = 1)만 진짜 제한이 있다.** 다른 레벨은 엔진을
 * 노드 예산으로 돌리고 데스크톱은 그때 99:59:59 를 보여 준다. 그래서 `limited`
 * 가 꺼져 있으면 시계는 흘러가되 «남은 시간»은 무한으로 표시된다.
 *
 * 「사용」은 *이번* 차례 / 대국 전체이고, 「남음」은 대국 예산에서 쓴 것을 빼고
 * 지금까지 번 가산을 더한 값이다.
 */

export type ClockSide = "computer" | "human";

export interface GameClock {
  limited: boolean;
  turnLimitMs: number;
  matchLimitMs: number;
  incrementMs: number;
  /** 지금 누구의 시간이 가고 있나. 멈춰 있으면 `null`. */
  running: ClockSide | null;
  computerMatchMs: number;
  computerTurnMs: number;
  humanMatchMs: number;
  humanTurnMs: number;
  computerIncrementMs: number;
  humanIncrementMs: number;
  /** 데스크톱의 `timeoutflag` — 한 번 알렸으면 다시 알리지 않는다. */
  timedOutNotified: boolean;
}

export const EMPTY_CLOCK: GameClock = {
  limited: false,
  turnLimitMs: 0,
  matchLimitMs: 0,
  incrementMs: 0,
  running: null,
  computerMatchMs: 0,
  computerTurnMs: 0,
  humanMatchMs: 0,
  humanTurnMs: 0,
  computerIncrementMs: 0,
  humanIncrementMs: 0,
  timedOutNotified: false,
};

/** 설정에서 온 제한만 갈아 끼운다. 이미 쓴 시간은 그대로 둔다. */
export function withLimits(
  c: GameClock,
  limits: Pick<GameClock, "limited" | "turnLimitMs" | "matchLimitMs" | "incrementMs">,
): GameClock {
  return { ...c, ...limits };
}

/**
 * 시계를 `side` 에게 넘긴다. 반대쪽의 덜 끝난 차례는 그쪽 대국 합계로 접어 넣는다 —
 * 데스크톱의 틱이 상태가 바뀔 때 하는 것과 같다.
 */
export function start(c: GameClock, side: ClockSide): GameClock {
  return side === "computer"
    ? { ...c, running: side, humanMatchMs: c.humanMatchMs + c.humanTurnMs, humanTurnMs: 0, computerTurnMs: 0 }
    : { ...c, running: side, computerMatchMs: c.computerMatchMs + c.computerTurnMs, computerTurnMs: 0, humanTurnMs: 0 };
}

export const stop = (c: GameClock): GameClock => ({ ...c, running: null });

export function tick(c: GameClock, deltaMs: number): GameClock {
  if (c.running === "computer") return { ...c, computerTurnMs: c.computerTurnMs + deltaMs };
  if (c.running === "human") return { ...c, humanTurnMs: c.humanTurnMs + deltaMs };
  return c;
}

/** 한 수를 마치면 가산을 번다(`timer*increment += increment`). */
export function addIncrement(c: GameClock, side: ClockSide): GameClock {
  return side === "computer"
    ? { ...c, computerIncrementMs: c.computerIncrementMs + c.incrementMs }
    : { ...c, humanIncrementMs: c.humanIncrementMs + c.incrementMs };
}

export const usedTurnMs = (c: GameClock, s: ClockSide): number =>
  s === "computer" ? c.computerTurnMs : c.humanTurnMs;

export const usedMatchMs = (c: GameClock, s: ClockSide): number =>
  s === "computer" ? c.computerMatchMs + c.computerTurnMs : c.humanMatchMs + c.humanTurnMs;

export function leftMatchMs(c: GameClock, s: ClockSide): number {
  const credit = s === "computer" ? c.computerIncrementMs : c.humanIncrementMs;
  return Math.max(0, c.matchLimitMs - usedMatchMs(c, s) + credit);
}

export const leftTurnMs = (c: GameClock, s: ClockSide): number =>
  Math.max(0, Math.min(c.turnLimitMs - usedTurnMs(c, s), leftMatchMs(c, s)));

/**
 * 엔진 차례마다 앞서 보내는 `INFO time_left`, 데스크톱이 계산하는 그대로:
 * 대국 예산에서 엔진이 **끝낸** 차례들을 빼고 크레딧을 더한다.
 * 진행 중인 차례는 **일부러** 빼지 않는다(main.c:2742).
 */
export const engineTimeLeftMs = (c: GameClock): number =>
  Math.max(0, c.matchLimitMs - c.computerMatchMs + c.computerIncrementMs);

/**
 * 데스크톱은 **사람 쪽 시계만** 경고한다 — 시간 초과 검사가 사람 라벨을 계산한
 * 뒤에 돈다(main.c:11866).
 */
export const playerTimedOut = (c: GameClock): boolean =>
  c.limited && (leftTurnMs(c, "human") <= 0 || leftMatchMs(c, "human") <= 0);

const UNLIMITED = "99:59:59";

/** `hh:mm:ss`. 데스크톱 라벨처럼 99:59:59 에서 멈춘다. */
export function format(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  if (Math.floor(safe / 3_600_000) >= 100) return UNLIMITED;
  const h = Math.floor(safe / 3_600_000);
  const m = Math.floor(safe / 60_000) % 60;
  const s = Math.floor(safe / 1_000) % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}

/** 한 시간 미만이면 `mm:ss` 로 짧게. 화면의 큰 숫자에 쓴다. */
export function formatShort(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  if (safe >= 3_600_000) return format(safe);
  const m = Math.floor(safe / 60_000);
  const s = Math.floor(safe / 1_000) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 「남은 차례 / 남은 대국」. 제한이 없으면 둘 다 무한 표시. */
export const leftLabel = (c: GameClock, s: ClockSide): string =>
  c.limited ? `${format(leftTurnMs(c, s))} / ${format(leftMatchMs(c, s))}` : `${UNLIMITED} / ${UNLIMITED}`;

export const usedLabel = (c: GameClock, s: ClockSide): string =>
  `${format(usedTurnMs(c, s))} / ${format(usedMatchMs(c, s))}`;

/**
 * 초읽기처럼 느껴져야 하는 구간인가 — 남은 차례 시간이 10초 이하.
 * 화면이 색을 바꾸는 근거로만 쓴다(시계 자체는 아무것도 하지 않는다).
 */
export const isUrgent = (c: GameClock, s: ClockSide): boolean =>
  c.limited && leftTurnMs(c, s) <= 10_000;
