#!/usr/bin/env node
/**
 * SPRT 러너 — Gomocup 엔진 둘(A = 시험, B = 기준)을 렌주 26개 표준 개시에서 **색을 바꿔 두 판씩** 맞붙이고,
 * 판이 끝날 때마다 Wald SPRT 의 LLR 을 쌓아 경계를 넘으면 멈춘다. docs/최적화-마스터플랜.md Phase 3 의 선행 작업.
 *
 *   node bench/sprt/runner.mjs --a "<명령줄>" --b "<명령줄>" [옵션]
 *
 * 엔진   --a / --b "<명령줄>"      예: "./engines/test/pbrain-rapfi" · "node bench/sprt/wasm-pbrain.mjs"
 *        --a-cwd / --b-cwd <dir>   엔진이 config.toml · 가중치를 찾는 곳(네이티브 Rapfi 는 cwd 에서 찾는다)
 *        --a-name / --b-name       보고용 이름(기본 A · B)
 *        --a-init / --b-init "<명령>"  START 뒤에 보낼 명령(여러 번 줄 수 있음, 예: "INFO THREAD_NUM 1")
 *        --a-tc / --b-tc "<tc>"    그 엔진만의 시간 제어(--tc 를 덮는다) — 예: 시간 핸디캡으로 러너 · SPRT 를 검증할 때
 *        --referee "<명령줄>"|none  금수(3-3·4-4) 판정용 엔진(기본: --b 와 같은 것을 따로 하나 더 띄움)
 *        --referee-cwd <dir>
 * 대국   --tc "turn=200,match=0,grace=1000" | "nodes=20000"
 *            turn  수당 시간(ms, INFO TIMEOUT_TURN) · match 판당 시간(ms, 0 = 없음 — 있으면 TIME_LEFT 를 매 수 보냄)
 *            nodes 수당 노드(INFO MAX_NODE — 시간과 무관하게 재현 가능한 초속기) · grace 시간 초과 판정 유예
 *        --games N               최대 판 수(쌍 단위로 올림, 기본 200) · --concurrency C 동시 대국(기본 1)
 *        --openings a,b,…        개시 이름(기본 26개 모두 — `--list-openings`) · --seed S 개시 순서 섞기
 *        --openings-file f.json  개시 묶음 파일(make-openings.mjs — 예: bench/sprt/openings-balanced.json). 없으면 26개 표준 개시
 *        --max-plies N           수 제한(넘으면 비김, 기본 225) · --hash-mb M (기본 64) · --threads T (기본 1)
 *        --max-minutes M         시간 예산 — 넘으면 새 쌍을 시작하지 않고 마저 둔 뒤 요약(CI 잡 시간 제한 전에 끝내려고)
 * SPRT   --elo0 0 --elo1 5 --alpha 0.05 --beta 0.05     (로지스틱 Elo · stats.mjs)
 * 출력   --out games.jsonl(판마다 한 줄) · --summary summary.json · --verbose(엔진 출력도 찍음)
 *
 * 종료 코드: 0 = 끝까지 돎(SPRT 결정 여부와 무관), 1 = 치명적 오류(엔진을 띄울 수 없음 · 심판 고장 · 프로세스 누수),
 *            2 = 인자 오류, 130 = 사용자 중단.
 */
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Engine, EngineError, LIVE } from "./engine.mjs";
import { BLACK, Board, WHITE, judgeMove } from "./referee.mjs";
import { label, loadOpenings, standardOpenings } from "./openings.mjs";
import { summarize } from "./stats.mjs";

// ── 인자 ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { "a-init": [], "b-init": [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`알 수 없는 인자: ${a}`);
    const key = a.slice(2);
    if (["verbose", "list-openings", "help"].includes(key)) {
      opts[key] = true;
      continue;
    }
    const val = argv[++i];
    if (val === undefined) throw new Error(`${a} 에 값이 없습니다`);
    if (key === "a-init" || key === "b-init") opts[key].push(val);
    else opts[key] = val;
  }
  return opts;
}

/** 따옴표를 아는 최소한의 명령줄 쪼개기 */
function splitCommand(line) {
  const out = [];
  let cur = "";
  let quote = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) throw new Error(`닫히지 않은 따옴표: ${line}`);
  if (has || cur) out.push(cur);
  return out;
}

