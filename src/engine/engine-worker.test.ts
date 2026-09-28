import { beforeAll, describe, expect, it } from "vitest";
import type { FromWorker, ToWorker } from "./engine-types";

/**
 * 워커의 탐색 루프 — **진짜 워커 모듈**을 가짜 엔진에 물려 돌린다.
 *
 * 가짜 엔진은 `YXNBEST` 에 **즉답**한다(`7,8` 한 줄). Rapfi 가 뻔한 국면에서
 * 탐색 없이 좌표를 돌려주는 것(tryTrivialBestmove)과 같은 모양이고, 무제한 분석이
 * 저절로 멈추던 버그의 방아쇠가 정확히 이것이었다: 루프가 즉답을 「끝」으로 읽고
 * YXSTOP 을 보냈다.
 *
 * 워커는 `self.onmessage` 를 모듈 최상위에서 건다. 그래서 전역을 먼저 꾸미고
 * 모듈을 나중에 읽는다.
 */

type Handler = (ev: { data: ToWorker }) => void;
const g = globalThis as unknown as Record<string, unknown>;
const posted: FromWorker[] = [];
const sent: string[] = [];

beforeAll(async () => {
  g.self = g;
  g.postMessage = (m: FromWorker) => posted.push(m);
  g.importScripts = () => undefined;
  g.Rapfi = async (opts: { onReceiveStdout: (line: string) => void }) => ({
    sendCommand(data: string) {
      const head = data.split("\n")[0]!;
      sent.push(head);
      // 단일 스레드 빌드처럼 **호출 안에서** 답한다.
      if (head.startsWith("YXNBEST")) opts.onReceiveStdout("7,8");
      if (head === "ABOUT") opts.onReceiveStdout('name="Rapfi", version="test"');
    },
    terminate() {},
  });
  await import("./engine-worker");
  send({ type: "boot", engineBaseUrl: "/engine/", variant: "test", sliceMs: 500, size: 15 });
  await until(() => posted.some((m) => m.type === "booted"));
});

const send = (m: ToWorker) => (g.onmessage as Handler)({ data: m });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, timeoutMs = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("기다리다 시간이 다 됐습니다");
    await sleep(10);
  }
}

const done = (id: number) =>
  posted.find(
    (m): m is Extract<FromWorker, { type: "searchDone" }> => m.type === "searchDone" && m.id === id,
  );

const analyze = (id: number): ToWorker => ({
  type: "search",
  mode: "analyze",
  setup: [{ kind: "yxboard", stones: [] }],
  repeat: [{ kind: "yxnbest", n: 5 }],
  totalMs: Infinity,
  id,
});

describe("엔진 워커 — 무제한 분석", () => {
  it("즉답(좌표 한 줄)이 와도 분석을 끝내지 않고, 정지가 오면 곧 멈춘다", async () => {
    const before = sent.filter((l) => l.startsWith("YXNBEST")).length;
    send(analyze(1));
    await sleep(700);
    // 예전엔 첫 즉답에서 searchDone(finished) + YXSTOP 이었다.
    expect(done(1)).toBeUndefined();
    // 쉬어 가며(100 → 200 → 400ms) 되묻는다 — 헛돌지도, 멈추지도 않는다.
    const slices = sent.filter((l) => l.startsWith("YXNBEST")).length - before;
    expect(slices).toBeGreaterThanOrEqual(2);
    expect(slices).toBeLessThan(10);

    const t0 = Date.now();
    send({ type: "stop" });
    await until(() => done(1) !== undefined);
    // 쉬는 중이어도 정지가 깨운다 — 쉼(최대 1초)이 끝나기를 기다리지 않는다.
    expect(Date.now() - t0).toBeLessThan(300);
    expect(done(1)?.reason).toBe("stopped");
    expect(sent.at(-1)).toBe("YXSTOP");
  });

  it("착수는 예전처럼 즉답을 곧바로 둔다", async () => {
    send({
      type: "search",
      mode: "move",
      setup: [{ kind: "yxboard", stones: [] }],
      repeat: [{ kind: "yxnbest", n: 1 }],
      totalMs: Infinity,
      id: 2,
    });
    await until(() => done(2) !== undefined);
    expect(done(2)?.reason).toBe("finished");
    expect(posted.some((m) => m.type === "bestMove")).toBe(true);
  });

  it("줄에 선 분석은 뒤에 선 착수에 자리를 내준다", async () => {
    send(analyze(3));
    await sleep(150);
    // 분석 둘이 연달아 오고 그 뒤에 착수가 선다 — 가운데 분석이 시작하며 정지
    // 표시를 지우면 착수가 영원히 기다렸다.
    send(analyze(4));
    send({
      type: "move",
      commands: [{ kind: "begin" }],
      turnMs: 1000,
      matchMs: 0,
      id: 5,
    });
    await until(() => done(5) !== undefined);
    expect(done(3)?.reason).toBe("stopped");
    expect(done(4)?.reason).toBe("stopped");
    expect(done(5)?.reason).toBe("finished");
  });

  it("줄에서 기다리는 동안 온 정지는 사라지지 않는다", async () => {
    send(analyze(6));
    await sleep(150);
    send(analyze(7)); // 6 이 비킬 때까지 기다린다
    send({ type: "stop" }); // 7 이 시작하기 전에 온 정지
    await until(() => done(7) !== undefined);
    expect(done(6)?.reason).toBe("stopped");
    expect(done(7)?.reason).toBe("stopped");
    // 7 은 한 조각도 돌지 않았다 — 끝난 뒤 더 늘지 않는다.
    const n = sent.length;
    await sleep(300);
    expect(sent.length).toBe(n);
  });
});
