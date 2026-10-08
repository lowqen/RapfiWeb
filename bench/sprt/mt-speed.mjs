#!/usr/bin/env node
/**
 * 멀티스레드 속도 대조 — S1(P2-3 폴스 셰어링 · P2-4 TT 적중 쓰기)처럼 **결과 불변인데 스레드 사이 캐시 경합만 바꾸는** 변경의
 * 순수 속도를 잰다. 고정 깊이 · --det(fixed-depth.mjs)는 1 스레드 전용이다 — 멀티스레드 탐색은 실행마다 트리가 달라 「같은 트리의
 * 시간 비」를 만들 수 없다. 그래서 **같은 시간 탐색의 NPS** 를 짝지어 잰다:
 *
 *   node bench/sprt/mt-speed.mjs --engine "base|<명령줄>" --engine "control|<명령줄>" --engine "test|<명령줄>" …
 *        [--threads 2,4] [--ms 1500] [--repeat 2] [--positions bench/sprt/openings-balanced.json] [--hash-mb 64]
 *        [--limit N] [--out r.json] [--md r.md]
 *
 * - 첫 엔진이 기준. 스레드 수마다 엔진을 모두 새로 띄운다(INFO THREAD_NUM 을 START 앞에 — 재구성 비용이 잼 밖에).
 * - 국면마다 해시를 비우고(YXHASHCLEAR) 수당 <ms> 탐색 — NPS = 마지막 INFO TOTALNODES × 1000 ÷ TOTALTIME(SHOW_DETAIL 3).
 *   멀티 빌드의 요약 줄 Speed 는 믿을 수 없다(M-1 탐침 37628721845).
 * - 엔진 순서는 국면마다 한 칸씩 돌린다 — 러너의 시간 흐름(열 · 클럭)이 한 엔진에 몰리지 않고, 짝(같은 반복 · 같은 국면)의
 *   탐색들은 몇 초 사이로 붙어 있다.
 * - 짝 비 = 시험 NPS ÷ 기준 NPS. 로그 평균 · 표준오차로 기하 평균과 95% 구간. control(기준과 같은 파일)의 구간이 0 을 품어야
 *   하네스를 믿는다.
 * - 엔진이 `MESSAGE LAYOUT …` 줄(tools/patches/p2-3-diag-layout.patch — 측정용)을 찍으면 스레드 수마다 모아 보고에 싣는다.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Engine, LIVE } from "./engine.mjs";

const argv = process.argv.slice(2);
const all = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const opt = (k, d) => all(k).at(-1) ?? d;

const specs = all("engine").map((s) => {
  const i = s.indexOf("|");
  const [cmd, ...args] = s
    .slice(i + 1)
    .trim()
    .split(/\s+/);
  return { name: s.slice(0, i), cmd, args };
});
if (specs.length < 2) {
  console.error(
    '쓰임: node bench/sprt/mt-speed.mjs --engine "기준|명령줄" --engine "시험|명령줄" … [옵션]',
  );
  process.exit(2);
}
const threadsList = opt("threads", "2,4").split(",").map(Number);
const ms = Number(opt("ms", 1500));
const repeat = Number(opt("repeat", 2));
const hashKb = Number(opt("hash-mb", 64)) * 1024;
const positions = opt("positions", "bench/sprt/openings-balanced.json")
  .split(",")
  .flatMap((f) => {
    const j = JSON.parse(readFileSync(f, "utf8"));
    const list = j.openings ?? j.positions ?? j;
    const set = f
      .split(/[\\/]/)
      .pop()
      .replace(/\.json$/, "");
    return list.map((p, i) => ({ id: `${set}:${p.name ?? p.id ?? i}`, moves: p.moves }));
  })
  .slice(0, Number(opt("limit", Infinity)));

/** 한 번 탐색 — 해시를 비우고 수당 ms. 그 수의 마지막 TOTALNODES · TOTALTIME 으로 NPS */
async function measure(e, moves) {
  let nodes = null;
  let time = null;
  const untap = e.tap((l) => {
    const m = /^INFO (TOTALNODES|TOTALTIME) (\d+)/.exec(l);
    if (m) m[1] === "TOTALNODES" ? (nodes = Number(m[2])) : (time = Number(m[2]));
  });
  try {
    await e.send("YXHASHCLEAR");
    await e.send(`INFO TIMEOUT_TURN ${ms}`);
    await e.play(moves, { timeoutMs: ms + 20_000 });
  } finally {
    untap();
  }
  return nodes != null && time > 0 ? { nodes, time, nps: (nodes * 1000) / time } : null;
}