function parseTc(text) {
  const tc = { turn: 200, match: 0, nodes: 0, grace: null };
  for (const part of text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [k, v] = part.split("=");
    if (!(k in tc) || !Number.isFinite(Number(v))) throw new Error(`--tc 를 읽을 수 없음: ${part}`);
    tc[k] = Number(v);
  }
  if (tc.nodes > 0 && !/turn=/.test(text)) tc.turn = 60_000; // 노드 제한이면 시간은 안전망만
  tc.grace ??= Math.max(1000, tc.turn);
  return tc;
}

/** 결정적 섞기(mulberry32) */
function shuffled(list, seed) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const opts = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
})();

const OPENINGS = (() => {
  if (!opts["openings-file"]) return standardOpenings();
  try {
    return loadOpenings(JSON.parse(readFileSync(opts["openings-file"], "utf8")));
  } catch (e) {
    console.error(`--openings-file: ${e.message}`);
    process.exit(2);
  }
})();
if (opts["list-openings"]) {
  for (const [n, m] of Object.entries(OPENINGS))
    console.log(`${n.padEnd(16)} ${m.map(label).join(" ")}`);
  process.exit(0);
}
if (opts.help || !opts.a || !opts.b) {
  console.error(
    '쓰임: node bench/sprt/runner.mjs --a "<명령줄>" --b "<명령줄>" [옵션] — 파일 머리 주석 참고',
  );
  process.exit(opts.help ? 0 : 2);
}

