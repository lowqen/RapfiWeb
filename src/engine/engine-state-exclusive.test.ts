import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AnalysisSnapshot,
  EngineCommand,
  FromWorker,
  Placement,
  ToWorker,
} from "./engine-types";
import { move } from "../core/model/move";

/**
 * 엔진 자물쇠(`owner`)와 독점 탐색(`exclusiveSearch`) — 게임 리뷰가 엔진을 쥐는 길.
 * 하네스는 `engine-state-modes.test.ts` 와 같다(스토어 → 클라이언트 → 가짜 워커 메시지).
 */

const workers: FakeWorker[] = [];

class FakeWorker {
  posted: ToWorker[] = [];
  onmessage: ((ev: { data: FromWorker }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    workers.push(this);
  }
  postMessage(m: ToWorker) {
    this.posted.push(m);
    if (m.type !== "boot") return;
    setTimeout(() => {
      this.onmessage?.({
        data: {
          type: "booted",
          version: m.variant,
          bootMs: 1,
          about: {},
          threaded: m.variant.startsWith("multi"),
          maxThreads: 256,
          weights: { source: "cache", ms: 0 },
          warmupMs: null,
        },
      });
    }, 5);
  }
  terminate() {
    this.terminated = true;
  }
  /** 마지막 탐색 요청을 끝낸다(대기로). */
  finish(mode: "analyze" | "move") {
    const id = this.posted.filter((m) => m.type === "search" || m.type === "move").length;
    this.onmessage?.({
      data: { type: "searchDone", id, mode, reason: "stopped", elapsedMs: 1 },
    });
  }
  infos(): EngineCommand[] {
    return this.posted
      .flatMap((m) => (m.type === "send" ? m.commands : []))
      .filter((c) => c.kind === "info");
  }
}

let store: typeof import("./engine-state").useEngineStore;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const stones: Placement[] = [
  { move: move(7, 7), own: false },
  { move: move(8, 8), own: true },
];

beforeAll(async () => {
  vi.stubGlobal("crossOriginIsolated", false);
  vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
  vi.stubGlobal("Worker", FakeWorker);
  const mod = await import("./engine-state");
  store = mod.useEngineStore;
  store.getState().configure({
    info: [
      { kind: "info", key: "max_node", value: -1 },
      { kind: "info", key: "hash_size", value: 65536 },
    ],
    hashAutoClear: false,
    threads: 1,
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const searches = (w: FakeWorker) =>
  w.posted.filter((m): m is Extract<ToWorker, { type: "search" }> => m.type === "search");

function snapshotMsg(id: number, depth: number): FromWorker {
  return {
    type: "snapshot",
    id,
    snapshot: {
      stats: {
        depth,
        selDepth: null,
        evalCp: 10,
        winRatePct: 52,
        mate: null,
        nodes: 1,
        speed: 1,
        timeMs: 1,
      },
      pvs: [
        { index: 0, depth, winRate: 0.52, mate: null, evalCp: 10, line: [move(6, 6)], round: 1 },
      ],
      tags: [],
      candidates: [],
      loseCells: [],
      bestMove: move(6, 6),
      bestLine: [move(6, 6)],
      instant: false,
    },
  } as unknown as FromWorker;
}

describe("자물쇠", () => {
  it("잡으면 켜 둔 분석을 끄고, 그동안 분석 · 착수를 받지 않는다", async () => {
    await store.getState().analyze(stones);
    const w = workers.at(-1)!;
    const before = searches(w).length;
    expect(store.getState().analyzing).toBe(true);

    expect(store.getState().acquire("review")).toBeNull();
    expect(store.getState().analyzing).toBe(false);
    expect(w.posted.at(-1)).toEqual({ type: "stop" });
    expect(store.getState().acquire("review")).toBe("이미 진행 중입니다");

    await store.getState().analyze(stones);
    expect(store.getState().analyzing).toBe(false);
    await store.getState().play(stones, false, { turnMs: 1000 });
    expect(searches(w)).toHaveLength(before);
    expect(w.posted.some((m) => m.type === "move")).toBe(false);
  });

  it("독점 탐색은 YXNBEST n 과 이 탐색만의 INFO 로 걸고, 끝나면 마지막 스냅샷을 준다", async () => {
    const w = workers.at(-1)!;
    const seen: number[] = [];
    const p = store
      .getState()
      .exclusiveSearch(
        stones,
        { totalMs: 1000, nbest: 2, info: [{ kind: "info", key: "max_depth", value: 12 }] },
        (s) => seen.push(s.stats.depth),
      );
    await tick();
    const req = searches(w).at(-1)!;
    expect(req.repeat).toEqual([{ kind: "yxnbest", n: 2 }]);
    expect(req.totalMs).toBe(1000);
    expect(w.infos()).toContainEqual({
      kind: "info",
      key: "max_depth",
      value: 12,
    } as EngineCommand);
    const id = w.posted.filter((m) => m.type === "search" || m.type === "move").length;
    w.onmessage?.({ data: snapshotMsg(id, 7) });
    w.onmessage?.({ data: snapshotMsg(id, 9) });
    w.onmessage?.({
      data: { type: "searchDone", id, mode: "analyze", reason: "timeout", elapsedMs: 1000 },
    });
    const snap = (await p) as AnalysisSnapshot;
    expect(seen).toEqual([7, 9]);
    expect(snap.stats.depth).toBe(9);
    // 독점 탐색의 끝은 «밀린 분석»으로 읽히지 않는다 — 분석이 다시 붙지 않는다.
    expect(store.getState().analyzing).toBe(false);
  });

  it("무제한이면 시간 한도 없이 건다", async () => {
    const w = workers.at(-1)!;
    const p = store.getState().exclusiveSearch(stones, { totalMs: Infinity, nbest: 2 });
    await tick();
    expect(searches(w).at(-1)!.totalMs).toBe(Infinity);
    w.finish("analyze");
    await p;
  });

  it("엔진을 내리면 기다리던 독점 탐색은 빈손으로 끝난다", async () => {
    const p = store.getState().exclusiveSearch(stones, { totalMs: 1000, nbest: 2 });
    await tick();
    store.getState().terminate();
    expect(await p).toBeNull();
  });

  it("풀면 다시 분석을 받는다", async () => {
    store.getState().release("review");
    expect(store.getState().owner).toBeNull();
    await store.getState().analyze(stones);
    expect(store.getState().analyzing).toBe(true);
  });
});
