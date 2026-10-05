#!/usr/bin/env node
/**
 * 고정 깊이 대조 — 같은 국면들을 엔진(또는 설정)마다 같은 깊이까지 풀어 노드 · 시간 · NPS · 최선수 · 평가를 맞댄다.
 * 트리를 바꾸는 설정(예: margin_scale — P2-7)의 「싼 확인」: NPS 가 얼마나 오르는지, 그 깊이에서 수 · 평가가 얼마나
 * 그대로인지. Elo 는 말하지 않는다(그것은 SPRT).
 *
 *   node bench/sprt/fixed-depth.mjs --engine "이름|명령줄|cwd" --engine … [--depth 14] [--repeat 2]
 *        [--positions a.json,b.json] [--out r.json]
 *
 * - 해시 비움 · 1 스레드 · MAX_DEPTH 고정 — 노드 수는 CPU 와 무관하게 정해진다(시간만 흔들린다).
 * - 국면마다 엔진 순서를 번갈아(반복마다 뒤집어) 러너의 시간 흐름(데우기 · 열)이 한쪽에 몰리지 않게 한다.
 * - 첫 엔진이 기준이다: 나머지의 노드 · 시간 비(국면별 기하 평균), 최선수 일치율, 평가 차.
 * - 국면 파일: openings-balanced.json(openings) · mate-suite.json · positions.json(positions) — 모두 `moves` 를 쓴다.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Engine, LIVE } from "./engine.mjs";

const argv = process.argv.slice(2);
const all = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const opt = (k, d) => all(k).at(-1) ?? d;
const depth = Number(opt("depth", 14));
const repeat = Number(opt("repeat", 2));
/**
 * `--det` — **엔진끼리 같은 트리**를 보장한다(결과 불변 패치의 순수 속도 대조용).
 * `YXHASHCLEAR` 는 TT 만 비우고 탐색 역사표(ABSearchData)는 남긴다. 기본 예열은 **시간 제한**(50ms)
 * 탐색이라 프로세스마다 예열이 닿은 깊이가 달라 역사표가 갈리고, 그 뒤 모든 트리가 갈린다 — 같은
 * 엔진을 둘로 띄워도 깊이 13 노드 비 0.85 · 최선수 4/5 였다. 그래서: 예열을 **노드 고정**(10만 — V8 최적화 단계까지 데운다)으로,
 * 측정 탐색을 **시간 제한 없이**(`TIMEOUT_TURN 0 · MATCH 0`) — 시간이 탐색에 닿는 곳이 없어진다.
 * 두 엔진이 국면을 같은 순서로 풀므로 역사표도 같은 길을 걷는다(반복 사이에는 달라질 수 있다 — 짝은
 * 같은 반복 안에서 짓는다).
 */
const det = argv.includes("--det");
const files = opt(
  "positions",
  "bench/sprt/openings-balanced.json,bench/gomocalc/mate-suite.json,bench/gomocalc/positions.json",
).split(",");
const specs = all("engine").map((s) => {
  const [name, line, cwd] = s.split("|");
  const [cmd, ...args] = line.trim().split(/\s+/);
  return { name, cmd, args, cwd: cwd ? resolve(cwd) : undefined };
});
if (specs.length < 2) {
  console.error(
    '쓰임: node bench/sprt/fixed-depth.mjs --engine "기준|명령|cwd" --engine "시험|명령|cwd" [옵션]',
  );
  process.exit(2);
}

const positions = files.flatMap((f) => {
  const j = JSON.parse(readFileSync(f, "utf8"));
  const list = j.openings ?? j.positions ?? j;
  return list.map((p, i) => ({
    id: `${f
      .split(/[\\/]/)
      .pop()
      .replace(/\.json$/, "")}:${p.name ?? p.id ?? i}`,
    moves: p.moves,
  }));
});

/** 고정 깊이 한 번 — 마지막 INFO TOTALNODES · 요약 줄의 시간 · 깊이 · 평가 */
async function solve(e, moves) {
  let nodes = null;
  let summary = null;
  const untap = e.tap((l) => {
    const n = /^INFO TOTALNODES (\d+)/.exec(l);
    if (n) nodes = Number(n[1]);
    // Rapfi timeText: 10초 미만은 ms, 그 위는 초 · 분 단위로 내림해 찍는다.
    const s =
      /^MESSAGE Speed \S+ \| Depth (\d+)-\d+ \| Eval (\S+) \| Node \S+ \| Time (\d+)(ms|s|min)\b/.exec(
        l,
      );
    if (s) {
      const ms = Number(s[3]) * { ms: 1, s: 1000, min: 60_000 }[s[4]];
      summary = { depth: Number(s[1]), eval: s[2], ms, coarse: s[4] !== "ms" };
    }
  });
  try {
    await e.send("YXHASHCLEAR");
    const { move } = await e.play(moves, { timeoutMs: 600_000 });
    if (!summary || nodes == null)
      throw new Error(`요약 줄을 못 읽음: ${e.lastLines(4).join(" | ")}`);
    return { move: move.join(","), nodes, ...summary };
  } finally {
    untap();
  }
}

