#!/usr/bin/env node
/**
 * M1 — cachegrind 한 번(docs/최적화-마스터플랜-v2.md §4 M1). 네이티브 엔진을 valgrind 아래에서 띄워 고정 국면들을
 * **노드 상한**으로 풀고, cachegrind 의 명령 수(Ir)와 모의 캐시 미스를 JSON 으로 남긴다.
 *
 *   node bench/cachegrind/cg-run.mjs --engine-dir DIR --mode search|load --ll 4194304 \
 *        [--positions bench/sprt/openings-balanced.json] [--count 12] [--nodes 250000] --out r.json
 *        [--no-valgrind]   # 보정용 — valgrind 없이 같은 대본을 돌려 노드 · 시간만 본다
 *
 * 결정성 — 같은 빌드면 Ir 이 실행마다 같아야 한다(tools/bench_cachegrind.sh 가 한 번 더 돌려 확인):
 *   - 1 스레드 · 국면마다 YXHASHCLEAR · `TIMEOUT_TURN 0`/`TIMEOUT_MATCH 0`(시간 제한 없음 — valgrind 아래 50배
 *     느려도 시간 관리가 탐색을 끊지 않는다) · `MAX_NODE` 로만 멈춘다. 노드 수 검사는 호출 수 기준이라 시간과 무관.
 *   - `SHOW_DETAIL 0` — 경과 시간에 따라 찍히는 실시간 줄을 끈다(출력 Ir 이 시간에 흔들리지 않게).
 *   - 해시 16MB — 국면마다 지우는 memset 이 측정을 덮지 않게(25만 노드에는 충분한 크기).
 *
 * `--mode load` 는 같은 대본에서 탐색만 뺀다(기동 · 가중치 적재 · 예열 · 해시 지우기). report.mjs 가
 * search − load 로 「탐색만의 비용」을 낸다 — 엔진 소스에 측정 코드를 넣지 않기 위해서다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Engine } from "../sprt/engine.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.lastIndexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (k) => argv.includes(`--${k}`);

const engineDir = resolve(opt("engine-dir", ""));
const mode = opt("mode", "search");
const ll = Number(opt("ll", 4 * 1024 * 1024));
const positionsFile = opt("positions", "bench/sprt/openings-balanced.json");
const count = Number(opt("count", 12));
const nodes = Number(opt("nodes", 250_000));
const out = resolve(opt("out", `cg-${mode}-${ll}.json`));
// 드라이버 점검용 — 네이티브 빌드가 없는 기계에서 `--engine-cmd "node bench/sprt/wasm-pbrain.mjs"` 로 같은 대본을
// 돌려 본다(valgrind 없이). 측정값이 아니다.
const engineCmd = opt("engine-cmd", null);
const useValgrind = !flag("no-valgrind") && !engineCmd;
if (
  (!engineCmd && !existsSync(resolve(engineDir, "pbrain-rapfi"))) ||
  !["search", "load"].includes(mode)
) {
  console.error(
    "쓰임: node bench/cachegrind/cg-run.mjs --engine-dir DIR --mode search|load --out r.json",
  );
  process.exit(2);
}

// 캐시 모양 — D1/I1 은 흔한 32KB 8-way, LL 만 바꾼다(16-way · 64B 줄, 크기는 2의 거듭제곱이어야 집합 수가 맞는다).
const D1 = "32768,8,64";
const I1 = "32768,8,64";
const LL = `${ll},16,64`;

const j = JSON.parse(readFileSync(positionsFile, "utf8"));
const positions = (j.openings ?? j.positions ?? j)
  .slice(0, count)
  .map((p, i) => ({ id: p.name ?? p.id ?? String(i), moves: p.moves }));

mkdirSync(dirname(out), { recursive: true });
const cgOut = out.replace(/\.json$/, "") + ".cgout";
rmSync(cgOut, { force: true });

const bin = resolve(engineDir, "pbrain-rapfi");
const spec = useValgrind
  ? {
      cmd: "valgrind",
      args: [
        "--tool=cachegrind",
        "--cache-sim=yes",
        `--I1=${I1}`,
        `--D1=${D1}`,
        `--LL=${LL}`,
        `--cachegrind-out-file=${cgOut}`,
        bin,
      ],
    }
  : engineCmd
    ? { cmd: engineCmd.split(/\s+/)[0], args: engineCmd.split(/\s+/).slice(1) }
    : { cmd: bin, args: [] };

const e = new Engine({
  name: `${mode}-${ll}`,
  ...spec,
  cwd: engineCmd ? process.cwd() : engineDir,
  startTimeoutMs: 1_800_000,
  log: flag("verbose") ? (l) => console.log(l) : undefined,
});

/** 요약 줄 — `MESSAGE Speed … | Depth D-S | Eval E | Node N | Time T` (Node 는 1만 넘으면 천 단위 내림) */
function parseNodes(t) {
  const m = /^(\d+)([KMGT]?)$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * { "": 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2]];
}

