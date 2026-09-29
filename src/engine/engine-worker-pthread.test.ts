import { describe, expect, it } from "vitest";

/**
 * pthread 가드 — 엔진 스레드가 이 워커 번들을 `name: "em-pthread"` 로 **다시 열었을 때**
 * 글루만 읽고 비키는가.
 *
 * 가드가 없으면 호스트 코드가 onmessage 를 걸어 글루의 pthread 부트스트랩
 * (`isPthread && Rapfi()`)을 가로막는다 — W0 에서 워커 구성이 「기동은 되는데 영원히
 * 무응답」이던 원인(W0c 에서 확정).
 *
 * 워커 모듈은 불러오는 순간 가드를 판정하므로, 전역을 pthread 모양으로 꾸미고 읽는다
 * (시험 파일마다 모듈이 따로 뜬다).
 */
describe("pthread 가드", () => {
  it("em-pthread 로 열리면 멀티 글루만 importScripts 하고 onmessage 를 걸지 않는다", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const imported: string[] = [];
    g.self = g;
    g.name = "em-pthread";
    g.location = { href: "https://rapfi.example/assets/engine-worker-abc123.js" };
    g.importScripts = (url: string) => imported.push(url);
    g.onmessage = undefined;

    const mod = await import("./engine-worker");

    expect(mod.IS_PTHREAD).toBe(true);
    expect(imported).toEqual(["https://rapfi.example/engine/rapfi-multi-simd128.js"]);
    // 호스트의 메시지 처리기는 걸리지 않았다 — 글루가 제 것을 건다.
    expect(g.onmessage).toBeUndefined();
  });
});
