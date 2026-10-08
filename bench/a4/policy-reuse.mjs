#!/usr/bin/env node
/**
 * A4 관문 0 — 정책 결과 캐시(카드 ④)를 짓기 전에 「같은 국면의 정책을 다시 계산하는 비율」을 잰다.
 *
 *   node bench/a4/policy-reuse.mjs --engine "이름|명령줄|cwd" [--depth 16]
 *        [--positions a.json,b.json] [--out r.json] [--md r.md]
 *
 * 엔진은 `tools/patches/a4-diag-policy-reuse.patch` 를 얹은 빌드여야 한다 — 탐색이 끝날 때마다
 * `MESSAGE PREUSE calls … | s8 full … fullcells … part … | s10 …` 를 찍는다(누적, 결과 불변).
 * 크기 2^k 의 직접 사상 표(zobristKey 아래 k 비트)로 흉내 낸 적중:
 *   full  = 같은 국면 · 요청 칸이 이미 계산한 칸의 부분집합 → 실제 캐시라면 계산을 통째로 건너뛴다
 *   part  = 같은 국면이지만 새 칸이 있다 → 다시 계산(흉내에서는 칸을 합친다)
 *
 * 설정은 wasm-speed(fixed-depth --det)와 같다: 해시 비움 · 1 스레드 · 노드 고정 예열 · 시간 무제한 · 고정 깊이.
 * 그래서 트리는 배포 엔진과 같다(패치는 결과 불변 — 워크플로가 BENCH 해시로 확인한다).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Engine, LIVE } from "../sprt/engine.mjs";

const argv = process.argv.slice(2);
const all = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const opt = (k, d) => all(k).at(-1) ?? d;
const depth = Number(opt("depth", 16));
const files = opt(
  "positions",
  "bench/sprt/openings-balanced.json,bench/gomocalc/mate-suite.json",
).split(",");
const [name, line, cwd] = (opt("engine") ?? "").split("|");
if (!line) {
  console.error('쓰임: node bench/a4/policy-reuse.mjs --engine "이름|명령|cwd" [옵션]');
  process.exit(2);
}
const [cmd, ...args] = line.trim().split(/\s+/);

const positions = files.flatMap((f) => {
  const j = JSON.parse(readFileSync(f, "utf8"));
  const list = j.openings ?? j.positions ?? j;
  const set = f
    .split(/[\\/]/)
    .pop()
    .replace(/\.json$/, "");
  return list.map((p, i) => ({ set, id: `${set}:${p.name ?? p.id ?? i}`, moves: p.moves }));
});

/** `MESSAGE PREUSE …` 한 줄 → { calls, cells, repeat, sizes: { s8: { full, fullcells, part } … } } */
function parse(l) {
  const m = /^MESSAGE PREUSE calls (\d+) cells (\d+) repeat (\d+)(.*)$/.exec(l);
  if (!m) return null;
  const sizes = {};
  for (const s of m[4].matchAll(/\| (s\d+) full (\d+) fullcells (\d+) part (\d+)/g))
    sizes[s[1]] = { full: Number(s[2]), fullcells: Number(s[3]), part: Number(s[4]) };
  return { calls: Number(m[1]), cells: Number(m[2]), repeat: Number(m[3]), sizes };
}
/** 계수끼리 a + sign·b */
const combine = (a, b, sign) => ({
  calls: a.calls + sign * b.calls,
  cells: a.cells + sign * b.cells,
  repeat: a.repeat + sign * b.repeat,
  sizes: Object.fromEntries(
    Object.entries(a.sizes).map(([k, v]) => [
      k,
      {
        full: v.full + sign * b.sizes[k].full,
        fullcells: v.fullcells + sign * b.sizes[k].fullcells,
        part: v.part + sign * b.sizes[k].part,
      },
    ]),
  ),
});
const diff = (a, b) => combine(a, b, -1);
const sum = (xs) => xs.reduce((a, x) => combine(a, x, 1));