let TC, cfg;
try {
  const base = opts.tc ?? "turn=200,match=0";
  TC = { A: parseTc(opts["a-tc"] ?? base), B: parseTc(opts["b-tc"] ?? base) };
  const names = opts.openings
    ? opts.openings.split(",").map((s) => s.trim())
    : Object.keys(OPENINGS);
  for (const n of names) if (!OPENINGS[n]) throw new Error(`없는 개시: ${n} (--list-openings)`);
  cfg = {
    games: Math.max(2, Number(opts.games ?? 200)),
    concurrency: Math.max(1, Number(opts.concurrency ?? 1)),
    maxPlies: Number(opts["max-plies"] ?? 225),
    maxMinutes: Number(opts["max-minutes"] ?? 0),
    hashKb: Number(opts["hash-mb"] ?? 64) * 1024,
    threads: Number(opts.threads ?? 1),
    sprt: {
      elo0: Number(opts.elo0 ?? 0),
      elo1: Number(opts.elo1 ?? 5),
      alpha: Number(opts.alpha ?? 0.05),
      beta: Number(opts.beta ?? 0.05),
    },
    openings: opts.seed != null ? shuffled(names, Number(opts.seed)) : names,
  };
  for (const [k, v] of Object.entries({
    ...cfg.sprt,
    games: cfg.games,
    concurrency: cfg.concurrency,
  }))
    if (!Number.isFinite(v)) throw new Error(`숫자가 아님: --${k}`);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

const log = opts.verbose ? (l) => console.log(`  · ${l}`) : undefined;
const engineSpec = (side) => {
  const [cmd, ...args] = splitCommand(opts[side]);
  return {
    name: opts[`${side}-name`] ?? side.toUpperCase(),
    cmd,
    args,
    cwd: opts[`${side}-cwd`] ? resolve(opts[`${side}-cwd`]) : undefined,
    init: opts[`${side}-init`],
    log,
  };
};
const SPEC = { A: engineSpec("a"), B: engineSpec("b") };
const refereeLine = opts.referee ?? opts.b;
const SPEC_REF =
  refereeLine === "none"
    ? null
    : (() => {
        const [cmd, ...args] = splitCommand(refereeLine);
        const cwd = opts["referee-cwd"] ?? (opts.referee ? undefined : opts["b-cwd"]);
        return { name: "referee", cmd, args, cwd: cwd ? resolve(cwd) : undefined, init: [], log };
      })();

/** 엔진에 넘길 INFO — START 앞(규칙 · 메모리)과 뒤(시간) */
const START_INFO = [`INFO HASH_SIZE ${cfg.hashKb}`, `INFO THREAD_NUM ${cfg.threads}`];
const gameInfo = (tc) => [
  `INFO TIMEOUT_TURN ${tc.turn}`,
  `INFO TIMEOUT_MATCH ${tc.match}`,
  ...(tc.nodes > 0 ? [`INFO MAX_NODE ${tc.nodes}`] : []),
];

// ── 일정 ────────────────────────────────────────────────────────────────
const nPairs = Math.ceil(cfg.games / 2);
const jobs = [];
for (let p = 0; p < nPairs; p++) {
  const opening = cfg.openings[p % cfg.openings.length];
  for (const aBlack of [true, false]) jobs.push({ pair: p, opening, aBlack, index: jobs.length });
}

const tally = { wins: 0, draws: 0, losses: 0, penta: [0, 0, 0, 0, 0] };
const pairScores = new Map(); // pair → A 점수 배열
const startedPairs = new Set();
const records = [];
let stopRequested = false; // SPRT 결정 · 시간 예산 · 사용자 중단 — 새 쌍을 시작하지 않는다
let budgetHit = false;
// SPRT 가 경계를 넘은 순간 — 그 뒤 시작한 쌍을 마저 두면 LLR 이 경계 안으로 돌아올 수 있지만 결정은 그 순간에 난다
let decided = null;
let aborting = false; // 두 번째 Ctrl-C · 치명적 오류 — 진행 중 판도 버린다
let fatal = null;
let nextJob = 0;
let summary = summarize(tally, cfg.sprt);

function takeJob() {
  if (
    cfg.maxMinutes > 0 &&
    !stopRequested &&
    performance.now() - tStart > cfg.maxMinutes * 60_000
  ) {
    stopRequested = budgetHit = true;
    console.log(`  → 시간 예산 ${cfg.maxMinutes}분을 넘었습니다 — 시작한 쌍만 마저 두고 멈춥니다`);
  }
  while (nextJob < jobs.length) {
    const j = jobs[nextJob];
    // 멈출 때는 이미 시작한 쌍의 나머지 판만 둔다 — 오각 표본을 반쪽으로 남기지 않는다.
    if (stopRequested && !startedPairs.has(j.pair)) {
      nextJob++;
      continue;
    }
    nextJob++;
    startedPairs.add(j.pair);
    return j;
  }
  return null;
}

if (opts.out) {
  mkdirSync(dirname(resolve(opts.out)), { recursive: true });
  writeFileSync(opts.out, "");
}

function record(job, result) {
  const aScore = result.winner === null ? 0.5 : (result.winner === BLACK) === job.aBlack ? 1 : 0;
  if (aScore === 1) tally.wins++;
  else if (aScore === 0) tally.losses++;
  else tally.draws++;
  const ps = pairScores.get(job.pair) ?? [];
  ps.push(aScore);
  pairScores.set(job.pair, ps);
  if (ps.length === 2) tally.penta[Math.round((ps[0] + ps[1]) * 2)]++;
  summary = summarize(tally, cfg.sprt);

  const rec = {
    game: records.length + 1,
    pair: job.pair,
    opening: job.opening,
    black: job.aBlack ? SPEC.A.name : SPEC.B.name,
    white: job.aBlack ? SPEC.B.name : SPEC.A.name,
    result: result.winner === null ? "1/2-1/2" : result.winner === BLACK ? "1-0" : "0-1",
    reason: result.reason,
    loser: result.loser ?? null,
    plies: result.moves.length,
    ms: Math.round(result.ms),
    moves: result.moves
      .map(([x, y]) => (x >= 0 && x < 15 && y >= 0 && y < 15 ? label([x, y]) : `(${x},${y})`))
      .join(" "),
    detail: result.detail ?? undefined,
  };
  records.push(rec);
  if (opts.out) appendFileSync(opts.out, JSON.stringify(rec) + "\n");

  const s = summary.sprt;
  console.log(
    `[${String(records.length).padStart(3)}/${jobs.length}] ${job.opening.padEnd(16)} ${rec.black} vs ${rec.white}  ` +
      `${rec.result.padEnd(7)} ${rec.reason.padEnd(10)} ${String(rec.plies).padStart(3)}수 ${(rec.ms / 1000).toFixed(1)}s | ` +
      `A W-D-L ${tally.wins}-${tally.draws}-${tally.losses} · LLR ${s.llr.toFixed(2)} [${s.lower.toFixed(2)}, ${s.upper.toFixed(2)}]`,
  );
  if (s.decision && !stopRequested) {
    stopRequested = true;
    decided = { decision: s.decision, game: records.length, llr: s.llr };
    console.log(`  → SPRT 결정: ${s.decision} 채택 — 시작한 쌍만 마저 두고 멈춥니다`);
  }
}

// ── 한 판 ───────────────────────────────────────────────────────────────
/** @returns {Promise<{ winner, reason, loser?, moves, ms, detail? }>} */
async function playGame(job, eng, referee) {
  const players = { [BLACK]: job.aBlack ? eng.A : eng.B, [WHITE]: job.aBlack ? eng.B : eng.A };
  const tcs = { [BLACK]: job.aBlack ? TC.A : TC.B, [WHITE]: job.aBlack ? TC.B : TC.A };
  const board = new Board(OPENINGS[job.opening]);
  const clock = { [BLACK]: tcs[BLACK].match, [WHITE]: tcs[WHITE].match };
  const t0 = performance.now();
  for (const [e, tc] of [
    [eng.A, TC.A],
    [eng.B, TC.B],
  ]) {
    await e.newGame();
    for (const c of gameInfo(tc)) await e.send(c);
  }
  const judge = {
    forbidden: referee
      ? async (moves) => {
          try {
            return await referee.forbidden(moves);
          } catch (e) {
            throw Object.assign(new Error(`심판 엔진 고장: ${e.message}`), { referee: true });
          }
        }
      : null,
  };
  for (;;) {
    const side = board.toMove;
    const p = players[side];
    const tc = tcs[side];
    const limit = tc.match > 0 ? Math.min(tc.turn, clock[side]) : tc.turn;
    let reply;
    try {
      reply = await p.play(board.moves, {
        timeLeftMs: tc.match > 0 ? clock[side] : null,
        timeoutMs: limit + tc.grace,
      });
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      return {
        winner: side === BLACK ? WHITE : BLACK,
        reason: e.kind === "timeout" ? "timeout" : "crash",
        loser: p.name,
        moves: board.moves,
        ms: performance.now() - t0,
        detail: [e.message, ...p.lastLines(4)],
      };
    }
    if (tc.match > 0) {
      clock[side] -= reply.ms;
      if (clock[side] < -tc.grace)
        return {
          winner: side === BLACK ? WHITE : BLACK,
          reason: "time",
          loser: p.name,
          moves: board.moves,
          ms: performance.now() - t0,
        };
    }
    const end = await judgeMove(board, reply.move, judge, cfg.maxPlies);
    if (end) {
      const loser = end.winner === null ? null : players[end.winner === BLACK ? WHITE : BLACK].name;
      return {
        ...end,
        loser,
        moves: board.moves.concat(end.reason === "illegal" ? [reply.move] : []),
        ms: performance.now() - t0,
        detail: end.reason === "illegal" ? [`불법 수 ${reply.move}`] : undefined,
      };
    }
  }
}

// ── 일꾼 ────────────────────────────────────────────────────────────────
async function ensure(slot, key, spec) {
  if (slot[key]?.alive) return slot[key];
  if (slot[key]) await slot[key].stop();
  for (let attempt = 1; ; attempt++) {
    const e = new Engine({ ...spec, startTimeoutMs: 120_000 });
    try {
      // 심판(R)은 수를 두지 않으니 가중치를 풀 필요가 없다 — YXSHOWFORBID 는 판만 본다.
      slot[key] = await e.start({ info: START_INFO, warmup: key !== "R" });
      return slot[key];
    } catch (err) {
      await e.stop();
      if (err instanceof EngineError && err.kind !== "spawn" && attempt < 2) continue;
      throw Object.assign(
        new Error(
          `${spec.name} 을(를) 띄우지 못했습니다: ${err.message}\n  ${e.lastLines(6).join("\n  ")}`,
        ),
        {
          fatal: true,
        },
      );
    }
  }
}

async function worker(id) {
  const slot = { A: null, B: null, R: null };
  try {
    for (let job = takeJob(); job && !aborting; job = takeJob()) {
      await ensure(slot, "A", { ...SPEC.A, name: SPEC.A.name });
      await ensure(slot, "B", { ...SPEC.B, name: SPEC.B.name });
      if (SPEC_REF) await ensure(slot, "R", { ...SPEC_REF, name: `referee#${id}` });
      let result;
      for (let attempt = 1; ; attempt++) {
        try {
          result = await playGame(job, slot, slot.R);
          break;
        } catch (err) {
          // 새 판 준비(RESTART/INFO) 중 엔진이 죽었거나 심판이 고장 — 그 판은 아직 아무도 두지 않았으니 다시 둔다.
          if (aborting) throw err;
          if (attempt >= 2) throw Object.assign(err, { fatal: true });
          console.log(
            `  ! 일꾼 ${id}: ${err.message} — 이 일꾼의 엔진을 모두 다시 띄우고 같은 판을 다시 둡니다`,
          );
          // 살아 있어도 멈춰 있을 수 있다(RESTART 시간 초과) — 셋 다 갈아 끼운다.
          for (const k of ["A", "B", "R"]) {
            await slot[k]?.stop();
            slot[k] = null;
          }
          await ensure(slot, "A", SPEC.A);
          await ensure(slot, "B", SPEC.B);
          if (SPEC_REF) await ensure(slot, "R", { ...SPEC_REF, name: `referee#${id}` });
        }
      }
      if (aborting) break;
      record(job, result);
      // 시간 초과 · 크래시를 낸 엔진은 다음 판 전에 갈아 끼운다 — 늦게 온 수가 다음 판에 섞이지 않게.
      if (result.reason === "timeout" || result.reason === "crash") {
        for (const k of ["A", "B"]) if (slot[k]?.name === result.loser) await slot[k].stop();
      }
    }
  } catch (err) {
    fatal ??= err;
    aborting = true;
  } finally {
    await Promise.all(Object.values(slot).map((e) => e?.stop()));
  }
}

// ── 신호 ────────────────────────────────────────────────────────────────
let interrupts = 0;
process.on("SIGINT", () => {
  interrupts++;
  if (interrupts === 1) {
    stopRequested = true;
    console.log(
      "\n  ^C — 새 판을 시작하지 않습니다(한 번 더 누르면 진행 중 판을 버리고 엔진을 죽입니다)",
    );
  } else {
    aborting = true;
    for (const e of LIVE) e.child?.kill("SIGKILL");
  }
});

// ── 실행 ────────────────────────────────────────────────────────────────
const bounds = summary.sprt;
console.log(`SPRT  A=${SPEC.A.name}  vs  B=${SPEC.B.name}`);
console.log(
  `  H0 elo=${cfg.sprt.elo0} · H1 elo=${cfg.sprt.elo1} · α=${cfg.sprt.alpha} · β=${cfg.sprt.beta} → LLR 경계 [${bounds.lower.toFixed(3)}, ${bounds.upper.toFixed(3)}]`,
);
console.log(
  `  ${jobs.length}판(${nPairs}쌍 · 개시 ${cfg.openings.length}개 순환) · 동시 ${cfg.concurrency} · ` +
    ["A", "B"]
      .map((k) => {
        const tc = TC[k];
        return (
          `${k} ` +
          (tc.nodes > 0 ? `수당 ${tc.nodes}노드` : `수당 ${tc.turn}ms`) +
          (tc.match > 0 ? ` · 판당 ${tc.match}ms` : "") +
          ` · 유예 ${tc.grace}ms`
        );
      })
      .join(" / ") +
    ` · 심판 ${SPEC_REF ? SPEC_REF.cmd + " " + SPEC_REF.args.join(" ") : "없음(장목만 판정)"}`,
);
const tStart = performance.now();
await Promise.all(
  Array.from({ length: Math.min(cfg.concurrency, jobs.length) }, (_, i) => worker(i + 1)),
);
const wallSec = (performance.now() - tStart) / 1000;

// 누수 확인 — 일꾼이 모두 끝났으면 살아 있는 엔진이 없어야 한다. 닫은 파이프 · 프로세스 핸들이 실제로
// 풀리는 것은 다음 틱이라, 몇 틱 기다린 뒤 센다. ProcessWrap(자식 프로세스 핸들)은 0 이어야 한다.
// PipeWrap 은 러너 자신의 stdout/stderr 가 파이프면(| tee 등) 그만큼 남는 것이 정상이다.
for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 20));
const leaked = [...LIVE].map((e) => `${e.name}(pid ${e.child?.pid})`);
const resources = process
  .getActiveResourcesInfo()
  .reduce((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {});
const ownPipes = [process.stdin, process.stdout, process.stderr].filter(
  (s) => s?._handle?.constructor?.name === "Pipe",
).length;
const childHandles =
  (resources.ProcessWrap ?? 0) + Math.max(0, (resources.PipeWrap ?? 0) - ownPipes);

// ── 요약 ────────────────────────────────────────────────────────────────
const fmt = (x, d = 1) =>
  Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? "+∞" : x === -Infinity ? "−∞" : String(x);
const s = summary;
const reasons = records.reduce((m, r) => ((m[r.reason] = (m[r.reason] ?? 0) + 1), m), {});
console.log("──────────────────────────────────────────────────────────────");
console.log(
  `판 ${s.games} · A ${SPEC.A.name} 기준 W-D-L ${s.wins}-${s.draws}-${s.losses} · 비김 ${fmt(s.drawRatio * 100)}% · ${fmt(wallSec)}s`,
);
console.log(
  `끝난 까닭: ${
    Object.entries(reasons)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ") || "-"
  }`,
);
console.log(
  `오각(쌍 ${s.pentanomial.n}): [${tally.penta.join(", ")}]  (A 쌍 점수 0 · ½ · 1 · 1½ · 2)`,
);
for (const [nm, a] of [
  ["오각", s.pentanomial],
  ["삼항", s.trinomial],
]) {
  if (!a.n) continue;
  console.log(
    `${nm}: 점수 ${fmt(a.score * 100)}% · Elo ${fmt(a.elo)} (95% ${fmt(a.eloLow)} ~ ${fmt(a.eloHigh)}) · LOS ${fmt(a.los * 100)}% · LLR ${fmt(a.llr, 3)}`,
  );
}
console.log(
  `SPRT(${s.sprt.basis}): LLR ${fmt(s.sprt.llr, 3)} / [${fmt(s.sprt.lower, 3)}, ${fmt(s.sprt.upper, 3)}] → ` +
    (decided
      ? `${decided.decision} 채택 — A 가 elo ${decided.decision === "H1" ? `≥ ${cfg.sprt.elo1}` : `≤ ${cfg.sprt.elo0}`} 쪽` +
        ` (${decided.game}판에서 경계를 넘음 · LLR ${fmt(decided.llr, 3)}; 시작한 쌍을 마저 둔 뒤 ${fmt(s.sprt.llr, 3)})`
      : `결정 전(${budgetHit ? "시간 예산" : interrupts ? "사용자 중단" : "판 수 한도"}에서 멈춤)`),
);
console.log(
  `프로세스: 남은 엔진 ${leaked.length}${leaked.length ? " — " + leaked.join(", ") : ""} · 남은 자식 핸들 ${childHandles} · 활성 자원 ${JSON.stringify(resources)}(러너 자신의 파이프 ${ownPipes})`,
);

if (opts.summary) {
  mkdirSync(dirname(resolve(opts.summary)), { recursive: true });
  writeFileSync(
    opts.summary,
    JSON.stringify(
      {
        engines: { A: SPEC.A, B: SPEC.B, referee: SPEC_REF },
        tc: TC,
        cfg,
        summary: s,
        reasons,
        wallSec,
        leaked,
      },
      (k, v) => (k === "log" ? undefined : v),
      2,
    ),
  );
}

if (fatal) {
  console.error(`치명적 오류: ${fatal.message}`);
  process.exit(1);
}
if (leaked.length || childHandles) {
  console.error("엔진 프로세스 · 파이프가 남았습니다 — 누수");
  process.exit(1);
}
process.exitCode = interrupts ? 130 : 0;
