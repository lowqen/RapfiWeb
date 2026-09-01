/**
 * 색이 아닌 토큰 — 타이포 15슬롯, 간격, 모서리, 모션, 레이아웃.
 *
 * `Type.kt` / `Spacing.kt` / `Shape.kt` / `Motion.kt` 를 한 자리에 옮긴 것이다.
 * 색과 같은 파일에서 굽는 이유는 하나다: `gen:tokens --check` 하나가 이것들까지
 * 지켜야 «TS 에서 고치고 CSS 는 잊는» 사고가 안 난다.
 */

/**
 * 시스템 폰트만 쓴다. 근거 셋이 같은 답을 가리킨다:
 * (1) 앱이 시스템 폰트를 쓴다 — «앱과 일치» 제약,
 * (2) 40MB 를 받는 앱에 폰트를 더할 이유가 없다,
 * (3) 멀티스레드를 되살려 COEP 를 켜면 외부 폰트는 어차피 막힌다(계획서 §8).
 */
export const FONT_STACKS = {
  sans: `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans KR", "Malgun Gothic", sans-serif`,
  mono: `ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, "D2Coding", monospace`,
} as const;

export interface TypeSlot {
  weight: number;
  size: number;
  line: number;
  /** px. 0 또는 음수만 — Material 의 양수 트래킹은 라틴용이라 한글이 성기게 보인다. */
  tracking?: number;
}

/**
 * **열다섯 슬롯 전부.** 셋만 손대고 열두 개를 Material 기본값에 두면 두 개의
 * 스케일이 동시에 도는 것이다 — 카드 제목과 그 아래 라벨이 다른 체계에서 온다.
 *
 * 읽기용 앱이 아니라 조밀한 분석 도구에 맞춰 조였고, 크기가 아니라 **굵기**가
 * 위계를 진다. 그래야 화면이 보드와 숫자에 더 남는다.
 */
export const TYPE: Record<string, TypeSlot> = {
  "display-large": { weight: 400, size: 44, line: 52, tracking: -0.5 },
  "display-medium": { weight: 400, size: 34, line: 42, tracking: -0.4 },
  "display-small": { weight: 400, size: 28, line: 36, tracking: -0.3 },

  "headline-large": { weight: 600, size: 28, line: 36, tracking: -0.4 },
  "headline-medium": { weight: 600, size: 24, line: 32, tracking: -0.3 },
  "headline-small": { weight: 600, size: 21, line: 28, tracking: -0.2 },

  "title-large": { weight: 600, size: 20, line: 26, tracking: -0.2 },
  "title-medium": { weight: 600, size: 16, line: 22, tracking: -0.1 },
  "title-small": { weight: 500, size: 14, line: 20 },

  "body-large": { weight: 400, size: 15, line: 22 },
  "body-medium": { weight: 400, size: 14, line: 20 },
  "body-small": { weight: 400, size: 13, line: 18 },

  "label-large": { weight: 500, size: 14, line: 20 },
  "label-medium": { weight: 500, size: 12, line: 16 },
  "label-small": { weight: 500, size: 11, line: 16 },
};

/** 콘솔과 좌표 줄. */
export const MONO = { size: 13, line: 18 } as const;

/** 4dp 격자에 반 단계 하나. `Spacing.kt`. */
export const SPACE = { xs: 2, s: 4, m: 8, l: 12, xl: 16, xxl: 24 } as const;

/** 하나의 모서리 스케일, 다섯 단계. `Shape.kt`. */
export const RADIUS = { xs: 4, s: 8, m: 12, l: 16, xl: 28 } as const;

/**
 * 네 규칙, 예외 없음(`Motion.kt`):
 * 미끄러지지 않는다 / 200ms 를 넘지 않는다 / 실시간 숫자는 보간하지 않는다 /
 * 증명 하트비트 500ms 는 그대로 둔다.
 */
export const MOTION = { quick: 150, panel: 180, value: 200, heartbeat: 500 } as const;

/** 앱의 `WideLayoutMin` / `ReadingWidth` 상수를 그대로 쓴다. */
export const LAYOUT = {
  readingWidth: 640,
  wideMin: 640,
  /** 내비게이션이 하단 탭으로 바뀌는 폭 — 앱 모습 그대로. */
  compactMax: 640,
  railWide: 1280,
  railIconOnly: 1024,
} as const;
