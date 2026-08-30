/**
 * 브라우저 쪽 W0-1 드라이버. harness.html 과 browser-test.mjs 가 같이 쓴다.
 *
 * node-protocol.mjs 와 **같은 단계 목록**(steps.js)을 돌린다. 두 곳에서 다른 것을
 * 검사하면 "node 는 되는데 브라우저는 안 된다"가 전송 계층 탓인지 검사 항목 탓인지
 * 알 수 없게 된다.
 */
import { createStdinChannel, stdinWrite, sabAvailable } from "./sab-stdin.js";
import { runSteps, END_COMMAND } from "./steps.js";

/** wasm-feature-detect 의 SIMD 프로브(의존성 없이 그대로). */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
  15, 26, 11,
]);

export function detectCapabilities() {
  let simd = false;
  try {
    simd = WebAssembly.validate(SIMD_PROBE);
  } catch {
    simd = false;
  }
  const threads = sabAvailable();
  return {
    simd,
    threads,
    crossOriginIsolated: typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    // 계획서 §3 의 하향 사다리.
    pick: threads && simd ? "multi-simd128" : threads ? "multi" : simd ? "single-simd128" : "single",
  };
}

async function fetchBenchFiles(onProgress) {
  const names = await (await fetch("/bench-manifest.json")).json();
  const files = [];
  for (const name of names) {
    const res = await fetch(`/out/bench/${name}`);
    if (!res.ok) throw new Error(`가중치를 받지 못했습니다: ${name} (${res.status})`);
    files.push({ name, bytes: new Uint8Array(await res.arrayBuffer()) });
    onProgress?.(name, files.length, names.length);
  }
  return files;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 메인 스레드가 막히는지 재는 계기.
 *
 * 워커가 `Atomics.wait` 로 자는 동안 UI 스레드는 아무 영향이 없어야 한다. 그게
 * 이 설계의 존재 이유이므로, 말로 하지 않고 숫자로 남긴다.
 */
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

/**
 * 한 변형에 대해 W0-1 을 돌린다.
 * @param {string} variant  single | single-simd128 | multi | multi-simd128
 * @param {(s: string) => void} [log]
 */
export async function runW0(variant, log = () => {}) {
  const caps = detectCapabilities();
  if (!caps.threads) {
    return {
      test: "W0-1 (browser, SAB+Atomics.wait)",
      variant,
      pass: false,
      caps,
      fatal: "SharedArrayBuffer 를 쓸 수 없습니다 — COOP/COEP 헤더를 확인하세요",
    };
  }

  const lines = [];
  const waiters = [];
  let readyAt = null;
  let exited = null;
  let fatal = null;

  log(`가중치를 받는 중…`);
  const files = await fetchBenchFiles((n, i, total) => log(`  ${i}/${total} ${n}`));
  const totalBytes = files.reduce((a, f) => a + f.bytes.length, 0);
  log(`가중치 ${(totalBytes / 1048576).toFixed(1)}MB · 워커를 띄웁니다 (${variant})`);

  const channel = createStdinChannel();
  const worker = new Worker(new URL("./worker-web.js", import.meta.url), { type: "module" });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "line") {
      lines.push(m.line);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].match(m.line)) waiters.splice(i, 1)[0].resolve(m.line);
      }
    } else if (m.type === "ready") readyAt = m.t;
    else if (m.type === "exit") exited = m;
    else if (m.type === "error") fatal = m.message;
  };

  const t0 = performance.now();
  worker.postMessage(
    {
      factoryUrl: new URL(`/out/engine/rapfi-${variant}.js`, location.href).href,
      wasmUrl: new URL(`/out/engine/rapfi-${variant}.wasm`, location.href).href,
      files,
      channel,
    },
    files.map((f) => f.bytes.buffer),
  );

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

  for (let i = 0; readyAt === null && fatal === null && i < 900; i++) await sleep(100);
  if (readyAt === null) {
    worker.terminate();
    return {
      test: "W0-1 (browser, SAB+Atomics.wait)",
      variant,
      pass: false,
      caps,
      fatal: fatal ?? "90초 안에 모듈이 뜨지 않았습니다",
      tail: lines.slice(-20),
    };
  }
  const bootMs = +(performance.now() - t0).toFixed(1);
  log(`모듈 기동 ${bootMs}ms · 프로토콜 단계 시작`);

  const lag = startLagMeter();
  const steps = await runSteps({ send: (text) => stdinWrite(channel, text), waitFor, sleep });
  const { maxLagMs, fps } = lag.stop();

  stdinWrite(channel, END_COMMAND + "\n");
  for (let i = 0; exited === null && i < 100; i++) await sleep(100);
  worker.terminate();

  return {
    test: "W0-1 (browser, SAB+Atomics.wait)",
    variant,
    pass: steps.every((s) => s.ok) && exited !== null,
    caps,
    bootMs,
    weightsMB: +(totalBytes / 1048576).toFixed(1),
    // 이 둘이 "메인 스레드가 안 막혔다"의 증거다.
    maxEventLoopLagMs: maxLagMs,
    fpsDuringSearch: fps,
    stdinBlocks: exited?.blocks ?? null,
    exitCode: exited?.code ?? null,
    steps,
    tail: lines.slice(-12),
  };
}
