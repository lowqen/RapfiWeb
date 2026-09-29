/**
 * 벤치 국면을 만든다 → positions.json (커밋된다. 한 번 만들고 고정한다).
 *
 *   node bench/gomocalc/make-positions.mjs
 *
 * 개시 두 개는 손으로 고른 3수 개시이고, 나머지는 **우리 엔진의 자가 대국**에서 뽑는다:
 *
 *   - 중반: 돌 16개 이상이고 평가가 한쪽으로 기울지 않은(|eval| < 400) 첫 국면
 *   - VCF: 둘 차례가 필승(+M)을 보고하고, 그 수순의 공격 수가 전부 사(四)인 국면
 *          (가장 긴 것 — 수읽기 길이가 벤치의 부하다)
 *   - VCT: 필승이지만 수순에 삼(三)이 섞인 국면(가장 이른 것)
 *
 * 판정은 lib.mjs 의 `classifyWin` — 엔진이 적은 BESTLINE 을 판에 놓아 보며 가른다.
 * 어느 엔진으로 만들었는지가 결과를 치우치게 하지 않도록, 국면은 **만들 때 한 번**
 * 정하고 두 엔진이 같은 파일을 읽는다.
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

const port = 4400 + Math.floor(Math.random() * 100);
const server = await serve(port);
const browser = await chromium.launch();
const games = [];
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/page/index.html`);
  const host = new Host(page);
  await host.load("rapfiweb", "single-simd128");
  await setup(host);
  await host.post("INFO THREAD_NUM 1");

  for (const [name, opening] of Object.entries(OPENINGS)) {
    const moves = opening.map((m) => [...m]);
    const plies = [];
    for (let p = 0; p < MAX_PLIES; p++) {
      const r = await search(host, moves, { timeMs: MOVE_MS });
      plies.push({ stones: moves.length, eval: r.eval, bestline: r.bestline, move: r.move });
      moves.push(r.move);
      const b = boardOf(moves);
      if (makesFive(b, r.move[0], r.move[1])) break;
    }
    games.push({ name, moves, plies });
    console.log(`${name}: ${moves.length}수 · ${moves.map(label).join(" ")}`);
  }
} finally {
  await browser.close();
  server.close();
}

if (process.env.DUMP) await writeFile(process.env.DUMP, JSON.stringify(games));

// ── 고르기 ────────────────────────────────────────────────────────────
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
  { id: "open-direct", note: "3수 직접 개시 h8 h9 i9 (백 차례)", moves: OPENINGS["direct-h8h9i9"] },
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
