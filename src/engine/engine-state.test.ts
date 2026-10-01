import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EngineCommand, FromWorker, ToWorker } from "./engine-types";

/**
 * 기동 순서(docs/최적화-마스터플랜.md P1-1) — 스토어 → 클라이언트 → 워커 메시지만 본다.
 *
 * 예전엔 `thread_num`·`hash_size` 를 기동(=예열) **뒤** `flushConfig` 가 보냈다. 엔진은
 * 스레드 수가 바뀌면 스레드를 모두 다시 세우며 예열이 푼 가중치를 버리고, 첫 사용자 탐색이
 * 그것을 다시 풀었다(T1: 0.73~0.85초). 이제 설정은 기동 메시지에 실려 예열 전에 들어가고,
 * 기동 뒤에는 **바뀐 것만** 나가야 한다.
 */

const workers: FakeWorker[] = [];

class FakeWorker {
  posted: ToWorker[] = [];
  onmessage: ((ev: { data: FromWorker }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
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
          weights: { source: "glue", ms: 0 },
          warmupMs: m.warmupMs ?? null,
        },
      });
    }, 5);
  }
  terminate() {}
}

/** 기동 뒤 `send` 로 나간 INFO 명령들. */
const sentInfo = (w: FakeWorker): EngineCommand[] =>
  w.posted.flatMap((m) => (m.type === "send" ? m.commands : [])).filter((c) => c.kind === "info");

let store: typeof import("./engine-state").useEngineStore;

beforeAll(async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  vi.stubGlobal("Worker", FakeWorker);
  store = (await import("./engine-state")).useEngineStore;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("기동 설정은 예열 전에, 기동 뒤에는 바뀐 것만", () => {
  it("thread_num·hash_size 가 기동 메시지에 실리고, 기동 뒤 다시 나가지 않는다", async () => {
    const s = store.getState();
    s.configure({
      info: [{ kind: "info", key: "hash_size", value: 65536 }],
      hashAutoClear: false,
      threads: 3,
    });
    await s.start();
    const w = workers[0]!;
    const boot = w.posted.find((m) => m.type === "boot")!;
    expect(boot.variant.startsWith("multi")).toBe(true);
    expect(boot.settings).toEqual([
      { kind: "info", key: "hash_size", value: 65536 },
      { kind: "info", key: "thread_num", value: 3 },
    ]);
    expect(store.getState().appliedThreads).toBe(3);
    // 기동 직후 flushConfig — 이미 보낸 값이라 아무것도 나가지 않는다(재구성·재적재 없음).
    expect(sentInfo(w)).toEqual([]);
  });

  it("첫 분석 직전에도 thread_num 을 다시 보내지 않는다", () => {
    store.getState().analyze([]);
    const w = workers[0]!;
    expect(w.posted.some((m) => m.type === "search")).toBe(true);
    expect(sentInfo(w)).toEqual([]);
  });

  it("기동 뒤 스레드 수를 바꾸면 그 한 줄만 — hash_size 는 다시 보내지 않는다", async () => {
    store.getState().stop();
    const w = workers[0]!;
    // 탐색이 끝났다고 알린다(대기 상태에서 설정이 곧바로 나간다).
    const id = w.posted.filter((m) => m.type === "search").length;
    w.onmessage?.({
      data: { type: "searchDone", id, mode: "analyze", reason: "stopped", elapsedMs: 1 },
    });
    store.getState().configure({
      info: [{ kind: "info", key: "hash_size", value: 65536 }],
      hashAutoClear: false,
      threads: 2,
    });
    expect(sentInfo(w)).toEqual([{ kind: "info", key: "thread_num", value: 2 }]);
    expect(store.getState().appliedThreads).toBe(2);
  });
});
