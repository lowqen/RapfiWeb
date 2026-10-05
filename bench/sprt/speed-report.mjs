#!/usr/bin/env node
/**
 * 결과 불변 패치의 **순수 속도 대조** 보고 — `fixed-depth.mjs --det` 의 `--out` JSON 을 읽는다.
 *
 *   node bench/sprt/speed-report.mjs r.json [--min-ms 100] [--json summary.json]
 *
 * - 짝은 **같은 반복 · 같은 국면**의 기준(첫 엔진) ↔ 시험이다. fixed-depth 가 국면마다 엔진 순서를
 *   번갈아 재므로 러너의 시간 흐름(데우기 · 열 · 클럭)이 한쪽에 몰리지 않고, 짝의 두 탐색은 몇 초
 *   사이로 붙어 있다.
 * - **트리가 같아야** 시간 비가 곧 속도 비다 — 짝의 노드 수가 다르면 그 짝은 빼고 경고한다
 *   (결과 불변 패치가 아니거나 --det 를 안 쓴 것).
 * - 시간 비 = 시험 ms / 기준 ms. 로그의 평균 · 표준오차로 기하 평균과 95% 구간(정규 근사)을 낸다.
 *   속도 이득 = 1 / 시간 비 − 1. `--min-ms` 보다 짧은 짝(ms 해상도 · 고정비가 큰 몫)은 뺀다.
 * - 국면 묶음(id 의 앞부분 — openings-balanced · mate-suite …)별로도 나눠 본다.
 */
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const minMs = Number(opt("min-ms", 100));
if (!file) {
  console.error("쓰임: node bench/sprt/speed-report.mjs r.json [--min-ms 100] [--json out.json]");
  process.exit(2);
}

const { specs, rows } = JSON.parse(readFileSync(file, "utf8"));
const [base, ...tests] = specs.map((s) => s.name);
const key = (r) => `${r.rep}|${r.id}`;
const baseRows = new Map(rows.filter((r) => r.engine === base).map((r) => [key(r), r]));

function stats(logs) {
  const n = logs.length;
  const m = logs.reduce((a, x) => a + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(logs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  return { n, ratio: Math.exp(m), lo: Math.exp(m - 1.96 * se), hi: Math.exp(m + 1.96 * se), sd };
}
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const speed = (r) => 1 / r - 1;

const out = { base, minMs, tests: {} };
const lines = [];
for (const t of tests) {
  const pairs = [];
  let treeDiff = 0;
  let short = 0;
  let coarse = 0;
  for (const r of rows.filter((x) => x.engine === t)) {
    const b = baseRows.get(key(r));
    if (!b) continue;
    if (b.nodes !== r.nodes) {
      treeDiff++;
      continue;
    }
    if (b.ms < minMs || r.ms < minMs) {
      short++;
      continue;
    }
    if (b.coarse || r.coarse) coarse++;
    pairs.push({ id: r.id, set: r.id.split(":")[0], rep: r.rep, ratio: r.ms / b.ms });
  }
  if (!pairs.length) {
    lines.push(`### ${t} ↔ ${base}: 쓸 짝이 없습니다(트리 다름 ${treeDiff} · 짧음 ${short})`);
    continue;
  }
  const all = stats(pairs.map((p) => Math.log(p.ratio)));
  const faster = pairs.filter((p) => p.ratio < 1).length;
  const sets = {};
  for (const set of [...new Set(pairs.map((p) => p.set))])
    sets[set] = stats(pairs.filter((p) => p.set === set).map((p) => Math.log(p.ratio)));
  out.tests[t] = { all, faster, slower: pairs.length - faster, treeDiff, short, coarse, sets };

  lines.push(`### ${t} ↔ ${base} — 같은 트리 · 짝 ${all.n}개(같은 반복 · 같은 국면)`);
  lines.push("");
  lines.push("| 묶음 | 짝 | 시간 비(기하) | 95% 구간 | **속도 이득** | 짝 로그 sd |");
  lines.push("|---|---|---|---|---|---|");
  const row = (name, s) =>
    lines.push(
      `| ${name} | ${s.n} | ${s.ratio.toFixed(4)} | ${s.lo.toFixed(4)} ~ ${s.hi.toFixed(4)} | ` +
        `**${pct(speed(s.ratio))}** (${pct(speed(s.hi))} ~ ${pct(speed(s.lo))}) | ${s.sd.toFixed(3)} |`,
    );
  row("전체", all);
  for (const [set, s] of Object.entries(sets)) row(set, s);
  lines.push("");
  lines.push(
    `시험이 빨랐던 짝 ${faster} · 느렸던 짝 ${pairs.length - faster}. ` +
      `제외: 트리가 다른 짝 ${treeDiff}${treeDiff ? " ⚠ — 결과 불변이 아니거나 --det 없이 쟀다" : ""} · ` +
      `${minMs}ms 보다 짧은 짝 ${short}` +
      (coarse ? ` · 초 단위로만 찍힌 짝 ${coarse}(10초 이상 — 해상도가 거침)` : ""),
  );
  lines.push("");
}
const md = lines.join("\n");
console.log(md);
const j = opt("json", null);
if (j) writeFileSync(j, JSON.stringify(out, null, 2) + "\n");
