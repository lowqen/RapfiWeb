/**
 * 엔진 스모크 — 진짜 WASM 엔진을 띄워 「클릭 → 분석 → 보드」 한 바퀴를 돈다.
 *
 *   pnpm build && pnpm exec tsx scripts/engine-smoke.ts
 *
 * `scripts/smoke.ts` 와 나눠 둔 이유는 전제가 다르기 때문이다: 이쪽은
 * `dist/engine/` 에 실제 산출물(.js/.wasm/.data 40MB)이 있어야 한다. 없으면
 * **건너뛴다** — 엔진이 아직 없는 상태에서 CI 를 빨갛게 만들 이유가 없고,
 * 「없어서 건너뛰었다」와 「있는데 실패했다」는 구별돼야 한다.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { ISOLATION_HEADERS, ISOLATE, expectedVariant, hasEngine } from "./isolation.ts";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const PORT = Number(process.env.SMOKE_PORT ?? 4181);

/**
 * `SMOKE_BASE_URL` 을 주면 **이미 떠 있는 사이트**를 검사한다(배포 확인용).
 * 없으면 여기서 dist 를 띄워 검사한다(CI 기본).
 */
const REMOTE = process.env.SMOKE_BASE_URL?.replace(/\/$/, "") ?? "";
const BASE = REMOTE || `http://localhost:${PORT}`;

