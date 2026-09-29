import { beforeAll, describe, expect, it } from "vitest";
import type { FromWorker, ToWorker } from "./engine-types";

/**
 * 워커의 **멀티 변형** 경로 — 진짜 워커 모듈을 **비동기** 가짜 엔진에 물린다.
 *
 * 멀티 변형에서 엔진은 제 pthread 에서 돌고 `sendCommand` 는 즉시 돌아온다. 답은
 * 나중에(엔진 스레드 → 워커) 온다. 가짜도 그렇게 군다: 모든 답을 타이머 뒤에 내고,
 * 탐색은 예산이 다 되거나 `YXSTOP` 이 오면 좌표 한 줄로 끝낸다.
 *
 * 확인하는 것(동시성 무결성):
 *   - 기동 핸드셰이크(START → OK) — 답이 없으면 `fatal`(클라이언트가 단일로 물러선다)
 *   - 탐색이 도는 동안 `YXSTOP` 말고는 **아무 명령도 나가지 않는다**
 *   - 정지·새 요청은 `YXSTOP` → 좌표를 기다린 뒤에야 다음 명령
 *   - 무제한 분석이 스스로 끝나면 되묻지 않고 정지까지 그대로 둔다
 *   - 시간제 착수는 비동기 좌표를 대국으로 올린다
 */

type Handler = (ev: { data: ToWorker }) => void;
const g = globalThis as unknown as Record<string, unknown>;
const posted: FromWorker[] = [];
/** 엔진이 받은 명령(머리 줄)과, 그때 엔진이 탐색 중이었는가. */
const sent: { head: string; busy: boolean; at: number }[] = [];
/** 가짜 엔진이 좌표 줄을 낸 시각들. */
const coordAt: number[] = [];

/** 가짜 엔진의 손잡이 — 시험마다 성질을 바꾼다. */
const fake = {
  /** START 에 답하지 않는다(멀티가 뜨지 못한 모양). */
  silent: false,
  /** 탐색이 스스로 끝나기까지(ms). 예산(timeout_turn)이 더 짧으면 그쪽. */
  searchMs: 10_000,
  running: false,
  turn: 1_000_000,
  out: (_l: string) => {},
  /** 다음 탐색 명령을 **삼킨다**(입력 경합으로 사라진 모양). */
  swallowNext: false,
  timer: null as ReturnType<typeof setTimeout> | null,
  tick: null as ReturnType<typeof setInterval> | null,
};

const later = (f: () => void, ms = 3) => setTimeout(f, ms);

function finishSearch() {
  if (!fake.running) return;
  fake.running = false;
  if (fake.timer) clearTimeout(fake.timer);
  if (fake.tick) clearInterval(fake.tick);
  later(() => {
    fake.out("MESSAGE Speed 1000 | Depth 5-5 | Eval 0 | Node 1000 | Time 10ms");
    fake.out("7,8");
    coordAt.push(performance.now());
  });
}

function startSearch() {
  fake.running = true;
  let nodes = 0;
  fake.tick = setInterval(() => {
    nodes += 100;
    fake.out(`INFO TOTALNODES ${nodes}`);
  }, 20);
  fake.timer = setTimeout(finishSearch, Math.min(fake.searchMs, fake.turn));
}

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
        if (head.startsWith("START") && !fake.silent) later(() => fake.out("OK"));
        if (head === "ABOUT") later(() => fake.out('name="Rapfi", version="mt-test"'));
        if (head === "yxshowinfo") later(() => fake.out("MESSAGE INFO MAX_THREAD_NUM 256"));
        const t = /^INFO timeout_turn (\d+)/.exec(head);
        if (t) fake.turn = Number(t[1]);
        if (head.startsWith("YXNBEST") || head === "BEGIN" || head === "BOARD") {
          if (fake.swallowNext) fake.swallowNext = false;
          else startSearch();
        }
        if (head === "YXSTOP") finishSearch();
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
const done = (id: number) => of("searchDone").find((m) => m.id === id);
const boot = (handshakeMs = 2_000): ToWorker => ({
  type: "boot",
  engineBaseUrl: "/engine/",
  variant: "multi-simd128",
  sliceMs: 500,
  size: 15,
  handshakeMs,
});
const analyze = (id: number, totalMs = Infinity): ToWorker => ({
  type: "search",
  mode: "analyze",
  setup: [{ kind: "yxboard", stones: [] }],
  repeat: [{ kind: "yxnbest", n: 5 }],
  totalMs,
  id,
});
/** 이 시점 이후 탐색 중에 나간 명령 중 YXSTOP 이 아닌 것. */
const busyViolations = (from: number) =>
  sent.slice(from).filter((s) => s.busy && s.head !== "YXSTOP");

