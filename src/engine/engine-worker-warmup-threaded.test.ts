import { beforeAll, describe, expect, it } from "vitest";
import type { FromWorker, ToWorker } from "./engine-types";

/**
 * 멀티 변형의 예열 — 비동기 가짜 엔진. 예열도 탐색이라 멀티의 규칙을 그대로 지켜야 한다:
 *   - 좌표가 오기 전에는 다른 명령을 내지 않는다
 *   - 좌표 뒤 **정착 대기**(SETTLE_MS)를 지나서야 다음 명령(해시 비우기)
 *   - 예열 명령이 삼켜지면(입력 경합) 기동 실패 — 클라이언트가 다음 변형으로 물러선다
 */

type Handler = (ev: { data: ToWorker }) => void;
const g = globalThis as unknown as Record<string, unknown>;
const posted: FromWorker[] = [];
const sent: { head: string; busy: boolean; at: number }[] = [];
const fake = { running: false, swallow: false, coordAt: 0, out: (_l: string) => {} };

beforeAll(async () => {
  g.self = g;
  g.postMessage = (m: FromWorker) => posted.push(m);
  g.importScripts = () => undefined;
  g.Rapfi = async (opts: { onReceiveStdout: (line: string) => void }) => {
    fake.out = (l) => opts.onReceiveStdout(l);
    return {
      sendCommand(data: string) {
        const head = data.split("\n")[0]!;
        sent.push({ head, busy: fake.running, at: performance.now() });
        if (head.startsWith("START")) setTimeout(() => fake.out("OK"), 3);
        if (head === "ABOUT") setTimeout(() => fake.out('name="Rapfi", version="mt"'), 3);
        if (head.startsWith("YXNBEST")) {
          if (fake.swallow) return; // 입력 경합으로 사라진 탐색
          fake.running = true;
          setTimeout(() => fake.out("MESSAGE mix9svq nnue: load weight"), 5);
          setTimeout(() => {
            fake.out("INFO PV 0");
            fake.out("INFO DEPTH 7");
            fake.out("INFO PV DONE");
            fake.running = false;
            fake.coordAt = performance.now();
            fake.out("9,5");
          }, 60);
        }
      },
      terminate() {},
    };
  };
  await import("./engine-worker");
});

const send = (m: ToWorker) => (g.onmessage as Handler)({ data: m });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, timeoutMs = 8000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("기다리다 시간이 다 됐습니다");
    await sleep(5);
  }
}
const of = <T extends FromWorker["type"]>(type: T) =>
  posted.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);
const boot: ToWorker = {
  type: "boot",
  engineBaseUrl: "/engine/",
  variant: "multi-simd128-relaxed",
  sliceMs: 500,
  size: 15,
  handshakeMs: 2000,
  warmupMs: 120,
};

describe("멀티 변형의 예열", () => {
  it("좌표를 기다리고, 정착 대기 뒤에 해시를 비우고, 그다음에 「떴다」", async () => {
    send(boot);
    await until(() => of("booted").length > 0);
    const b = of("booted")[0]!;
    expect(b.threaded).toBe(true);
    expect(b.warmupMs).toBeGreaterThanOrEqual(60);
    expect(b.weights.source).toBe("glue"); // 공유 가중치 없이 띄웠다
    // 탐색 중에 나간 명령이 없다(YXSTOP 도 필요 없었다).
    expect(sent.filter((s) => s.busy)).toEqual([]);
    const clear = sent.find((s) => s.head === "YXHASHCLEAR")!;
    expect(clear.at - fake.coordAt).toBeGreaterThanOrEqual(45); // SETTLE_MS(50) — 타이머 오차 허용
    expect(of("snapshot")).toHaveLength(0);
  });

  it("예열 탐색이 삼켜지면(입력 경합) 기동 실패 — 다음 변형으로 물러설 신호", async () => {
    posted.length = 0;
    fake.swallow = true;
    send(boot);
    await until(() => of("fatal").length > 0);
    expect(of("fatal")[0]!.message).toContain("예열");
    expect(of("booted")).toHaveLength(0);
  }, 12_000);
});