let engine;
let code = 0;
const rows = [];
try {
  const seen = [];
  engine = await new Engine({
    name,
    cmd,
    args,
    cwd: cwd ? resolve(cwd) : undefined,
    startTimeoutMs: 120_000,
  }).start({
    info: ["INFO THREAD_NUM 1", "INFO SHOW_DETAIL 3", "INFO HASH_SIZE 131072"],
    warmup: false,
  });
  let nodes = null;
  engine.tap((l) => {
    const p = parse(l);
    if (p) seen.push(p);
    const n = /^INFO TOTALNODES (\d+)/.exec(l);
    if (n) nodes = Number(n[1]);
  });
  /** 탐색 하나가 끝난 뒤 그 탐색의 PREUSE 줄을 기다린다(수 줄과 순서가 바뀌어 와도). */
  const nextPreuse = async (want) => {
    for (let i = 0; i < 100 && seen.length < want; i++) await new Promise((r) => setTimeout(r, 50));
    if (seen.length < want)
      throw new Error(`PREUSE 줄이 없다 — 진단 패치 빌드인가? ${engine.lastLines(4).join(" | ")}`);
    return seen[want - 1];
  };

  // 예열 — fixed-depth --det 와 같다(노드 고정 · 시간 무제한)
  await engine.send("INFO TIMEOUT_TURN 0");
  await engine.send("INFO TIMEOUT_MATCH 0");
  await engine.send("INFO MAX_NODE 100000");
  await engine.play([[7, 7]], { timeoutMs: 120_000 });
  let prev = await nextPreuse(1);
  await engine.send(`INFO MAX_DEPTH ${depth}`);
  await engine.send("INFO MAX_NODE 0");

  console.log(`국면 ${positions.length}개 · 깊이 ${depth} · ${name}`);
  const t0 = performance.now();
  for (const [i, p] of positions.entries()) {
    nodes = null;
    await engine.send("YXHASHCLEAR");
    await engine.play(p.moves, { timeoutMs: 600_000 });
    const cur = await nextPreuse(i + 2);
    rows.push({ id: p.id, set: p.set, nodes, ...diff(cur, prev) });
    prev = cur;
    if ((i + 1) % 20 === 0)
      console.log(
        `  ${i + 1}/${positions.length} · ${((performance.now() - t0) / 1000).toFixed(0)}s`,
      );
  }

  // 요약 — 묶음별 · 전체
  const pct = (a, b) => (b ? (100 * a) / b : 0);
  const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const groups = [...new Set(rows.map((r) => r.set)), "전체"];
  const summary = { depth, positions: positions.length, groups: {} };
  for (const g of groups) {
    const rs = g === "전체" ? rows : rows.filter((r) => r.set === g);
    const t = sum(rs);
    const totalNodes = rs.reduce((a, r) => a + (r.nodes ?? 0), 0);
    summary.groups[g] = {
      positions: rs.length,
      nodes: totalNodes,
      calls: t.calls,
      callsPerKNode: (1000 * t.calls) / totalNodes,
      cellsPerCall: t.cells / t.calls,
      repeatPct: pct(t.repeat, t.calls),
      sizes: Object.fromEntries(
        Object.entries(t.sizes).map(([k, v]) => [
          k,
          {
            fullPct: pct(v.full, t.calls),
            fullCellsPct: pct(v.fullcells, t.cells),
            partPct: pct(v.part, t.calls),
            // 국면별 full 비율의 중앙값 — 몇 국면이 몰아 올린 것인지 본다
            fullPctMedian: med(rs.map((r) => pct(r.sizes[k].full, r.calls))),
          },
        ]),
      ),
    };
  }

  const md = [];
  md.push(`깊이 ${depth} · 1 스레드 · 해시 비움 · --det 와 같은 예열 — 엔진 \`${name}\``);
  md.push("");
  md.push("| 묶음 | 국면 | 노드 | 정책 호출 | 호출 / 1천 노드 | 칸 / 호출 | 바로 앞과 같은 국면 |");
  md.push("|---|---|---|---|---|---|---|");
  for (const [g, v] of Object.entries(summary.groups))
    md.push(
      `| ${g} | ${v.positions} | ${v.nodes.toLocaleString("en-US")} | ${v.calls.toLocaleString("en-US")} | ${v.callsPerKNode.toFixed(1)} | ${v.cellsPerCall.toFixed(1)} | ${v.repeatPct.toFixed(1)}% |`,
    );
  md.push("");
  md.push(
    "**표 크기별 재사용 가능 비율**(full = 계산을 통째로 건너뜀 · 칸 가중 · part = 같은 국면이나 새 칸)",
  );
  md.push("");
  const sizeKeys = Object.keys(summary.groups["전체"].sizes);
  md.push(
    `| 묶음 | ${sizeKeys.map((k) => `2^${k.slice(1)} full · 칸 · part · 국면 중앙값`).join(" | ")} |`,
  );
  md.push(`|---|${sizeKeys.map(() => "---").join("|")}|`);
  for (const [g, v] of Object.entries(summary.groups))
    md.push(
      `| ${g} | ${sizeKeys
        .map((k) => {
          const s = v.sizes[k];
          return `${s.fullPct.toFixed(1)}% · ${s.fullCellsPct.toFixed(1)}% · ${s.partPct.toFixed(1)}% · ${s.fullPctMedian.toFixed(1)}%`;
        })
        .join(" | ")} |`,
    );
  const report = md.join("\n");
  console.log("\n" + report);

  const out = opt("out");
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(
      out,
      JSON.stringify({ engine: { name, cmd, args }, summary, rows }, null, 1) + "\n",
    );
  }
  const mdOut = opt("md");
  if (mdOut) {
    mkdirSync(dirname(resolve(mdOut)), { recursive: true });
    writeFileSync(mdOut, report + "\n");
  }
} catch (e) {
  console.error(`실패: ${e.stack ?? e}`);
  code = 1;
} finally {
  await engine?.stop();
}
if (LIVE.size) code = 1;
process.exitCode = code;
