/**
 * 링버퍼 자체의 단위 시험 — 엔진도 WASM 도 없이.
 *
 * W0-1 이 실패했을 때 "우리 채널이 틀렸나, 엔진 쪽인가"를 가르기 위한 것이다.
 * 그 구분이 없으면 40분짜리 빌드를 붙들고 추측하게 된다.
 *
 * 확인하는 것:
 *   - 바이트가 순서대로, 빠짐없이, 겹치지 않고 건너간다 (링 wrap-around 포함)
 *   - 소비자가 실제로 블로킹한다 (blocks > 0) — 바쁜 대기가 아니다
 *   - close() 뒤에는 남은 것을 다 준 다음 EOF(null) 를 준다
 *   - 생산자(메인 스레드)는 그동안 멈추지 않는다
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createStdinChannel, stdinWrite, stdinClose } from "./src/sab-stdin.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// 버퍼(4KB)보다 훨씬 큰 양을 흘려보내 wrap-around 와 블로킹을 모두 강제한다.
const CAPACITY = 4096;
const CHUNKS = 40;
const CHUNK = "0123456789abcdefghijklmnopqrstuvwxyz".repeat(20) + "\n"; // 721B
const expected = CHUNK.repeat(CHUNKS);

const channel = createStdinChannel(CAPACITY);
const worker = new Worker(resolve(HERE, "sab-consumer.mjs"), { workerData: { channel } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let maxLag = 0;
let last = performance.now();
const lagTimer = setInterval(() => {
  const t = performance.now();
  maxLag = Math.max(maxLag, t - last - 5);
  last = t;
}, 5);

const t0 = performance.now();
for (let i = 0; i < CHUNKS; i++) {
  await stdinWrite(channel, CHUNK);
  // 소비자가 따라잡아 비어 있는 상태를 만들도록 일부러 쉰다 — 그래야
  // Atomics.wait 가 실제로 걸린다.
  if (i % 4 === 3) await sleep(12);
}
stdinClose(channel);

const result = await new Promise((res, rej) => {
  worker.on("message", res);
  worker.on("error", rej);
  setTimeout(() => rej(new Error("소비자가 15초 안에 끝내지 못했습니다")), 15000);
});
clearInterval(lagTimer);
await worker.terminate();

const ok =
  result.text === expected && result.blocks > 0 && result.sawEof === true;

const report = {
  test: "W0-1 예비 — SAB 링버퍼 단위 시험",
  pass: ok,
  bytesExpected: expected.length,
  bytesReceived: result.text.length,
  contentMatches: result.text === expected,
  stdinBlocks: result.blocks,
  sawEof: result.sawEof,
  producerMaxLagMs: +maxLag.toFixed(1),
  wallMs: +(performance.now() - t0).toFixed(1),
  capacity: CAPACITY,
  note:
    result.blocks === 0
      ? "blocks=0 — 소비자가 한 번도 잠들지 않았습니다. 블로킹 경로가 검증되지 않았습니다."
      : "소비자가 비었을 때 실제로 Atomics.wait 로 잠들었습니다.",
};
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
