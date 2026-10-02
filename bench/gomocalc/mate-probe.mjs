/**
 * 필승 발견 탐침 — 「언제(시간·깊이·노드) 처음 ±M 을 보고하는가」를 엔진별로 잰다.
 *
 *   node bench/gomocalc/mate-probe.mjs                         # 필승 국면 묶음(mate-suite.json)
 *   PROBES=midgame,midgame+l9m10 node bench/gomocalc/mate-probe.mjs   # 낱 국면(예전 방식)
 *   node bench/gomocalc/mate-probe.mjs --report a.json b.json  # 결과 파일끼리 비교표(버전 간)
 *
 * 환경 변수:
 *   ENGINES   gomocalc,rapfiweb       VARIANT  single-simd128      THREADS 1
 *   TIME_MS   묶음 10000 · 낱 국면 30000
 *   SUITE     mate-suite.json         LIMIT    (앞에서 N개만)      IDS  (m01,m07 … 골라서)
 *   PROBES    (주면 낱 국면 모드)     LABEL    mate-suite · mate-probe
 *   PRE       탐색 앞에 보낼 명령(세미콜론 구분) — 예: `INFO SEARCH_TYPE MCTS`
 *
 * ## 묶음 모드 — P1-3 의 지표 (docs/최적화-마스터플랜.md §5.1 「첫 필승 시간」)
 *
 * mate-suite.json 의 국면은 모두 **둘 차례가 이긴다**(만들 때 엔진이 증명했다). 국면마다:
 *   - 풀었다 = 제한 시간 안에 **+M** 을 보고했다. 그 첫 보고의 깊이·엔진 시간·노드를 적는다.
 *   - 실패   = +M 이 없었다(−M 을 보고했으면 「부호 틀림」으로 따로 센다 — 고장 신호다).
 * 엔진마다 실패율과 첫 필승의 깊이·시간 **중앙값**(푼 국면만)·p90, 그리고 실패를 「제한 초과」로
 * 넣은 **전체 중앙값**을 낸다. 트리를 바꾸는 변경은 이 전체 중앙값이 나빠지지 않아야 한다(§5.3).
 *
 * ## 낱 국면 모드
 *
 * 국면 이름은 positions.json 의 id 에 `+수순`(사람 표기, 공백 없이)을 붙여 늘린다 —
 * 예: `midgame+l9m10` 은 중반 국면에 흑 l9 · 백 m10 을 더 둔 것. 두 엔진이 갈리는 수(ply 2
 * 의 방어)를 따로 떼어 「그 뒤에도 필승이 있는가」를 묻는 데 쓴다(docs/최적화-마스터플랜.md §1).
 *
 * 첫 필승은 lib.mjs `search` 의 `firstMate` — 처음으로 ±M 을 보고한 PV 블록이다(깊이마다 첫
 * 보고만 보던 예전 결과 파일보다 같은 깊이 안의 늦은 필승을 한 깊이 일찍 잡는다).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { chromium } from "playwright";
import { HERE, Host, label, search, serve, setup } from "./lib.mjs";

const list = (v, d) =>
  (v ?? d)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// ── 통계 ─────────────────────────────────────────────────────────────

/** 정렬된 수열의 분위수(가까운 순위). 비면 null. */
function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

/** 묶음 결과(한 엔진의 줄들) → 지표. 실패는 「제한 초과」(Infinity)로 전체 중앙값에 넣는다. */
function summarize(rows) {
  const solved = rows.filter((r) => r.solved);
  const ms = solved.map((r) => r.firstMate.engineMs ?? r.firstMate.wallMs);
  const all = rows.map((r) =>
    r.solved ? (r.firstMate.engineMs ?? r.firstMate.wallMs) : Infinity,
  );
  return {
    n: rows.length,
    solved: solved.length,
    failed: rows.length - solved.length,
    wrongSign: rows.filter((r) => r.wrongSign).length,
    failRate: rows.length ? (rows.length - solved.length) / rows.length : null,
    medianMs: quantile(ms, 0.5),
    p90Ms: quantile(ms, 0.9),
    medianMsAll: quantile(all, 0.5),
    medianDepth: quantile(
      solved.map((r) => r.firstMate.depth),
      0.5,
    ),
    medianNodes: quantile(
      solved.map((r) => r.firstMate.nodes).filter((n) => n != null),
      0.5,
    ),
  };
}

