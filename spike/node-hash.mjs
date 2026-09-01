/**
 * BENCH 해시만 뽑는다. 게이트도 기준선도 없다 — 진단용(tools/diag_hash_width.sh).
 *
 *   ENGINE_DIR=… node node-hash.mjs <variant>
 *
 * node-bench.mjs 와 달리 **비동기로 기다린다.** 멀티 스레드 빌드에서
 * sendCommand 는 엔진 pthread 를 깨우기만 하고 즉시 돌아오기 때문에,
 * "sendCommand 가 돌아오면 끝난 것"이라고 가정하면 아무 것도 재지 못한다
 * (실제로 첫 측정에서 multi 가 0.2초 만에 빈 결과를 냈다).
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { startEngine } from "./src/engine-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = resolve(process.env.ENGINE_DIR ?? resolve(HERE, "../out/engine"));
const variant = process.argv[2] ?? "single-simd128";
const timeoutMs = +(process.env.BENCH_TIMEOUT_MS ?? 1_800_000);

const js = resolve(ENGINE_DIR, `rapfi-${variant}.js`);
if (!existsSync(js)) {
  console.error(`없음: ${js}`);
  process.exit(2);
}

const out = [];
let hash = null;
let resolveDone;
const done = new Promise((r) => (resolveDone = r));

const require = createRequire(import.meta.url);
const factory = require(js);
const Module = await startEngine({
  factory,
  baseUrl: ENGINE_DIR + "/",
  onLine: (l) => {
    out.push(l);
    const m = l.match(/Hash:\s*([0-9a-f]+)/i);
    if (m) {
      hash = m[1].toLowerCase();
      resolveDone();
    }
  },
});

try {
  Module.sendCommand("BENCH");
} catch (e) {
  if (!(e && (e.name === "ExitStatus" || typeof e.status === "number"))) throw e;
}
await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs))]);

const nodes = (out.join("\n").match(/Nodes:\s*([\d,]+)/i) ?? [])[1] ?? null;
console.log(JSON.stringify({ variant, hash, nodes }));
process.exit(hash ? 0 : 1);
