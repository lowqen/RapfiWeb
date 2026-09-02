import { describe, it, expect } from "vitest";
import { boardGeometry, starPoints, MARGIN } from "./board-geometry";
import { moveAt, isNearIntersection, zoomAt, clampTransform, IDENTITY } from "./board-interaction";
import {
  DEFAULT_PALETTE,
  colorsForTag,
  inkContrast,
  ladderColor,
  ladderHex,
  ratePosition,
  winPosition,
  losePosition,
  LADDER_STOPS,
} from "./ladder";
import { luminanceOf } from "../design/oklch";
import { label, moveKey, fromKey } from "../model/move";

describe("기하", () => {
  const side = 600;
  const g = boardGeometry(side, 15);

  it("여백은 0.75칸, 반지름은 0.45step", () => {
    expect(g.step).toBeCloseTo(side / (14 + 2 * MARGIN), 10);
    expect(g.origin).toBeCloseTo(g.step * MARGIN, 10);
    expect(g.radius).toBeCloseTo(g.step * 0.45, 10);
  });

  it("선폭은 step/45 — 단, 1px 아래로는 안 내려간다", () => {
    // 600px 보드에서는 step/45 = 0.86 이라 바닥값 1 이 이긴다. 큰 보드에서 비율이 산다.
    expect(g.hair).toBe(1);
    const big = boardGeometry(1200, 15);
    expect(big.hair).toBeCloseTo(big.step / 45, 10);
    expect(big.hair).toBeGreaterThan(1);
  });

  it("격자가 보드 안에 들어간다 — 여백이 양쪽에 남는다", () => {
    expect(g.cx(0)).toBeGreaterThan(0);
    expect(g.cx(14)).toBeLessThan(side);
    expect(side - g.cx(14)).toBeCloseTo(g.cx(0), 6);
  });

  it("cellAt 은 그린 자리를 되돌려 준다 (모든 교점에서)", () => {
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        expect(g.cellAt(g.cx(x), g.cy(y))).toEqual({ x, y });
      }
    }
  });

  it("보드 밖은 가장자리로 잘린다", () => {
    expect(g.cellAt(-500, -500)).toEqual({ x: 0, y: 0 });
    expect(g.cellAt(9999, 9999)).toEqual({ x: 14, y: 14 });
  });

  it("화점은 15×15 에서만 다섯 개", () => {
    expect(starPoints(15)).toHaveLength(5);
    expect(starPoints(20)).toHaveLength(0);
    expect(starPoints(15)).toContainEqual({ x: 7, y: 7 });
  });
});

describe("좌표 표기", () => {
  it("열은 A부터, 행은 아래에서 위로 — 보드 여백의 라벨과 같은 규칙", () => {
    expect(label({ x: 0, y: 14 })).toBe("A1");
    expect(label({ x: 7, y: 7 })).toBe("H8");
    expect(label({ x: 14, y: 0 })).toBe("O15");
  });

  it("키 왕복", () => {
    for (const m of [
      { x: 0, y: 0 },
      { x: 7, y: 7 },
      { x: 14, y: 14 },
    ]) {
      expect(fromKey(moveKey(m), 15)).toEqual(m);
    }
  });
});

