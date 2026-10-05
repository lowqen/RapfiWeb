import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isUnlimitedTurn, levelInfo, useGameStore } from "./gameStore";
import { useBoardStore } from "./boardStore";
import { useEvalHistory } from "./currentAnalysis";
import { buildSeries, evalAtOrBefore, showMarkers } from "./evalSeries";
import { getGameHandlers, useEngineStore } from "../../engine/engine-state";
import { isSameOrAncestorKey, move, positionKey, type Move } from "../../core/model/move";
import { EMPTY_SNAPSHOT, type EngineCommand, type Placement } from "../../engine/engine-types";
import type { ComputerSide } from "../../core/model/game";

/**
 * 보드의 [대국] | [분석] 탭 — 엔진 없이 돌린다(`game.test.ts` 와 같은 기록기).
 *
 * 지키는 것: 탭을 바꿔도 기보는 그대로이고, 대국의 엔진 수와 분석이 서로의 판에 새어 들지
 * 않으며, 분석의 「정지」는 **지금 국면의** 최선수만 둔다.
 */

const plays: {
  stones: readonly Placement[];
  budget: { turnMs?: number; matchMs?: number } | undefined;
  info: readonly EngineCommand[] | undefined;
}[] = [];
let stops = 0;

const g = () => useGameStore.getState();
const stones = () => useBoardStore.getState().render.stones;
const engineMoves = (...ms: Move[]) => getGameHandlers().onEngineMove?.(ms);

function fresh(opts: { mode?: "game" | "analysis"; computerSide?: ComputerSide } = {}) {
  useEngineStore.setState({
    status: "idle",
    analyzing: false,
    snapshot: EMPTY_SNAPSHOT,
    snapshotKey: null,
    send: () => {},
    play: async (s, _empty, budget, info) => {
      plays.push({ stones: s, budget, info });
    },
    stop: () => {
      stops++;
      useEngineStore.setState({ analyzing: false });
    },
  });
  useGameStore.setState({
    mode: "game",
    computerSide: opts.computerSide ?? "none",
    opening: "none",
    showForbidden: false,
    moveTimeMs: 0,
    level: 5,
  });
  g().newGame();
  if (opts.mode) useGameStore.setState({ mode: opts.mode });
  plays.length = 0;
  stops = 0;
}

/** 엔진이 「지금 판」을 읽는 중이라고 꾸민다 — 최선수 `best`. */
function analysing(best: Move, key = positionKey(stones())) {
  useEngineStore.setState({
    status: "searching",
    analyzing: true,
    snapshot: { ...EMPTY_SNAPSHOT, bestMove: best, bestLine: [best] },
    snapshotKey: key,
  });
}

beforeEach(() => fresh());
afterEach(() => useGameStore.setState({ mode: "game" }));

describe("분석 탭", () => {
  it("판을 누르면 그대로 놓인다 — 컴퓨터가 색을 맡았어도 엔진이 차례를 받지 않는다", () => {
    fresh({ mode: "analysis", computerSide: "white" });
    expect(g().tap(move(7, 7))).toEqual({ kind: "placed" });
    expect(g().tap(move(8, 8))).toEqual({ kind: "placed" });
    expect(stones()).toHaveLength(2);
    expect(plays).toHaveLength(0);
    expect(g().thinking).toBe(false);
  });

  it("엔진 차례에 눌러도 «두어라»가 아니다 — 누른 자리에 돌이 놓인다", () => {
    fresh({ mode: "analysis", computerSide: "black" });
    expect(g().tap(move(3, 3))).toEqual({ kind: "placed" });
    expect(plays).toHaveLength(0);
  });

  it("진영 전환은 대국 탭의 일이다", () => {
    fresh({ mode: "analysis", computerSide: "white" });
    g().swapSides();
    expect(g().computerSide).toBe("white");
  });
});

