/**
 * 벤치 국면을 만든다. 두 가지 — 둘 다 커밋된다(한 번 만들고 고정한다).
 *
 *   node bench/gomocalc/make-positions.mjs                → positions.json  (run.mjs 의 국면 5개)
 *   node bench/gomocalc/make-positions.mjs --mate-suite   → mate-suite.json (필승 국면 묶음, P1-3)
 *
 * ## positions.json — 벤치 국면 5개
 *
 * 개시 두 개는 손으로 고른 3수 개시이고, 나머지는 **우리 엔진의 자가 대국**에서 뽑는다:
 *
 *   - 중반: 돌 16개 이상이고 평가가 한쪽으로 기울지 않은(|eval| < 400) 첫 국면
 *   - VCF: 둘 차례가 필승(+M)을 보고하고, 그 수순의 공격 수가 전부 사(四)인 국면
 *          (가장 긴 것 — 수읽기 길이가 벤치의 부하다)
 *   - VCT: 필승이지만 수순에 삼(三)이 섞인 국면(가장 이른 것)
 *
 * ## mate-suite.json — 필승 국면 묶음 (docs/최적화-마스터플랜.md P1-3)
 *
 * 국면 하나(midgame +M43)의 일화로는 「약해졌다/아니다」를 가를 수 없다. 렌주 **26개 표준
 * 개시**(3수 — 직접 13 · 간접 13) 각각에서 자가 대국을 두고, 「둘 차례가 이긴다」가 **증명된**
 * 국면을 30~50개 뽑는다. `mate-probe.mjs` 가 이 묶음으로 「첫 필승 보고」의 깊이·시간 중앙값과
 * 실패율을 잰다.
 *
 *   - 자가 대국에서 둘 차례가 처음으로 +M 을 보고한 수(`selfplay`) — 그 대국에서 필승이 처음
 *     보인 자리라 대국 안에서 가장 어렵다.
 *   - 그보다 **같은 쪽 차례로 1~BACK 수 앞**(`verify`) — 자가 대국의 짧은 시간에는 못 봤지만
 *     `VERIFY_MS` 의 긴 탐색이 +M 을 증명한 국면. 묶음에서 가장 어려운 몫이다. 증명되지 않은
 *     국면은 넣지 않는다(필승이 아닌 국면을 「못 찾았다」고 세면 실패율이 거짓이 된다).
 *   - 그래도 MIN 에 모자라면 필승 연속 구간의 다음 공격 차례(`followup`, 더 짧은 필승)로 채운다.
 *
 * 국면은 RenjuNet 기보가 아니라 **우리 엔진의 자가 대국**에서만 나온다(기보 자료는 라이선스상
 * 커밋할 수 없다). 엔진의 Rapfi ±M 은 탐색이 증명한 값이다.
 *
 * 판정은 lib.mjs 의 `classifyWin` — 엔진이 적은 BESTLINE 을 판에 놓아 보며 가른다.
 * 어느 엔진으로 만들었는지가 결과를 치우치게 하지 않도록, 국면은 **만들 때 한 번**
 * 정하고 두 엔진이 같은 파일을 읽는다.
 *
 * 환경 변수: MOVE_MS 400(수당) · VERIFY_MS 4000 · BACK 2 · MIN 30 · MAX 50 · MIN_MATE 5 ·
 *           GAMES(개시 이름 쉼표 구분 — 일부만) · DUMP(자가 대국 원본을 이 경로에)
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  HERE,
  Host,
  boardOf,
  classifyWin,
  label,
  makesFive,
  mateOf,
  search,
  serve,
  setup,
} from "./lib.mjs";

const MATE_SUITE = process.argv.includes("--mate-suite");
const MOVE_MS = Number(process.env.MOVE_MS ?? 400);
const MAX_PLIES = 80;

// 3수 개시(흑 h8 · 백 · 흑). 좌표는 (x, y), y 는 위에서 아래로.
const OPENINGS = {
  "direct-h8h9i9": [
    [7, 7],
    [7, 6],
    [8, 6],
  ],
  "indirect-h8i9j8": [
    [7, 7],
    [8, 6],
    [9, 7],
  ],
  "direct-h8h9h10": [
    [7, 7],
    [7, 6],
    [7, 5],
  ],
  "indirect-h8i9i7": [
    [7, 7],
    [8, 6],
    [8, 8],
  ],
};

/**
 * 렌주 26개 표준 개시 — 흑 h8 · 백 h9(직접) 또는 i9(간접) 뒤, 셋째 수를 천원 둘레 5×5 안에
 * 두는 자리를 **대칭으로 묶은 것**이 정확히 13 + 13 이다. 직접은 h 줄 거울(x → 14 − x),
 * 간접은 h8–i9 대각선 거울((x, y) → (14 − y, 14 − x))이 앞의 두 돌을 그대로 둔다.
 */
