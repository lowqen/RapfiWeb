import { beforeEach, describe, expect, it } from "vitest";
import { REVIEW_BUSY, useGameStore } from "./gameStore";
import { useBoardStore } from "./boardStore";
import { useEngineStore } from "../../engine/engine-state";
import type { EngineCommand } from "../../engine/engine-types";
import { move } from "../../core/model/move";

/**
 * 리뷰가 엔진을 쥐고 있을 때(`owner`) 보드가 엔진을 건드리지 않는가 — 분석 정지가 리뷰의
 * 탐색을 끊거나, 대국의 엔진 착수가 리뷰의 국면 사이에 끼면 리뷰가 엉뚱한 값을 적는다.
 */

const sent: EngineCommand[] = [];
let stops = 0;
let plays = 0;

beforeEach(() => {
  sent.length = 0;
  stops = 0;
  plays = 0;
  useEngineStore.setState({
    owner: "review",
    status: "searching",
    analyzing: false,
    send: (...c) => {
      sent.push(...c);
    },
    stop: () => {
      stops++;
    },
    play: async () => {
      plays++;
    },
  });
  useBoardStore.getState().clear();
  useGameStore.setState({
    mode: "game",
    computerSide: "white",
    opening: "none",
    thinking: false,
    result: null,
    prompt: null,
  });
});

describe("리뷰 중의 보드", () => {
  it("분석 정지는 리뷰의 탐색을 멈추지 않고 까닭을 돌려준다", () => {
    useGameStore.setState({ mode: "analysis" });
    expect(useGameStore.getState().stopAnalysis({ playBest: true })).toEqual({
      kind: "rejected",
      reason: REVIEW_BUSY,
    });
    expect(stops).toBe(0);
  });

  it("대국의 엔진 차례는 걸지 않고 기다리라고 알린다", () => {
    const r = useGameStore.getState().tap(move(7, 7));
    expect(r.kind).toBe("placed");
    expect(plays).toBe(0);
    expect(useGameStore.getState().thinking).toBe(false);
    expect(useGameStore.getState().prompt).toEqual({ kind: "info", text: REVIEW_BUSY });
  });

  it("자물쇠가 풀리면 평소대로 엔진이 둔다", () => {
    useEngineStore.setState({ owner: null, status: "ready" });
    useGameStore.getState().tap(move(7, 7));
    expect(plays).toBe(1);
    expect(useGameStore.getState().thinking).toBe(true);
  });
});