const gm = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
const engines = [];
let code = 0;
const rows = []; // { id, engine, rep, move, nodes, ms, depth, eval }
try {
  for (const s of specs)
    engines.push(
      await new Engine({ ...s, startTimeoutMs: 120_000 }).start({
        info: ["INFO THREAD_NUM 1", "INFO SHOW_DETAIL 3", "INFO HASH_SIZE 131072"],
        warmup: !det,
      }),
    );
  for (const e of engines) {
    if (det) {
      // 시간 무제한 · 노드 고정 예열 — 가중치는 여기서 풀린다(측정에 섞이지 않게).
      await e.send("INFO TIMEOUT_TURN 0");
      await e.send("INFO TIMEOUT_MATCH 0");
      await e.send("INFO MAX_NODE 100000"); // V8 가 뜨거운 함수를 최적화 단계로 올릴 만큼
      await e.play([[7, 7]], { timeoutMs: 120_000 });
    }
    await e.send(`INFO MAX_DEPTH ${depth}`);
    await e.send("INFO MAX_NODE 0");
    if (!det) {
      await e.send("INFO TIMEOUT_TURN 3600000");
      await e.send("INFO TIMEOUT_MATCH 0");
    }
  }
  console.log(
    `국면 ${positions.length}개 × 엔진 ${engines.length} × 반복 ${repeat} · 깊이 ${depth}`,
  );
  const t0 = performance.now();
  for (let rep = 0; rep < repeat; rep++)
    for (const [pi, p] of positions.entries()) {
      const order = (pi + rep) % 2 === 0 ? engines : [...engines].reverse();
      for (const e of order)
        rows.push({ id: p.id, engine: e.name, rep, ...(await solve(e, p.moves)) });
      if ((pi + 1) % 20 === 0)
        console.log(
          `  반복 ${rep + 1} · ${pi + 1}/${positions.length} · ${((performance.now() - t0) / 1000).toFixed(0)}s`,
        );
    }

  // 요약 — 국면마다 반복의 시간 중앙값(노드는 같아야 한다), 기준 대비 비
  const base = specs[0].name;
  const pick = (id, name) => rows.filter((r) => r.id === id && r.engine === name);
  const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const summary = { depth, repeat, positions: positions.length, engines: {} };
  for (const s of specs) {
    const per = positions.map((p) => {
      const rs = pick(p.id, s.name);
      const bs = pick(p.id, base);
      return {
        nodes: rs[0].nodes,
        ms: med(rs.map((r) => r.ms)),
        bNodes: bs[0].nodes,
        bMs: med(bs.map((r) => r.ms)),
        sameMove: rs[0].move === bs[0].move,
        evalDiff:
          /^-?\d+$/.test(rs[0].eval) && /^-?\d+$/.test(bs[0].eval)
            ? Math.abs(Number(rs[0].eval) - Number(bs[0].eval))
            : null,
        nondet: new Set(rs.map((r) => r.nodes)).size > 1,
      };
    });
    const tn = per.reduce((a, r) => a + r.nodes, 0);
    const tms = per.reduce((a, r) => a + r.ms, 0);
    const ed = per.map((r) => r.evalDiff).filter((x) => x != null);
    summary.engines[s.name] = {
      totalNodes: tn,
      totalMs: tms,
      nps: Math.round((tn / tms) * 1000),
      nodeRatio: gm(per.map((r) => r.nodes / r.bNodes)),
      timeRatio: gm(per.map((r) => Math.max(r.ms, 1) / Math.max(r.bMs, 1))),
      npsRatio: gm(per.map((r) => r.nodes / Math.max(r.ms, 1) / (r.bNodes / Math.max(r.bMs, 1)))),
      sameMove: per.filter((r) => r.sameMove).length,
      evalDiffMedian: ed.length ? med(ed) : null,
      evalDiffOver50: ed.filter((x) => x > 50).length,
      nondeterministic: per.filter((r) => r.nondet).length,
    };
  }
  console.log(
    `\n| 엔진 | 노드 합 | 시간 합 | NPS | NPS 비(국면별 기하) | 노드 비 | 깊이 도달 시간 비 | 최선수 같음 | 평가 차 중앙값 · >50 |`,
  );
  console.log(`|---|---|---|---|---|---|---|---|---|`);
  for (const [n, v] of Object.entries(summary.engines))
    console.log(
      `| ${n} | ${v.totalNodes.toLocaleString()} | ${(v.totalMs / 1000).toFixed(1)}s | ${v.nps.toLocaleString()} | ${v.npsRatio.toFixed(3)} | ${v.nodeRatio.toFixed(3)} | ${v.timeRatio.toFixed(3)} | ${v.sameMove}/${positions.length} | ${v.evalDiffMedian ?? "-"} · ${v.evalDiffOver50} |`,
    );
  const nd = Object.values(summary.engines).reduce((a, v) => a + v.nondeterministic, 0);
  if (nd)
    console.log(`⚠ 반복 사이 노드 수가 다른 국면 ${nd}개 — 결정적이어야 한다(해시 · 스레드 확인)`);
  const out = opt("out");
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify({ specs, summary, rows }, null, 1) + "\n");
  }
} catch (e) {
  console.error(`실패: ${e.stack ?? e}`);
  code = 1;
} finally {
  await Promise.all(engines.map((e) => e.stop()));
}
if (LIVE.size) code = 1;
process.exitCode = code;
