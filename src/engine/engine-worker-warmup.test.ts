import { beforeAll, describe, expect, it } from "vitest";
import type { FromWorker, ToWorker, WeightsSpec } from "./engine-types";
import { sha256Hex } from "./weights-cache";

/**
 * 기동 단계 — **공유 가중치 선적재**와 **예열 탐색** (단일 변형, 동기 가짜 엔진).
 *
 * 가짜 엔진은 `YXNBEST` 에 수순 한 벌(INFO 줄)과 좌표로 답한다. 예열 중의 줄이 보드로
 * 새지 않는지(스냅샷·좌표), 가중치가 글루에 `getPreloadedPackage` 로 들어가는지, 해시가
 * 틀리면 기동이 실패하는지를 본다.
 */

type Handler = (ev: { data: ToWorker }) => void;
const g = globalThis as unknown as Record<string, unknown>;
const posted: FromWorker[] = [];
const sent: string[] = [];
const WEIGHTS = new TextEncoder().encode("RAPFI-DATA-PACKAGE").buffer as ArrayBuffer;
/** 글루가 받은 모듈 설정 — 기동마다 새로. */
let glueOpts: {
  locateFile?: (p: string) => string;
  getPreloadedPackage?: (name: string, size: number) => ArrayBuffer | null;
} = {};
let fetched = 0;

beforeAll(async () => {
  g.self = g;
  g.postMessage = (m: FromWorker) => posted.push(m);
  g.importScripts = () => undefined;
  g.fetch = async () => {
    fetched++;
    return new Response(WEIGHTS.slice(0));
  };
  g.Rapfi = async (opts: typeof glueOpts & { onReceiveStdout: (line: string) => void }) => {
    glueOpts = opts;
    return {
      sendCommand(data: string) {
        const head = data.split("\n")[0]!;
        sent.push(head);
        const out = opts.onReceiveStdout;
        if (head.startsWith("START")) out("OK");
        if (head === "ABOUT") out('name="Rapfi", version="test"');
        if (head.startsWith("YXNBEST")) {
          out("INFO PV 0");
          out("INFO DEPTH 9");
          out("INFO EVAL 123");
          out("INFO WINRATE 0.61");
          out("INFO BESTLINE 9,5 6,8");
          out("INFO PV DONE");
          out("9,5");
        }
      },
      terminate() {},
    };
  };
  await import("./engine-worker");
});

const send = (m: ToWorker) => (g.onmessage as Handler)({ data: m });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, timeoutMs = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("기다리다 시간이 다 됐습니다");
    await sleep(5);
  }
}
const of = <T extends FromWorker["type"]>(type: T) =>
  posted.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);

async function spec(sha?: string): Promise<WeightsSpec> {
  return {
    url: "https://x/engine/rapfi.data?v=abc",
    size: WEIGHTS.byteLength,
    sha256: sha ?? (await sha256Hex(WEIGHTS)),
  };
}

const boot = (weights: WeightsSpec, warmupMs: number): ToWorker => ({
  type: "boot",
  engineBaseUrl: "/engine/",
  variant: "single-simd128",
  sliceMs: 500,
  size: 15,
  weights,
  warmupMs,
  settings: [
    { kind: "info", key: "hash_size", value: 65536 },
    { kind: "info", key: "thread_num", value: 1 },
  ],
});

describe("기동 — 공유 가중치와 예열", () => {
  it("가중치 해시가 틀리면 기동하지 않는다(fatal — 클라이언트가 알린다)", async () => {
    send(boot(await spec("0".repeat(64)), 150));
    await until(() => of("fatal").length > 0);
    expect(of("fatal")[0]!.message).toContain("무결성");
    expect(of("booted")).toHaveLength(0);
  });

  it("맞는 가중치는 글루에 훅으로 들어가고, `.data` 요청은 공유 주소로 간다", async () => {
    const s = await spec();
    sent.length = 0;
    posted.length = 0;
    send(boot(s, 150));
    await until(() => of("booted").length > 0);
    const b = of("booted")[0]!;
    expect(b.weights.source).toBe("network"); // 노드에는 Cache Storage 가 없다
    // 글루가 그 버퍼를 받는다 — 한 번만 넘기고 워커는 참조를 놓는다.
    const buf = glueOpts.getPreloadedPackage!("rapfi-single-simd128.data", s.size);
    expect(buf && new TextDecoder().decode(buf)).toBe("RAPFI-DATA-PACKAGE");
    expect(glueOpts.getPreloadedPackage!("x", 0)).toBeNull();
    expect(glueOpts.locateFile!("rapfi-single-simd128.data")).toBe(s.url);
    expect(glueOpts.locateFile!("rapfi-single-simd128.wasm")).toBe(
      "/engine/rapfi-single-simd128.wasm",
    );
  });

  it("예열은 「떴다」보다 먼저 돌고, 해시를 비우고, 보드에는 아무것도 올리지 않는다", async () => {
    const b = of("booted")[0]!;
    expect(b.warmupMs).not.toBeNull();
    const start = sent.indexOf("START 15");
    const warm = sent.indexOf("YXNBEST 1");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(warm).toBeGreaterThan(start);
    expect(sent.slice(start)).toEqual(
      expect.arrayContaining(["INFO timeout_turn 150", "YXBOARD", "YXNBEST 1", "YXHASHCLEAR"]),
    );
    expect(sent.indexOf("YXHASHCLEAR")).toBeGreaterThan(warm);
    // 기동 설정은 START 뒤·예열 전에 한 번 — 예열이 확정된 스레드·해시에서 돈다.
    const hash = sent.indexOf("INFO hash_size 65536");
    const threads = sent.indexOf("INFO thread_num 1");
    expect(hash).toBeGreaterThan(start);
    expect(threads).toBeGreaterThan(start);
    expect(Math.max(hash, threads)).toBeLessThan(sent.indexOf("INFO timeout_turn 150"));
    expect(sent.filter((s) => s.startsWith("INFO thread_num"))).toHaveLength(1);
    // 예열의 수순·좌표는 스냅샷이나 착수로 새지 않는다.
    expect(of("snapshot")).toHaveLength(0);
    expect(of("bestMove")).toHaveLength(0);
    const lines = of("console").flatMap((c) => c.lines);
    expect(lines.join("\n")).toContain("예열 탐색");
    expect(lines.join("\n")).toContain("SHA-256 확인");
  });

  it("예열 뒤의 첫 분석은 평소처럼 집계된다", async () => {
    send({
      type: "search",
      mode: "analyze",
      setup: [{ kind: "yxboard", stones: [] }],
      repeat: [{ kind: "yxnbest", n: 1 }],
      totalMs: 300,
      id: 1,
    });
    await until(() => of("searchDone").some((m) => m.id === 1));
    const snap = of("snapshot").at(-1)!;
    expect(snap.id).toBe(1);
    expect(snap.snapshot.stats.depth).toBe(9);
    // 해시가 틀렸던 첫 기동은 HTTP 캐시를 건너뛰어 한 번 더 받았고(2), 맞는 기동이 1.
    // 노드에는 Cache Storage 가 없어 캐시 경로는 weights-cache.test.ts 가 본다.
    expect(fetched).toBe(3);
  });
});
