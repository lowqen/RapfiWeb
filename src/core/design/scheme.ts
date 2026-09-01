/**
 * 역할 → 램프·톤 표. `Theme.kt`(ColorScheme 30역할) + `Color.kt`(RapfiColors) +
 * `BoardSkin.kt` 을 한 자리에 모은 것이다.
 *
 * **모든 역할을 채운다.** Material 은 빠진 역할을 자기 기본값(보라)으로 메우므로,
 * 서른 역할 중 열한 개만 이름 붙인 스킴은 팔레트가 둘인 앱이 된다 — 누군가
 * 생각한 부분은 이 앱의 색이고 나머지(카드 전부, 내비게이션 바, 구분선, 큰
 * 분석 버튼)는 보라. 웹에는 Material 런타임이 없지만 **표를 채운다는 규율은
 * 같은 이유로 유지한다**: 컴포넌트가 토큰을 찾다가 없으면 그 자리에서 색을
 * 발명하게 된다.
 */
import type { Rgb } from "./oklch";
import { Ink, Neutral, NeutralVariant, Sage, Clay, WoodNight, Signal, ResultBlue, ResultGreen } from "./ramps";

/** 토큰 하나: 램프의 톤이거나, 알파가 있는 순수 검정(보드 그림자·후광뿐). */
export type TokenValue = Rgb | { black: number };

export interface Scheme {
  [token: string]: TokenValue;
}

/** Material 30역할 + 이 앱의 것 + 보드 스킨. 이름은 kebab-case 로 CSS 에 나간다. */
function scheme(dark: boolean): Scheme {
  const t = <T extends { tone(n: number): Rgb }>(r: T, light: number, night: number) =>
    r.tone(dark ? night : light);

  return {
    // ── Material 역할 ────────────────────────────────────────────────
    primary: t(Ink, 24, 90),
    "on-primary": dark ? Ink.tone(18) : Neutral.tone(99),
    "primary-container": t(Ink, 90, 30),
    "on-primary-container": t(Ink, 18, 93),
    "inverse-primary": t(Ink, 80, 35),

    secondary: t(Sage, 36, 80),
    "on-secondary": dark ? Sage.tone(18) : Neutral.tone(100),
    "secondary-container": t(Sage, 90, 28),
    "on-secondary-container": t(Sage, 20, 92),

    tertiary: t(Clay, 38, 80),
    "on-tertiary": dark ? Clay.tone(18) : Neutral.tone(100),
    "tertiary-container": t(Clay, 90, 28),
    "on-tertiary-container": t(Clay, 20, 92),

    error: t(Signal, 42, 78),
    "on-error": dark ? Signal.tone(16) : Neutral.tone(100),
    "error-container": t(Signal, 92, 28),
    "on-error-container": t(Signal, 20, 92),

    background: t(Neutral, 98, 12),
    "on-background": t(Neutral, 14, 92),
    surface: t(Neutral, 98, 12),
    "on-surface": t(Neutral, 14, 92),
    "surface-variant": t(NeutralVariant, 92, 26),
    "on-surface-variant": t(NeutralVariant, 38, 78),
    "surface-tint": t(Ink, 24, 90),
    "inverse-surface": t(Neutral, 20, 90),
    "inverse-on-surface": t(Neutral, 96, 18),

    outline: NeutralVariant.tone(52),
    "outline-variant": t(NeutralVariant, 84, 28),
    scrim: { black: 1 },

    "surface-bright": t(Neutral, 99, 30),
    "surface-dim": t(Neutral, 88, 9),
    "surface-container-lowest": t(Neutral, 100, 8),
    "surface-container-low": t(Neutral, 96, 14),
    "surface-container": t(Neutral, 94, 17),
    "surface-container-high": t(Neutral, 92, 21),
    "surface-container-highest": t(Neutral, 90, 25),

    // ── Material 이 이름을 갖지 않은 것 (RapfiColors) ──────────────────
    "result-black": t(ResultBlue, 45, 76),
    "result-white": t(ResultGreen, 40, 74),
    "result-draw": t(NeutralVariant, 43, 74),
    "on-result": t(Neutral, 100, 10),
    positive: t(Sage, 38, 78),
    caution: t(Clay, 40, 76),

    // ── 보드 스킨 (BoardSkin.kt) ─────────────────────────────────────
    // 다크 모드는 나무 자체가 다르다(Clay → WoodNight): 톤 변화가 아니라
    // **재료** 변화다. 낮의 채도는 어두운 명도에서 나무가 아니라 주황 플라스틱으로 읽힌다.
    "board-wood": dark ? WoodNight.tone(33) : Clay.tone(76),
    "board-wood-edge": dark ? WoodNight.tone(26) : Clay.tone(68),
    "board-line": dark ? WoodNight.tone(52) : Clay.tone(42),
    "board-label": dark ? WoodNight.tone(70) : Clay.tone(32),
    "board-black-high": t(Ink, 28, 26),
    "board-black-low": t(Ink, 6, 4),
    "board-black-rim": t(Ink, 2, 1),
    "board-white-high": t(Neutral, 99, 96),
    "board-white-low": t(NeutralVariant, 84, 78),
    "board-white-rim": t(NeutralVariant, 58, 48),
    "board-stone-shadow": { black: dark ? 0x59 / 255 : 0x40 / 255 },
    "board-last-move": t(Sage, 48, 72),
    "board-best": t(Clay, 90, 88),
    "board-best-halo": { black: dark ? 0x73 / 255 : 0x66 / 255 },
    "board-candidate": t(Sage, 42, 68),
    "board-forbid": t(Signal, 48, 66),
    "board-blocked": dark ? Neutral.tone(72) : Ink.tone(30),
    // 라이트 보드에는 칩 테두리가 없다 — 값 사다리가 금색 나무에서 이미 분리된다.
    // 다크 보드에서는 사다리가 나무 명도 안으로 들어오므로 테두리가 **필수**다.
    ...(dark ? { "board-chip-rim": Neutral.tone(88) } : {}),
  };
}

export const LightScheme = scheme(false);
export const DarkScheme = scheme(true);

/** 대비 시험이 보는 쌍 — 앱의 테마 시험이 지키던 성질을 그대로 옮긴다. */
export const CONTRAST_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["on-background", "background"],
  ["on-surface", "surface"],
  ["on-surface-variant", "surface-variant"],
  ["on-primary", "primary"],
  ["on-primary-container", "primary-container"],
  ["on-secondary", "secondary"],
  ["on-secondary-container", "secondary-container"],
  ["on-tertiary", "tertiary"],
  ["on-tertiary-container", "tertiary-container"],
  ["on-error", "error"],
  ["on-error-container", "error-container"],
  ["inverse-on-surface", "inverse-surface"],
];