describe("인터랙션", () => {
  const side = 600;

  it("변환이 없으면 히트 테스트가 기하와 같다", () => {
    const g = boardGeometry(side, 15);
    expect(moveAt(g.cx(3), g.cy(9), side, 15)).toEqual({ x: 3, y: 9 });
  });

  it("교점에서 먼 곳은 «가까움»이 아니다 — 여백 클릭이 A15 로 새지 않게", () => {
    const g = boardGeometry(side, 15);
    expect(isNearIntersection(g.cx(0), g.cy(0), side, 15)).toBe(true);
    // 두 교점의 정확한 중간은 어느 쪽에도 가깝지 않다(반지름 0.45step, 허용 1.1배).
    expect(isNearIntersection(g.cx(0) + g.step / 2, g.cy(0), side, 15)).toBe(false);
  });

  it("확대해도 손가락 아래 지점이 그대로다", () => {
    const g = boardGeometry(side, 15);
    const px = g.cx(10);
    const py = g.cy(4);
    const zoomed = zoomAt(IDENTITY, side, 2, px, py);
    expect(zoomed.scale).toBe(2);
    expect(moveAt(px, py, side, 15, zoomed)).toEqual({ x: 10, y: 4 });
  });

  it("배율 1에서는 이동이 0으로 잘린다 — 확대 안 했는데 미끄러지면 사고다", () => {
    expect(clampTransform({ scale: 1, panX: 200, panY: -80 }, side)).toEqual({
      scale: 1,
      panX: 0,
      panY: 0,
    });
  });

  it("배율은 1..4 로 잘린다", () => {
    expect(zoomAt(IDENTITY, side, 100, 0, 0).scale).toBe(4);
    expect(zoomAt({ scale: 4, panX: 0, panY: 0 }, side, 0.001, 0, 0).scale).toBe(1);
  });
});

describe("값 사다리", () => {
  it("다섯 앵커를 정확히 재현한다", () => {
    LADDER_STOPS.forEach((hex, i) => {
      expect(ladderHex(i / (LADDER_STOPS.length - 1))).toBe(hex);
    });
  });

  it("휘도가 단조 증가한다 — 흑백으로도 순서가 남는다", () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const l = luminanceOf(ladderColor(i / 100));
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
  });

  it("흰 글씨가 사다리 전 구간에서 4.5:1 이상", () => {
    // 가장 밝은 앵커(버밀리언)가 최악이고, 앱의 문서가 4.88 이라고 적어 두었다.
    for (let i = 0; i <= 100; i++) {
      const ratio = inkContrast(ladderHex(i / 100));
      expect(ratio, `위치 ${i}%`).toBeGreaterThanOrEqual(4.5);
    }
    expect(inkContrast(ladderHex(1))).toBeGreaterThan(4.8);
  });

  it("50% 는 정확히 가운데 — «모르겠다»가 한쪽으로 기울지 않는다", () => {
    expect(ratePosition(DEFAULT_PALETTE, 50)).toBe(0.5);
    expect(ladderHex(0.5)).toBe("#515863");
  });

  it("램프가 가운데를 벌린다 — 50→55 가 90→95 보다 크게 움직인다", () => {
    const near = ratePosition(DEFAULT_PALETTE, 55) - ratePosition(DEFAULT_PALETTE, 50);
    const far = ratePosition(DEFAULT_PALETTE, 95) - ratePosition(DEFAULT_PALETTE, 90);
    expect(near).toBeGreaterThan(far);
  });

  it("확정 승패는 퍼센트 범위 밖에 앉는다 — 사실이 숫자보다 약해 보이면 안 된다", () => {
    const win = winPosition(DEFAULT_PALETTE);
    const lose = losePosition(DEFAULT_PALETTE);
    for (let p = 0; p <= 100; p++) {
      const pos = ratePosition(DEFAULT_PALETTE, p);
      expect(pos).toBeLessThanOrEqual(win + 1e-6);
      expect(pos).toBeGreaterThanOrEqual(lose - 1e-6);
    }
  });

  it("확정 승패만 굵다", () => {
    expect(colorsForTag(DEFAULT_PALETTE, "win").bold).toBe(true);
    expect(colorsForTag(DEFAULT_PALETTE, "lose").bold).toBe(true);
    expect(colorsForTag(DEFAULT_PALETTE, "rate", 63).bold).toBe(false);
  });

  it("colorValue 가 사다리를 어둡게 하되 0.4 아래로는 못 간다", () => {
    const dim = colorsForTag({ ...DEFAULT_PALETTE, value: 60 }, "rate", 50);
    const full = colorsForTag(DEFAULT_PALETTE, "rate", 50);
    expect(dim.fill).not.toBe(full.fill);
    const floorLit = colorsForTag({ ...DEFAULT_PALETTE, value: 0 }, "rate", 50);
    const at40 = colorsForTag({ ...DEFAULT_PALETTE, value: 40 }, "rate", 50);
    expect(floorLit.fill).toBe(at40.fill);
  });
});
