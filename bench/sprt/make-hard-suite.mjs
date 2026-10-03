#!/usr/bin/env node
/**
 * 하드 필승 묶음(mate-suite-hard.json) 만들기 — docs/최적화-마스터플랜.md 「하드 국면 묶음」 설계.
 * 지금 묶음(mate-suite.json)은 가장 어려운 국면도 ~1.7초에 풀려, 깊은 탐색 변경(P3-1 등)을 재지 못한다.
 * 목표: CI WASM(single-simd128 · 1 스레드 · 해시 128MB)에서 **첫 +M 이 10~60초**에 나오는 국면 30~50개.
 *
 * ## 두 단계 — 네이티브로 고르고(extract), WASM 으로 확인한다(finalize)
 *
 *   node bench/sprt/make-hard-suite.mjs extract --engine "<명령줄>" --cwd dir [옵션] --out candidates.json
 *   (mate-probe 로 candidates.json 을 60초씩 푼다 — SUITE=candidates.json TIME_MS=60000)
 *   node bench/sprt/make-hard-suite.mjs finalize --candidates candidates.json --probe mate-probe결과.json
 *        [--min-ms 10000] [--max-ms 60000] [--keep 50] --out bench/gomocalc/mate-suite-hard.json
 *
 * extract:
 *   0. 후보 — bench/sprt/results/*.jsonl(우리 엔진의 SPRT 기보, RenjuNet 아님)에서 다섯으로 끝난 판의
 *      끝에서 --offsets(기본 11,15,19,23,27,31)수 앞, **이긴 쪽 차례**인 국면. 대칭 대표 키(canonicalKey)로 겹침 제거.
 *      (끝에서 7~9수 앞은 초속기 대국에서 이미 외길이라 2만 노드 안에 다 풀린다 — 로컬 시험 10/10)
 *   A. 거르기: 해시 비움 · 1 스레드 · 노드 --screen-nodes(기본 15만). 여기서 +M 이 나오면 너무 쉬움, −M 이면
 *      둘 차례가 짐 → 버림. 나머지 중 평가(둘 차례 쪽)가 --eval-min 이상인 것을 평가 높은 순으로.
 *   B. 깊게: 위에서 --deep 개(판당 --per-game-deep 개까지)를 노드 --max-nodes(기본 1,100만)까지 — 첫 +M 의 노드를
 *      잰다(보이면 STOP — 나머지는 버리는 시간). [--min-nodes, --max-nodes] 안이면 후보.
 *      노드 창은 CI WASM 속도 ~18.4만 nps(P3-1 mate suite 의 첫 필승에서 잼) × 10~60초. 1 스레드 · 해시 비움 ·
 *      같은 해시 크기면 네이티브와 WASM 의 렌주 탐색 트리가 같다(노드 수가 같다 — B1) — 그래서 네이티브로 고르고
 *      WASM 시간은 마지막에 실제로 잰다.
 * finalize: mate-probe 결과에서 [--min-ms, --max-ms] 에 첫 +M 이 나온 것만, 판당 하나, 쉬운 것부터 어려운 것까지
 *      고르게 --keep 개 → mate-suite.json 과 같은 꼴(positions[].{id, from, source, moves, toMove, mate, kind}).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Engine, LIVE } from "./engine.mjs";
import { canonicalKey, label } from "./openings.mjs";

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const num = (k, d) => Number(opt(k, d));
const write = (file, obj) => {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
};
const parseLabel = (s) => ["abcdefghijklmno".indexOf(s[0]), 15 - Number(s.slice(1))];

if (mode === "extract") await extract();
else if (mode === "finalize") finalize();
else {
  console.error("쓰임: make-hard-suite.mjs extract|finalize [옵션] — 파일 머리 주석 참고");
  process.exit(2);
}

// ── extract ─────────────────────────────────────────────────────────────
async function extract() {
  const P = {
    offsets: opt("offsets", "11,15,19,23,27,31").split(",").map(Number),
    screenNodes: num("screen-nodes", 150_000),
    evalMin: num("eval-min", 250),
    deep: num("deep", 600),
    maxOut: num("max-out", 90),
    perGameDeep: num("per-game-deep", 2),
    minNodes: num("min-nodes", 1_800_000),
    maxNodes: num("max-nodes", 11_000_000),
    concurrency: num("concurrency", 2),
    games: opt("games", "bench/sprt/results"),
    limitGames: num("limit-games", 0),
  };
  const engineLine = opt("engine");
  if (!engineLine) throw new Error("--engine 이 필요합니다");
  const [cmd, ...args] = engineLine.split(/\s+/);
  const cwd = opt("cwd") ? resolve(opt("cwd")) : undefined;
  const out = opt("out", "hard-candidates.json");

  // 0. 후보
  const files = readdirSync(P.games)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  let games = files.flatMap((f) =>
    readFileSync(join(P.games, f), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l, i) => ({ ...JSON.parse(l), src: `${f.replace(/\.jsonl$/, "")}#${i + 1}` })),
  );
  games = games.filter((g) => g.reason === "five" && g.result !== "1/2-1/2");
  if (P.limitGames) games = games.slice(0, P.limitGames);
  const seen = new Set();
  const cands = [];
  for (const g of games) {
    const moves = g.moves.split(" ").map(parseLabel);
    for (const k of P.offsets) {
      if (k % 2 === 0) throw new Error("--offsets 는 홀수여야 이긴 쪽 차례가 된다");
      const m = moves.length - k;
      if (m < 5) continue;
      const pos = moves.slice(0, m);
      const key = canonicalKey(pos);
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push({ game: g.src, offset: k, moves: pos });
    }
  }
  console.log(`[0] 다섯으로 끝난 판 ${games.length}개 → 후보 ${cands.length}개(대칭 겹침 뺌)`);
  console.log(`    매개변수 ${JSON.stringify(P)}`);

  const engines = [];
  let code = 0;
  try {
    for (let i = 0; i < P.concurrency; i++)
      engines.push(
        await new Engine({ name: `hard#${i + 1}`, cmd, args, cwd, startTimeoutMs: 120_000 }).start({
          // mate-probe(lib.mjs setup)와 같은 해시 128MB — 해시 크기가 다르면 트리가 달라진다
          info: ["INFO THREAD_NUM 1", "INFO SHOW_DETAIL 3", "INFO HASH_SIZE 131072"],
          warmup: true,
        }),
      );
    for (const e of engines) {
      await e.send("INFO TIMEOUT_TURN 3600000");
      await e.send("INFO TIMEOUT_MATCH 0");
      await e.send("INFO MAX_DEPTH 200");
    }

    /** 노드 제한 탐색 — 첫 ±M 보고의 노드(그 직전 TOTALNODES)와 마지막 평가. stopOnMate 면 +M 에서 멈춘다 */
    async function probe(e, moves, nodes, stopOnMate) {
      let lastNodes = 0;
      let first = null;
      let ev = null;
      let stopped = false;
      const untap = e.tap((l) => {
        const n = /^INFO (?:TOTAL)?NODES (\d+)/.exec(l);
        if (n) lastNodes = Math.max(lastNodes, Number(n[1]));
        const v = /^INFO EVAL (\S+)/.exec(l);
        if (v) {
          ev = v[1];
          if (!first && /^[+-]M\d+$/.test(ev)) {
            first = { eval: ev, nodes: lastNodes };
            if (stopOnMate && ev.startsWith("+") && !stopped) {
              stopped = true;
              e.send("STOP").catch(() => {});
            }
          }
        }
        const s = /^MESSAGE Speed .*\| Eval (\S+) \|/.exec(l);
        if (s) ev = s[1];
      });
      try {
        await e.send("YXHASHCLEAR");
        await e.send(`INFO MAX_NODE ${nodes}`);
        await e.play(moves, { timeoutMs: 1_800_000 });
        return { first, eval: ev, nodes: lastNodes };
      } finally {
        untap();
      }
    }

    async function pool(items, fn, what) {
      const t0 = performance.now();
      let next = 0;
      let done = 0;
      await Promise.all(
        engines.map(async (e) => {
          for (let i = next++; i < items.length; i = next++) {
            items[i].r = await fn(e, items[i]);
            if (++done % 200 === 0 || done === items.length)
              console.log(
                `  ${what} ${done}/${items.length} · ${((performance.now() - t0) / 60000).toFixed(1)}분`,
              );
          }
        }),
      );
    }

    // A
    await pool(cands, (e, c) => probe(e, c.moves, P.screenNodes, false), "A");
    const counts = { easy: 0, losing: 0, low: 0, open: 0 };
    const open = [];
    for (const c of cands) {
      const f = c.r.first;
      if (f?.eval.startsWith("+")) counts.easy++;
      else if (f?.eval.startsWith("-") || /^-M/.test(c.r.eval ?? "")) counts.losing++;
      else if (!/^-?\d+$/.test(c.r.eval ?? "") || Number(c.r.eval) < P.evalMin) counts.low++;
      else {
        counts.open++;
        open.push(c);
      }
    }
    console.log(
      `[A] ${P.screenNodes}노드: 쉬움(+M) ${counts.easy} · 짐(−M) ${counts.losing} · 평가 ${P.evalMin} 미만 ${counts.low} · 남음 ${counts.open}`,
    );

    // B
    open.sort((a, b) => Number(b.r.eval) - Number(a.r.eval));
    const perGame = new Map();
    const deep = [];
    for (const c of open) {
      if (deep.length >= P.deep) break;
      if ((perGame.get(c.game) ?? 0) >= P.perGameDeep) continue;
      perGame.set(c.game, (perGame.get(c.game) ?? 0) + 1);
      deep.push(c);
    }
    console.log(
      `[B] 깊게 ${deep.length}개 — 최대 ${P.maxNodes.toLocaleString()}노드, 첫 +M 에서 멈춤`,
    );
    await pool(deep, (e, c) => probe(e, c.moves, P.maxNodes, true), "B");
    const hits = deep.filter(
      (c) =>
        c.r.first?.eval.startsWith("+") &&
        c.r.first.nodes >= P.minNodes &&
        c.r.first.nodes <= P.maxNodes,
    );
    const tooEasy = deep.filter(
      (c) => c.r.first?.eval.startsWith("+") && c.r.first.nodes < P.minNodes,
    ).length;
    const none = deep.filter((c) => !c.r.first).length;
    console.log(
      `[B] 창 안 ${hits.length} · 창보다 쉬움 ${tooEasy} · ${P.maxNodes.toLocaleString()}노드까지 필승 없음 ${none}`,
    );

    // 판당 하나 — 같은 판의 이웃 국면은 같은 필승의 앞뒤라 정보가 겹친다
    const byGame = new Map();
    for (const c of hits.sort((a, b) => a.r.first.nodes - b.r.first.nodes))
      if (!byGame.has(c.game)) byGame.set(c.game, c);
    // WASM 확인(국면당 최대 60초)을 잡 시간 안에 — 넘치면 노드 범위에 고르게 뽑는다
    const all = [...byGame.values()];
    const chosen =
      all.length <= P.maxOut
        ? all
        : Array.from(
            { length: P.maxOut },
            (_, i) => all[Math.round((i * (all.length - 1)) / (P.maxOut - 1))],
          );
    write(out, {
      _: "make-hard-suite.mjs extract 의 후보 — mate-probe(SUITE=이 파일, TIME_MS=60000)로 WASM 시간을 잰 뒤 finalize 로 묶는다",
      generatedAt: new Date().toISOString(),
      engine: engines[0].about,
      params: P,
      counts: {
        candidates: cands.length,
        ...counts,
        deep: deep.length,
        inWindow: hits.length,
        tooEasy,
        none,
        oneGame: all.length,
        chosen: chosen.length,
      },
      positions: chosen.map((c, i) => ({
        id: `c${String(i + 1).padStart(3, "0")}`,
        from: c.game,
        source: `offset${c.offset}`,
        moves: c.moves,
        toMove: c.moves.length % 2 === 0 ? "black" : "white",
        mate: c.r.first.eval,
        nativeFirstMateNodes: c.r.first.nodes,
        kind: "hard",
      })),
    });
    console.log(`→ ${out} (${chosen.length}개, 판당 하나)`);
  } catch (e) {
    console.error(`실패: ${e.stack ?? e}`);
    code = 1;
  } finally {
    await Promise.all(engines.map((e) => e.stop()));
  }
  if (LIVE.size) code = 1;
  process.exitCode = code;
}