const fmtMs = (v, limit) =>
  v == null ? "—" : v === Infinity ? `>${limit / 1000}s` : `${(v / 1000).toFixed(2)}s`;
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const table = (head, rows) =>
  [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

/** 결과 파일 하나 이상 → 마크다운(엔진 요약 + 국면별 첫 필승). 열 = (라벨, 엔진). */
function renderMarkdown(results) {
  const cols = [];
  for (const R of results) {
    for (const engine of [...new Set(R.runs.map((r) => r.engine))]) {
      cols.push({
        name: results.length > 1 ? `${R.label}/${engine}` : engine,
        R,
        rows: R.runs.filter((r) => r.engine === engine),
      });
    }
  }
  const out = [];
  const first = results[0];
  out.push(
    `## 필승 국면 묶음 — ${results.map((R) => R.label).join(" ↔ ")}`,
    "",
    `- 묶음 ${first.suite?.file ?? "—"} (${first.suite?.generatedAt ?? "?"}) · 변형 ${first.variant} · ` +
      `스레드 ${first.threads} · 국면당 ${first.timeMs}ms`,
    "",
    table(
      ["엔진", "국면", "풀었다", "실패율", "부호 틀림", "첫 필승 중앙값", "p90", "전체 중앙값", "깊이 중앙값", "노드 중앙값"],
      cols.map(({ name, R, rows }) => {
        const s = summarize(rows);
        return [
          name,
          s.n,
          s.solved,
          pct(s.failRate),
          s.wrongSign,
          fmtMs(s.medianMs, R.timeMs),
          fmtMs(s.p90Ms, R.timeMs),
          fmtMs(s.medianMsAll, R.timeMs),
          s.medianDepth ?? "—",
          s.medianNodes ?? "—",
        ];
      }),
    ),
    "",
  );
  const ids = [...new Set(cols.flatMap((c) => c.rows.map((r) => r.probe)))];
  const meta = new Map(first.runs.map((r) => [r.probe, r]));
  out.push(
    "### 국면별 첫 필승 (엔진 시간 · 깊이 — ✗ 는 제한 안에 +M 없음)",
    "",
    table(
      ["국면", "종류", "출처", ...cols.map((c) => c.name)],
      ids.map((id) => [
        id,
        meta.get(id)?.kind ?? "—",
        meta.get(id)?.source ?? "—",
        ...cols.map(({ rows }) => {
          const r = rows.find((x) => x.probe === id);
          if (!r) return "";
          if (!r.solved) return r.wrongSign ? `✗ (${r.firstMate.eval})` : `✗ ${r.final ?? ""}`;
          const f = r.firstMate;
          return `${fmtMs(f.engineMs ?? f.wallMs)} d${f.depth}`;
        }),
      ]),
    ),
  );
  return out.join("\n");
}

// ── 비교 리포트만 ────────────────────────────────────────────────────

if (process.argv[2] === "--report") {
  const files = process.argv.slice(3);
  if (!files.length) {
    console.error("사용: node mate-probe.mjs --report <결과.json> [다른 결과.json …]");
    process.exit(2);
  }
  const results = await Promise.all(files.map(async (f) => JSON.parse(await readFile(f, "utf8"))));
  const bad = files.filter((_, i) => results[i].mode !== "suite");
  if (bad.length) {
    console.error(`묶음 모드 결과가 아닙니다: ${bad.join(", ")}`);
    process.exit(2);
  }
  console.log(renderMarkdown(results));
  process.exit(0);
}

// ── 측정 ─────────────────────────────────────────────────────────────

const SUITE_MODE = process.env.PROBES === undefined;
const ENGINES = list(process.env.ENGINES, "gomocalc,rapfiweb");
const VARIANT = process.env.VARIANT ?? "single-simd128";
const THREADS = Number(process.env.THREADS ?? 1);
const TIME_MS = Number(process.env.TIME_MS ?? (SUITE_MODE ? 10_000 : 30_000));
const LABEL = process.env.LABEL ?? (SUITE_MODE ? "mate-suite" : "mate-probe");
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

let suite = null;
let probes;
if (SUITE_MODE) {
  const file = process.env.SUITE ?? join(HERE, "mate-suite.json");
  suite = JSON.parse(await readFile(file, "utf8"));
  const ids = list(process.env.IDS, "");
  let ps = suite.positions.filter((p) => !ids.length || ids.includes(p.id));
  if (process.env.LIMIT) ps = ps.slice(0, Number(process.env.LIMIT));
  if (!ps.length) throw new Error("고른 국면이 없습니다(IDS·LIMIT 확인)");
  probes = ps.map((p) => ({ name: p.id, moves: p.moves, meta: p }));
  suite = { file: basename(file), generatedAt: suite.generatedAt, generator: suite.generator };
  console.log(
    `묶음 ${suite.file}: ${probes.length}개 · 국면당 ${TIME_MS}ms · ${ENGINES.join(", ")}`,
  );
} else {
  probes = list(process.env.PROBES, "").map(resolveProbe);
}

const port = 4700 + Math.floor(Math.random() * 200);
const server = await serve(port);
const out = {
  label: LABEL,
  mode: SUITE_MODE ? "suite" : "probes",
  suite,
  pre: PRE,
  variant: VARIANT,
  threads: THREADS,
  timeMs: TIME_MS,
  startedAt: new Date().toISOString(),
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
        const fm = s.firstMate;
        const row = {
          engine,
          probe: p.name,
          final: s.eval,
          move: label(s.move),
          depth: `${s.depth}-${s.selDepth}`,
          nodes: s.nodes,
          firstMate: fm,
          pv: s.bestline.map(label).join(" "),
          evalByDepth: Object.fromEntries(Object.entries(s.depthAt).map(([d, v]) => [d, v.eval])),
        };
        if (SUITE_MODE) {
          // 묶음의 국면은 모두 둘 차례가 이긴다 — +M 을 보고해야 「풀었다」.
          Object.assign(row, {
            kind: p.meta.kind,
            source: p.meta.source,
            expected: p.meta.mate,
            solved: Boolean(fm && fm.eval.startsWith("+")),
            wrongSign: Boolean(fm && fm.eval.startsWith("-")),
          });
        }
        out.runs.push(row);
        console.log(
          `${engine.padEnd(9)} ${p.name.padEnd(16)} ${String(s.eval).padStart(5)} ${label(s.move)} d${row.depth}` +
            (fm ? ` · 첫 필승 d${fm.depth} ${fm.engineMs}ms ${fm.eval}` : " · 필승 없음"),
        );
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
out.finishedAt = new Date().toISOString();
await mkdir(join(HERE, "results"), { recursive: true });
await writeFile(join(HERE, "results", `${LABEL}.json`), JSON.stringify(out, null, 2));
if (SUITE_MODE) {
  const md = renderMarkdown([out]);
  await writeFile(join(HERE, "results", `${LABEL}.md`), md + "\n");
  console.log("\n" + md);
}