describe("탭 전환 — 엔진 상태를 격리한다", () => {
  it("대국 → 분석: 생각하던 대국의 수를 버리고, 늦게 온 답은 판에 두지 않는다", () => {
    fresh({ computerSide: "white" });
    g().tap(move(7, 7));
    expect(g().thinking).toBe(true);
    g().setMode("analysis");
    expect(g().thinking).toBe(false);
    expect(stops).toBe(1);
    engineMoves(move(8, 8)); // 정지에 답해 올라온 수
    expect(stones()).toHaveLength(1);
    // 기보는 그대로.
    expect(stones()[0]).toEqual(move(7, 7));
  });

  it("분석 → 대국: 분석을 멈추기만 한다 — 최선수를 두지 않는다", () => {
    fresh({ mode: "analysis" });
    g().tap(move(7, 7));
    analysing(move(8, 8));
    g().setMode("game");
    expect(stops).toBe(1);
    expect(useEngineStore.getState().analyzing).toBe(false);
    expect(stones()).toHaveLength(1);
  });

  it("탭을 오가도 기보·앞으로 갈 수·결과가 그대로다", () => {
    fresh({ mode: "analysis" });
    for (const m of [move(7, 7), move(8, 8), move(9, 9)]) g().tap(m);
    g().undoMove();
    g().setMode("game");
    g().setMode("analysis");
    expect(stones()).toHaveLength(2);
    expect(useBoardStore.getState().future).toEqual([move(9, 9)]);
  });

  it("엔진을 내리면(종료 · 엔진 전환) 생각하던 대국의 수를 버리고 판을 푼다", () => {
    fresh({ computerSide: "white" });
    g().tap(move(7, 7));
    expect(g().thinking).toBe(true);
    getGameHandlers().onEngineReset?.();
    expect(g().thinking).toBe(false);
    expect(g().tap(move(1, 1)).kind).not.toBe("rejected");
  });
});

describe("분석 정지 → 최선수 착수", () => {
  it("빈 판이면 엔진의 답을 기다리지 않고 천원(H8)", () => {
    fresh({ mode: "analysis" });
    useEngineStore.setState({ status: "searching", analyzing: true });
    expect(g().stopAnalysis({ playBest: true })).toEqual({ kind: "placed", cell: move(7, 7) });
    expect(stones()).toEqual([move(7, 7)]);
    expect(stops).toBe(1);
  });

  it("지금 국면의 BEST(PV 첫 수)를 둔다", () => {
    fresh({ mode: "analysis" });
    g().tap(move(7, 7));
    analysing(move(8, 6));
    expect(g().stopAnalysis({ playBest: true })).toEqual({ kind: "placed", cell: move(8, 6) });
    expect(stones()).toEqual([move(7, 7), move(8, 6)]);
    // 정지가 분석을 껐으므로 둔 뒤에 분석이 다시 붙지 않는다.
    expect(useEngineStore.getState().analyzing).toBe(false);
  });

  it("무른 직후 — 엔진의 답이 **뒤 국면**의 것이면 두지 않고 까닭을 말한다", () => {
    fresh({ mode: "analysis" });
    g().tap(move(7, 7));
    g().tap(move(8, 8));
    analysing(move(9, 9)); // 2수 국면의 답
    g().undoMove(); // 판은 1수 국면
    const r = g().stopAnalysis({ playBest: true });
    expect(r.kind).toBe("rejected");
    expect(stones()).toHaveLength(1);
    expect(stops).toBe(1);
  });

  it("설정이 꺼져 있으면 멈추기만", () => {
    fresh({ mode: "analysis" });
    g().tap(move(7, 7));
    analysing(move(8, 6));
    expect(g().stopAnalysis({ playBest: false })).toEqual({ kind: "stopped" });
    expect(stones()).toHaveLength(1);
  });

  it("분석 중이 아니었으면 두지 않는다", () => {
    fresh({ mode: "analysis" });
    expect(g().stopAnalysis({ playBest: true })).toEqual({ kind: "stopped" });
    expect(stones()).toHaveLength(0);
  });

  it("대국 탭에서는 두지 않는다 — 대국의 수는 대국의 차례가 정한다", () => {
    fresh();
    g().tap(move(7, 7));
    analysing(move(8, 6));
    expect(g().stopAnalysis({ playBest: true })).toEqual({ kind: "stopped" });
    expect(stones()).toHaveLength(1);
  });

  it("최선수가 금수 자리면 두지 않는다", () => {
    fresh({ mode: "analysis" });
    g().tap(move(7, 7));
    g().tap(move(0, 0));
    useBoardStore.getState().setForbidden([move(8, 6)]);
    analysing(move(8, 6));
    const r = g().stopAnalysis({ playBest: true });
    expect(r.kind).toBe("rejected");
    expect(stones()).toHaveLength(2);
  });
});

