import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EngineCommand, FromWorker, Placement, ToWorker } from "./engine-types";
import { move } from "../core/model/move";

/**
 * 엔진 스토어의 **모드 격리**와 **엔진 전환** — 스토어 → 클라이언트 → 워커 메시지만 본다.
 *
 *   - 대국 레벨(`max_node`)은 그 착수에만 얹히고, 다음 분석은 설정값으로 되돌린다
 *   - 엔진을 바꾸면(`setEnginePreference`) 워커를 깨끗이 새로 띄우고, 켜 둔 분석은 잇는다
 *   - 엔진을 내리면 대국에 알린다(`onEngineReset`) — 생각하던 수가 판을 잠그지 않게
 *   - 스냅샷에는 그 탐색 국면의 키가 붙는다(`snapshotKey`)
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
let handlers: typeof import("./engine-state").setGameHandlers;

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
  handlers = mod.setGameHandlers;
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

describe("대국 레벨은 그 착수에만", () => {
  it("착수에 max_node 를 얹고, 다음 분석이 설정값(-1)으로 되돌린다 — 바뀐 한 줄씩만", async () => {
    await store.getState().start();
    const w = workers.at(-1)!;
    await store
      .getState()
      .play(stones, false, { turnMs: 1000, matchMs: 0 }, [
        { kind: "info", key: "max_node", value: 20000 },
      ]);
    expect(w.infos()).toEqual([{ kind: "info", key: "max_node", value: 20000 }]);
    w.finish("move");

    await store.getState().analyze(stones);
    expect(w.infos()).toEqual([
      { kind: "info", key: "max_node", value: 20000 },
      { kind: "info", key: "max_node", value: -1 },
    ]);
    // hash_size 는 한 번도 다시 나가지 않는다(해시 표를 다시 잡지 않는다).
    expect(w.infos().some((c) => c.kind === "info" && c.key === "hash_size")).toBe(false);
  });

  it("스냅샷에는 그 탐색 국면의 키가 붙는다", () => {
    const w = workers.at(-1)!;
    const id = w.posted.filter((m) => m.type === "search" || m.type === "move").length;
    w.onmessage?.({
      data: {
        type: "snapshot",
        id,
        snapshot: {
          stats: {
            depth: 5,
            selDepth: 8,
            evalCp: 30,
            winRatePct: 55,
            mate: null,
            nodes: 100,
            speed: 1000,
            timeMs: 10,
          },
          pvs: [],
          tags: [],
          candidates: [],
          loseCells: [],
          bestMove: move(6, 6),
          bestLine: [move(6, 6)],
          instant: false,
        },
      } as unknown as FromWorker,
    });
    expect(store.getState().snapshotKey).toBe(`${7 * 15 + 7},${8 * 15 + 8}`);
    expect(store.getState().evalKey).toBe(store.getState().snapshotKey);
  });
});

describe("오류 문장", () => {
  it("워커 오류의 스택은 화면에 싣지 않는다 — 「무엇이」만", async () => {
    const { tidy } = await import("./engine-state");
    expect(
      tidy(
        "Error: 가중치 무결성 검사 실패 — 크기 1098 ≠ 19865582 (http://x/engine/rapfi.data?v=1)\n    at je (http://x/assets/engine-worker-C.js:1:14127)",
      ),
    ).toBe("가중치 무결성 검사 실패 — 크기 1098 ≠ 19865582 (http://x/engine/rapfi.data?v=1)");
    expect(tidy("멀티 핸드셰이크 실패")).toBe("멀티 핸드셰이크 실패");
  });
});

describe("엔진 전환 · 내리기", () => {
  it("엔진을 바꾸면 워커를 새로 띄우고, 켜 둔 분석을 같은 국면으로 잇는다", async () => {
    expect(store.getState().analyzing).toBe(true);
    const old = workers.at(-1)!;
    store.getState().setEnginePreference("simd");
    await tick(40);
    expect(old.terminated).toBe(true);
    const fresh = workers.at(-1)!;
    expect(fresh).not.toBe(old);
    const boot = fresh.posted.find((m) => m.type === "boot");
    expect(boot && boot.type === "boot" && boot.variant).toBe("single-simd128");
    const search = fresh.posted.find((m) => m.type === "search");
    expect(search && search.type === "search" && search.setup[0]).toMatchObject({
      kind: "yxboard",
      stones,
    });
    expect(store.getState().analyzing).toBe(true);
    expect(store.getState().engine.variant).toBe("single-simd128");
  });

  it("같은 엔진을 다시 고르면 아무것도 하지 않는다", async () => {
    const n = workers.length;
    store.getState().setEnginePreference("simd");
    await tick();
    expect(workers).toHaveLength(n);
  });

  it("엔진을 내리면 대국에 알린다 — 생각하던 수가 판을 잠그지 않게", () => {
    const reset = vi.fn();
    handlers({ onEngineReset: reset });
    store.getState().terminate();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe("idle");
    expect(store.getState().snapshotKey).toBeNull();
    handlers({});
  });
});