if (!REMOTE && !hasEngine(DIST)) {
  console.log(
    "엔진 산출물이 없어 건너뜁니다 (dist/engine/rapfi.data · rapfi-single-simd128.{js,wasm}).",
  );
  console.log("  engine-release.yml 을 한 번 돌리면 채워집니다.");
  process.exit(0);
}
if (REMOTE) console.log(`원격 검사: ${REMOTE}`);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".map": "application/json",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!existsSync(file) || extname(file) === "") file = join(DIST, "index.html");
  try {
    const body = readFileSync(file);
    res.writeHead(200, {
      ...ISOLATION_HEADERS,
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const fail = (m: string) => {
  console.error(`엔진 스모크 실패: ${m}`);
  process.exitCode = 1;
};

if (!REMOTE) await new Promise<void>((r) => server.listen(PORT, r));
const browser = await chromium.launch();
let page: import("playwright").Page | null = null;
const pageErrors: string[] = [];

/**
 * 실패했을 때 **엔진이 뭐라고 했는지** 찍는다.
 *
 * 처음엔 이게 없어서 「30초 안에 값이 안 채워짐」만 보였다. 그건 증상이지
 * 원인이 아니다 — 프로토콜 이식을 검증하는 시험에서 정작 엔진의 말은 로그에
 * 한 줄도 없었다.
 */
async function dumpState(why: string) {
  console.error(`\n──── 실패 지점: ${why} ────`);
  if (!page) return;
  try {
    // 콘솔은 엔진 탭으로 갔다 — 화면이 아니라 스토어에서 전체를 읽는다.
    const lines = (await page.evaluate(`window.__rapfiConsole()`)) as string[];
    if (lines.length === 0) throw new Error("빈 콘솔");
    console.error(`엔진 콘솔 (마지막 ${Math.min(60, lines.length)}줄):`);
    console.error(lines.slice(-60).join("\n"));
  } catch {
    console.error("엔진 콘솔이 화면에 없습니다 — 엔진이 한 줄도 뱉지 않았습니다.");
  }
  try {
    const panel = await page
      .locator(".panel")
      .filter({ has: page.locator(".panel__badge") })
      .innerText({ timeout: 2000 });
    console.error(`\n분석 패널:\n${panel}`);
  } catch {
    console.error("분석 패널을 읽지 못했습니다.");
  }
  if (pageErrors.length) {
    console.error(`\n페이지 오류 ${pageErrors.length}건:`);
    console.error(pageErrors.slice(-20).join("\n"));
  } else {
    console.error("\n페이지 오류는 없습니다.");
  }
  console.error("────────────────────────────\n");
}

try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = pageErrors;
  page.on("pageerror", (e) => errors.push("[pageerror] " + (e.stack ?? String(e))));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("[console] " + m.text());
  });

  await page.goto(`${BASE}/board`, { waitUntil: "networkidle" });

  // 1. 엔진 기동. 40MB .data 를 받고 가중치를 푸는 시간이 든다.
  const t0 = Date.now();
  await page.getByRole("button", { name: "엔진 시작" }).click();
  await page.locator('.panel__badge[data-status="ready"]').waitFor({ timeout: 120_000 });
  const bootMs = Date.now() - t0;
  console.log(`엔진 기동 ${bootMs}ms`);

  // 1b. **어느 변형으로 떴는가.** 격리돼 있고 멀티 산출물이 있으면 멀티여야 한다 —
  // 조용히 단일로 물러섰다면(핸드셰이크 실패) 여기서 잡는다. 격리가 없으면 단일.
  type EngineInfo = {
    variant: string;
    threaded: boolean;
    appliedThreads: number | null;
    fallbackReason: string | null;
    weightsSource: "cache" | "network" | "glue" | null;
    weightsMs: number | null;
    warmupMs: number | null;
  };
  let engineInfo = (await page.evaluate(`window.__rapfiEngine()`)) as EngineInfo;
  const wantVariant = expectedVariant(DIST);
  console.log(
    `엔진 변형 ${engineInfo.variant} · 스레드 ${engineInfo.appliedThreads} · 격리 ${ISOLATE}` +
      (engineInfo.fallbackReason ? ` · 물러섬: ${engineInfo.fallbackReason}` : ""),
  );
  if (engineInfo.variant !== wantVariant) {
    fail(
      `${wantVariant} 가 떠야 하는데 ${engineInfo.variant} 입니다 (${engineInfo.fallbackReason ?? ""})`,
    );
  }
  if (engineInfo.threaded !== wantVariant.startsWith("multi")) {
    fail(`threaded=${engineInfo.threaded} — 변형과 어긋납니다`);
  }

  // 1c. **공유 가중치 · 캐시 · 예열.** 새 브라우저의 첫 기동은 가중치를 내려받고(해시 확인),
  // 예열 탐색을 마친 뒤에 「대기」가 된다. 새로고침 뒤 다시 띄우면 **캐시에서** 읽어야 한다 —
  // 재방문·엔진 전환(멀티 → 단일 폴백 포함)에 20MB 를 다시 받지 않는다는 뜻이다.
  const firstWeights = `${engineInfo.weightsSource} ${engineInfo.weightsMs}ms`;
  if (!REMOTE && engineInfo.weightsSource !== "network") {
    fail(`첫 기동의 가중치가 내려받은 것이 아닙니다: ${firstWeights}`);
  }
  if (engineInfo.warmupMs === null) fail("예열 탐색이 돌지 않았습니다");
  await page.reload({ waitUntil: "networkidle" });
  const t1 = Date.now();
  await page.getByRole("button", { name: "엔진 시작" }).click();
  await page.locator('.panel__badge[data-status="ready"]').waitFor({ timeout: 120_000 });
  const rebootMs = Date.now() - t1;
  engineInfo = (await page.evaluate(`window.__rapfiEngine()`)) as EngineInfo;
  if (engineInfo.weightsSource !== "cache") {
    fail(`새로고침 뒤 기동이 캐시를 쓰지 않았습니다: ${engineInfo.weightsSource}`);
  } else {
    console.log(
      `가중치: 첫 기동 ${firstWeights} → 재기동 cache ${engineInfo.weightsMs}ms · ` +
        `예열 ${engineInfo.warmupMs}ms · 재기동 ${rebootMs}ms`,
    );
  }
  if (engineInfo.variant !== wantVariant) fail(`재기동 변형이 ${engineInfo.variant} 입니다`);

  // 콘솔에 엔진이 실제로 말한 줄이 있어야 한다 — 파서가 아니라 엔진이 살아 있다는 증거.
  await page.waitForTimeout(300); // 콘솔은 100ms 배치로 온다
  const consoleText = ((await page.evaluate(`window.__rapfiConsole()`)) as string[]).join("\n");
  if (!/Rapfi|Evaluator|config/i.test(consoleText)) {
    fail(`콘솔에 엔진 출력이 없습니다:\n${consoleText.slice(0, 400)}`);
  }

  // 1d. **빈 판(0수) 분석.** Rapfi 는 빈 판에서 탐색하지 않고 천원(7,7)을 곧바로 돌려준다 —
  // PV · 깊이 · 평가 · 카운터가 한 줄도 없다. 예전엔 집계기가 그 좌표를 흘려 화면이 «탐색 중»
  // 그대로 비어 멈춘 듯 보였다. 이제 최선수 H8 과 즉답 안내가 떠야 한다.
  {
    const panel = page.locator(".panel").filter({ has: page.locator(".panel__badge") });
    await page.getByRole("button", { name: "분석", exact: true }).click();
    await page.locator('.panel__badge[data-status="searching"]').waitFor({ timeout: 10_000 });
    const best = panel.locator(".kv dd").last();
    await page
      .waitForFunction(
        `(() => { const dds = [...document.querySelectorAll(".panel .kv dd")];
                  return dds.length > 0 && dds[dds.length - 1].textContent.trim() === "H8"; })()`,
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => undefined);
    const emptyBest = (await best.innerText()).trim();
    if (emptyBest !== "H8") fail(`빈 판 분석의 최선수가 H8 이 아닙니다: «${emptyBest}»`);
    if (!(await panel.locator("[data-instant]").isVisible())) {
      fail("빈 판 분석에 즉답 안내가 없습니다");
    }
    console.log(`빈 판 분석: 최선수 ${emptyBest} · 즉답 안내`);
    await page.getByRole("button", { name: "정지" }).click();
    await page.locator('.panel__badge[data-status="ready"]').waitFor({ timeout: 5000 });
  }

  // 2. 돌 하나 놓기 — 보드 한가운데는 15×15 에서 H8 이다.
  const view = await page.locator(".board__view").boundingBox();
  if (!view) throw new Error("보드가 없습니다");
  await page.mouse.click(view.x + view.width / 2, view.y + view.height / 2);
  await page.waitForTimeout(120);

  // 3. 분석. 그동안 메인 스레드가 살아 있는지 rAF 로 잰다.
  //
  // **문자열로 넘긴다.** 이 스크립트는 tsx(esbuild)로 도는데, esbuild 가
  // keep-names 로 이름 있는 함수에 `__name(...)` 헬퍼를 끼워 넣는다. 그 헬퍼는
  // 브라우저 쪽에 없으므로 페이지 안에서 ReferenceError 로 죽는다.
  // 문자열은 변환을 거치지 않는다.
  await page.evaluate(`(() => {
    window.__frames = 0;
    let id = 0;
    const tick = () => { window.__frames++; id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    window.__stop = () => cancelAnimationFrame(id);
  })()`);

  const tAnalyze = Date.now();
  await page.getByRole("button", { name: "분석", exact: true }).click();
  await page.locator('.panel__badge[data-status="searching"]').waitFor({ timeout: 10_000 });

  // 승률이나 최선수 중 하나라도 채워지면 스트림이 도착한 것이다.
  await page
    .locator(".panel")
    .filter({ has: page.locator(".panel__badge") })
    .locator(".kv dd.tnum")
    .filter({ hasNotText: "—" })
    .first()
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);

  const frames = (await page.evaluate(
    `(() => { window.__stop && window.__stop(); return window.__frames; })()`,
  )) as number;
  const elapsedSec = (Date.now() - tAnalyze) / 1000;
  const fps = frames / elapsedSec;
  console.log(`탐색 중 ${fps.toFixed(1)}fps (${frames} 프레임 / ${elapsedSec.toFixed(1)}초)`);
  // 시간 분할이 동작하면 메인 스레드는 거의 자유롭다. 30fps 아래면 조각이
  // 제 몫을 못 하고 있다는 뜻이다.
  if (fps < 30) fail(`탐색 중 메인 스레드가 막힙니다: ${fps.toFixed(1)}fps`);

  // 4. 분석 결과가 화면에 있는가
  // 분석 패널은 상태 점(.panel__badge)을 가진 패널이다.
  const analysisPanel = page.locator(".panel").filter({ has: page.locator(".panel__badge") });
  const bestCell = (await analysisPanel.locator(".kv dd").last().innerText()).trim();
  if (bestCell === "—") fail("최선수가 비어 있습니다 — INFO 스트림이 오지 않았습니다");
  else console.log(`최선수 ${bestCell}`);

  const pvRows = await page.locator(".pvlist__row").count();
  console.log(`PV ${pvRows}개`);

  // 4b. **노드·시간이 실시간으로, 늘기만 하며 오른다.** 예전엔 PV 하나의 `NODES` 를
  // 총계로 그려 노드가 튀었고, `TOTALTIME` 을 몰라 시간이 조각(0.5초) 안에서만 돌았다.
  // 0.5초 간격으로 여덟 번 읽어 단조 증가와 0.5초 천장 돌파를 본다.
  const pg = page; // 닫힘 안에서는 null 좁히기가 풀린다
  const tile = (k: string) =>
    pg.locator(".stat", { has: pg.locator(`dt:text-is("${k}")`) }).locator("dd");
  const readNum = (t: string): number => {
    const s = t.trim();
    const mmss = /^(\d+):(\d{2})$/.exec(s);
    if (mmss) return (Number(mmss[1]) * 60 + Number(mmss[2])) * 1000;
    const m = /^([\d.]+)\s*([KMGs]?)/.exec(s);
    if (!m) return NaN;
    const scale: Record<string, number> = { K: 1e3, M: 1e6, G: 1e9, s: 1000, "": 1 };
    return Number(m[1]) * (scale[m[2] ?? ""] ?? 1);
  };
  const samples: { t: number; n: number }[] = [];
  for (let i = 0; i < 8; i++) {
    samples.push({
      t: readNum(await tile("TIME").innerText()),
      n: readNum(await tile("NODE").innerText()),
    });
    await page.waitForTimeout(500);
  }
  const ok = (xs: number[]) => xs.every((x, i) => !Number.isNaN(x) && (i === 0 || x >= xs[i - 1]!));
  const ts = samples.map((s) => s.t);
  const ns = samples.map((s) => s.n);
  if (!ok(ts)) fail(`TIME 이 줄거나 비었습니다: ${ts.join(" → ")}`);
  else if (ts.at(-1)! <= 1000) fail(`TIME 이 조각(0.5초) 천장을 넘지 못합니다: ${ts.join(" → ")}`);
  // 3.5초를 읽는 동안 시간은 흘러야 한다. 후보 수 1 의 멀티 분석에서 Rapfi 가 깊이
  // 한 단계 끝날 때만 카운터를 찍어 TIME 이 1.5초에 몇 초씩 멈춘 적이 있다.
  else if (ts.at(-1)! - ts[0]! < 2000) fail(`TIME 이 멈춰 있습니다: ${ts.join(" → ")}`);
  else if (!ok(ns)) fail(`NODE 가 들쭉날쭉합니다: ${ns.join(" → ")}`);
  // 3.5초를 읽는 동안 노드도 늘어야 한다. 격리 멀티 변형은 조각 없이 한 번에 돌고 Rapfi 가 노드 수를
  // PV 완료 때만 찍어, 깊은 단계 하나 동안 NODE 가 첫 값에 멈췄다(CI 249000→249000). 엔진 패치 P4-1 이
  // 0.5초마다 카운터를 찍는다.
  else if (ns.at(-1)! <= ns[0]!) fail(`NODE 가 멈춰 있습니다: ${ns.join(" → ")}`);
  else console.log(`실시간 카운터: TIME ${ts[0]}→${ts.at(-1)}ms · NODE ${ns[0]}→${ns.at(-1)}`);

  // 4c. **무제한 분석은 스스로 멈추지 않는다.** 예전엔 분석 예산이 5초였고, 즉답
  // 조각(좌표 한 줄)에서도 끝나 YXSTOP 을 보냈다. 옛 한도를 넘겨 기다린 뒤에도
  // 여전히 탐색 중이어야 한다(위 표본 4초 + 여기 1초).
  await page.waitForTimeout(1000);
  const still = await page
    .locator(".panel")
    .filter({ has: page.locator(".panel__badge") })
    .locator(".panel__badge")
    .getAttribute("data-status");
  if (still !== "searching")
    fail(`무제한 분석이 ${Date.now() - tAnalyze}ms 만에 멈췄습니다 (${still})`);
  else console.log(`무제한 분석: ${((Date.now() - tAnalyze) / 1000).toFixed(1)}초째 계속 탐색 중`);

  // 5. 정지 — 조각 경계에서 듣는다(기본 500ms). 넉넉히 3초를 준다.
  const tStop = Date.now();
  await page.getByRole("button", { name: "정지" }).click();
  await page.locator('.panel__badge[data-status="ready"]').waitFor({ timeout: 5000 });
  const stopMs = Date.now() - tStop;
  console.log(`정지까지 ${stopMs}ms`);
  if (stopMs > 3000) fail(`정지가 너무 늦습니다: ${stopMs}ms`);
  // 멀티 변형은 YXSTOP 이 탐색 도중에 닿는다(W0c 실측 1~9ms) — 조각 경계를 기다리지 않는다.
  else if (engineInfo.threaded && stopMs > 1000) {
    fail(`멀티 변형인데 정지가 ${stopMs}ms 걸렸습니다 — 조각 경계를 기다리는 것 같습니다`);
  }

  // 6. 보드에 실제로 그려졌는가 — 동적 레이어에 빈 캔버스가 아닌 픽셀이 있어야 한다.
  const painted = await page.evaluate(() => {
    const c = document.querySelectorAll("canvas.board__layer")[1] as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  });
  if (painted === 0) fail("동적 레이어가 비어 있습니다 — 돌도 칩도 그려지지 않았습니다");
  else console.log(`동적 레이어 픽셀 ${painted.toLocaleString()}개`);

  if (errors.length) fail(`콘솔 오류 ${errors.length}건:\n  ${errors.join("\n  ")}`);
  if (!process.exitCode) console.log("엔진 스모크 통과");
} catch (e) {
  // 예외로 죽어도 **엔진이 뭐라고 했는지**는 남긴다.
  const first = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e);
  await dumpState(first);
  fail(first);
} finally {
  await browser.close();
  if (!REMOTE) server.close();
}
