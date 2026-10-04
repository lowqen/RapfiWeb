#!/usr/bin/env node
/**
 * M1 보고 — tools/bench_cachegrind.sh 가 남긴 `<엔진>-<search|load>-<LL>[-rep2].json` 묶음을 표로.
 *
 *   node bench/cachegrind/report.mjs DIR [--json summary.json]
 *
 * - **탐색만의 비용 = search − load**(같은 엔진 · 같은 LL). load 는 기동 · 적재 · 예열 · 해시 지우기만 한 같은 대본이다.
 * - 노드당 값은 탐색 노드 합(요약 줄 — 노드 상한에 닿았으면 상한과 같다)으로 나눈다.
 * - 추정 사이클(cg 관례) = Ir + 10·(I1mr + D1mr + D1mw) + 100·(ILmr + DLmr + DLmw) — 미스의 무게를 대략 얹은 값.
 *   절대값은 의미가 없고, 같은 LL 에서 A/B 의 상대 변화만 본다.
 * - 첫 엔진이 기준(A)이다. 결정성: `-rep2` 가 있으면 같은 실행의 Ir 이 비트까지 같은지 본다.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const dir = argv[0];
const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null;
if (!dir) {
  console.error("쓰임: node bench/cachegrind/report.mjs DIR [--json out.json]");
  process.exit(2);
}

const runs = readdirSync(dir)
  .map((f) => /^(.+)-(search|load)-(\d+)(-rep2)?\.json$/.exec(f))
  .filter(Boolean)
  .map(([f, engine, mode, ll, rep]) => ({
    engine,
    mode,
    ll: Number(ll),
    rep: !!rep,
    data: JSON.parse(readFileSync(join(dir, f), "utf8")),
  }));
const order = [];
for (const r of runs) if (!order.includes(r.engine)) order.push(r.engine);
// 기준을 앞으로 — 이름이 base 면 그것이 A
order.sort((a, b) => (a === "base" ? -1 : b === "base" ? 1 : 0));
const lls = [...new Set(runs.map((r) => r.ll))].sort((a, b) => a - b);
const find = (engine, mode, ll, rep = false) =>
  runs.find((r) => r.engine === engine && r.mode === mode && r.ll === ll && r.rep === rep)?.data;

const EV = ["Ir", "I1mr", "ILmr", "Dr", "D1mr", "DLmr", "Dw", "D1mw", "DLmw"];
const sub = (a, b) => Object.fromEntries(EV.map((k) => [k, (a.total[k] ?? 0) - (b.total[k] ?? 0)]));
const cest = (t) => t.Ir + 10 * (t.I1mr + t.D1mr + t.D1mw) + 100 * (t.ILmr + t.DLmr + t.DLmw);
const mb = (b) => `${b / 1024 / 1024}MB`;
const n0 = (x) => Math.round(x).toLocaleString("en-US");
const n1 = (x) => x.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const pct = (a, b) => `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(2)}%`;

const summary = { lls, engines: order, rows: [] };
const out = [];
out.push(`## M1 — cachegrind (탐색만 = search − load)`);
const any = runs.find((r) => r.mode === "search")?.data;
if (any)
  out.push(
    `국면 ${any.count}개(\`${any.positionsFile}\`) × 노드 상한 ${n0(any.nodesBudget)} · 1 스레드 · 해시 16MB · ` +
      `I1 ${any.cache.I1} · D1 ${any.cache.D1} · ${any.valgrind ?? ""}`,
  );
out.push("");

for (const ll of lls) {
  out.push(`### LL ${mb(ll)}`);
  out.push(
    "| 엔진 | 노드 | Ir/노드 | D1 미스/노드 | LL 미스/노드 | LL 미스율(데이터) | 추정 사이클/노드 | Ir/노드 vs A | 사이클/노드 vs A |",
  );
  out.push("|---|---|---|---|---|---|---|---|---|");
  let base = null;
  for (const name of order) {
    const s = find(name, "search", ll);
    const l = find(name, "load", ll);
    if (!s || !l) continue;
    const t = sub(s, l);
    const nodes = s.nodes;
    const row = {
      engine: name,
      ll,
      nodes,
      search: t,
      irPerNode: t.Ir / nodes,
      d1PerNode: (t.D1mr + t.D1mw) / nodes,
      llPerNode: (t.DLmr + t.DLmw) / nodes,
      llDataMissRate: (t.DLmr + t.DLmw) / (t.Dr + t.Dw),
      cestPerNode: cest(t) / nodes,
    };
    base ??= row;
    summary.rows.push(row);
    out.push(
      `| ${name} | ${n0(nodes)} | ${n1(row.irPerNode)} | ${n1(row.d1PerNode)} | ${n1(row.llPerNode)} | ` +
        `${(row.llDataMissRate * 100).toFixed(3)}% | ${n1(row.cestPerNode)} | ` +
        `${row === base ? "—" : pct(row.irPerNode, base.irPerNode)} | ${row === base ? "—" : pct(row.cestPerNode, base.cestPerNode)} |`,
    );
  }
  out.push("");
}

// 결정성
const reps = runs.filter((r) => r.rep);
if (reps.length) {
  out.push("### 결정성 — 같은 빌드 두 번");
  out.push("| 엔진 | LL | Ir (1회) | Ir (2회) | 차 | DLmr (1회 ↔ 2회) |");
  out.push("|---|---|---|---|---|---|");
  for (const r of reps) {
    const a = find(r.engine, r.mode, r.ll);
    const d = r.data.total.Ir - a.total.Ir;
    summary.determinism ??= [];
    summary.determinism.push({ engine: r.engine, ll: r.ll, ir1: a.total.Ir, ir2: r.data.total.Ir });
    out.push(
      `| ${r.engine} | ${mb(r.ll)} | ${n0(a.total.Ir)} | ${n0(r.data.total.Ir)} | ${d === 0 ? "**0**" : `${n0(d)} (${pct(r.data.total.Ir, a.total.Ir)})`} | ${n0(a.total.DLmr)} ↔ ${n0(r.data.total.DLmr)} |`,
    );
  }
  out.push("");
}

// 함수별 — 가장 작은 LL 의 search 런(load 를 빼지 않은 값이지만 탐색 함수에는 load 몫이 거의 없다)
const ll0 = lls[0];
const tops = order.map((n) => ({ n, s: find(n, "search", ll0) })).filter((x) => x.s);
if (tops.length) {
  out.push(`### 함수별 Ir/노드 (LL ${mb(ll0)}, search 런 · 상위)`);
  const names = [...new Set(tops.flatMap((x) => x.s.top.slice(0, 12).map((f) => f.fn)))];
  out.push(
    `| 함수 | ${tops.map((x) => `${x.n} Ir/노드 · DLmr/노드`).join(" | ")} |${tops.length > 1 ? " B vs A |" : ""}`,
  );
  out.push(`|---|${tops.map(() => "---").join("|")}|${tops.length > 1 ? "---|" : ""}`);
  for (const fn of names) {
    const vals = tops.map((x) => x.s.top.find((f) => f.fn === fn));
    const cells = vals.map((v, i) =>
      v ? `${n1(v.Ir / tops[i].s.nodes)} · ${(v.DLmr / tops[i].s.nodes).toFixed(2)}` : "—",
    );
    const short = fn.length > 90 ? fn.slice(0, 87) + "…" : fn;
    let cmp = "";
    if (tops.length > 1)
      cmp =
        vals[0] && vals[1]
          ? ` ${pct(vals[1].Ir / tops[1].s.nodes, vals[0].Ir / tops[0].s.nodes)} |`
          : " — |";
    out.push(`| \`${short.replace(/\|/g, "\\|")}\` | ${cells.join(" | ")} |${cmp}`);
  }
  out.push("");
}

const md = out.join("\n");
console.log(md);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(summary, null, 2) + "\n");
