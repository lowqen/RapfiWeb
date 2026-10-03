#!/usr/bin/env node
/**
 * 균형 개시 묶음 만들기 — SPRT 러너의 개시를 「색이 승부를 정하지 않는」 4~5수 국면으로 바꾸려고.
 *
 * 왜: 26개 표준 3수 개시로 수당 100ms 자체 대국을 두면 흑 승률이 64~75% 이고, P3-1 SPRT 에서는 쌍 391개 중
 * 297개가 1 대 1 이었다(두 엔진이 같은 색으로 각각 이김 = 정보 없음). 쌍이 갈리지 않으면 SPRT 는 판을 버린다.
 *
 * 어떻게(엔진의 수와 평가로 넓힌다 — 기보 자료는 쓰지 않는다, 라이선스):
 *   1. 26개 표준 개시마다 넷째 수(백) 후보 — 가운데 (2R+1)² 칸 안, 기존 돌에서 2칸 안의 빈칸 — 를 모두 둔다.
 *   2. 거르기 평가(--screen-nodes, 해시 비움 · 1 스레드 · 노드 고정 → CPU 와 무관하게 같은 값).
 *   3. 개시마다 흑 승률이 0.5 에 가까운 넷째 수 국면 몇 개(--parents)를 골라 다섯째 수(흑) 후보를 같은 방식으로 둔다.
 *   4. 4수 · 5수 후보 중 거르기 승률이 0.5 ± --screen-gap 안인 것을 깊게 다시 평가(--final-nodes).
 *   5. 0.5 ± --max-gap 안인 것만, 대칭(가운데를 지키는 8가지)으로 겹치는 것을 빼고, 출처 개시당 --per-source,
 *      부모 국면당 --per-parent 개까지, 0.5 에 가까운 순서로 --keep 개.
 * 승률은 모두 **흑 쪽에서 본 값**으로 맞춘다(엔진은 둘 차례 쪽 값을 낸다).
 *
 *   node bench/sprt/make-openings.mjs --engine "<명령줄>" [--cwd dir] [--concurrency 2] [--out f.json]
 *        [--screen-nodes 20000] [--final-nodes 500000] [--radius 3] [--parents 6] [--screen-gap 0.15]
 *        [--max-gap 0.08] [--keep 60] [--per-source 4] [--per-parent 2] [--sources a,b] [--no-five]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Engine, LIVE } from "./engine.mjs";
import { canonicalKey, label, standardOpenings } from "./openings.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (k) => argv.includes(`--${k}`);
const num = (k, d) => Number(opt(k, d));
const P = {
  screenNodes: num("screen-nodes", 20000),
  finalNodes: num("final-nodes", 500000),
  radius: num("radius", 3),
  parents: num("parents", 6),
  screenGap: num("screen-gap", 0.15),
  maxGap: num("max-gap", 0.08),
  keep: num("keep", 60),
  perSource: num("per-source", 4),
  perParent: num("per-parent", 2),
  concurrency: num("concurrency", 2),
  five: !flag("no-five"),
};
const engineLine = opt("engine");
if (!engineLine) {
  console.error(
    '쓰임: node bench/sprt/make-openings.mjs --engine "<명령줄>" [옵션] — 파일 머리 주석 참고',
  );
  process.exit(2);
}
const [cmd, ...args] = engineLine.split(/\s+/);
const cwd = opt("cwd") ? resolve(opt("cwd")) : undefined;
const out = opt("out", "bench/sprt/openings-balanced.json");

const STANDARD = standardOpenings();
const sources = opt("sources") ? opt("sources").split(",") : Object.keys(STANDARD);

/** 가운데 상자 안, 기존 돌에서 2칸 안의 빈칸 */
function candidates(moves) {
  const taken = new Set(moves.map(([x, y]) => `${x},${y}`));
  const out = [];
  for (let y = 7 - P.radius; y <= 7 + P.radius; y++)
    for (let x = 7 - P.radius; x <= 7 + P.radius; x++) {
      if (taken.has(`${x},${y}`)) continue;
      if (moves.some(([a, b]) => Math.max(Math.abs(a - x), Math.abs(b - y)) <= 2)) out.push([x, y]);
    }
  return out;
}

/** 흑 쪽 승률 — 엔진은 둘 차례 쪽 값을 낸다. 필승(±M) · 값 없음은 null */
function blackWinrate(moves, r) {
  if (r.winrate == null || !/^-?\d+$/.test(r.eval ?? "")) return null;
  return moves.length % 2 === 0 ? r.winrate : 1 - r.winrate;
}

// ── 엔진 일꾼 ───────────────────────────────────────────────────────────
const engines = [];
async function pool(items, nodes, what) {
  const t0 = performance.now();
  let next = 0;
  let done = 0;
  const results = new Array(items.length);
  await Promise.all(
    engines.map(async (e) => {
      for (let i = next++; i < items.length; i = next++) {
        const r = await e.evaluate(items[i].moves, { nodes });
        results[i] = { ...items[i], eval: r.eval, wr: blackWinrate(items[i].moves, r) };
        if (++done % 100 === 0 || done === items.length)
          console.log(
            `  ${what} ${done}/${items.length} · ${((performance.now() - t0) / 1000).toFixed(0)}s`,
          );
      }
    }),
  );
  return results;
}

const gap = (r) => (r.wr == null ? Infinity : Math.abs(r.wr - 0.5));
const name = (src, extra) => `${src}+${extra.map(label).join("")}`;

