#!/usr/bin/env node
/**
 * PGO 훈련 — 계측 빌드(PGO_GENERATE=1)의 WASM 을 Node 에서 띄워 대표 국면을 풀게 하고, END 로 끝내 프로파일을
 * 디스크에 떨군다(tools/pgo/profdump.js 가 Module.onExit 에서 꺼낸다).
 *
 *   RAPFI_PROFRAW=out.profraw node tools/pgo/train.mjs --dir <엔진 폴더> [--variant single-simd128]
 *        [--positions a.json,b.json] [--nodes 200000] [--limit N]
 *
 * 국면: 배포가 실제로 도는 것 — 렌주 균형 개시 · 필승 묶음(표준 · 하드). 국면마다 해시를 비우고 노드 제한으로
 * 푼다(계측 빌드는 2~3배 느려 시간 제한은 국면마다 깊이가 들쭉날쭉해진다). BENCH 는 넣지 않는다 — 렌주 전용
 * .data 에서 BENCH 의 10국면 중 7개는 고전 평가로 폴백해 배포 핫패스를 대표하지 않는다.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const dir = resolve(arg("dir", "out/engine"));
const variant = arg("variant", "single-simd128");
const nodes = Number(arg("nodes", 200000));
const limit = Number(arg("limit", 0));
const files = arg(
  "positions",
  "bench/sprt/openings-balanced.json,bench/gomocalc/mate-suite.json,bench/gomocalc/mate-suite-hard.json",
).split(",");

const js = resolve(dir, `rapfi-${variant}.js`);
const data = [resolve(dir, `rapfi-${variant}.data`), resolve(dir, "rapfi.data")].find((p) =>
  existsSync(p),
);
if (!existsSync(js) || !data) {
  console.error(`train: 엔진 파일이 없습니다 — ${js} · ${data ?? "(.data 없음)"}`);
  process.exit(2);
}
let positions = files.flatMap((f) => {
  const j = JSON.parse(readFileSync(f, "utf8"));
  return (j.openings ?? j.positions).map((p) => p.moves);
});
if (limit) positions = positions.slice(0, limit);

let lines = 0;
let moves = 0;
const factory = createRequire(import.meta.url)(js);
const Module = await factory({
  locateFile: (p) => (p.endsWith(".data") ? data : resolve(dir, p)),
  onReceiveStdout: (l) => {
    lines++;
    if (/^\d+,\d+$/.test(l)) moves++;
  },
  onReceiveStderr: (l) => process.stderr.write(l + "\n"),
  print: () => {},
  printErr: () => {},
});

const send = (c) => Module.sendCommand(c);
const t0 = Date.now();
send("INFO RULE 4");
send("START 15");
send("INFO HASH_SIZE 131072");
send("INFO THREAD_NUM 1");
send("INFO TIMEOUT_TURN 3600000");
send("INFO TIMEOUT_MATCH 0");
send(`INFO MAX_NODE ${nodes}`);
for (const [i, ms] of positions.entries()) {
  send("YXHASHCLEAR");
  const toMove = ms.length % 2;
  send(
    ["BOARD", ...ms.map(([x, y], k) => `${x},${y},${k % 2 === toMove ? 1 : 2}`), "DONE"].join("\n"),
  );
  if ((i + 1) % 25 === 0)
    console.log(`  ${i + 1}/${positions.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log(
  `훈련 국면 ${positions.length}개 · 국면당 ${nodes} 노드 · 수 ${moves}개 · 출력 ${lines}줄 · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
);
if (moves !== positions.length) {
  console.error(
    `수가 ${moves}개 — 국면 수(${positions.length})와 다르다. 탐색이 끝나지 않은 국면이 있다`,
  );
  process.exitCode = 1;
}
// END → emscripten_force_exit → atexit(프로파일 기록) → onExit(profdump.js 가 디스크로) → process.exit
try {
  send("END");
} catch (e) {
  if (!(e && (e.name === "ExitStatus" || typeof e.status === "number"))) throw e;
}
