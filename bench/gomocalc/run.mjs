/**
 * gomocalc 엔진 대 Zenyth Web 엔진 — 같은 호스트·같은 국면·같은 명령으로 잰다.
 *
 *   node bench/gomocalc/fetch-engines.mjs          # 한 번
 *   node bench/gomocalc/run.mjs [옵션]
 *
 * 옵션(환경 변수):
 *   ENGINES    gomocalc,rapfiweb            engines/ 아래 폴더 이름
 *   VARIANTS   single-simd128,multi-simd128,multi-simd128-relaxed
 *                                           없는 파일은 건너뛴다(우리 릴리스에는 relaxed 가 없다)
 *   THREADS    1,2                          멀티 변형에서 잴 스레드 수(단일은 늘 1)
 *   TIME_MS    10000                        국면당 탐색 시간
 *   REPEAT     2                            같은 조건 반복(평가 일관성·편차)
 *   BENCH      single-simd128,multi-simd128-relaxed
 *                                           Rapfi 내장 BENCH 를 돌릴 변형(비우면 안 돈다)
 *   HASH_MB    128                          두 엔진 같은 해시(gomocalc 기본값)
 *   LABEL      local                        결과 파일 이름
 *   SEARCH     1                            0 이면 본 측정을 건너뛴다(BENCH 만 보태는 보충 측정)
 *
 * 결과 파일 여럿은 report.mjs 가 합친다 — 뒤 파일의 같은 (엔진, 변형) 이 앞의 것을 대신하고,
 * 본 측정이 없는 보충 런은 BENCH 만 앞의 런에 얹는다.
 *
 * 한 (엔진, 변형) 마다 **브라우저를 새로 띄운다** — 앞 엔진의 메모리·JIT 가 섞이지 않게.
 *
 * 순서가 중요하다:
 *   1. 기동(로드 시간·기동 직후 메모리)
 *   2. **냉(冷) 탐색** — 첫 탐색. 가중치 적재 + V8 의 Liftoff→TurboFan 승격 전 구간이
 *      섞인다. 사용자가 앱을 열고 처음 누르는 「분석」이 이것이다.
 *   3. BENCH(선택) — 결정적 내장 벤치. 이것이 JIT 예열도 겸한다.
 *   4. 예열 탐색(BENCH 를 안 돌렸으면) → 본 측정: 스레드 × 국면 × 반복
 *   5. 탐색 뒤 메모리
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import { HERE, Host, label, search, serve, setup, sleep } from "./lib.mjs";

const list = (v, d) =>
  (v ?? d)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const ENGINES = list(process.env.ENGINES, "gomocalc,rapfiweb");
const VARIANTS = list(
  process.env.VARIANTS,
  "single-simd128,single-simd128-relaxed,multi-simd128,multi-simd128-relaxed",
);
const THREADS = list(process.env.THREADS, "1,2").map(Number);
const TIME_MS = Number(process.env.TIME_MS ?? 10_000);
const REPEAT = Number(process.env.REPEAT ?? 2);
const BENCH = list(process.env.BENCH, "single-simd128,multi-simd128-relaxed");
const HASH_MB = Number(process.env.HASH_MB ?? 128);
const LABEL = process.env.LABEL ?? "local";
const COLD_MS = Number(process.env.COLD_MS ?? 3_000);
const WARM_MS = Number(process.env.WARM_MS ?? 8_000);
const SEARCH = process.env.SEARCH !== "0";

const { positions } = JSON.parse(await readFile(join(HERE, "positions.json"), "utf8"));
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

/** 엔진 스스로가 말한 이름·버전(ABOUT). */
async function about(host) {
  host.cursor = (await host.page.evaluate(() => window.bench.lines.length)) | 0;
  await host.post("ABOUT");
  const got = await host.until((l) => l.startsWith("name="), 10_000, "ABOUT");
  return got.at(-1).line;
}

/** Rapfi 내장 BENCH. 결과 줄을 모은다. */
async function runBench(host) {
  host.cursor = (await host.page.evaluate(() => window.bench.lines.length)) | 0;
  const t0 = Date.now();
  await host.post("BENCH");
  const got = await host.until((l) => /^MESSAGE Hash:/.test(l), 30 * 60_000, "BENCH");
  const pick = (re) => {
    const all = got.map((l) => re.exec(l.line)).filter(Boolean);
    return all.map((m) => Number(m[1]));
  };
  const totals = pick(/^MESSAGE Total Time \(ms\): (\d+)/);
  const nodes = pick(/^MESSAGE Nodes: (\d+)/)[0] ?? null;
  return {
    // 엔진이 찍는 Nodes/s 는 wasm32 에서 **넘친다** — nodes×1000 을 32비트 size_t 로
    // 셈해 노드가 약 429만을 넘으면 2^32 로 접힌다(4,391,204 노드 → 1,174 로 찍힘).
    // 그래서 노드 ÷ 시간으로 직접 셈한 값을 따로 둔다.
    npsComputed: nodes && totals[1] ? Math.round((nodes * 1000) / totals[1]) : null,
    wallMs: Date.now() - t0,
    moveBenchMs: totals[0] ?? null,
    movesPerSec: pick(/^MESSAGE Moves\/s: (\d+)/)[0] ?? null,
    searchBenchMs: totals[1] ?? null,
    nodes: pick(/^MESSAGE Nodes: (\d+)/)[0] ?? null,
    nps: pick(/^MESSAGE Nodes\/s: (\d+)/)[0] ?? null,
    hash: /^MESSAGE Hash: (\w+)/.exec(got.at(-1).line)?.[1] ?? null,
  };
}