describe("대국 레벨", () => {
  it("레벨은 착수에 max_node 를 얹는다 — 최강은 얹지 않는다", () => {
    expect(levelInfo(1)).toEqual([{ kind: "info", key: "max_node", value: 20_000 }]);
    expect(levelInfo(5)).toEqual([]);
  });

  it("노드 레벨 + 무제한 시간이면 엔진이 스스로 둔다(유한 예산) — 「지금 두기」는 최강에만", () => {
    expect(isUnlimitedTurn({ moveTimeMs: 0, level: 5 })).toBe(true);
    expect(isUnlimitedTurn({ moveTimeMs: 0, level: 2 })).toBe(false);
    fresh({ computerSide: "white" });
    g().setLevel(2);
    g().tap(move(7, 7));
    expect(plays).toHaveLength(1);
    expect(plays[0]!.info).toEqual([{ kind: "info", key: "max_node", value: 100_000 }]);
    expect(Number.isFinite(plays[0]!.budget?.turnMs)).toBe(true);
  });

  it("최강 + 무제한은 예전과 같다 — 시간 한도 없이", () => {
    fresh({ computerSide: "white" });
    g().tap(move(7, 7));
    expect(plays[0]!.budget).toEqual({ turnMs: Infinity });
    expect(plays[0]!.info).toEqual([]);
  });
});

describe("형세 그래프 · 무르기 정리", () => {
  it("국면 키는 수순이다 — 앞 국면은 뒤 국면의 머리다", () => {
    const a = positionKey([move(7, 7)]);
    const b = positionKey([move(7, 7), move(8, 8)]);
    expect(isSameOrAncestorKey(a, b)).toBe(true);
    expect(isSameOrAncestorKey("", b)).toBe(true);
    // 무른 판에서 뒤 국면의 값은 쓰지 않는다.
    expect(isSameOrAncestorKey(b, a)).toBe(false);
    // 「112」는 「11」로 시작하지만 다른 수다 — 쉼표까지 맞아야 머리다.
    expect(isSameOrAncestorKey("11", "112")).toBe(false);
  });

  it("엔진이 평가를 내면 그 국면의 키로 적힌다", () => {
    const key = positionKey([move(7, 7)]);
    const view = { blackPct: 61, blackEval: 40, mate: null };
    useEngineStore.setState({ evalView: view, evalKey: key });
    expect(useEvalHistory.getState().byKey.get(key)).toEqual(view);
  });

  it("대국처럼 한 수 걸러 평가가 있어도 한 줄로 잇는다 — 축만 남던 그래프", () => {
    const v = (blackPct: number) => ({ blackPct, blackEval: null, mate: null });
    // 사람(흑) 차례는 비고 엔진(백) 차례만 평가가 있다: 1 · 3 · 5수.
    const points = [null, v(80), null, v(30), null, v(25), null];
    const s = buildSeries(points);
    expect(s).toEqual([
      { ply: 1, pct: 80 },
      { ply: 3, pct: 30 },
      { ply: 5, pct: 25 },
    ]);
    expect(showMarkers(s)).toBe(true);
    // 읽지 않은 6수의 값은 그 앞의 5수 값이다(몇 수째의 값인지 함께).
    expect(evalAtOrBefore(points, 6)).toEqual({ view: v(25), ply: 5 });
    expect(evalAtOrBefore(points, 0)).toBeNull();
  });

  it("평가가 없으면 점도 없고, 많으면 점 표시를 그리지 않는다", () => {
    expect(buildSeries([null, null])).toEqual([]);
    expect(showMarkers([])).toBe(false);
    const many = Array.from({ length: 40 }, (_, i) => ({
      blackPct: 50 + i,
      blackEval: 0,
      mate: null,
    }));
    expect(showMarkers(buildSeries(many))).toBe(false);
  });

  it("그래프의 한 점을 누르면 그 수로 간다 — 앞뒤 모두", () => {
    fresh({ mode: "analysis" });
    for (const m of [move(7, 7), move(8, 8), move(9, 9)]) g().tap(m);
    g().gotoPly(1);
    expect(stones()).toHaveLength(1);
    g().gotoPly(3);
    expect(stones()).toHaveLength(3);
    g().gotoPly(0);
    expect(stones()).toHaveLength(0);
  });
});