describe("엔진 워커 — 멀티 변형", () => {
  it("핸드셰이크(START → OK)가 없으면 fatal — 클라이언트가 단일로 물러설 신호", async () => {
    fake.silent = true;
    send(boot(150));
    await until(() => of("fatal").length > 0);
    expect(of("fatal")[0]!.message).toContain("핸드셰이크");
    expect(of("booted")).toHaveLength(0);
    fake.silent = false;
  });

  it("기동하면 threaded 와 엔진이 알린 상한을 올린다", async () => {
    send(boot());
    await until(() => of("booted").length > 0);
    expect(of("booted")[0]).toMatchObject({ threaded: true, maxThreads: 256 });
  });

  it("무제한 분석은 조각 없이 한 번 걸고, 정지하면 YXSTOP → 좌표 뒤에 끝난다", async () => {
    const from = sent.length;
    send(analyze(1));
    await sleep(300);
    expect(done(1)).toBeUndefined();
    const heads = sent.slice(from).map((s) => s.head);
    // 조각이 아니라 한 번: 사실상 끝나지 않는 예산 하나와 탐색 명령 하나.
    expect(heads.filter((h) => h.startsWith("YXNBEST"))).toHaveLength(1);
    expect(heads).toContain("INFO timeout_turn 1000000000");

    const t0 = Date.now();
    send({ type: "stop" });
    await until(() => done(1) !== undefined);
    expect(Date.now() - t0).toBeLessThan(200); // 조각 경계(500ms)를 기다리지 않는다
    expect(done(1)!.reason).toBe("stopped");
    expect(busyViolations(from)).toEqual([]);
  });

  it("새 요청은 도는 탐색을 YXSTOP 으로 세우고, 좌표가 온 뒤에야 제 명령을 낸다", async () => {
    const from = sent.length;
    send(analyze(2));
    await sleep(100);
    send(analyze(3)); // 국면이 바뀐 분석
    await until(() => done(2) !== undefined);
    expect(done(2)!.reason).toBe("stopped");
    await sleep(100);
    expect(done(3)).toBeUndefined(); // 3 은 돌고 있다
    // **탐색 중에 나간 명령은 YXSTOP 뿐** — 3 의 YXBOARD·YXNBEST 는 2 의 좌표 뒤다.
    expect(busyViolations(from)).toEqual([]);
    send({ type: "stop" });
    await until(() => done(3) !== undefined);
    expect(busyViolations(from)).toEqual([]);
  });

  it("무제한 분석이 스스로 끝나도(증명·즉답) 되묻지 않고 정지까지 둔다", async () => {
    fake.searchMs = 20;
    const from = sent.length;
    send(analyze(4));
    await sleep(400);
    expect(done(4)).toBeUndefined(); // 끝나지 않는다 — 분석의 끝은 사용자가 정한다
    expect(sent.slice(from).filter((s) => s.head.startsWith("YXNBEST"))).toHaveLength(1);
    send({ type: "stop" });
    await until(() => done(4) !== undefined);
    expect(done(4)!.reason).toBe("stopped");
    fake.searchMs = 10_000;
  });

  it("유한 분석은 예산으로 끝나고 timeout 이다", async () => {
    send(analyze(5, 150));
    await until(() => done(5) !== undefined);
    expect(done(5)!.reason).toBe("timeout");
  });

  it("시간제 착수는 비동기로 오는 좌표를 대국에 올린다", async () => {
    const before = of("bestMove").length;
    send({ type: "move", commands: [{ kind: "begin" }], turnMs: 120, matchMs: 0, id: 6 });
    await until(() => done(6) !== undefined);
    expect(done(6)!.reason).toBe("finished");
    expect(of("bestMove").length).toBe(before + 1);
  });

  it("시간제 착수 중 정지(지금 두기·무르기)는 YXSTOP 으로 곧 끝낸다", async () => {
    const from = sent.length;
    const before = of("bestMove").length;
    send({ type: "move", commands: [{ kind: "begin" }], turnMs: 60_000, matchMs: 0, id: 7 });
    await sleep(80);
    send({ type: "stop" });
    await until(() => done(7) !== undefined, 1000);
    expect(of("bestMove").length).toBe(before + 1);
    expect(sent.slice(from).map((s) => s.head)).toContain("YXSTOP");
  });

  it("탐색이 없을 때 온 설정 명령은 곧바로 엔진에 닿는다(스레드 수 변경 자리)", async () => {
    const from = sent.length;
    send({ type: "send", commands: [{ kind: "info", key: "thread_num", value: 3 }] });
    await until(() => sent.slice(from).some((s) => s.head === "INFO thread_num 3"));
    expect(sent.slice(from).find((s) => s.head === "INFO thread_num 3")!.busy).toBe(false);
  });

  it("탐색 중에 온 스레드 수 변경은 탐색이 **끝난 뒤**에 닿는다", async () => {
    const from = sent.length;
    send(analyze(8));
    await sleep(80);
    send({ type: "send", commands: [{ kind: "info", key: "thread_num", value: 2 }] });
    await until(() => sent.slice(from).some((s) => s.head === "INFO thread_num 2"));
    // 도는 분석은 그 명령에 자리를 내주며 멈췄고, 명령은 엔진이 놀 때 나갔다.
    expect(done(8)!.reason).toBe("stopped");
    expect(busyViolations(from)).toEqual([]);
  });
});

describe("엔진 워커 — 멀티 변형의 입력 경합 방지", () => {
  it("좌표 뒤 50ms 가 지나기 전에는 다음 명령을 내지 않는다(정착 대기)", async () => {
    send(analyze(20));
    await sleep(60);
    send(analyze(21)); // 국면이 바뀌어 곧바로 다음 분석 — 사고가 나던 자리
    await until(() => done(20) !== undefined);
    const coord = coordAt.at(-1)!;
    await until(() => sent.some((s) => s.at > coord));
    const next = sent.find((s) => s.at > coord)!;
    // 실측: 좌표 직후 곧바로 보내면 탐색 스레드와 입력을 나눠 먹어 엔진이 죽었다.
    expect(next.at - coord).toBeGreaterThanOrEqual(45);
    send({ type: "stop" });
    await until(() => done(21) !== undefined);
  });

  it("탐색 명령이 삼켜져 한 줄도 오지 않으면 fatal — 클라이언트가 단일로 다시 띄운다", async () => {
    const fatals = of("fatal").length;
    fake.swallowNext = true;
    send(analyze(22));
    await until(() => of("fatal").length > fatals, 8_000);
    expect(of("fatal").at(-1)!.message).toContain("입력 경합");
  }, 10_000);
});
