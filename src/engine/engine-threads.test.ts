import { afterEach, describe, expect, it, vi } from "vitest";
import { detectCapabilities } from "./engine-client";
import { threadCap, threadCommand } from "./engine-state";

/**
 * 멀티/단일 변형 선택과 스레드 명령 — 브라우저 없이 전역만 바꿔 본다.
 * (node 20 은 WebAssembly SIMD 를 검증하므로 SIMD 는 참으로 나온다.)
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("변형 자동 선택", () => {
  it("격리 + SharedArrayBuffer 면 멀티를 먼저 고른다", () => {
    vi.stubGlobal("crossOriginIsolated", true);
    const c = detectCapabilities();
    expect(c.simd).toBe(true);
    expect(c.variant).toBe("multi-simd128");
    expect(c.threads).toBe(true);
    expect(c.threadsNote).toBeNull();
  });

  it("격리가 없으면(COOP/COEP 헤더 없음) 단일로, 까닭을 말한다", () => {
    vi.stubGlobal("crossOriginIsolated", false);
    const c = detectCapabilities();
    expect(c.variant).toBe("single-simd128");
    expect(c.threads).toBe(false);
    expect(c.threadsNote).toContain("COOP/COEP");
  });

  it("SharedArrayBuffer 가 없으면 격리돼 있어도 단일", () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("SharedArrayBuffer", undefined);
    const c = detectCapabilities();
    expect(c.variant).toBe("single-simd128");
    expect(c.threadsNote).toContain("SharedArrayBuffer");
  });

  it("?engine=single 로 단일을 강제한다", () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("location", { search: "?engine=single" });
    expect(detectCapabilities().variant).toBe("single-simd128");
  });

  it("SIMD 가 없으면 아무것도 못 돌린다", () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("WebAssembly", { validate: () => false });
    const c = detectCapabilities();
    expect(c.variant).toBeNull();
    expect(c.note).toContain("SIMD");
  });
});

describe("스레드 수 명령", () => {
  it("멀티 변형이면 요청한 수를 상한 안에서 INFO thread_num 으로", () => {
    expect(threadCommand(true, 3, 8)).toEqual({
      command: { kind: "info", key: "thread_num", value: 3 },
      threads: 3,
    });
    expect(threadCommand(true, 12, 8).threads).toBe(8);
    expect(threadCommand(true, 0, 8).threads).toBe(1);
  });

  it("단일 변형이면 무엇을 청하든 1 — 그 빌드는 다른 값을 받고 무시한다", () => {
    expect(threadCommand(false, 6, 8)).toEqual({
      command: { kind: "info", key: "thread_num", value: 1 },
      threads: 1,
    });
  });

  it("상한은 코어 수·엔진 상한·16 중 가장 작은 값, 코어를 모르면 4", () => {
    expect(threadCap(8, 256)).toBe(8);
    expect(threadCap(64, 256)).toBe(16);
    expect(threadCap(8, 4)).toBe(4);
    expect(threadCap(null, null)).toBe(4);
    expect(threadCap(1, 256)).toBe(1);
  });
});
