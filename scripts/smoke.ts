/**
 * 스모크 — 프로덕션 빌드를 실제로 띄워 AppShell 이 렌더되는지 본다.
 *
 *   pnpm build && pnpm exec tsx scripts/smoke.ts
 *
 * 「빌드가 됐다」와 「화면이 뜬다」는 다르다. 라우터 설정 오류, CSS 변수 오타,
 * 워커 URL 실수는 전부 빌드를 통과하고 빈 화면으로 끝난다. 그래서 이 단계가 있다.
 * 지금은 W1 이라 확인하는 것도 W1 만큼이다: 레일 여섯 항목, 상단 바 제목,
 * 라우팅 이동, 다크 토큰이 실제로 적용되는지.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const PORT = Number(process.env.SMOKE_PORT ?? 4179);

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

// SPA 폴백이 있는 최소 정적 서버. vite preview 를 쓰지 않는 이유는
// 종료 처리를 우리가 확실히 쥐고 있어야 CI 가 매달리지 않기 때문이다.
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
  console.error(`스모크 실패: ${m}`);
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

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });

  // 1. 루트가 /board 로 간다
  if (!page.url().endsWith("/board")) fail(`루트가 /board 로 가지 않았습니다: ${page.url()}`);

  // 2. 레일 여섯 항목
  const rail = await page.locator(".rail__link").allInnerTexts();
  if (rail.length !== 6) fail(`레일 항목이 6개가 아닙니다: ${rail.length} (${rail.join(", ")})`);

  // 3. 상단 바가 현재 위치를 말한다
  const title = (await page.locator(".topbar__title").innerText()).trim();
  if (title !== "보드") fail(`상단 바 제목이 «보드»가 아닙니다: «${title}»`);

  // 4. 연구로 이동하면 서브탭 넷이 나오고 제목이 바뀐다 — 1클릭이어야 한다
  await page.locator('.rail__link[href="/research"]').click();
  await page.waitForURL("**/research/review");
  const tabs = await page.locator(".rtabs__tab").allInnerTexts();
  if (tabs.length !== 4) fail(`연구 탭이 4개가 아닙니다: ${tabs.length}`);
  const rtitle = (await page.locator(".topbar__title").innerText()).trim();
  if (!rtitle.startsWith("연구 ·")) fail(`연구 제목이 «연구 · …» 가 아닙니다: «${rtitle}»`);

  // 5. 토큰이 실제로 먹었는가. 배경이 투명/기본 흰색이면 CSS 가 안 붙은 것이다.
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (bg === "rgba(0, 0, 0, 0)" || bg === "") fail(`body 배경이 비어 있습니다: «${bg}»`);

  // 6. 다크 토큰 — data-theme 를 붙이면 값이 바뀌어야 한다
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (dark === bg) fail(`다크 테마가 배경을 바꾸지 않았습니다 (둘 다 ${bg})`);

  // 7. 좁은 폭에서 하단 탭으로 바뀐다
  await page.setViewportSize({ width: 480, height: 800 });
  await page.waitForTimeout(100);
  const bottom = await page.locator(".tabs__link").count();
  if (bottom !== 6) fail(`좁은 폭에서 하단 탭이 6개가 아닙니다: ${bottom}`);
  if ((await page.locator(".rail").count()) !== 0) fail("좁은 폭인데 레일이 남아 있습니다");

  // ── 8. 보드 (W2) ────────────────────────────────────────────────
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.goto(`http://localhost:${PORT}/board`, { waitUntil: "networkidle" });

  const layers = await page.locator(".board__layer").count();
  if (layers !== 2) fail(`보드 캔버스가 2장이 아닙니다: ${layers}`);

  // 캔버스가 「있다」와 「그려졌다」는 다르다. 정적 레이어 한가운데 픽셀을 읽어
  // 나무가 실제로 칠해졌는지 본다 — 투명하면 그리기가 아예 돌지 않은 것이다.
  const pixel = () =>
    page.evaluate(() => {
      const c = document.querySelectorAll("canvas.board__layer")[0] as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return [d[0], d[1], d[2], d[3]].join(",");
    });

  const woodLight = await pixel();
  if (woodLight.endsWith(",0")) fail(`정적 레이어가 비어 있습니다(투명): ${woodLight}`);

  // 보드 한가운데는 15×15 에서 정확히 H8 이다 — 여백이 양쪽 0.75칸이라 대칭이므로
  // 판의 중심(7.75 step)이 cx(7) 과 같은 자리다.
  const view = await page.locator(".board__view").boundingBox();
  if (!view) {
    fail("보드가 화면에 없습니다");
  } else {
    await page.mouse.click(view.x + view.width / 2, view.y + view.height / 2);
    await page.waitForTimeout(120);
    const aria = await page.locator("canvas[role=img]").getAttribute("aria-label");
    if (!aria?.includes("돌 1개")) fail(`돌이 놓이지 않았습니다: ${aria}`);
    const lastCell = (await page.locator(".kv dd").last().innerText()).trim();
    if (lastCell !== "H8") fail(`가운데를 눌렀는데 H8 이 아닙니다: ${lastCell}`);

    await page.mouse.click(view.x + view.width / 2, view.y + view.height / 2);
    await page.waitForTimeout(80);
    const again = await page.locator("canvas[role=img]").getAttribute("aria-label");
    if (!again?.includes("돌 1개")) fail(`같은 점에 두 번 놓였습니다: ${again}`);
  }

  // 다크에서 나무가 바뀌어야 한다 — 스킨을 CSS 변수에서 다시 읽는지 보는 자리다.
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.waitForTimeout(200);
  const woodDark = await pixel();
  if (woodDark === woodLight) fail(`다크에서 나무 색이 그대로입니다: ${woodDark}`);

  const ladder = await page.locator(".ladder__cell").count();
  if (ladder !== 5) fail(`값 사다리 견본이 5칸이 아닙니다: ${ladder}`);

  if (errors.length) fail(`콘솔 오류 ${errors.length}건:\n  ${errors.join("\n  ")}`);

  if (!process.exitCode) {
    console.log(
      "스모크 통과 — 레일 6 · 연구 탭 4 · 라우팅 · 토큰(라이트/다크) · 좁은 폭 전환\n" +
        "             보드 2레이어 · 나무 렌더 · H8 착수 · 중복 착수 무시 · 다크 나무 · 사다리 5칸",
    );
  }
} finally {
  await browser.close();
  server.close();
}
