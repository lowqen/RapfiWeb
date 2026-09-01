/**
 * `core/designsystem/theme/Color.kt` 의 이식본 — 아홉 개의 램프.
 *
 * **먹과 한지.** 크롬(카드·바·칩·버튼)은 따뜻하고 거의 무채색이고, 화면에서
 * 채도 있는 색은 보드의 것이다: 분석의 값 칩, 나무, 등급 표시. 취향이 아니라
 * 작동 규칙이다 — 이 앱에서 **색은 값**이라, 칩의 색상이 수의 좋고 나쁨을 말한다.
 * UI 까지 색으로 소리치면 읽는 사람이 둘을 구별해야 한다. 그래서 UI 는 물러나고
 * 보드가 말한다.
 */
import { ramp } from "./oklch";

/** 따뜻한 목탄 → 강조 가족. 거의 무채색이어야 «먹»으로 읽힌다. */
export const Ink = ramp(74, 0.02);

/** 한지: 배경과 표면. 청회색으로 읽히지 않을 만큼만 따뜻하다. */
export const Neutral = ramp(74, 0.007);

/** 윤곽선과 흐린 글자 — 같은 종이에 몸이 조금 더 있는 것. */
export const NeutralVariant = ramp(74, 0.016);

/** 보드의 녹색, 데스크톱의 `#81B64C` 를 가라앉힌 것. */
export const Sage = ramp(148, 0.06);

/**
 * 보드 금색의 가족. 나무와 «오류 아닌 주의»에 쓴다.
 *
 * hue·chroma 는 톤 76 이 데스크톱의 보드(`#DCB35C` → `#DAB673`)에, 톤 42 가
 * 그 격자(`#7A5A2B` → `#7B5E22`)에 떨어지도록 고른 값이다. 수년을 본 보드는
 * 실수로 다시 디자인할 것이 아니다 — 먼저 재현하고, 그 다음에 유도한다.
 * 이 두 값은 `ramps.test.ts` 의 골든 앵커다.
 */
export const Clay = ramp(82, 0.095);

/** 등불 아래의 같은 나무. **재료**가 바뀐 것이라 톤이 아니라 램프를 따로 둔다. */
export const WoodNight = ramp(82, 0.05);

/** 오류, 금수, 손실 — 유일하게 큰 소리를 내는 가족. */
export const Signal = ramp(27, 0.13);

/** 모든 통계 표에서 «흑 승». 데스크톱과 앱이 공유한다. */
export const ResultBlue = ramp(245, 0.085);

/** «백 승». 흰색이 아니라 녹색인 이유: 종이 위의 흰색은 아무것도 아니다. */
export const ResultGreen = ramp(155, 0.085);

export const ALL_RAMPS = {
  Ink,
  Neutral,
  NeutralVariant,
  Sage,
  Clay,
  WoodNight,
  Signal,
  ResultBlue,
  ResultGreen,
} as const;

export type RampName = keyof typeof ALL_RAMPS;
