/**
 * W0c 실행기 — 브라우저 × 실행 방식 × 격리 조합을 돌려 표 하나로 모은다.
 *
 *   node spike/w0c/run.mjs                  # 세 브라우저 전부
 *   BROWSERS=chromium node spike/w0c/run.mjs
 *   ENGINE_DIR=path/to/engine node spike/w0c/run.mjs
 *
 * 결과: results/w0c.json (원자료) · results/w0c.md (표). 표는 표준 출력에도 찍는다.
 *
 * 조합(브라우저마다):
 *   single · worker     · 격리   지금 배포 경로 — 기준선(THREAD_NUM 4 는 무시돼야 한다)
 *   multi  · page       · 격리   계획서 W0c 의 1안: 페이지 메인 스레드
 *   multi  · worker     · 격리   W0 가 실패한 구성 재현
 *   multi  · worker-url · 격리   2안: 워커 + mainScriptUrlOrBlob(가설)
 *   multi  · page       · 무격리 대조군: 지금 배포 헤더로는 무엇이 일어나는가
 */
import { chromium, firefox, webkit } from "playwright";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(HERE, "../..");
const ENGINE_DIR = resolve(process.env.ENGINE_DIR ?? join(ROOT, "out/engine"));
const OUT = resolve(process.env.RESULTS_DIR ?? join(ROOT, "results"));

// VARIANTS=single 이면 단일 변형만 — 하네스 자체를 멀티 빌드 없이 검증할 때.
const VARIANTS = (process.env.VARIANTS ?? "single,multi").split(",");
for (const v of VARIANTS) {
  for (const ext of ["js", "wasm", "data"]) {
    const f = join(ENGINE_DIR, `rapfi-${v}-simd128.${ext}`);
    if (!existsSync(f)) {
      console.error(`엔진 산출물이 없습니다: ${f}`);
      process.exit(2);
    }
  }
}

const TYPES = { chromium, firefox, webkit };
const browsers = (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",").filter(Boolean);
const CASES = [
  { variant: "single", mode: "worker", iso: true, threads: "1,4", stop: false },
  { variant: "multi", mode: "page", iso: true, threads: "1,2,4,8", stop: true },
  { variant: "multi", mode: "worker", iso: true, threads: "1,2,4,8", stop: true },
  { variant: "multi", mode: "worker-url", iso: true, threads: "1,2,4,8", stop: true },
  { variant: "multi", mode: "page", iso: false, threads: "1", stop: false },
].filter((c) => VARIANTS.includes(c.variant));
const CASE_TIMEOUT_MS = Number(process.env.CASE_TIMEOUT_MS ?? 180_000);

const server = await startServer(0);
const port = server.address().port;
const results = [];

for (const name of browsers) {
  let browser;
  try {
    browser = await TYPES[name].launch();
  } catch (e) {
    results.push({ browser: name, launchError: String(e.message ?? e).split("\n")[0] });
    continue;
  }
  const version = browser.version();
  for (const c of CASES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const logs = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
    const url =
      `http://localhost:${port}/${c.iso ? "iso" : "plain"}/spike/w0c/page.html` +
      `?mode=${c.mode}&variant=${c.variant}&threads=${c.threads}&stop=${c.stop ? 1 : 0}`;
    const t0 = Date.now();
    let r;
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.__w0c !== undefined, null, {
        timeout: CASE_TIMEOUT_MS,
      });
      r = await page.evaluate(() => window.__w0c);
    } catch (e) {
      // 페이지가 결과를 못 낸 채 시간이 다 됐다 — 그래도 화면에 무엇이 있었는지 남긴다.
      const shown = await page.locator("#status").innerText().catch(() => "");
      r = { ok: false, stage: "runner", error: `${String(e.message).split("\n")[0]} · ${shown}` };
    }
    results.push({
      browser: name,
      browserVersion: version,
      ...c,
      elapsedMs: Date.now() - t0,
      logs: logs.slice(-15),
      ...r,
    });
    const last = results.at(-1);
    console.log(
      `${name.padEnd(8)} ${c.variant.padEnd(6)} ${c.mode.padEnd(10)} ${c.iso ? "iso  " : "plain"} → ` +
        (last.ok ? `ok (${speeds(last)})` : `실패[${last.stage}] ${last.error}`),
    );
    await context.close();
  }
  await browser.close();
}
server.close();

function speeds(r) {
  return (r.scaling ?? []).map((s) => `${s.threads}t:${s.speed ?? "?"}`).join(" ");
}

// ── 표 ─────────────────────────────────────────────────────────────
const md = [];
md.push(`# W0c 결과 — ${new Date().toISOString()}`);
md.push("");
md.push(
  "| 브라우저 | 변형 | 실행 | 격리 | coi | 결과 | 기동 | 1t | 2t | 4t | 8t | 4t/1t | YXNBEST 차단 | YXSTOP | 호스트 최대 지연 |",
);
md.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of results) {
  if (r.launchError) {
    md.push(`| ${r.browser} | — | — | — | — | 기동 실패: ${r.launchError} |||||||||`);
    continue;
  }
  const sp = (n) => r.scaling?.find((s) => s.threads === n)?.speed ?? "—";
  const s1 = r.scaling?.find((s) => s.threads === 1)?.speed;
  const s4 = r.scaling?.find((s) => s.threads === 4)?.speed;
  const block = r.scaling?.length ? Math.max(...r.scaling.map((s) => s.blockMs)) : "—";
  md.push(
    [
      r.browser,
      r.variant,
      r.mode,
      r.iso ? "O" : "X",
      r.env?.crossOriginIsolated === true ? "O" : r.env?.crossOriginIsolated === false ? "X" : "?",
      r.ok ? "✅" : `❌ ${r.stage}: ${String(r.error ?? "").slice(0, 80)}`,
      r.bootMs != null ? `${r.bootMs}ms` : "—",
      sp(1),
      sp(2),
      sp(4),
      sp(8),
      s1 && s4 ? (s4 / s1).toFixed(2) : "—",
      block === "—" ? block : `${block}ms`,
      r.stop ? `${r.stop.latencyMs}ms` : "—",
      r.hostMaxGapMs != null ? `${r.hostMaxGapMs}ms` : "—",
    ]
      .join(" | ")
      .replace(/^/, "| ")
      .concat(" |"),
  );
}
md.push("");
md.push(
  `환경: hardwareConcurrency = ${[...new Set(results.map((r) => r.env?.hardwareConcurrency).filter(Boolean))].join(", ") || "?"}`,
);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "w0c.json"), JSON.stringify(results, null, 2));
writeFileSync(join(OUT, "w0c.md"), md.join("\n") + "\n");
console.log("\n" + md.join("\n"));
