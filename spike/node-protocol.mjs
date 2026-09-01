/**
 * W0-1 (node): upstream 의 sendCommand 펌프로 piskvork 프로토콜 왕복.
 *
 *   node node-protocol.mjs <variant>
 *
 * 브라우저 확인은 browser-test.mjs 가 따로 한다 — 이건 CI 에서 훨씬 싸게 도는
 * 1차 관문이다.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { startEngine } from "./src/engine-core.js";
import { runSteps, END_COMMAND } from "./src/steps.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = resolve(process.env.ENGINE_DIR ?? resolve(HERE, "../out/engine"));
const variant = process.argv[2] ?? "single-simd128";

const js = resolve(ENGINE_DIR, `rapfi-${variant}.js`);
if (!existsSync(js)) {
  console.error(`없음: ${js}`);
  process.exit(2);
}

const lines = [];
const waiters = [];
let exitCode = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pushLine(line) {
  lines.push(line);
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].match(line)) waiters.splice(i, 1)[0].resolve(line);
  }
}

function waitFor(match, timeoutMs, label) {
  const seen = lines.find(match);
  if (seen) return Promise.resolve(seen);
  return new Promise((res, rej) => {
    const w = { match, resolve: res };
    waiters.push(w);
    setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i >= 0) {
        waiters.splice(i, 1);
        rej(new Error(`${label}: ${timeoutMs}ms 안에 응답 없음`));
      }
    }, timeoutMs);
  });
}

/** 이벤트 루프 지연. 멀티 변형은 PROXY_TO_PTHREAD 라 여기가 막히면 안 된다. */
function startLagMeter(periodMs = 10) {
  let last = performance.now();
  let max = 0;
  const t = setInterval(() => {
    const now = performance.now();
    max = Math.max(max, now - last - periodMs);
    last = now;
  }, periodMs);
  t.unref?.();
  return { stop: () => (clearInterval(t), max) };
}

const t0 = performance.now();
let Module;
let fatal = null;
try {
  // upstream 은 EXPORT_ES6 를 쓰지 않는다 — 산출물은 CommonJS/전역이다.
  const require = createRequire(import.meta.url);
  const factory = require(js);
  Module = await startEngine({
    factory,
    baseUrl: ENGINE_DIR + "/",
    onLine: pushLine,
    onExit: (c) => (exitCode = c),
  });
} catch (e) {
  fatal = String((e && e.stack) || e);
}

if (fatal) {
  console.log(JSON.stringify({ test: "W0-1 (node)", variant, pass: false, fatal }, null, 2));
  process.exit(1);
}

const bootMs = +(performance.now() - t0).toFixed(1);
const lag = startLagMeter();

// sendCommand 는 동기다(gomocupLoopOnce 를 그 자리에서 부른다). 각 단계 사이에
// 마이크로태스크를 한 번 돌려 waitFor 가 이미 도착한 줄을 볼 수 있게 한다.
const results = await runSteps({
  send: async (text) => {
    for (const line of text.split("\n")) {
      if (line.length) Module.sendCommand(line);
    }
    await sleep(0);
  },
  waitFor,
  sleep,
});

const maxLagMs = +lag.stop().toFixed(1);

// **결과를 먼저 찍고 그 다음에 END 를 보낸다.**
// 단일 스레드 빌드에서 END 는 그 자리에서 runProtocol() 을 돌려
// emscripten_force_exit(0) 까지 가고, Emscripten 은 다음 이벤트 루프 회전에서
// process.exit() 를 부른다. END 뒤에 await 이 하나라도 있으면 그 사이에 프로세스가
// 죽어 결과 JSON 이 한 줄도 나오지 않는다 — 세 런 동안 node-single 이 빈 파일이었다.
const passed = results.every((r) => r.ok);
console.log(
  JSON.stringify(
    {
      test: "W0-1 (node, upstream sendCommand 펌프)",
      variant,
      pass: passed,
      bootMs,
      maxEventLoopLagMs: maxLagMs,
      exitCode,
      steps: results,
      tail: lines.slice(-12),
    },
    null,
    2,
  ),
);

try {
  Module.sendCommand(END_COMMAND);
} catch (e) {
  // 멀티 빌드에서는 process.exit 대신 ExitStatus 를 던진다. 정상 종료다.
  if (!(e && (e.name === "ExitStatus" || typeof e.status === "number"))) throw e;
}
process.exit(passed ? 0 : 1);
