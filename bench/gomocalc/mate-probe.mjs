/**
 * 필승 발견 탐침 — 「언제(시간·깊이·노드) 처음 ±M 을 보고하는가」를 엔진별로 잰다.
 *
 *   node bench/gomocalc/mate-probe.mjs
 *
 * 환경 변수:
 *   ENGINES   gomocalc,rapfiweb       VARIANT  single-simd128      THREADS 1
 *   TIME_MS   30000                   PROBES   midgame,midgame+l9m10,midgame+l9l8
 *   LABEL     mate-probe
 *
 * 국면 이름은 positions.json 의 id 에 `+수순`(사람 표기, 공백 없이)을 붙여 늘린다 —
 * 예: `midgame+l9m10` 은 중반 국면에 흑 l9 · 백 m10 을 더 둔 것. 두 엔진이 갈리는 수(ply 2
 * 의 방어)를 따로 떼어 「그 뒤에도 필승이 있는가」를 묻는 데 쓴다(docs/최적화-마스터플랜.md §1).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { HERE, Host, label, search, serve, setup } from "./lib.mjs";

const list = (v, d) =>
  (v ?? d)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const ENGINES = list(process.env.ENGINES, "gomocalc,rapfiweb");
const VARIANT = process.env.VARIANT ?? "single-simd128";
const THREADS = Number(process.env.THREADS ?? 1);
const TIME_MS = Number(process.env.TIME_MS ?? 30_000);
const PROBES = list(process.env.PROBES, "midgame,midgame+l9m10,midgame+l9l8");
const LABEL = process.env.LABEL ?? "mate-probe";
/** 탐색 앞에 보낼 명령(세미콜론 구분) — 예: `INFO SEARCH_TYPE MCTS`. */
const PRE = list(process.env.PRE?.replaceAll(";", ","), "");

const { positions } = JSON.parse(await readFile(join(HERE, "positions.json"), "utf8"));

/** `h8` → [7,7] */
const parse = (s) => ["abcdefghijklmno".indexOf(s[0]), 15 - Number(s.slice(1))];

function resolveProbe(name) {
  const [id, tail] = name.split("+");
  const base = positions.find((p) => p.id === id);
  if (!base) throw new Error(`국면 없음: ${id}`);
  const extra = tail ? tail.match(/[a-o]\d{1,2}/g).map(parse) : [];
  return { name, moves: [...base.moves, ...extra] };
}

const probes = PROBES.map(resolveProbe);
const port = 4700 + Math.floor(Math.random() * 200);
const server = await serve(port);
const out = {
  label: LABEL,
  pre: PRE,
  variant: VARIANT,
  threads: THREADS,
  timeMs: TIME_MS,
  runs: [],
};
try {
  for (const engine of ENGINES) {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/page/index.html`);
      const host = new Host(page);
      await host.load(engine, VARIANT);
      await setup(host);
      await host.post(`INFO THREAD_NUM ${THREADS}`);
      for (const c of PRE) await host.post(c);
      // 예열 — 가중치 풀기·JIT 승격을 측정에서 뺀다.
      await search(host, positions[0].moves, { timeMs: 3000 });
      for (const p of probes) {
        const s = await search(host, p.moves, { timeMs: TIME_MS });
        const first = Object.entries(s.depthAt).find(([, v]) => /^[+-]M/.test(v.eval ?? ""));
        const row = {
          engine,
          probe: p.name,
          final: s.eval,
          move: label(s.move),
          depth: `${s.depth}-${s.selDepth}`,
          nodes: s.nodes,
          firstMate: first
            ? {
                depth: Number(first[0]),
                engineMs: first[1].engineMs,
                nodes: first[1].nodes,
                eval: first[1].eval,
              }
            : null,
          pv: s.bestline.map(label).join(" "),
          evalByDepth: Object.fromEntries(Object.entries(s.depthAt).map(([d, v]) => [d, v.eval])),
        };
        out.runs.push(row);
        console.log(
          `${engine.padEnd(9)} ${p.name.padEnd(16)} ${String(s.eval).padStart(5)} ${label(s.move)} d${row.depth}` +
            (first
              ? ` · 첫 필승 d${first[0]} ${first[1].engineMs}ms ${first[1].eval}`
              : " · 필승 없음"),
        );
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
await mkdir(join(HERE, "results"), { recursive: true });
await writeFile(join(HERE, "results", `${LABEL}.json`), JSON.stringify(out, null, 2));