/** 페이지 전체 메모리(격리된 페이지에서만 된다). 실패해도 벤치는 계속한다. */
async function uaMemory(page) {
  try {
    return await page.evaluate(async () => {
      if (!performance.measureUserAgentSpecificMemory) return null;
      const r = await Promise.race([
        performance.measureUserAgentSpecificMemory(),
        new Promise((ok) => setTimeout(() => ok(null), 30_000)),
      ]);
      return r ? r.bytes : null;
    });
  } catch {
    return null;
  }
}

const port = 4500 + Math.floor(Math.random() * 400);
const server = await serve(port);
const results = {
  label: LABEL,
  startedAt: new Date().toISOString(),
  host: {
    cpu: os.cpus()[0]?.model ?? "?",
    logicalCores: os.cpus().length,
    memGB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    platform: `${os.platform()} ${os.release()}`,
  },
  params: { TIME_MS, REPEAT, HASH_MB, THREADS, COLD_MS, WARM_MS },
  runs: [],
};

try {
  for (const engine of ENGINES) {
    for (const variant of VARIANTS) {
      if (!(await exists(join(HERE, "engines", engine, `rapfi-${variant}.js`)))) continue;
      const tag = `${engine}/${variant}`;
      console.log(`\n== ${tag}`);
      const browser = await chromium.launch({
        args: ["--enable-blink-features=ForceEagerMeasureMemory"],
      });
      const run = { engine, variant, searches: [] };
      results.runs.push(run);
      try {
        const page = await browser.newPage();
        page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
        await page.goto(`http://127.0.0.1:${port}/page/index.html`);
        results.host.browser = browser.version();
        const host = new Host(page);

        // 1. 기동
        const loaded = await host.load(engine, variant);
        run.loadMs = Math.round(loaded.loadMs);
        run.host = loaded.kind;
        run.about = await about(host);
        await setup(host, { hashMb: HASH_MB });
        run.memAfterStart = await host.memoryBytes();
        console.log(`  ${run.about}`);
        console.log(
          `  로드 ${run.loadMs}ms · 메모리 ${(run.memAfterStart / 2 ** 20).toFixed(0)}MB`,
        );

        // 2. 냉 탐색 — 첫 국면, 1 스레드
        await host.post("INFO THREAD_NUM 1");
        const cold = await search(host, positions[0].moves, { timeMs: COLD_MS });
        run.cold = { ...cold, positionId: positions[0].id, timeMs: COLD_MS };
        console.log(`  냉 탐색 ${COLD_MS}ms: ${cold.nps} nps · 깊이 ${cold.depth}`);

        // 3. BENCH / 4. 예열
        if (BENCH.includes(variant)) {
          run.bench = await runBench(host);
          console.log(
            `  BENCH: move ${run.bench.movesPerSec}/s · search ${run.bench.nps} nps · ${run.bench.nodes} nodes · ${run.bench.searchBenchMs}ms · ${run.bench.hash}`,
          );
          await setup(host, { hashMb: HASH_MB }); // BENCH 가 규칙을 바꿔 둔다
        } else {
          await host.post("INFO THREAD_NUM 1");
          await search(host, positions[2]?.moves ?? positions[0].moves, { timeMs: WARM_MS });
        }

        // 4. 본 측정 (SEARCH=0 이면 건너뛴다 — BENCH 만 보태는 보충 측정용)
        const threads = !SEARCH ? [] : variant.startsWith("multi") ? THREADS : [1];
        for (const n of threads) {
          await host.post(`INFO THREAD_NUM ${n}`);
          for (const pos of positions) {
            for (let r = 0; r < REPEAT; r++) {
              const s = await search(host, pos.moves, { timeMs: TIME_MS });
              s.mem = await host.memoryBytes();
              run.searches.push({ positionId: pos.id, threads: n, repeat: r, ...s });
              console.log(
                `  t${n} ${pos.id.padEnd(13)} #${r} ${String(s.nps).padStart(7)} nps · 깊이 ${s.depth}-${s.selDepth} · ${s.eval} · ${label(s.move)}`,
              );
            }
          }
        }

        // 5. 메모리
        run.memAfterSearch = await host.memoryBytes();
        run.uaMemory = await uaMemory(page);
        run.errors = await page.evaluate(() => window.bench.errors);
      } catch (e) {
        run.failed = String(e?.message ?? e);
        console.log(`  X ${run.failed}`);
      } finally {
        await browser.close();
        await sleep(500);
      }
    }
  }
} finally {
  server.close();
}

results.finishedAt = new Date().toISOString();
await mkdir(join(HERE, "results"), { recursive: true });
const out = join(HERE, "results", `${LABEL}.json`);
await writeFile(out, JSON.stringify(results, null, 2));
console.log(`\n결과: ${out}`);