const t0 = performance.now();
const rows = [];
try {
  await e.start({
    rule: 4,
    info: ["INFO THREAD_NUM 1", "INFO SHOW_DETAIL 0", "INFO HASH_SIZE 16384"],
  });
  for (const c of ["INFO TIMEOUT_TURN 0", "INFO TIMEOUT_MATCH 0", "INFO MAX_NODE 2000"])
    await e.send(c);
  // 예열 — 가중치는 첫 탐색에서 풀린다. load/search 두 모드가 똑같이 치르는 비용이다.
  await e.play([[7, 7]], { timeoutMs: 1_800_000 });
  await e.send(`INFO MAX_NODE ${nodes}`);

  for (const p of positions) {
    await e.send("YXHASHCLEAR");
    if (mode === "load") continue;
    let summary = null;
    const untap = e.tap((l) => {
      const s = /^MESSAGE Speed \S+ \| Depth (\d+)-\d+ \| Eval (\S+) \| Node (\S+) \| Time/.exec(l);
      if (s) summary = { depth: Number(s[1]), eval: s[2], nodes: parseNodes(s[3]) };
    });
    try {
      const { move, ms } = await e.play(p.moves, { timeoutMs: 3_600_000 });
      if (!summary) throw new Error(`요약 줄을 못 읽음: ${e.lastLines(4).join(" | ")}`);
      rows.push({ id: p.id, move: move.join(","), ms: Math.round(ms), ...summary });
      console.log(
        `  ${p.id}: ${summary.nodes} 노드 · d${summary.depth} · ${summary.eval} · ${(ms / 1000).toFixed(1)}s`,
      );
    } finally {
      untap();
    }
  }
} finally {
  // END 뒤 valgrind 가 출력 파일을 쓸 때까지 기다린다 — 일찍 죽이면 측정이 사라진다.
  await e.stop(600_000);
}

/** cachegrind 출력 — events · summary 와 함수별 합(fn= 블록) */
function parseCg(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const events = /^events:\s*(.+)$/m.exec(text)[1].trim().split(/\s+/);
  const summary = /^summary:\s*(.+)$/m.exec(text)[1].trim().split(/\s+/).map(Number);
  const total = Object.fromEntries(events.map((k, i) => [k, summary[i] ?? 0]));
  const fns = new Map();
  let fn = null;
  for (const l of lines) {
    if (l.startsWith("fn=")) {
      fn = l.slice(3);
      if (!fns.has(fn)) fns.set(fn, new Array(events.length).fill(0));
    } else if (fn && /^\d/.test(l)) {
      const v = l.trim().split(/\s+/).slice(1).map(Number);
      const acc = fns.get(fn);
      for (let i = 0; i < v.length; i++) acc[i] += v[i];
    }
  }
  const top = [...fns.entries()]
    .map(([name, v]) => ({ fn: name, ...Object.fromEntries(events.map((k, i) => [k, v[i]])) }))
    .sort((a, b) => b.Ir - a.Ir)
    .slice(0, 25);
  return { events, total, top };
}

const result = {
  mode,
  ll,
  cache: { I1, D1, LL },
  nodesBudget: nodes,
  positionsFile,
  count: positions.length,
  valgrind: useValgrind
    ? execFileSync("valgrind", ["--version"], { encoding: "utf8" }).trim()
    : null,
  engine: existsSync(resolve(engineDir, "ENGINE_VERSION.txt"))
    ? readFileSync(resolve(engineDir, "ENGINE_VERSION.txt"), "utf8")
    : null,
  wallMs: Math.round(performance.now() - t0),
  positions: rows,
  nodes: rows.reduce((a, r) => a + (r.nodes ?? 0), 0),
  ...(useValgrind ? parseCg(cgOut) : {}),
};
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(
  `${mode} LL=${ll}: ${result.total ? `Ir ${result.total.Ir.toLocaleString()} · ` : ""}${(result.wallMs / 1000).toFixed(0)}s → ${out}`,
);
