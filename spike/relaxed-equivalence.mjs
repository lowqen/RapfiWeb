/**
 * relaxed SIMD 동등성 게이트 — **앱이 실제로 타는 경로(렌주 · mix9svq NNUE)** 에서 relaxed
 * 빌드가 일반 SIMD 빌드와 **같은 탐색**을 하는가.
 *
 *   node --experimental-wasm-relaxed-simd spike/relaxed-equivalence.mjs
 *
 * ## 왜 BENCH 해시로는 안 되는가
 *
 * 렌주 전용 .data 로 BENCH 를 돌리면 자체 국면 10개 중 7개(프리스타일·스탠다드)가 가중치가
 * 없어 **classical 폴백 평가**로 돈다(web-baseline.json). 그 경로는 relaxed 에서 값이 갈린다 —
 * 2026-09-30 릴리스 런에서 relaxed BENCH 가 dd5e1c73(7,387,373 노드)로, 일반 2b7c7da9
 * (7,170,518)와 달랐다. 반면 가중치 4종 빌드(10개 모두 NNUE)에서는 relaxed = 일반
 * (4100a973, docs/gomocalc-엔진-비교.md §4.3). 앱은 렌주만 두고 렌주는 늘 NNUE 로 평가하므로,
 * 판정해야 할 것은 **렌주 국면에서의 동등성**이다.
 *
 * ## 무엇을 비교하나
 *
 * bench/gomocalc/positions.json 의 렌주 국면 5개(개시 2 · 중반 · VCF · VCT)를 두 빌드로
 * 1 스레드 · 해시 비움 · **고정 깊이**(시간 무제한)로 읽고, 국면마다 총 노드 수 · 평가값 ·
 * 최선 수순 · 최선수가 **모두 같아야** 통과한다. 1 스레드 고정 깊이 탐색은 결정적이라, 하나라도
 * 다르면 relaxed 명령이 평가를 바꾼 것이다.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { startEngine } from "./src/engine-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = resolve(process.env.ENGINE_DIR ?? resolve(HERE, "../out/engine"));
const DEPTH = Number(process.env.DEPTH ?? 16);
const PAIR = (process.env.PAIR ?? "single-simd128,single-simd128-relaxed").split(",");
const { positions } = JSON.parse(
  readFileSync(resolve(HERE, "../bench/gomocalc/positions.json"), "utf8"),
);

/** 수순 → YXBOARD 한 덩어리(1 = 둘 차례의 돌). 단일 빌드는 받자마자 돌리므로 한 번에. */
function boardBlock(moves) {
  const toMove = moves.length % 2;
  return ["YXBOARD", ...moves.map(([x, y], i) => `${x},${y},${i % 2 === toMove ? 1 : 2}`), "DONE"].join(
    "\n",
  );
}

async function run(variant) {
  const js = resolve(ENGINE_DIR, `rapfi-${variant}.js`);
  if (!existsSync(js)) throw new Error(`없음: ${js}`);
  const require = createRequire(import.meta.url);
  const lines = [];
  const Module = await startEngine({
    factory: require(js),
    baseUrl: ENGINE_DIR + "/",
    onLine: (l) => lines.push(l),
  });
  for (const c of [
    "INFO SHOW_DETAIL 3",
    "INFO RULE 4",
    "START 15",
    "INFO THREAD_NUM 1",
    "INFO HASH_SIZE 65536",
    "INFO TIMEOUT_MATCH 0",
    "INFO TIMEOUT_TURN 1000000000",
    `INFO MAX_DEPTH ${DEPTH}`,
  ])
    Module.sendCommand(c);
  const out = [];
  for (const p of positions) {
    Module.sendCommand("YXHASHCLEAR");
    Module.sendCommand(boardBlock(p.moves));
    const from = lines.length;
    const t0 = Date.now();
    Module.sendCommand("YXNBEST 1"); // 단일 빌드: 탐색이 이 호출 안에서 끝난다
    const seg = lines.slice(from);
    const last = (key) => {
      for (let i = seg.length - 1; i >= 0; i--) {
        const m = new RegExp(`^INFO ${key} (.*)$`).exec(seg[i]);
        if (m) return m[1].trim();
      }
      return null;
    };
    out.push({
      id: p.id,
      move: seg.filter((l) => /^\d+,\d+$/.test(l)).at(-1) ?? null,
      nodes: last("TOTALNODES"),
      depth: last("DEPTH"),
      eval: last("EVAL"),
      bestline: last("BESTLINE"),
      ms: Date.now() - t0,
    });
  }
  return { variant, version: lines.find((l) => /Rapfi \d/.test(l)) ?? null, results: out };
}

const [a, b] = await Promise.all(PAIR.map(run));
let same = true;
const rows = a.results.map((r, i) => {
  const s = b.results[i];
  const eq = ["move", "nodes", "depth", "eval", "bestline"].every((k) => r[k] === s[k]);
  if (!eq) same = false;
  return { id: r.id, eq, [a.variant]: r, [b.variant]: s };
});
console.log(
  JSON.stringify(
    { test: "relaxed 동등성(렌주 · NNUE · 1 스레드 · 고정 깊이)", depth: DEPTH, pass: same, versions: [a.version, b.version], rows },
    null,
    2,
  ),
);
if (!same) {
  console.error("✗ relaxed 빌드가 렌주 국면에서 다른 탐색을 했습니다 — relaxed 를 배포하면 안 된다");
  process.exit(1);
}
console.log(`✓ 렌주 국면 ${rows.length}개에서 ${a.variant} = ${b.variant} (깊이 ${DEPTH})`);
