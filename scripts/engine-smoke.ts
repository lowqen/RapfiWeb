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
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const PORT = Number(process.env.SMOKE_PORT ?? 4181);

const GLUE = join(DIST, "engine/rapfi-single-simd128.js");
const WASM = join(DIST, "engine/rapfi-single-simd128.wasm");
const DATA = join(DIST, "engine/rapfi-single-simd128.data");

if (!existsSync(GLUE) || !existsSync(WASM) || !existsSync(DATA)) {
  console.log("엔진 산출물이 없어 건너뜁니다 (dist/engine/rapfi-single-simd128.{js,wasm,data}).");
  console.log("  engine-release.yml 을 한 번 돌리면 채워집니다.");
  process.exit(0);
}

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
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const fail = (m: string) => {
  console.error(`엔진 스모크 실패: ${m}`);
  process.exitCode = 1;
};

await new Promise<void>((r) => server.listen(PORT, r));
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(`http://localhost:${PORT}/board`, { waitUntil: "networkidle" });

  // 1. 엔진 기동. 40MB .data 를 받고 가중치를 푸는 시간이 든다.
  const t0 = Date.now();
  await page.getByRole("button", { name: "엔진 시작" }).click();
  await page.locator('.panel__badge[data-status="ready"]').waitFor({ timeout: 120_000 });
  const bootMs = Date.now() - t0;
  console.log(`엔진 기동 ${bootMs}ms`);

  // 콘솔에 엔진이 실제로 말한 줄이 있어야 한다 — 파서가 아니라 엔진이 살아 있다는 증거.
  const consoleText = await page.locator(".console").innerText();
  if (!/Rapfi|Evaluator|config/i.test(consoleText)) {
    fail(`콘솔에 엔진 출력이 없습니다:\n${consoleText.slice(0, 400)}`);
  }

  // 2. 돌 하나 놓기 — 보드 한가운데는 15×15 에서 H8 이다.
  const view = await page.locator(".board__view").boundingBox();
  if (!view) throw new Error("보드가 없습니다");
  await page.mouse.click(view.x + view.width / 2, view.y + view.height / 2);
  await page.waitForTimeout(120);

  // 3. 분석. 그동안 메인 스레드가 살아 있는지 rAF 로 잰다.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __stop?: () => void };
    w.__frames = 0;
    let id = requestAnimationFrame(function tick() {
      w.__frames++;
      id = requestAnimationFrame(tick);
    });
    w.__stop = () => cancelAnimationFrame(id);
  });

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

  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __stop?: () => void };
    w.__stop?.();
    return w.__frames;
  });
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

  // 5. 정지 — 조각 경계에서 듣는다(기본 500ms). 넉넉히 3초를 준다.
  const tStop = Date.now();
  await page.getByRole("button", { name: "정지" }).click();
  await page.locator('.panel__badge[data-status="ready"]').waitFor({ timeout: 5000 });
  const stopMs = Date.now() - tStop;
  console.log(`정지까지 ${stopMs}ms`);
  if (stopMs > 3000) fail(`정지가 너무 늦습니다: ${stopMs}ms`);

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
} finally {
  await browser.close();
  server.close();
}
