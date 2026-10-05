import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BootAbortedError,
  EngineClient,
  detectCapabilities,
  planOrder,
  preferenceBlocker,
  type EngineVariant,
} from "./engine-client";
import type { FromWorker, ToWorker } from "./engine-types";

/**
 * 엔진 선택(자동 · 멀티 · relaxed · 일반 SIMD)과 **기동 중 엔진 전환**.
 *
 * 전환은 떠 있는(또는 뜨는 중인) 엔진을 `terminate` 하고 새로 띄운다. 그때 옛 기동이
 * 살아남아 시간 초과 뒤 다음 변형을 **새로** 띄우면, 아무도 붙잡지 않은 워커가 하나 더
 * 생기고 그 사건이 새 엔진의 상태를 덮는다 — 그것이 여기서 막는 고장이다.
 */

const ALL: EngineVariant[] = [
  "multi-simd128-relaxed",
  "multi-simd128",
  "single-simd128-relaxed",
  "single-simd128",
];

describe("엔진 선택 → 시도할 변형 순서", () => {
  it("자동은 환경의 순서 그대로", () => {
    expect(planOrder(ALL, "auto")).toEqual({ order: ALL, note: null });
  });

  it("멀티는 멀티부터, 실패하면 단일로 물러설 자리를 남긴다", () => {
    expect(planOrder(ALL, "multi").order).toEqual(ALL);
    const noThreads = planOrder(["single-simd128-relaxed", "single-simd128"], "multi");
    expect(noThreads.order).toEqual(["single-simd128-relaxed", "single-simd128"]);
    expect(noThreads.note).toContain("멀티스레드를 쓸 수 없어");
  });

  it("relaxed 는 단일 relaxed 부터 — 못 쓰는 브라우저면 Standard 로 띄우고 까닭을 남긴다", () => {
    expect(planOrder(ALL, "relaxed")).toEqual({
      order: ["single-simd128-relaxed", "single-simd128"],
      note: null,
    });
    const plain = planOrder(["multi-simd128", "single-simd128"], "relaxed");
    expect(plain.order).toEqual(["single-simd128"]);
    expect(plain.note).toContain("Standard SIMD");
  });

  it("Standard SIMD 는 일반 단일 하나뿐 — 멀티·relaxed 를 섞지 않는다", () => {
    expect(planOrder(ALL, "simd")).toEqual({ order: ["single-simd128"], note: null });
  });

  it("못 고르는 항목은 까닭을 말한다", () => {
    vi.stubGlobal("crossOriginIsolated", false);
    const caps = detectCapabilities();
    expect(preferenceBlocker(caps, "auto")).toBeNull();
    expect(preferenceBlocker(caps, "simd")).toBeNull();
    expect(preferenceBlocker(caps, "multi")).toContain("COOP/COEP");
    const relaxedOk = caps.variants.includes("single-simd128-relaxed");
    expect(preferenceBlocker(caps, "relaxed") === null).toBe(relaxedOk);
  });
});

// ── 기동 중 전환 ────────────────────────────────────────────────────

const spawned: HangingWorker[] = [];
/** 참이면 기동 메시지에 영영 답하지 않는다(느린 회선에서 가중치를 받는 중). */
let hang = true;

class HangingWorker {
  boot: Extract<ToWorker, { type: "boot" }> | null = null;
  onmessage: ((ev: { data: FromWorker }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    spawned.push(this);
  }
  postMessage(m: ToWorker) {
    if (m.type !== "boot") return;
    this.boot = m;
    setTimeout(() => {
      this.onmessage?.({ data: { type: "phase", phase: "weights" } });
      if (hang) return;
      this.onmessage?.({ data: { type: "phase", phase: "warmup" } });
      this.onmessage?.({
        data: {
          type: "booted",
          version: m.variant,
          bootMs: 1,
          about: {},
          threaded: m.variant.startsWith("multi"),
          maxThreads: 256,
          weights: { source: "cache", ms: 1 },
          warmupMs: null,
        },
      });
    }, 5);
  }
  terminate() {
    this.terminated = true;
  }
}

afterEach(() => {
  spawned.length = 0;
  hang = true;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("엔진 전환 — 기동 중에 내려도 옛 기동이 살아남지 않는다", () => {
  it("Standard SIMD 를 고르면 일반 단일 변형 하나만 띄운다", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", HangingWorker);
    hang = false;
    const c = new EngineClient();
    await c.start("simd");
    expect(spawned.map((w) => w.boot?.variant)).toEqual(["single-simd128"]);
    expect(c.runningVariant).toBe("single-simd128");
  });

  it("기동 단계를 알린다(로딩 표시) — 변형과 함께", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    vi.stubGlobal("Worker", HangingWorker);
    hang = false;
    const phases: string[] = [];
    const c = new EngineClient({ onBootPhase: (p, v) => phases.push(`${p}:${v}`) });
    await c.start("simd");
    expect(phases).toEqual(["weights:single-simd128", "warmup:single-simd128"]);
  });

  it("기동 중 terminate — 곧바로 그만두고, 시간이 지나도 다음 변형을 띄우지 않는다", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", HangingWorker);
    const errors: string[] = [];
    const statuses: string[] = [];
    const c = new EngineClient({
      onError: (e) => errors.push(e),
      onStatus: (s) => statuses.push(s),
    });
    const booting = c.start("multi");
    const settled = booting.then(
      () => "resolved",
      (e: unknown) => (e instanceof BootAbortedError ? "aborted" : `rejected: ${String(e)}`),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(spawned).toHaveLength(1);

    c.terminate();
    await vi.advanceTimersByTimeAsync(0);
    expect(await settled).toBe("aborted");
    expect(spawned[0]!.terminated).toBe(true);

    // 옛 기동의 120초 한도가 지나도 아무것도 새로 뜨지 않는다.
    await vi.advanceTimersByTimeAsync(200_000);
    expect(spawned).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(statuses).not.toContain("error");
    expect(c.currentStatus).toBe("idle");
  });

  it("내린 뒤 같은 클라이언트로 다시 띄우면 새 기동이 정상으로 돈다", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    vi.stubGlobal("Worker", HangingWorker);
    const c = new EngineClient();
    const first = c.start("simd").catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 10));
    c.terminate();
    expect(await first).toBeInstanceOf(BootAbortedError);
    hang = false;
    await c.start("simd");
    expect(c.currentStatus).toBe("ready");
    expect(spawned).toHaveLength(2);
  });
});
