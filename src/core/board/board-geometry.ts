import { DEFAULT_SIZE, type Move } from "../model/move";

/**
 * 사각 보드 안에서 교점이 어디 앉는가. `BoardGeometry.kt` 의 이식본.
 *
 * 격자 둘레의 여백이 좌표 라벨을 진다. 데스크톱은 거기에 한 칸을 다 쓸 수 있지만
 * 화면 폭만 한 보드에서는 **네 칸 중 세 칸**만 준다 — 라벨에 필요한 전부이면서
 * 돌 하나하나를 몇 퍼센트 크게 만든다.
 *
 * **그리기와 히트 테스트가 둘 다 여기를 지난다.** 그래야 둘이 어긋나지 않는다 —
 * 앱이 같은 이유로 같은 규칙을 세웠다.
 */

/** 격자 양옆 여백, 칸 단위. */
export const MARGIN = 0.75;

export interface BoardGeometry {
  /** 보드 한 변의 CSS 픽셀 길이. */
  readonly side: number;
  readonly n: number;
  /** 교점 간격. */
  readonly step: number;
  /** 첫 교점의 좌표(= 여백). */
  readonly origin: number;
  /** 돌 반지름. */
  readonly radius: number;
  /** 선 굵기의 기준. 격자를 따라가므로 4배 해상도로 내보내도 실선이 유지된다. */
  readonly hair: number;
  cx(x: number): number;
  cy(y: number): number;
  /** 화면 좌표에서 가장 가까운 교점. 보드 밖은 가장자리로 잘린다. */
  cellAt(px: number, py: number): Move;
}

export function boardGeometry(side: number, n: number = DEFAULT_SIZE): BoardGeometry {
  const step = side / (n - 1 + 2 * MARGIN);
  const origin = step * MARGIN;
  const clamp = (v: number) => (v < 0 ? 0 : v > n - 1 ? n - 1 : v);

  return {
    side,
    n,
    step,
    origin,
    radius: step * 0.45,
    // 1px 아래로는 내려가지 않는다 — 작은 보드에서 격자가 사라지면 보드가 아니게 된다.
    hair: Math.max(step / 45, 1),
    cx: (x) => origin + x * step,
    cy: (y) => origin + y * step,
    cellAt: (px, py) => ({
      x: clamp(Math.round((px - origin) / step)),
      y: clamp(Math.round((py - origin) / step)),
    }),
  };
}

/**
 * 화점. 15×15 는 네 귀의 (3,3) 계열과 천원 — 앱과 같은 다섯 개다.
 * 다른 크기에서는 그리지 않는다(데스크톱도 그렇다).
 */
export function starPoints(n: number): readonly Move[] {
  if (n !== 15) return [];
  return [
    { x: 3, y: 3 },
    { x: 3, y: 11 },
    { x: 11, y: 3 },
    { x: 11, y: 11 },
    { x: 7, y: 7 },
  ];
}
