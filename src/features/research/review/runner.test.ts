import { describe, expect, it } from "vitest";
import {
  budgetInfo,
  depthReached,
  engineLogLine,
  placementsOf,
  recordFromSnapshot,
  runReview,
  type ReviewPort,
} from "./runner";
import {
  EMPTY_SNAPSHOT,
  type AnalysisSnapshot,
  type PvSnapshot,
} from "../../../engine/engine-types";
import { move, type Move } from "../../../core/model/move";
import { EMPTY_RECORD, type PositionRecord } from "../../../core/review/move-quality";

/**
 * 리뷰 루프 — 진짜 엔진 대신 국면마다 정해 둔 스냅샷을 돌려주는 가짜 포트로.
 * 확인하는 것: 어느 국면을 읽고 어느 국면을 건너뛰는가, 기록이 어떻게 만들어지는가,
 * 취소 · 엔진 소실 · 이어서 하기.
 */

const pv = (
  index: number,
  winRate: number | null,
  extra: Partial<PvSnapshot> = {},
): PvSnapshot => ({
  index,
  depth: 10,
  winRate,
  mate: null,
  evalCp: null,
  line: [move(index, 0)],
  round: 1,
  ...extra,
});

const snap = (pvs: PvSnapshot[], extra: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot => ({
  ...EMPTY_SNAPSHOT,
  pvs,
  bestMove: pvs[0]?.line[0] ?? null,
  stats: { ...EMPTY_SNAPSHOT.stats, depth: 10 },
  ...extra,
});

/** 대각선으로 늘어선 수 — 오목이 되지 않게 띄엄띄엄. */
const line = (n: number): Move[] =>
  Array.from({ length: n }, (_, i) => move((i * 3) % 15, Math.floor(i / 2) * 2));

function fakePort(answer: (ply: number) => AnalysisSnapshot | null) {
  const searched: number[] = [];
  const opts: { totalMs: number; nbest: number }[] = [];
  let stops = 0;
  const port: ReviewPort = {
    search: async (stones, o, onSnapshot) => {
      searched.push(stones.length);
      opts.push({ totalMs: o.totalMs, nbest: o.nbest });
      const s = answer(stones.length);
      if (s) onSnapshot(s);
      return s;
    },
    stop: () => {
      stops++;
    },
  };
  return { port, searched, opts, stops: () => stops };
}

const hooks = (cancelAt = Infinity) => {
  const checkpoints: number[] = [];
  const logs: string[] = [];
  let ticks = 0;
  return {
    checkpoints,
    logs,
    h: {
      onCheckpoint: (_r: readonly PositionRecord[], i: number) => {
        checkpoints.push(i);
      },
      onProgress: () => {
        ticks++;
      },
      isCancelled: () => ticks > cancelAt,
      log: (t: string) => logs.push(t),
    },
  };
};

const budget = { seconds: 2, byDepth: false, depth: 14 };

describe("기록 만들기", () => {
  it("흑 차례 국면은 그대로, 백 차례는 뒤집는다", () => {
    expect(recordFromSnapshot(snap([pv(0, 0.7)]), 0).blackWinRate).toBeCloseTo(0.7);
    expect(recordFromSnapshot(snap([pv(0, 0.7)]), 1).blackWinRate).toBeCloseTo(0.3);
  });

  it("메이트는 1 / 0 으로 붙이고 흑 관점 부호로 남긴다", () => {
    const white = recordFromSnapshot(snap([pv(0, 0.9, { mate: 3 })]), 1);
    expect(white.blackMate).toBe(-3);
    expect(white.blackWinRate).toBe(0);
    const black = recordFromSnapshot(snap([pv(0, 0.1, { mate: -2 })]), 0);
    expect(black.blackMate).toBe(-2);
    expect(black.blackWinRate).toBe(0);
  });

  it("최선과 차선의 차를 두는 쪽 관점으로 — 메이트는 붙여서", () => {
    expect(recordFromSnapshot(snap([pv(0, 0.7), pv(1, 0.5)]), 0).gap).toBeCloseTo(0.2);
    expect(recordFromSnapshot(snap([pv(1, 0.5), pv(0, 0.7)]), 1).gap).toBeCloseTo(0.2);
    expect(recordFromSnapshot(snap([pv(0, 0.6, { mate: 5 }), pv(1, 0.4)]), 0).gap).toBeCloseTo(0.6);
    expect(recordFromSnapshot(snap([pv(0, 0.6)]), 0).gap).toBeNull();
  });

  it("최선수는 엔진의 것, 없으면 PV 머리", () => {
    expect(recordFromSnapshot(snap([pv(0, 0.5)], { bestMove: move(3, 3) }), 0).best).toEqual(
      move(3, 3),
    );
    expect(recordFromSnapshot(snap([pv(0, 0.5)], { bestMove: null }), 0).best).toEqual(move(0, 0));
  });

  it("PV 가 없으면 전체 통계로, 그것도 없으면 값 없이", () => {
    const stats = { ...EMPTY_SNAPSHOT.stats, winRatePct: 40 };
    expect(recordFromSnapshot(snap([], { stats }), 0).blackWinRate).toBeCloseTo(0.4);
    const instant = recordFromSnapshot(snap([], { instant: true, bestMove: move(1, 2) }), 0);
    expect(instant.blackWinRate).toBeNull();
    expect(instant.best).toEqual(move(1, 2));
    expect(recordFromSnapshot(null, 0)).toEqual(EMPTY_RECORD);
  });

  it("승률 줄 없이 평가값만 있으면 로지스틱으로", () => {
    expect(recordFromSnapshot(snap([pv(0, null, { evalCp: 0 })]), 0).blackWinRate).toBeCloseTo(0.5);
  });
});

describe("도움", () => {
  it("엔진에 넘기는 own 은 다음 차례 색", () => {
    expect(placementsOf([move(1, 1), move(2, 2)]).map((p) => p.own)).toEqual([true, false]);
    expect(placementsOf([move(1, 1)]).map((p) => p.own)).toEqual([false]);
  });

  it("예산 INFO — 노드 무제한, 깊이는 예산이거나 판 칸 수", () => {
    expect(budgetInfo({ seconds: 3, byDepth: true, depth: 18 }, 15)).toEqual([
      { kind: "info", key: "max_node", value: -1 },
      { kind: "info", key: "max_depth", value: 18 },
    ]);
    expect(budgetInfo(budget, 15)[1]).toEqual({ kind: "info", key: "max_depth", value: 225 });
  });

  it("깊이 도달은 둘째 PV 까지 그 깊이여야", () => {
    const s = snap([pv(0, 0.5, { depth: 14 }), pv(1, 0.4, { depth: 13 })], {
      stats: { ...EMPTY_SNAPSHOT.stats, depth: 14 },
    });
    expect(depthReached(s, 14)).toBe(false);
    expect(
      depthReached({ ...s, pvs: [pv(0, 0.5, { depth: 14 }), pv(1, 0.4, { depth: 14 })] }, 14),
    ).toBe(true);
    expect(depthReached({ ...s, pvs: [pv(0, 0.5, { depth: 14 })] }, 14)).toBe(true);
  });
});

describe("루프", () => {
  it("첫 다섯 국면을 건너뛰고 나머지를 한 번씩 읽는다", async () => {
    const f = fakePort(() => snap([pv(0, 0.55), pv(1, 0.5)]));
    const k = hooks();
    const moves = line(8);
    const out = await runReview(
      { moves, size: 15, records: [], index: 0 },
      { budget, skipOpening: true },
      f.port,
      k.h,
    );
    expect(out.kind).toBe("done");
    expect(f.searched).toEqual([5, 6, 7, 8]);
    expect(f.opts.every((o) => o.totalMs === 2000 && o.nbest === 2)).toBe(true);
    if (out.kind !== "done") return;
    expect(out.records).toHaveLength(9);
    expect(out.records.slice(0, 5).every((r) => r.blackWinRate === null)).toBe(true);
    expect(out.records[5]!.blackWinRate).not.toBeNull();
    expect(k.checkpoints).toEqual([6, 7, 8, 9]);
  });

  it("건너뛰기를 끄면 빈 판부터 읽는다", async () => {
    const f = fakePort(() => snap([pv(0, 0.5)]));
    await runReview(
      { moves: line(3), size: 15, records: [], index: 0 },
      { budget, skipOpening: false },
      f.port,
      hooks().h,
    );
    expect(f.searched).toEqual([0, 1, 2, 3]);
  });

  it("오목이 난 국면은 읽지 않고 이긴 쪽으로 적는다", async () => {
    // 흑 h8..l8 다섯, 백은 그 사이 다른 줄
    const moves = [7, 8, 9, 10, 11].flatMap((x, i) =>
      i < 4 ? [move(x, 7), move(x, 9)] : [move(x, 7)],
    );
    const f = fakePort(() => snap([pv(0, 0.5)]));
    const out = await runReview(
      { moves, size: 15, records: [], index: 0 },
      { budget, skipOpening: false },
      f.port,
      hooks().h,
    );
    expect(f.searched).not.toContain(9);
    if (out.kind !== "done") throw new Error(out.kind);
    expect(out.records[9]).toMatchObject({ blackWinRate: 1, blackMate: 0 });
  });

  it("깊이 예산은 시간 무제한으로 걸고, 깊이에 닿으면 멈춘다", async () => {
    const deep = snap([pv(0, 0.5, { depth: 12 }), pv(1, 0.4, { depth: 12 })], {
      stats: { ...EMPTY_SNAPSHOT.stats, depth: 12 },
    });
    const f = fakePort(() => deep);
    await runReview(
      { moves: line(1), size: 15, records: [], index: 0 },
      { budget: { seconds: 3, byDepth: true, depth: 12 }, skipOpening: false },
      f.port,
      hooks().h,
    );
    expect(f.opts[0]!.totalMs).toBe(Infinity);
    expect(f.stops()).toBe(2); // 국면 둘(빈 판 · 1수) 모두
  });

  it("즉답이면 예산을 기다리지 않고 멈춘다", async () => {
    const f = fakePort(() => snap([], { instant: true, bestMove: move(4, 4) }));
    await runReview(
      { moves: line(1), size: 15, records: [], index: 0 },
      { budget, skipOpening: false },
      f.port,
      hooks().h,
    );
    expect(f.stops()).toBe(2);
  });

  it("취소하면 그 자리까지의 기록과 번호를 돌려준다", async () => {
    const f = fakePort(() => snap([pv(0, 0.5)]));
    const out = await runReview(
      { moves: line(6), size: 15, records: [], index: 0 },
      { budget, skipOpening: false },
      f.port,
      hooks(2).h,
    );
    expect(out.kind).toBe("cancelled");
    if (out.kind !== "cancelled") return;
    expect(out.index).toBe(2);
    expect(out.records[1]!.blackWinRate).not.toBeNull();
    expect(out.records[2]!.blackWinRate).toBeNull();
  });

  it("엔진이 사라지면 실패 — 이어서 할 자리를 남긴다", async () => {
    const f = fakePort((ply) => (ply < 2 ? snap([pv(0, 0.5)]) : null));
    const out = await runReview(
      { moves: line(4), size: 15, records: [], index: 0 },
      { budget, skipOpening: false },
      f.port,
      hooks().h,
    );
    expect(out.kind).toBe("failed");
    if (out.kind === "failed") expect(out.index).toBe(2);
  });

  it("체크포인트에서 이어 하면 앞의 기록은 두고 남은 국면만 읽는다", async () => {
    const f = fakePort(() => snap([pv(0, 0.6)]));
    const kept: PositionRecord = { blackWinRate: 0.42, blackMate: 0, best: null, gap: null };
    const out = await runReview(
      { moves: line(4), size: 15, records: [kept, kept, kept], index: 3 },
      { budget, skipOpening: false },
      f.port,
      hooks().h,
    );
    expect(f.searched).toEqual([3, 4]);
    if (out.kind !== "done") throw new Error(out.kind);
    expect(out.records[2]!.blackWinRate).toBe(0.42);
    expect(out.records[3]!.blackWinRate).toBeCloseTo(0.4); // 백 차례 0.6 → 흑 0.4
  });
});

describe("엔진 로그", () => {
  it("국면마다 깊이 · 노드 · 시간 · 속도 · 최선 · 값 · 차를 한 줄로", () => {
    const s = snap([pv(0, 0.7), pv(1, 0.5)], {
      bestMove: move(8, 6),
      stats: {
        ...EMPTY_SNAPSHOT.stats,
        depth: 14,
        selDepth: 22,
        nodes: 1_250_000,
        timeMs: 1002,
        speed: 1_247_000,
      },
    });
    const rec = recordFromSnapshot(s, 7);
    expect(engineLogLine(7, s, rec, 15)).toBe(
      "#7 백 차례 · 깊이 14-22 · 1.25M 노드 · 1002ms · 1.25M/s · 최선 i9 · 흑 30.0% · 차 20%p",
    );
  });

  it("즉답과 메이트는 그렇다고 적는다", () => {
    const instant = snap([], { instant: true, bestMove: move(7, 7) });
    expect(engineLogLine(0, instant, recordFromSnapshot(instant, 0), 15)).toBe(
      "#0 흑 차례 · 즉답 · 최선 h8",
    );
    const mate = snap([pv(0, 1, { mate: 5 })]);
    expect(engineLogLine(2, mate, recordFromSnapshot(mate, 2), 15)).toMatch(/흑 M5$/);
  });

  it("읽은 국면 · 종국 국면마다 한 줄, 이어서 하면 앞의 줄에 잇는다", async () => {
    const f = fakePort(() => snap([pv(0, 0.5)]));
    const checkpointLogs: number[] = [];
    const h = {
      ...hooks().h,
      onCheckpoint: (_r: unknown, _i: number, log: readonly string[]) =>
        void checkpointLogs.push(log.length),
    };
    const out = await runReview(
      { moves: line(3), size: 15, records: [], index: 0 },
      { budget, skipOpening: false },
      f.port,
      h,
    );
    expect(out.log).toHaveLength(4);
    expect(out.log[0]).toMatch(/^#0 흑 차례/);
    expect(checkpointLogs).toEqual([1, 2, 3, 4]);
    const resumed = await runReview(
      { moves: line(3), size: 15, records: [], index: 2, log: ["앞의 줄 A", "앞의 줄 B"] },
      { budget, skipOpening: false },
      f.port,
      hooks().h,
    );
    expect(resumed.log.slice(0, 2)).toEqual(["앞의 줄 A", "앞의 줄 B"]);
    expect(resumed.log).toHaveLength(4);
  });
});