// ── finalize ────────────────────────────────────────────────────────────
function finalize() {
  const cand = JSON.parse(readFileSync(opt("candidates"), "utf8"));
  const res = JSON.parse(readFileSync(opt("probe"), "utf8"));
  const minMs = num("min-ms", 10_000);
  const maxMs = num("max-ms", 60_000);
  const keep = num("keep", 50);
  const byId = new Map(cand.positions.map((p) => [p.id, p]));
  const solved = res.runs
    .filter((r) => r.solved && r.firstMate.engineMs >= minMs && r.firstMate.engineMs <= maxMs)
    .map((r) => ({ ...byId.get(r.probe), wasm: r.firstMate }))
    .sort((a, b) => a.wasm.engineMs - b.wasm.engineMs);
  // 쉬운 것부터 어려운 것까지 고르게(넘치면 간격을 두고 뽑는다)
  const pick =
    solved.length <= keep
      ? solved
      : Array.from(
          { length: keep },
          (_, i) => solved[Math.round((i * (solved.length - 1)) / (keep - 1))],
        );
  const ratio = solved.map((p) => p.wasm.nodes / p.nativeFirstMateNodes).sort((a, b) => a - b);
  const stats = {
    probed: res.runs.length,
    solvedAny: res.runs.filter((r) => r.solved).length,
    inWindow: solved.length,
    kept: pick.length,
    // 네이티브 ↔ WASM 첫 필승 노드 비 — 트리가 같으면 1 근처
    wasmOverNativeNodes: ratio.length
      ? {
          median: ratio[ratio.length >> 1],
          p10: ratio[Math.floor(ratio.length * 0.1)],
          p90: ratio[Math.floor(ratio.length * 0.9)],
        }
      : null,
  };
  console.log(
    `[finalize] 잰 ${stats.probed} · 60초 안에 풂 ${stats.solvedAny} · ${minMs / 1000}~${maxMs / 1000}초 창 ${stats.inWindow} → ${stats.kept}개`,
  );
  if (stats.wasmOverNativeNodes)
    console.log(`  WASM/네이티브 첫 필승 노드 비 ${JSON.stringify(stats.wasmOverNativeNodes)}`);
  write(opt("out", "bench/gomocalc/mate-suite-hard.json"), {
    _: "make-hard-suite.mjs 가 만든 하드 필승 묶음. 모든 국면은 둘 차례가 이긴다(엔진이 +M 으로 증명). 좌표 (x, y), y 는 위에서 아래로. 첫 수가 흑. CI WASM(single-simd128 · 1 스레드 · 해시 128MB)에서 첫 +M 이 10~60초.",
    generatedAt: new Date().toISOString(),
    generator: `bench/sprt/make-hard-suite.mjs — 후보 ${cand.counts.candidates} → 네이티브 창 ${cand.counts.inWindow} → WASM ${minMs / 1000}~${maxMs / 1000}초 ${stats.inWindow} → ${stats.kept}개`,
    counts: { total: pick.length, ...stats },
    positions: pick.map((p, i) => ({
      id: `h${String(i + 1).padStart(2, "0")}`,
      from: p.from,
      source: p.source,
      moves: p.moves,
      toMove: p.toMove,
      mate: p.wasm.eval ?? p.mate,
      kind: "hard",
      nativeFirstMateNodes: p.nativeFirstMateNodes,
      wasmFirstMate: { ms: p.wasm.engineMs, nodes: p.wasm.nodes, depth: p.wasm.depth },
    })),
  });
  if (pick.length < 20) {
    console.error(
      `묶음이 너무 작습니다(${pick.length}) — 국면별 잡음 ×1.8 에서 20개 미만은 판정력이 낮다(설계 노트)`,
    );
    process.exitCode = 1;
  }
}
