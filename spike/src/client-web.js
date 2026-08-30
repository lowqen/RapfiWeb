/**
 * 브라우저 쪽 W0-1 드라이버. harness.html 과 browser-test.mjs 가 같이 쓴다.
 * node-protocol.mjs 와 **같은 단계 목록**(steps.js)을 돌린다.
 */
import { runSteps, END_COMMAND } from "./steps.js";

/**
 * SIMD 프로브. 처음 쓴 바이트열은 함수 타입이 v128 을 **반환**한다고 선언해 놓고
 * 본문에서 drop 해 버려서, SIMD 를 지원하는 브라우저에서도 검증에 실패했다
 * (실제로 헤드리스 Chromium 이 `simd: false` 를 보고했는데 엔진은 그 자리에서
 * `WASM_SIMD` 로 잘 돌았다). 타입을 `() -> ()` 로 맞춘 것이 아래다:
 *   type   () -> ()
 *   code   i32.const 0 ; i8x16.splat ; drop ; end
 */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, // magic + version
  1, 4, 1, 96, 0, 0, // type section: 1 type, func () -> ()
  3, 2, 1, 0, // function section: 1 func, type 0
  10, 9, 1, 7, 0, 65, 0, 253, 15, 26, 11, // code: i32.const 0, i8x16.splat, drop, end
]);

export function detectCapabilities() {
  let simd = false;
  try {
    simd = WebAssembly.validate(SIMD_PROBE);
  } catch {
    simd = false;
  }
  const isolated = typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false;
  return {
    simd,
    crossOriginIsolated: isolated,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    // 사다리가 둘로 줄었다: SIMD 없는 변형은 이 엔진 커밋에서 빌드되지 않는다.
    // 그리고 단일 스레드 변형에는 COOP/COEP 가 필요 없다 — 헤더는 pthread 전용이다.
    pick: !simd ? null : isolated ? "multi-simd128" : "single-simd128",
    note: !simd ? "WASM SIMD 미지원 브라우저 — 이 엔진을 실행할 수 없습니다" : null,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 메인 스레드가 막히는지 재는 계기. 워커가 탐색하는 동안 여기는 멀쩡해야 한다. */
function startLagMeter(periodMs = 10) {
  let last = performance.now();
  let maxLag = 0;
  let frames = 0;
  const id = setInterval(() => {
    const t = performance.now();
    maxLag = Math.max(maxLag, t - last - periodMs);
    last = t;
  }, periodMs);
  let raf = requestAnimationFrame(function tick() {
    frames++;
    raf = requestAnimationFrame(tick);
  });
  const t0 = performance.now();
  return {
    stop() {
      clearInterval(id);
      cancelAnimationFrame(raf);
      const sec = (performance.now() - t0) / 1000;
      return { maxLagMs: +maxLag.toFixed(1), fps: +(frames / sec).toFixed(1) };
    },
  };
}

export async function runW0(variant, log = () => {}) {
  const caps = detectCapabilities();
  const lines = [];
  const waiters = [];
  let ready = false;
  let exited = null;
  let fatal = null;

  const worker = new Worker(new URL("./worker-web.js", import.meta.url)); // 클래식 워커
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "line") {
      lines.push(m.line);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].match(m.line)) waiters.splice(i, 1)[0].resolve(m.line);
      }
    } else if (m.type === "ready") ready = true;
    else if (m.type === "exit") exited = m;
    else if (m.type === "error") fatal = m.message;
  };

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

  const base = new URL("/out/engine/", location.href).href;
  log(`워커 기동 (${variant}) — 가중치는 rapfi-${variant}.data 에 구워져 있습니다`);
  const t0 = performance.now();
  worker.postMessage({
    type: "start",
    factoryUrl: base + `rapfi-${variant}.js`,
    baseUrl: base,
  });

  for (let i = 0; !ready && fatal === null && i < 1800; i++) await sleep(100);
  if (!ready) {
    worker.terminate();
    return {
      test: "W0-1 (browser)",
      variant,
      pass: false,
      caps,
      fatal: fatal ?? "180초 안에 모듈이 뜨지 않았습니다",
      tail: lines.slice(-20),
    };
  }
  const bootMs = +(performance.now() - t0).toFixed(1);
  log(`모듈 기동 ${bootMs}ms · 프로토콜 단계 시작`);

  const lag = startLagMeter();
  const steps = await runSteps({
    send: async (text) => {
      for (const line of text.split("\n")) {
        if (line.length) worker.postMessage({ type: "cmd", line });
      }
      await sleep(0);
    },
    waitFor,
    sleep,
  });
  const { maxLagMs, fps } = lag.stop();

  worker.postMessage({ type: "cmd", line: END_COMMAND });
  await sleep(500);
  worker.terminate();

  return {
    test: "W0-1 (browser, upstream sendCommand 펌프)",
    variant,
    pass: steps.every((s) => s.ok),
    caps,
    bootMs,
    maxEventLoopLagMs: maxLagMs,
    fpsDuringSearch: fps,
    exitCode: exited?.code ?? null,
    steps,
    tail: lines.slice(-12),
  };
}