function stats(logs) {
  const n = logs.length;
  const m = logs.reduce((a, x) => a + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(logs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  return { n, ratio: Math.exp(m), lo: Math.exp(m - 1.96 * se), hi: Math.exp(m + 1.96 * se), sd };
}

const rows = []; // { threads, engine, rep, id, nodes, time, nps }
const layout = {}; // `${threads}|${engine}` → 줄들
let code = 0;
const t0 = performance.now();
try {
  for (const threads of threadsList) {
    const engines = [];
    for (const s of specs) {
      const e = new Engine({ ...s, startTimeoutMs: 120_000 });
      const key = `${threads}|${s.name}`;
      e.tap((l) => {
        if (/^MESSAGE LAYOUT /.test(l)) (layout[key] ??= []).push(l.replace(/^MESSAGE /, ""));
      });
      await e.start({
        info: [`INFO HASH_SIZE ${hashKb}`, `INFO THREAD_NUM ${threads}`],
        warmup: true,
      });
      await e.send("INFO SHOW_DETAIL 3");
      // 가중치 · JIT 를 데운다 — 첫 국면의 시간이 한 엔진에만 얹히지 않게 엔진마다 한 번
      await measure(e, positions[0].moves);
      engines.push(e);
    }
    console.log(
      `스레드 ${threads}: 엔진 ${engines.length} · 국면 ${positions.length} × 반복 ${repeat} · 수당 ${ms}ms`,
    );
    let rot = 0;
    for (let rep = 0; rep < repeat; rep++)
      for (const [pi, p] of positions.entries()) {
        const order = engines.map((_, i) => engines[(i + rot) % engines.length]);
        rot++;
        for (const e of order) {
          const r = await measure(e, p.moves);
          if (r) rows.push({ threads, engine: e.name, rep, id: p.id, ...r });
        }
        if ((pi + 1) % 20 === 0)
          console.log(
            `  스레드 ${threads} · 반복 ${rep + 1} · ${pi + 1}/${positions.length} · ${((performance.now() - t0) / 1000).toFixed(0)}s`,
          );
      }
    await Promise.all(engines.map((e) => e.stop()));
  }
} catch (e) {
  console.error(`실패: ${e.stack ?? e}`);
  code = 1;
} finally {
  await Promise.all([...LIVE].map((e) => e.stop()));
}

// ── 보고 ────────────────────────────────────────────────────────────────
const base = specs[0].name;
const out = { base, ms, repeat, positions: positions.length, threads: {}, layout };
const md = [];
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const k = (x) => `${(x / 1000).toFixed(1)}K`;
for (const threads of threadsList) {
  const mine = rows.filter((r) => r.threads === threads);
  const baseRows = new Map(
    mine.filter((r) => r.engine === base).map((r) => [`${r.rep}|${r.id}`, r]),
  );
  const per = {};
  md.push(
    `### 스레드 ${threads} — 짝 비(시험 NPS ÷ ${base} NPS) · 수당 ${ms}ms · 국면 ${positions.length} × 반복 ${repeat}`,
    "",
  );
  md.push(
    "| 엔진 | 평균 NPS | 짝 | NPS 비(기하) | 95% 구간 | **속도 이득** | 빨랐던 짝 | 짝 로그 sd |",
  );
  md.push("|---|---|---|---|---|---|---|---|");
  for (const s of specs) {
    const rs = mine.filter((r) => r.engine === s.name);
    const meanNps = rs.reduce((a, r) => a + r.nps, 0) / Math.max(1, rs.length);
    if (s.name === base) {
      per[s.name] = { meanNps, n: rs.length };
      md.push(`| ${s.name} (기준) | ${k(meanNps)} | ${rs.length} | 1 | — | — | — | — |`);
      continue;
    }
    const pairs = rs.flatMap((r) => {
      const b = baseRows.get(`${r.rep}|${r.id}`);
      return b ? [Math.log(r.nps / b.nps)] : [];
    });
    if (!pairs.length) continue;
    const st = stats(pairs);
    const faster = pairs.filter((x) => x > 0).length;
    per[s.name] = { meanNps, ...st, faster };
    md.push(
      `| ${s.name} | ${k(meanNps)} | ${st.n} | ${st.ratio.toFixed(4)} | ${st.lo.toFixed(4)} ~ ${st.hi.toFixed(4)} | ` +
        `**${pct(st.ratio - 1)}** (${pct(st.lo - 1)} ~ ${pct(st.hi - 1)}) | ${faster}/${st.n} | ${st.sd.toFixed(3)} |`,
    );
  }
  md.push("");
  out.threads[threads] = per;
}
if (threadsList.length > 1) {
  const [a, b] = [threadsList[0], threadsList.at(-1)];
  md.push(`### 스레드 확장 — 평균 NPS ${b} ÷ ${a}`, "", "| 엔진 | 비 |", "|---|---|");
  for (const s of specs) {
    const x = out.threads[a]?.[s.name]?.meanNps;
    const y = out.threads[b]?.[s.name]?.meanNps;
    if (x && y) md.push(`| ${s.name} | ${(y / x).toFixed(3)} |`);
  }
  md.push("");
}
const layoutKeys = Object.keys(layout);
if (layoutKeys.length) {
  md.push("### 캐시 줄 배치(p2-3-diag-layout — 줄 번호 = 주소 >> 6, + 줄 안 오프셋)", "", "```");
  for (const key of layoutKeys) {
    md.push(`[스레드 ${key.replace("|", " · ")}]`);
    for (const l of layout[key]) md.push(`  ${l}`);
  }
  md.push("```", "");
}
md.push(`벽시계 ${((performance.now() - t0) / 60000).toFixed(1)}분 · 탐색 ${rows.length}번`);
const text = md.join("\n");
console.log("\n" + text);
const outFile = opt("out");
if (outFile) {
  mkdirSync(dirname(resolve(outFile)), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ ...out, specs, rows }, null, 1) + "\n");
}
if (opt("md")) writeFileSync(opt("md"), text + "\n");
if (LIVE.size) code = 1;
process.exitCode = code;
