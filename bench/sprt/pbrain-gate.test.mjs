/**
 * 명령 관문(pbrain-gate.mjs) 시험 — 가짜 시계로 돈다.
 *   node --test bench/sprt/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PbrainGate } from "./pbrain-gate.mjs";

/** 가짜 시계 — setTimer/clearTimer 를 주입하고 advance(ms) 로 흘린다 */
function clock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

function setup(opts = {}) {
  const c = clock();
  const sent = [];
  const fatal = [];
  const gate = new PbrainGate({
    send: (cmd) => sent.push(cmd),
    onFatal: (r) => fatal.push(r),
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    ...opts,
  });
  const feed = (...lines) => lines.forEach((l) => gate.input(l));
  return { c, sent, fatal, gate, feed };
}

test("여러 줄 블록(BOARD … DONE)은 모아서 한 번에 넘긴다", () => {
  const { sent, feed } = setup();
  feed("INFO TIMEOUT_TURN 500", "BOARD", "7,7,1", "8,8,2");
  assert.deepEqual(sent, ["INFO TIMEOUT_TURN 500"]); // 블록은 아직
  feed("DONE");
  assert.deepEqual(sent, ["INFO TIMEOUT_TURN 500", "BOARD\n7,7,1\n8,8,2\nDONE"]);
});

test("탐색 중에는 줄 세우고, 좌표 뒤 정착 시간이 지나야 순서대로 넘긴다", () => {
  const { c, sent, gate, feed } = setup({ settleMs: 50 });
  feed("BOARD", "7,7,1", "DONE");
  assert.equal(gate.state, "searching");
  feed("RESTART", "INFO TIMEOUT_TURN 500");
  assert.equal(sent.length, 1, "탐색 중 명령이 새면 안 된다");
  gate.output("MESSAGE Depth 10");
  gate.output("6,8");
  assert.equal(gate.state, "settling");
  c.advance(49);
  assert.equal(sent.length, 1, "정착 시간 전에 넘기면 탐색 스레드가 입력을 가로챌 수 있다");
  c.advance(1);
  assert.deepEqual(sent.slice(1), ["RESTART", "INFO TIMEOUT_TURN 500"]);
  assert.equal(gate.state, "idle");
});

test("줄 선 명령 중 탐색이 있으면 거기서 다시 탐색 중 — 뒤의 명령은 다음 좌표까지 기다린다", () => {
  const { c, sent, gate, feed } = setup();
  feed("BOARD", "7,7,1", "DONE");
  feed("INFO TIME_LEFT 1000", "BOARD", "7,7,1", "8,8,2", "DONE", "INFO TIMEOUT_TURN 300");
  gate.output("6,8");
  c.advance(50);
  assert.deepEqual(sent.slice(1), ["INFO TIME_LEFT 1000", "BOARD\n7,7,1\n8,8,2\nDONE"]);
  assert.equal(gate.state, "searching");
  assert.deepEqual(gate.queue, ["INFO TIMEOUT_TURN 300"]);
  gate.output("9,9");
  c.advance(50);
  assert.equal(sent.at(-1), "INFO TIMEOUT_TURN 300");
});

test("탐색 중에도 정지(YXSTOP · STOP)와 END 는 곧바로 넘긴다", () => {
  const { sent, feed } = setup();
  feed("TURN 7,7");
  feed("YXSTOP");
  feed("STOP");
  feed("END");
  assert.deepEqual(sent, ["TURN 7,7", "YXSTOP", "STOP", "END"]);
});

test("탐색 명령 뒤 한 줄도 안 오면 정해진 시간에 onFatal — 매달리지 않는다", () => {
  const { c, fatal, feed } = setup({ firstLineMs: 5000 });
  feed("BOARD", "7,7,1", "DONE");
  c.advance(4999);
  assert.equal(fatal.length, 0);
  c.advance(1);
  assert.equal(fatal.length, 1);
  assert.match(fatal[0], /5000ms 동안 엔진 출력이 없음.*BOARD/);
});

test("출력이 오면 감시가 풀린다 — 긴 탐색(줄은 오는데 좌표가 늦음)은 죽이지 않는다", () => {
  const { c, fatal, gate, feed } = setup({ firstLineMs: 5000 });
  feed("BEGIN");
  c.advance(100);
  gate.output("MESSAGE Depth 1");
  c.advance(60_000);
  assert.equal(fatal.length, 0);
  assert.equal(gate.state, "searching");
});

test("탐색이 아닌 명령에서 오는 좌표 꼴 줄은 상태를 바꾸지 않는다", () => {
  const { sent, gate, feed } = setup();
  feed("INFO RULE 4");
  gate.output("7,7");
  feed("ABOUT");
  assert.deepEqual(sent, ["INFO RULE 4", "ABOUT"]);
  assert.equal(gate.state, "idle");
});

test("close 는 타이머를 모두 치우고 그 뒤 입력 · 출력을 무시한다", () => {
  const { c, sent, fatal, gate, feed } = setup();
  feed("BOARD", "7,7,1", "DONE", "RESTART");
  gate.output("6,8");
  gate.close();
  assert.equal(c.pending(), 0);
  c.advance(10_000);
  feed("ABOUT");
  assert.deepEqual(sent, ["BOARD\n7,7,1\nDONE"]);
  assert.equal(fatal.length, 0);
});

/**
 * 관문이 막으려는 사고의 모형 — 앱이 실측한 「좌표 뒤 탐색 스레드가 잠깐 입력을 더 읽는다」(engine-worker.ts SETTLE_MS):
 * 좌표 줄 뒤 `stealMs` 안에 들어온 명령은 탐색 스레드가 먹어 버려 엔진에 닿지 않는다.
 */
function stealingEngine(c, stealMs) {
  let movedAt = -Infinity;
  let now = 0;
  const got = [];
  return {
    tick: (ms) => {
      now += ms;
      c.advance(ms);
    },
    receive: (cmd) => {
      if (now - movedAt < stealMs) return; // 사라짐
      got.push(cmd);
    },
    move(gate) {
      movedAt = now;
      gate.output("6,8");
    },
    got,
  };
}

test("모형: 관문 없이(정착 0ms) 좌표 직후 보낸 명령은 사라지고, 정착 50ms 면 모두 닿는다", () => {
  for (const [settleMs, expectLost] of [
    [0, true],
    [50, false],
  ]) {
    const c = clock();
    const eng = stealingEngine(c, 5);
    const gate = new PbrainGate({
      send: (cmd) => eng.receive(cmd),
      onFatal: () => {},
      settleMs,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
    });
    for (let game = 0; game < 20; game++) {
      gate.input("BOARD");
      gate.input("7,7,1");
      gate.input("DONE");
      eng.tick(300);
      gate.input("RESTART"); // 러너는 좌표를 받자마자 다음 판을 준비한다 — 탐색 중이라 줄 선다
      eng.move(gate);
      eng.tick(settleMs);
    }
    const restarts = eng.got.filter((x) => x === "RESTART").length;
    if (expectLost)
      assert.ok(
        restarts < 20,
        `정착 0ms 인데 RESTART ${restarts}/20 — 모형이 사고를 재현하지 못함`,
      );
    else assert.equal(restarts, 20, `정착 50ms 에서 RESTART ${restarts}/20`);
  }
});
