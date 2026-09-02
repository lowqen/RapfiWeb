import type { Move } from "../model/move";
import { boardGeometry } from "./board-geometry";

/**
 * 보드 위의 손가락·마우스 → 수.
 *
 * 확대·이동 상태를 여기 두는 이유는 하나다: **히트 테스트가 그리기와 같은 변환을
 * 써야 한다.** 화면 좌표를 보드 좌표로 되돌리는 식이 두 곳에 있으면 반드시
 * 어긋나고, 그 증상은 «가끔 옆칸에 놓인다» 라서 잡기 어렵다.
 */

export interface ViewTransform {
  /** 배율. 1 = 보드가 컨테이너에 꽉 참. */
  scale: number;
  /** CSS 픽셀 단위 이동. 확대 상태에서만 0이 아니다. */
  panX: number;
  panY: number;
}

export const IDENTITY: ViewTransform = { scale: 1, panX: 0, panY: 0 };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 확대해도 보드가 컨테이너 밖으로 새지 않게 이동량을 잘라 준다.
 * 배율 1에서는 이동이 항상 0이다 — 확대하지 않았는데 보드가 미끄러지면 사고다.
 */
export function clampTransform(t: ViewTransform, side: number): ViewTransform {
  const scale = clamp(t.scale, MIN_SCALE, MAX_SCALE);
  const slack = (side * (scale - 1)) / 2;
  // `+ 0` 은 -0 을 지운다. 배율 1에서 여유가 -0 이라 음수 이동이 -0 으로 잘리는데,
  // -0 은 화면에서는 같아도 Object.is/toEqual 에서는 다른 값이라 나중에 헷갈린다.
  return {
    scale,
    panX: clamp(t.panX, -slack, slack) + 0,
    panY: clamp(t.panY, -slack, slack) + 0,
  };
}

/**
 * 한 점을 중심으로 확대한다. 손가락(또는 커서) 아래 있던 보드 지점이 그 자리에
 * 남아야 «내가 확대한다»는 느낌이 난다 — 중심 고정 확대는 그 느낌을 깬다.
 */
export function zoomAt(
  t: ViewTransform,
  side: number,
  factor: number,
  px: number,
  py: number,
): ViewTransform {
  const scale = clamp(t.scale * factor, MIN_SCALE, MAX_SCALE);
  const k = scale / t.scale;
  const cxScreen = side / 2 + t.panX;
  const cyScreen = side / 2 + t.panY;
  return clampTransform(
    {
      scale,
      panX: t.panX + (cxScreen - px) * (k - 1),
      panY: t.panY + (cyScreen - py) * (k - 1),
    },
    side,
  );
}

/**
 * 컨테이너 기준 좌표 → 보드 좌표(변환 되돌리기) → 가장 가까운 교점.
 *
 * @param side  컨테이너 한 변(CSS 픽셀). 보드는 항상 정사각이다.
 */
export function moveAt(
  px: number,
  py: number,
  side: number,
  n: number,
  t: ViewTransform = IDENTITY,
): Move {
  const bx = (px - side / 2 - t.panX) / t.scale + side / 2;
  const by = (py - side / 2 - t.panY) / t.scale + side / 2;
  return boardGeometry(side, n).cellAt(bx, by);
}

/**
 * 그 점이 실제로 교점 위인가 — 클릭이 «가장 가까운 칸»으로 무한히 번지지 않게 한다.
 * 반지름의 1.1배까지 허용한다(손가락은 픽셀이 아니다).
 */
export function isNearIntersection(
  px: number,
  py: number,
  side: number,
  n: number,
  t: ViewTransform = IDENTITY,
): boolean {
  const g = boardGeometry(side, n);
  const bx = (px - side / 2 - t.panX) / t.scale + side / 2;
  const by = (py - side / 2 - t.panY) / t.scale + side / 2;
  const m = g.cellAt(bx, by);
  const dx = bx - g.cx(m.x);
  const dy = by - g.cy(m.y);
  return Math.hypot(dx, dy) <= g.radius * 1.1;
}

/** 롱프레스로 볼 시간. 데스크톱의 Ctrl+클릭/가운데 클릭 자리다(main.c:2677). */
export const LONG_PRESS_MS = 500;