function standardOpenings() {
  const out = {};
  const bases = {
    direct: { two: [7, 6], mirror: ([x, y]) => [14 - x, y] },
    indirect: { two: [8, 6], mirror: ([x, y]) => [14 - y, 14 - x] },
  };
  const key = ([x, y]) => y * 15 + x;
  for (const [kind, { two, mirror }] of Object.entries(bases)) {
    let n = 0;
    for (let y = 5; y <= 9; y++) {
      for (let x = 5; x <= 9; x++) {
        if ((x === 7 && y === 7) || (x === two[0] && y === two[1])) continue;
        if (key([x, y]) > key(mirror([x, y]))) continue; // 거울상 쪽이 대표
        out[`${kind}-${label([x, y])}`] = [[7, 7], two, [x, y]];
        n++;
      }
    }
    if (n !== 13) throw new Error(`${kind} 개시가 13개가 아닙니다: ${n}`);
  }
  return out;
}

/** 한 판을 끝까지(오목 또는 MAX_PLIES) 둔다. 수마다 평가·수순을 적는다. */
async function selfPlay(host, opening) {
  const moves = opening.map((m) => [...m]);
  const plies = [];
  for (let p = 0; p < MAX_PLIES; p++) {
    const r = await search(host, moves, { timeMs: MOVE_MS });
    plies.push({ stones: moves.length, eval: r.eval, bestline: r.bestline, move: r.move });
    moves.push(r.move);
    const b = boardOf(moves);
    if (makesFive(b, r.move[0], r.move[1])) break;
  }
  return { moves, plies };
}

