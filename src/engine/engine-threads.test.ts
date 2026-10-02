import { afterEach, describe, expect, it, vi } from "vitest";
import { detectCapabilities } from "./engine-client";
import { bootCommands, threadCap, threadCommand } from "./engine-state";
import { firstOf } from "./testing/relaxed-runtime";

/**
 * 멀티/단일 변형 선택과 스레드 명령 — 브라우저 없이 전역만 바꿔 본다.
 * (노드 20+ 는 WebAssembly SIMD 를 검증하므로 SIMD 는 참으로 나온다. relaxed SIMD 는 런타임마다
 * 다르므로 — 노드 20 거짓, 노드 22+ 참 — 기대 변형은 런타임의 답에서 만든다.)
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("변형 자동 선택", () => {
  it("격리 + SharedArrayBuffer 면 멀티를 먼저 고른다", () => {
    vi.stubGlobal("crossOriginIsolated", true);
    const c = detectCapabilities();
    expect(c.simd).toBe(true);
    expect(c.variant).toBe(firstOf("multi-simd128"));
    expect(c.threads).toBe(true);
    expect(c.threadsNote).toBeNull();
  });

  it("격리가 없으면(COOP/COEP 헤더 없음) 단일로, 까닭을 말한다", () => {
    vi.stubGlobal("crossOriginIsolated", false);
    const c = detectCapabilities();
    expect(c.variant).toBe(firstOf("single-simd128"));
    expect(c.threads).toBe(false);
    expect(c.threadsNote).toContain("COOP/COEP");
  });

  it("SharedArrayBuffer 가 없으면 격리돼 있어도 단일", () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("SharedArrayBuffer", undefined);
    const c = detectCapabilities();
    expect(c.variant).toBe(firstOf("single-simd128"));
    expect(c.threadsNote).toContain("SharedArrayBuffer");
  });

  it("?engine=single 로 단일을 강제한다", () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("location", { search: "?engine=single" });
    expect(detectCapabilities().variant).toBe(firstOf("single-simd128"));
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

describe("기동 설정(예열 전에 보낼 것)", () => {
  const config = {
    info: [{ kind: "info" as const, key: "hash_size", value: 262144 }],
    hashAutoClear: false,
    threads: 6,
  };

  it("INFO 목록 뒤에 이 변형의 thread_num — 멀티는 코어 수 안에서", () => {
    expect(bootCommands(config, true, 4)).toEqual([
      { kind: "info", key: "hash_size", value: 262144 },
      { kind: "info", key: "thread_num", value: 4 },
    ]);
    expect(bootCommands(config, true, 8).at(-1)).toEqual({
      kind: "info",
      key: "thread_num",
      value: 6,
    });
  });

  it("단일 변형이면 thread_num 1 — 폴백한 엔진에 멀티 값을 보내지 않는다", () => {
    expect(bootCommands(config, false, 8).at(-1)).toEqual({
      kind: "info",
      key: "thread_num",
      value: 1,
    });
  });
});
