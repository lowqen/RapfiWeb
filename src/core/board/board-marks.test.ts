import { describe, expect, it } from "vitest";
import { drawDynamic, emptyRender, type BoardRender } from "./board-renderer";
import { boardGeometry } from "./board-geometry";
import type { BoardSkin } from "./board-skin";
import { move, moveKey } from "../model/move";

/**
 * 모양 표식(`marks`) — 캔버스 없이, 불린 그리기 호출을 세는 가짜 컨텍스트로.
 * 확인하는 것은 «빈 점에만 그린다»와 «모양마다 다른 경로»다.
 */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, name) =>
        typeof name === "string" && !["fillStyle", "strokeStyle", "lineWidth"].includes(name)
          ? (...args: unknown[]) => {
              calls.push(name);
              void args;
              return { addColorStop: () => {} };
            }
          : undefined,
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const skin = new Proxy({}, { get: () => "#000" }) as BoardSkin;
const g = boardGeometry(450, 15);

function draw(r: Partial<BoardRender>) {
  const { ctx, calls } = recorder();
  drawDynamic(ctx, { ...emptyRender(15), showNumbers: false, ...r }, g, skin);
  return calls;
}

const square = { shape: "square" as const, fill: "#5ce062", dot: null };

describe("모양 표식", () => {
  it("빈 점에 그린다", () => {
    const base = draw({}).filter((c) => c === "rect").length;
    const calls = draw({ marks: new Map([[moveKey(move(3, 3)), square]]) });
    expect(calls.filter((c) => c === "rect").length).toBe(base + 1);
  });

  it("돌이 놓인 점에는 그리지 않는다", () => {
    const base = draw({ stones: [move(3, 3)] }).filter((c) => c === "rect").length;
    const calls = draw({ stones: [move(3, 3)], marks: new Map([[moveKey(move(3, 3)), square]]) });
    expect(calls.filter((c) => c === "rect").length).toBe(base);
  });

  it("다각형은 꼭짓점 수만큼 선을 긋고, 안쪽 점은 원 하나를 더 그린다", () => {
    const at = moveKey(move(5, 5));
    const lines = (shape: "pentagon" | "triangle") =>
      draw({ marks: new Map([[at, { shape, fill: "#fff", dot: null }]]) }).filter(
        (c) => c === "lineTo",
      ).length;
    expect(lines("pentagon") - lines("triangle")).toBe(2);
    const arcs = (dot: string | null) =>
      draw({ marks: new Map([[at, { ...square, dot }]]) }).filter((c) => c === "arc").length;
    expect(arcs("#000") - arcs(null)).toBe(1);
  });
});