let code = 0;
try {
  for (let i = 0; i < P.concurrency; i++)
    engines.push(
      await new Engine({ name: `eval#${i + 1}`, cmd, args, cwd, startTimeoutMs: 120_000 }).start({
        info: ["INFO THREAD_NUM 1", "INFO SHOW_DETAIL 3", "INFO HASH_SIZE 65536"],
      }),
    );
  console.log(`엔진 ${engines.length}개: ${engines[0].about ?? cmd}`);
  console.log(`매개변수 ${JSON.stringify(P)}`);

  // 1. 넷째 수
  const four = [];
  for (const src of sources)
    for (const m of candidates(STANDARD[src]))
      four.push({ source: src, parent: src, moves: [...STANDARD[src], m], name: name(src, [m]) });
  console.log(`[1] 넷째 수 후보 ${four.length}개 — 거르기 ${P.screenNodes}노드`);
  const fourR = await pool(four, P.screenNodes, "넷째");

  // 2. 다섯째 수 — 개시마다 흑 승률이 0.5 에 가까운 넷째 수 국면을 부모로
  let fiveR = [];
  if (P.five) {
    const parents = sources.flatMap((src) =>
      fourR
        .filter((r) => r.source === src && r.wr != null)
        .sort((a, b) => gap(a) - gap(b))
        .slice(0, P.parents),
    );
    const five = parents.flatMap((p) =>
      candidates(p.moves).map((m) => ({
        source: p.source,
        parent: p.name,
        moves: [...p.moves, m],
        name: `${p.name}${label(m)}`,
      })),
    );
    console.log(
      `[2] 부모 ${parents.length}개 → 다섯째 수 후보 ${five.length}개 — 거르기 ${P.screenNodes}노드`,
    );
    fiveR = await pool(five, P.screenNodes, "다섯째");
  }

  // 3. 깊은 평가
  const near = [...fourR, ...fiveR].filter((r) => gap(r) <= P.screenGap);
  const seen = new Set();
  const uniq = near.filter((r) => {
    const k = canonicalKey(r.moves);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(
    `[3] 거르기 통과 ${near.length}개(대칭 겹침 빼면 ${uniq.length}개) — 깊은 평가 ${P.finalNodes}노드`,
  );
  const finalR = await pool(uniq, P.finalNodes, "깊은");

  // 4. 고르기
  const perSource = new Map();
  const perParent = new Map();
  const chosen = [];
  for (const r of finalR.filter((r) => gap(r) <= P.maxGap).sort((a, b) => gap(a) - gap(b))) {
    if ((perSource.get(r.source) ?? 0) >= P.perSource) continue;
    if ((perParent.get(r.parent) ?? 0) >= P.perParent) continue;
    perSource.set(r.source, (perSource.get(r.source) ?? 0) + 1);
    perParent.set(r.parent, (perParent.get(r.parent) ?? 0) + 1);
    chosen.push(r);
    if (chosen.length >= P.keep) break;
  }

  const hist = (rs) => {
    const b = [0, 0, 0, 0, 0, 0];
    for (const r of rs) if (r.wr != null) b[Math.min(5, Math.floor(gap(r) / 0.05))]++;
    return b;
  };
  const stats = {
    four: four.length,
    five: fiveR.length,
    screened: near.length,
    unique: uniq.length,
    chosen: chosen.length,
    sourcesCovered: perSource.size,
    fourStone: chosen.filter((r) => r.moves.length === 4).length,
    fiveStone: chosen.filter((r) => r.moves.length === 5).length,
    // |흑 승률 − 0.5| 를 0.05 칸으로 — 마지막 칸은 0.25 이상
    screenGapHistogram: hist([...fourR, ...fiveR]),
    finalGapHistogram: hist(finalR),
  };
  console.log(
    `[4] 고름 ${chosen.length}개 — 출처 개시 ${perSource.size}/${sources.length} · 4수 ${stats.fourStone} · 5수 ${stats.fiveStone}`,
  );
  console.log(`    거르기 |흑 승률−0.5| 분포(0.05 칸) ${JSON.stringify(stats.screenGapHistogram)}`);
  for (const r of chosen)
    console.log(
      `    ${r.name.padEnd(28)} 흑 승률 ${r.wr.toFixed(3)} · eval ${r.eval} (둘 차례 ${r.moves.length % 2 ? "백" : "흑"})`,
    );

  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        engine: engines[0].about,
        params: P,
        note: "흑 승률은 흑 쪽에서 본 값. 노드 고정 · 해시 비움 · 1 스레드 평가 — bench/sprt/make-openings.mjs",
        stats,
        openings: chosen.map((r) => ({
          name: r.name,
          moves: r.moves,
          blackWinrate: Number(r.wr.toFixed(4)),
          eval: r.eval,
          source: r.source,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`→ ${out}`);
  if (chosen.length < Math.min(P.keep, 20)) {
    console.error(
      `고른 개시가 너무 적습니다(${chosen.length}) — --max-gap · --radius · --parents 를 넓혀 보세요`,
    );
    code = 1;
  }
} catch (e) {
  console.error(`실패: ${e.stack ?? e}`);
  code = 1;
} finally {
  await Promise.all(engines.map((e) => e.stop()));
}
if (LIVE.size) {
  console.error(`엔진 프로세스가 남았습니다: ${LIVE.size}`);
  code = 1;
}
process.exitCode = code;
