import { describe, expect, it } from "vitest";

/**
 * relaxed 멀티 번들의 pthread 가드 — 엔진 스레드가 **relaxed 진입점 번들**을 다시 열면
 * relaxed 글루를 읽어야 한다. 일반 글루를 읽으면 pthread 가 받는 wasm 모듈(relaxed)과
 * 글루의 임포트가 어긋나 스레드가 서지 않는다.
 *
 * 일반 번들은 `engine-worker-pthread.test.ts` 가 본다(시험 파일마다 모듈이 따로 뜬다).
 */
describe("pthread 가드 — relaxed 번들", () => {
  it("em-pthread 로 열리면 relaxed 멀티 글루만 읽고 비킨다", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const imported: string[] = [];
    g.self = g;
    g.name = "em-pthread";
    g.location = { href: "https://rapfi.example/assets/engine-worker-relaxed-abc123.js" };
    g.importScripts = (url: string) => imported.push(url);
    g.onmessage = undefined;

    await import("./engine-worker-relaxed");
    const mod = await import("./engine-worker");

    expect(mod.pthreadVariant()).toBe("multi-simd128-relaxed");
    expect(imported).toEqual(["https://rapfi.example/engine/rapfi-multi-simd128-relaxed.js"]);
    expect(g.onmessage).toBeUndefined();
  });
});