const openings = MATE_SUITE ? standardOpenings() : OPENINGS;
const only = (process.env.GAMES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const chosen = Object.entries(openings).filter(([n]) => !only.length || only.includes(n));
if (process.argv.includes("--list")) {
  for (const [n, m] of Object.entries(openings)) console.log(`${n}  ${m.map(label).join(" ")}`);
  process.exit(0);
}
if (!chosen.length) throw new Error(`GAMES 와 맞는 개시가 없습니다 — --list 로 이름을 보세요`);

const port = 4400 + Math.floor(Math.random() * 100);
const server = await serve(port);
const browser = await chromium.launch();
const games = [];
/** 필승 묶음 모드에서 쓴다 — 자가 대국이 끝난 뒤 검증 탐색도 같은 엔진으로. */
let host = null;
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/page/index.html`);
  host = new Host(page);
  await host.load("rapfiweb", "single-simd128");
  await setup(host);
  await host.post("INFO THREAD_NUM 1");

  for (const [name, opening] of chosen) {
    const t0 = Date.now();
    const g = await selfPlay(host, opening);
    games.push({ name, ...g });
    console.log(
      `${name}: ${g.moves.length}수 · ${((Date.now() - t0) / 1000).toFixed(0)}초 · ` +
        g.moves.map(label).join(" "),
    );
  }

  if (process.env.DUMP) await writeFile(process.env.DUMP, JSON.stringify(games));
  if (MATE_SUITE) await writeMateSuite(host, games);
} finally {
  await browser.close();
  server.close();
}

if (!MATE_SUITE) await writeBenchPositions(games);

// ── positions.json ────────────────────────────────────────────────────

async function writeBenchPositions(games) {
  const picked = {};
  const at = (g, p) => g.moves.slice(0, g.plies[p].stones);

  for (const g of games) {
    for (let p = 0; p < g.plies.length && !picked.midgame; p++) {
      const e = Number(g.plies[p].eval);
      if (g.plies[p].stones >= 16 && Number.isFinite(e) && Math.abs(e) < 400) {
        picked.midgame = { from: g.name, moves: at(g, p), eval: g.plies[p].eval };
      }
    }
  }

  let bestVcf = null;
  let firstVct = null;
  for (const g of games) {
    for (let p = 0; p < g.plies.length; p++) {
      const ply = g.plies[p];
      const mate = mateOf(ply.eval);
      if (!mate || mate < 0) continue;
      const kind = classifyWin(at(g, p), ply.bestline, mate);
      const cand = { from: g.name, moves: at(g, p), eval: ply.eval, line: ply.bestline, kind };
      if (kind === "VCF" && (!bestVcf || mate > mateOf(bestVcf.eval))) bestVcf = cand;
      if (kind === "VCT" && !firstVct) firstVct = cand;
    }
  }
  if (bestVcf) picked.vcf = bestVcf;
  if (firstVct) picked.vct = firstVct;

  const positions = [
    {
      id: "open-direct",
      note: "3수 직접 개시 h8 h9 i9 (백 차례)",
      moves: OPENINGS["direct-h8h9i9"],
    },
    {
      id: "open-indirect",
      note: "3수 간접 개시 h8 i9 j8 (백 차례)",
      moves: OPENINGS["indirect-h8i9j8"],
    },
  ];
  if (picked.midgame) {
    positions.push({
      id: "midgame",
      note: `중반 ${picked.midgame.moves.length}수 — ${picked.midgame.from} 자가 대국, 생성 시 평가 ${picked.midgame.eval}`,
      moves: picked.midgame.moves,
    });
  }
  for (const k of ["vcf", "vct"]) {
    const c = picked[k];
    if (!c) {
      console.log(`! ${k.toUpperCase()} 국면을 찾지 못했습니다`);
      continue;
    }
    positions.push({
      id: k,
      note: `${c.kind} ${c.moves.length}수 — 둘 차례 ${c.eval}, 수순 ${c.line.map(label).join(" ")}`,
      moves: c.moves,
    });
  }

  await writeFile(
    join(HERE, "positions.json"),
    JSON.stringify(
      {
        _: "make-positions.mjs 가 만든 벤치 국면. 좌표 (x, y), y 는 위에서 아래로. 첫 수가 흑.",
        generatedAt: new Date().toISOString(),
        generator: `rapfiweb single-simd128 자가 대국, 수당 ${MOVE_MS}ms`,
        positions,
      },
      null,
      2,
    ),
  );
  for (const p of positions) console.log(`${p.id}: ${p.note}`);
}

// ── mate-suite.json ───────────────────────────────────────────────────

async function writeMateSuite(host, games) {
  const VERIFY_MS = Number(process.env.VERIFY_MS ?? 4000);
  const BACK = Number(process.env.BACK ?? 2);
  const MIN = Number(process.env.MIN ?? 30);
  const MAX = Number(process.env.MAX ?? 50);
  const MIN_MATE = Number(process.env.MIN_MATE ?? 5);

  const seen = new Set();
  const keyOf = (moves) => moves.map(([x, y]) => `${x},${y}`).join(" ");
  const suite = [];
  const add = (g, moves, mate, line, source, extra = {}) => {
    const k = keyOf(moves);
    if (seen.has(k)) return false;
    seen.add(k);
    suite.push({
      from: g.name,
      source,
      moves,
      toMove: moves.length % 2 === 0 ? "black" : "white",
      mate: `+M${mate}`,
      kind: classifyWin(moves, line, mate),
      line: line.map(label).join(" "),
      ...extra,
    });
    return true;
  };

  // 대국마다: 둘 차례가 처음으로 +M(MIN_MATE 이상)을 본 수.
  const firsts = [];
  for (const g of games) {
    const p = g.plies.findIndex((pl) => (mateOf(pl.eval) ?? 0) >= MIN_MATE);
    if (p < 0) {
      console.log(`  ${g.name}: 필승 보고 없음(${g.plies.length}수 동안)`);
      continue;
    }
    firsts.push({ g, p });
    const ply = g.plies[p];
    add(g, g.moves.slice(0, ply.stones), mateOf(ply.eval), ply.bestline, "selfplay", {
      foundMs: MOVE_MS,
    });
  }

  // 그보다 같은 쪽 차례로 앞선 국면 — 긴 탐색이 증명하면 넣는다(가장 어려운 몫).
  for (const { g, p } of firsts) {
    for (let back = 1; back <= BACK; back++) {
      const q = p - 2 * back;
      if (q < 0) break;
      const moves = g.moves.slice(0, g.plies[q].stones);
      const r = await search(host, moves, { timeMs: VERIFY_MS });
      const mate = mateOf(r.eval);
      const ok = mate !== null && mate >= MIN_MATE;
      console.log(
        `  ${g.name} −${back}: ${r.eval}` +
          (ok ? ` ✓ 증명(${r.firstMate?.engineMs ?? "?"}ms)` : " — 증명 못 함, 넣지 않음"),
      );
      if (!ok) break; // 이보다 앞은 더 멀다
      add(g, moves, mate, r.bestline, "verify", { foundMs: r.firstMate?.engineMs ?? null });
    }
  }

  // 모자라면 필승 연속 구간의 다음 공격 차례로 채운다(짧은 필승 — 쉬운 몫).
  for (const { g, p } of firsts) {
    if (suite.length >= MIN) break;
    for (let q = p + 2; q < g.plies.length && suite.length < MIN; q += 2) {
      const ply = g.plies[q];
      const mate = mateOf(ply.eval);
      if (mate === null || mate < MIN_MATE) break;
      add(g, g.moves.slice(0, ply.stones), mate, ply.bestline, "followup", { foundMs: MOVE_MS });
    }
  }

  // 넘치면 어려운 몫부터 남긴다.
  const rank = { verify: 0, selfplay: 1, followup: 2 };
  suite.sort((a, b) => rank[a.source] - rank[b.source]);
  const kept = suite.slice(0, MAX);
  if (kept.length < MIN) {
    console.log(
      `! 필승 국면이 ${kept.length}개 — 목표 ${MIN} 에 모자랍니다(BACK·MOVE_MS 를 늘려 보세요)`,
    );
  }
  const positions = kept.map((s, i) => ({ id: `m${String(i + 1).padStart(2, "0")}`, ...s }));
  const count = (k, v) => positions.filter((p) => p[k] === v).length;

  await writeFile(
    join(HERE, "mate-suite.json"),
    JSON.stringify(
      {
        _:
          "make-positions.mjs --mate-suite 가 만든 필승 국면 묶음(P1-3). 모든 국면은 둘 차례가 이긴다" +
          "(엔진이 ±M 으로 증명). 좌표 (x, y), y 는 위에서 아래로. 첫 수가 흑.",
        generatedAt: new Date().toISOString(),
        generator:
          `rapfiweb single-simd128 · 1 스레드 · 26개 표준 개시 자가 대국 수당 ${MOVE_MS}ms · ` +
          `검증 ${VERIFY_MS}ms · 앞선 국면 ${BACK}수까지 · 필승 거리 ${MIN_MATE} 이상`,
        counts: {
          total: positions.length,
          verify: count("source", "verify"),
          selfplay: count("source", "selfplay"),
          followup: count("source", "followup"),
          VCF: count("kind", "VCF"),
          VCT: count("kind", "VCT"),
          unknown: count("kind", "unknown"),
        },
        positions,
      },
      null,
      2,
    ),
  );
  console.log(
    `mate-suite.json: ${positions.length}개 — 검증 ${count("source", "verify")} · 자가 대국 ` +
      `${count("source", "selfplay")} · 보충 ${count("source", "followup")} / ` +
      `VCF ${count("kind", "VCF")} · VCT ${count("kind", "VCT")} · 미판정 ${count("kind", "unknown")}`,
  );
}
