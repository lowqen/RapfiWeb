/**
 * W0-1 (node): SAB + Atomics.wait 블로킹 stdin 으로 piskvork 프로토콜 왕복.
 *
 *   node node-protocol.mjs <variant>
 *
 * 브라우저 없이 주 경로를 검증한다. node 의 worker_threads 는 SharedArrayBuffer 와
 * Atomics.wait 의미가 브라우저 워커와 같으므로, 여기서 깨지면 브라우저에서도 깨진다.
 * 브라우저 확인은 browser-test.mjs 가 따로 한다 — 이건 CI 에서 훨씬 싸게 도는 1차 관문.
 *
 * 검사하는 것:
 *   1. ABOUT      → 엔진 식별 줄이 온다            (양방향 통신 자체)
 *   2. START 15   → OK                             (핸드셰이크)
 *   3. INFO …     → 응답 없이 조용히 먹는다        (설정 주입)
 *   4. BOARD+DONE → 착수 한 줄                     (15×15 국면 전송)
 *   5. TURN       → 착수 한 줄                     (대화형 왕복)
 *   6. END        → 프로세스 종료                  (정상 종료 경로)
 * 그리고 내내 드라이버 스레드의 이벤트 루프 지연을 재서, 엔진이 생각하는 동안
 * "메인 스레드"가 멈추지 않는지 확인한다.
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { createStdinChannel, stdinWrite } from "./src/sab-stdin.js";
import { runSteps, END_COMMAND } from "./src/steps.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = resolve(process.env.ENGINE_DIR ?? resolve(HERE, "../out/engine"));
const BENCH_DIR = resolve(process.env.BENCH_DIR ?? resolve(HERE, "../out/bench"));
const variant = process.argv[2] ?? "single";

const js = resolve(ENGINE_DIR, `rapfi-${variant}.js`);
const wasm = resolve(ENGINE_DIR, `rapfi-${variant}.wasm`);
for (const p of [js, wasm, BENCH_DIR]) {
  if (!existsSync(p)) {
    console.error(`[${variant}] 없음: ${p}`);
    process.exit(2);
  }
}

const channel = createStdinChannel();
const lines = [];
const waiters = [];
let readyAt = null;
let exited = null;

const worker = new Worker(resolve(HERE, "src/worker-node.mjs"), {
  workerData: {
    factoryUrl: pathToFileURL(js).href,
    wasmUrl: wasm,
    benchDir: BENCH_DIR,
    channel,
  },
});

worker.on("message", (m) => {
  if (m.type === "line") {
    lines.push(m.line);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(m.line)) waiters.splice(i, 1)[0].resolve(m.line);
    }
  } else if (m.type === "ready") {
    readyAt = m.t;
  } else if (m.type === "exit") {
    exited = m;
  } else if (m.type === "error") {
    console.error(`[${variant}] 워커 오류:\n${m.message}`);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(match, timeoutMs, label) {
  // 이미 와 있는 줄에서 먼저 찾는다 — 엔진이 우리가 기다리기 전에 답할 수 있다.
  const seen = lines.find(match);
  if (seen) return Promise.resolve(seen);
  return new Promise((resolvePromise, reject) => {
    const w = { match, resolve: resolvePromise };
    waiters.push(w);
    setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i >= 0) {
        waiters.splice(i, 1);
        reject(new Error(`${label}: ${timeoutMs}ms 안에 응답 없음`));
      }
    }, timeoutMs);
  });
}

/** 드라이버 스레드의 이벤트 루프 지연. 블로킹이 워커에 갇혀 있는지의 증거다. */
function startLagMeter(periodMs = 10) {
  let last = performance.now();
  let max = 0;
  const t = setInterval(() => {
    const nowT = performance.now();
    max = Math.max(max, nowT - last - periodMs);
    last = nowT;
  }, periodMs);
  t.unref?.();
  return { stop: () => (clearInterval(t), max) };
}

const startedAt = performance.now();
for (let i = 0; readyAt === null && exited === null && i < 600; i++) await sleep(100);
if (readyAt === null) {
  console.error(`[${variant}] 60초 안에 모듈이 뜨지 않았습니다`);
  console.error(lines.slice(-30).join("\n"));
  process.exit(1);
}
const bootMs = +(performance.now() - startedAt).toFixed(1);
const lag = startLagMeter();

const results = await runSteps({
  send: (text) => stdinWrite(channel, text),
  waitFor,
  sleep,
});

const maxLagMs = +lag.stop().toFixed(1);
stdinWrite(channel, END_COMMAND + "\n");
for (let i = 0; exited === null && i < 100; i++) await sleep(100);

const passed = results.every((r) => r.ok) && exited !== null;
const report = {
  test: "W0-1 (node, SAB+Atomics.wait)",
  variant,
  pass: passed,
  bootMs,
  maxEventLoopLagMs: maxLagMs,
  stdinBlocks: exited?.blocks ?? null,
  exitCode: exited?.code ?? null,
  steps: results,
  tail: lines.slice(-12),
};
console.log(JSON.stringify(report, null, 2));
worker.terminate();
process.exit(passed ? 0 : 1);
