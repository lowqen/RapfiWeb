#!/usr/bin/env node
/**
 * N1 — 소형 값 헤드 학습 표본 만들기. 마스터플랜 2부 §3.2.
 *
 *   node bench/n1/gen-samples.mjs --engine <pbrain-rapfi> --cwd <엔진 폴더> --out <폴더> \
 *        [--workers 8] [--nodes 100000] [--every 4] [--target 4000000] [--holdout-frac 0.1]
 *
 * 엔진은 tools/patches/n1-value-dump.patch 를 얹은 네이티브 빌드여야 한다 — 환경 변수 RAPFI_VALUE_DUMP 가 가리키는
 * 파일에, 탐색이 값 헤드를 부를 때마다 한 줄(입력 · 대형 헤드 로짓 · 고전 평가 · 창)을 덧붙인다 — v2(N1b) 664바이트,
 * v1(N1) 88바이트(--rec 88).
 *
 * 국면: bench/sprt/results/*.jsonl 의 대국 기보(자체 대국 · SPRT 수천 판)에서 --stride 수마다 뽑고, 대칭 겹침을 뺀다.
 * **대국 단위로** 학습 · 보류를 가른다(같은 대국의 국면이 양쪽에 섞이면 보류 오차가 낙관적으로 나온다). 일꾼 0 이
 * 보류 국면만, 나머지가 학습 국면을 푼다 — 일꾼마다 따로 띄운 엔진이 자기 파일에 쓴다(잠금 없음).
 * 탐색은 해시 비움 · 1 스레드 · 노드 고정(Engine.evaluate) — 같은 빌드면 같은 표본이 나온다.
 * 목표 줄 수에 닿으면 멈춘다.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Engine, LIVE } from "../sprt/engine.mjs";
import { canonicalKey } from "../sprt/openings.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.lastIndexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const P = {
  engine: opt("engine"),
  cwd: opt("cwd"),
  out: resolve(opt("out", "bench/n1/samples")),
  games: opt("games", "bench/sprt/results"),
  workers: Number(opt("workers", 4)),
  nodes: Number(opt("nodes", 100_000)),
  every: Number(opt("every", 4)),
  target: Number(opt("target", 4_000_000)),
  holdoutFrac: Number(opt("holdout-frac", 0.1)),
  stride: Number(opt("stride", 5)),
  seed: opt("seed", "n1"),
  rec: Number(opt("rec", 664)),
};
if (!P.engine) {
  console.error(
    "쓰임: node bench/n1/gen-samples.mjs --engine <pbrain-rapfi> --cwd <폴더> --out <폴더> [옵션]",
  );
  process.exit(2);
}
const REC = P.rec;

const parseLabel = (s) => ["abcdefghijklmno".indexOf(s[0]), 15 - Number(s.slice(1))];
const h32 = (s) => createHash("sha256").update(`${P.seed}:${s}`).digest().readUInt32BE(0);

// ── 국면 ─────────────────────────────────────────────────────────────
const games = readdirSync(P.games)
  .filter((f) => f.endsWith(".jsonl"))
  .flatMap((f) =>
    readFileSync(join(P.games, f), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l, i) => ({ ...JSON.parse(l), src: `${f}#${i + 1}` })),
  )
  .filter((g) => typeof g.moves === "string" && g.moves.length > 0);
const seen = new Set();
const sets = { train: [], holdout: [] };
for (const g of games) {
  const moves = g.moves.split(" ").map(parseLabel);
  const split = h32(g.src) / 2 ** 32 < P.holdoutFrac ? "holdout" : "train";
  for (let m = 4; m < moves.length - 1; m += P.stride) {
    const pos = moves.slice(0, m);
    const key = canonicalKey(pos);
    if (seen.has(key)) continue;
    seen.add(key);
    sets[split].push({ id: `${g.src}@${m}`, moves: pos, k: h32(`${g.src}@${m}`) });
  }
}
for (const s of Object.values(sets)) s.sort((a, b) => a.k - b.k); // 결정적으로 섞는다
console.log(
  `대국 ${games.length.toLocaleString()} · 국면 학습 ${sets.train.length.toLocaleString()} · 보류 ${sets.holdout.length.toLocaleString()} ` +
    `· 노드 ${P.nodes.toLocaleString()} · 매 ${P.every}번째 호출 · 목표 ${P.target.toLocaleString()}줄`,
);

// ── 일꾼 ─────────────────────────────────────────────────────────────
mkdirSync(P.out, { recursive: true });
const files = [];
const lines = (f) => (existsSync(f) ? Math.floor(statSync(f).size / REC) : 0);
const total = (kind) => files.filter((f) => f.kind === kind).reduce((s, f) => s + lines(f.path), 0);
const goal = { holdout: Math.round(P.target * P.holdoutFrac), train: P.target };

const engines = [];
for (let w = 0; w < P.workers; w++) {
  const kind = w === 0 ? "holdout" : "train";
  const path = join(P.out, kind === "holdout" ? "holdout.bin" : `train-${w}.bin`);
  files.push({ kind, path });
  // 엔진은 띄울 때의 환경을 물려받는다 — 일꾼마다 자기 파일을 가리키게 하고 띄운다.
  process.env.RAPFI_VALUE_DUMP = path;
  process.env.RAPFI_VALUE_DUMP_EVERY = String(P.every);
  const e = new Engine({
    name: `n1#${w}`,
    cmd: resolve(P.engine),
    args: [],
    cwd: P.cwd ? resolve(P.cwd) : undefined,
  });
  await e.start({ rule: 4, info: ["INFO THREAD_NUM 1"] });
  engines.push({ e, kind });
}
delete process.env.RAPFI_VALUE_DUMP;

const t0 = performance.now();
const cursor = { train: 0, holdout: 0 };
let solved = 0;
let lastLog = 0;
await Promise.all(
  engines.map(async ({ e, kind }) => {
    const list = sets[kind];
    for (;;) {
      if (total(kind) >= goal[kind]) break;
      const i = cursor[kind]++;
      if (i >= list.length) break;
      await e.evaluate(list[i].moves, { nodes: P.nodes, timeoutMs: 600_000 });
      solved++;
      const now = performance.now();
      if (now - lastLog > 30_000) {
        lastLog = now;
        console.log(
          `  ${((now - t0) / 60000).toFixed(1)}분 · 국면 ${solved.toLocaleString()} · 학습 ${total("train").toLocaleString()}` +
            ` / 보류 ${total("holdout").toLocaleString()}줄`,
        );
      }
    }
  }),
);
// END 로 정상 종료시켜야 엔진이 버퍼를 비우고 파일을 닫는다.
await Promise.all(engines.map(({ e }) => e.stop()));
console.log(
  `끝 — ${((performance.now() - t0) / 60000).toFixed(1)}분 · 국면 ${solved.toLocaleString()} · ` +
    `학습 ${total("train").toLocaleString()}줄 · 보류 ${total("holdout").toLocaleString()}줄 · 남은 엔진 ${LIVE.size}`,
);
for (const f of files) console.log(`  ${f.path} ${lines(f.path).toLocaleString()}줄`);
if (total("holdout") === 0 || total("train") === 0) {
  console.error(
    "표본이 비었습니다 — 엔진에 n1-value-dump 패치가 얹혔는지, RAPFI_VALUE_DUMP 를 받는지 보세요",
  );
  process.exit(1);
}
