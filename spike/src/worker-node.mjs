/**
 * node worker_threads 어댑터.
 *
 * 브라우저 없이 W0-1 주 경로를 한 번 검증하기 위한 것이다. node 의 worker_threads
 * 는 SharedArrayBuffer 와 Atomics.wait 의미가 브라우저 워커와 같으므로, 여기서
 * 깨지면 브라우저에서도 깨진다 — CI 에서 훨씬 싸게 잡을 수 있는 실패다.
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { makeBlockingStdin } from "./sab-stdin.js";
import { runEngineSession } from "./engine-core.js";

const { factoryUrl, wasmUrl, benchDir, channel } = workerData;

// 40MB 를 구조화 복제로 넘기지 않고 워커가 직접 읽는다.
const files = readdirSync(benchDir)
  .filter((n) => !n.endsWith(".txt"))
  .map((name) => ({ name, bytes: readFileSync(join(benchDir, name)) }));

let blocks = 0;
await runEngineSession({
  post: (m) => parentPort.postMessage(m),
  factoryUrl,
  wasmUrl,
  files,
  stdin: { fn: makeBlockingStdin(channel, { onBlock: () => blocks++ }), blocks: () => blocks },
});
