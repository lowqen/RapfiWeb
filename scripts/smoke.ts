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
import { ISOLATION_HEADERS, ISOLATE } from "./isolation.ts";
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

  // 1. 루트가 /board 로 간다. 이 이동은 **클라이언트 라우터**가 첫 렌더에서 한다 —
  // networkidle 은 그 렌더를 기다려 주지 않아, 곧바로 URL 을 읽으면 부하에 따라
  // 가끔 «/» 를 읽었다(수정 전 코드에서도 네 번에 한 번). 이동을 기다린 뒤 본다.
  await page.waitForURL("**/board", { timeout: 5_000 }).catch(() => undefined);
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
    // 순서가 아니라 **이름**으로 집는다. 처음엔 `.kv dd` 의 last() 를 썼는데,
    // 분석 패널에도 .kv 가 생기면서 최선수를 집었고, 규칙 줄이 하나 더 늘자
    // first() 도 어긋났다. data-k 는 줄이 늘어도 흔들리지 않는다.
    const lastCell = (await page.locator("dd[data-k=last]").innerText()).trim();
    if (lastCell !== "H8") fail(`가운데를 눌렀는데 H8 이 아닙니다: ${lastCell}`);

    await page.mouse.click(view.x + view.width / 2, view.y + view.height / 2);
    await page.waitForTimeout(80);
    const again = await page.locator("canvas[role=img]").getAttribute("aria-label");
    if (!again?.includes("돌 1개")) fail(`같은 점에 두 번 놓였습니다: ${again}`);

    // 두 번째 돌은 백. 한 칸 옆(= step 만큼)을 누른다 — 15×15 에서 한 칸은
    // 보드 한 변의 1/15.5 다.
    const step = view.width / 15.5;
    await page.mouse.click(view.x + view.width / 2 + step, view.y + view.height / 2);
    await page.waitForTimeout(80);
    const two = await page.locator("canvas[role=img]").getAttribute("aria-label");
    if (!two?.includes("돌 2개")) fail(`둘째 돌이 놓이지 않았습니다: ${two}`);
    const turn = (await page.locator("dd[data-k=turn]").innerText()).trim();
    if (turn !== "흑") fail(`두 수 뒤 차례가 흑이 아닙니다: ${turn}`);
  }

  // 리사이즈 → 캔버스 실제 픽셀이 따라오는가 (DPR 포함)
  const widthBefore = await page.evaluate(
    () => (document.querySelector("canvas.board__layer") as HTMLCanvasElement).width,
  );
  await page.setViewportSize({ width: 1100, height: 700 });
  // 고정 200ms 가 아니라 **바뀔 때까지**(최대 3초) 기다린다 — ResizeObserver → 다시
  // 그리기가 느린 CI 러너에서 200ms 를 넘긴 적이 있다(비격리 런에서 빨갛게 됐다).
  const widthAfter = await page
    .waitForFunction(
      (before) =>
        (document.querySelector("canvas.board__layer") as HTMLCanvasElement).width !== before,
      widthBefore,
      { timeout: 3000 },
    )
    .then(() =>
      page.evaluate(
        () => (document.querySelector("canvas.board__layer") as HTMLCanvasElement).width,
      ),
    )
    .catch(() => widthBefore);
  if (widthAfter === widthBefore) {
    fail(`리사이즈에도 캔버스 해상도가 그대로입니다: ${widthBefore}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);

  // 다크에서 나무가 바뀌어야 한다 — 스킨을 CSS 변수에서 다시 읽는지 보는 자리다.
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.waitForTimeout(200);
  const woodDark = await pixel();
  if (woodDark === woodLight) fail(`다크에서 나무 색이 그대로입니다: ${woodDark}`);

  // 보드 옆 칸은 엔진 상태 · 국면 둘뿐이다. 대국 설정은 설정 탭, 콘솔은 엔진 탭으로
  // 갔고 대국 시계는 없앴다 — 옆 칸에 다시 쌓이기 시작하면 여기서 잡는다.
  const sideCards = await page.locator(".boardscreen__side > .panel").count();
  if (sideCards !== 2) fail(`보드 옆 칸 카드가 둘(엔진·국면)이 아닙니다: ${sideCards}`);
  if ((await page.locator(".clock, .clocks").count()) !== 0) fail("보드에 시계가 남아 있습니다");
  // 평가 바 — 엔진 없이도 자리를 잡고 있어야 한다(값은 「—」, 50:50).
  const meter = page.getByRole("meter", { name: "평가 바" });
  if ((await meter.count()) !== 1) fail("평가 바가 없습니다");
  else if ((await meter.getAttribute("aria-valuenow")) !== "50") {
    fail(`엔진 없이 평가 바가 50 이 아닙니다: ${await meter.getAttribute("aria-valuenow")}`);
  }
  for (const gone of ["새 대국", "기권", "컴퓨터 백"]) {
    const n = await page.getByRole("button", { name: gone, exact: true }).count();
    if (n !== 0) fail(`「${gone}」 이 아직 보드 화면에 있습니다 — 설정 탭의 것입니다`);
  }
  if ((await page.locator(".console").count()) !== 0) fail("콘솔이 아직 보드 화면에 있습니다");

  // 한 화면에 들어오는가 — 휴대폰 · 노트북 · 데스크톱 · 가로 휴대폰에서
  // **페이지가 스크롤되지 않고** 보드 전체가 뷰포트 안에 있어야 한다.
  // 예전 보드 칸은 `aspect-ratio: 1` 이라 높이가 칸 너비로 정해져 세로가
  // 모자란 화면마다 넘쳤다(1440×1000 에서 보드 984px).
  const screens = [
    { name: "휴대폰 세로", width: 390, height: 844 },
    { name: "휴대폰 가로", width: 844, height: 390 },
    { name: "태블릿 세로", width: 768, height: 1024 },
    { name: "노트북", width: 1366, height: 768 },
    { name: "데스크톱", width: 1920, height: 1080 },
  ];
  const fits: string[] = [];
  for (const s of screens) {
    await page.setViewportSize({ width: s.width, height: s.height });
    // 판이 **새 크기로 자리 잡을 때까지** 기다린다. 평가 바는 CSS 가 곧바로 새 크기로
    // 정하고 판 캔버스는 ResizeObserver 를 거쳐 한 박자 늦게 따라온다 — 그래서 「판이
    // 정사각형이고 한 변이 평가 바 높이와 같을 때」다. 고정 250ms 로는 느린 러너에서 옛
    // 크기가 섞인 판을 잰 적이 있다. 3초 안에 맞지 않으면 아래 검사가 진짜로 실패한다.
    await page
      .waitForFunction(
        `(() => {
          var r = document.querySelector(".board__view").getBoundingClientRect();
          var e = document.querySelector(".evalbar");
          var barH = e ? e.getBoundingClientRect().height : r.height;
          return Math.abs(r.width - r.height) < 1 && Math.abs(r.height - barH) < 2;
        })()`,
        null,
        { timeout: 3000, polling: 100 },
      )
      .catch(() => undefined);
    const m = (await page.evaluate(`(() => {
      var root = document.scrollingElement;
      var content = document.querySelector(".shell__content");
      var b = document.querySelector(".board__view").getBoundingClientRect();
      var e = document.querySelector(".evalbar").getBoundingClientRect();
      return {
        pageScroll: root.scrollHeight - root.clientHeight,
        contentScroll: content.scrollHeight - content.clientHeight,
        top: b.top, left: b.left, bottom: b.bottom, right: b.right, side: b.width,
        barTop: e.top, barBottom: e.bottom, barLeft: e.left, barRight: e.right,
      };
    })()`)) as {
      pageScroll: number;
      contentScroll: number;
      top: number;
      left: number;
      bottom: number;
      right: number;
      side: number;
      barTop: number;
      barBottom: number;
      barLeft: number;
      barRight: number;
    };
    const tag = `${s.name} ${s.width}×${s.height}`;
    if (m.pageScroll > 1 || m.contentScroll > 1) {
      fail(`${tag}: 스크롤이 생깁니다 (페이지 ${m.pageScroll}px · 내용 ${m.contentScroll}px)`);
    } else if (m.top < 0 || m.left < 0 || m.bottom > s.height + 1 || m.right > s.width + 1) {
      fail(`${tag}: 보드가 화면 밖으로 나갑니다 ${JSON.stringify(m)}`);
    } else if (
      // 평가 바는 판의 왼쪽에 붙어 판과 같은 높이여야 한다(체스닷컴처럼).
      Math.abs(m.barTop - m.top) > 2 ||
      Math.abs(m.barBottom - m.bottom) > 2 ||
      m.barRight > m.left ||
      m.left - m.barRight > 16
    ) {
      fail(`${tag}: 평가 바가 판 옆에 판 높이로 붙지 않았습니다 ${JSON.stringify(m)}`);
    } else if (m.side < Math.min(s.width, s.height) * 0.4) {
      fail(`${tag}: 보드가 지나치게 작습니다 (${Math.round(m.side)}px)`);
    } else {
      fits.push(`${s.name} ${Math.round(m.side)}px`);
    }
  }
  if (fits.length === screens.length) console.log(`한 화면 핏: ${fits.join(" · ")}`);
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── 9. 설정 탭 ────────────────────────────────────────────────────
  // 대국 설정·조작이 여기로 왔다. 레일 1클릭으로 닿고, 검색이 줄을 거르고,
  // 대국 스모크가 이름으로 집는 칩들이 이 화면에 있어야 한다.
  await page.locator(".rail__link", { hasText: "설정" }).click();
  await page.waitForURL("**/settings");
  const groups = await page.locator(".sgroup").count();
  const rows = await page.locator(".srow").count();
  if (groups < 6) fail(`설정 분류 카드가 모자랍니다: ${groups}`);
  for (const name of ["새 대국", "컴퓨터 백", "RIF 오프닝", "3초", "무제한"]) {
    const n = await page.getByRole("button", { name, exact: true }).count();
    if (n !== 1) fail(`설정 탭에 「${name}」 이 하나가 아닙니다: ${n}개`);
  }
  // 스레드 조절 — 격리된 곳이면 멀티 변형이 계획되고 스레드 선택이 켜져 있어야 한다.
  // 격리되지 않은 곳(SMOKE_ISOLATE=0)이면 단일로 계획되고 선택이 잠겨 있어야 한다.
  const isolated = (await page.evaluate("crossOriginIsolated")) as boolean;
  if (isolated !== ISOLATE) fail(`crossOriginIsolated=${isolated} (기대 ${ISOLATE})`);
  const variantText = (await page.locator(".srow", { hasText: "엔진 변형" }).innerText()).trim();
  const wantVariant = ISOLATE ? "multi-simd128" : "single-simd128";
  if (!variantText.includes(wantVariant))
    fail(`엔진 변형 줄이 ${wantVariant} 가 아닙니다: ${variantText}`);
  const threadGroup = page.getByRole("radiogroup", { name: "스레드 수" });
  if ((await threadGroup.count()) !== 1) fail("스레드 수 선택이 없습니다");
  else {
    const locked = (await threadGroup.getByRole("radio").first().isDisabled()) === true;
    if (locked === ISOLATE) {
      fail(`스레드 수 선택이 ${ISOLATE ? "잠겨" : "열려"} 있습니다 (격리 ${ISOLATE})`);
    }
  }

  await page.getByRole("searchbox", { name: "설정 검색" }).fill("hash_size");
  const filtered = await page.locator(".srow").count();
  if (filtered !== 1) fail(`«hash_size» 검색이 한 줄로 좁혀지지 않습니다: ${filtered}줄`);
  await page.getByRole("searchbox", { name: "설정 검색" }).fill("");
  // 해시 크기를 바꾸면 새로고침 뒤에도 남는다(localStorage).
  await page.getByRole("radio", { name: "256", exact: true }).click();
  await page.reload({ waitUntil: "networkidle" });
  const kept = await page
    .getByRole("radio", { name: "256", exact: true })
    .getAttribute("aria-checked");
  if (kept !== "true") fail(`해시 크기가 새로고침 뒤 남지 않았습니다: aria-checked=${kept}`);
  await page.evaluate(() => localStorage.removeItem("rapfi.settings"));
  // 좁은 폭에서도 가로로 넘치지 않는가 — 칩·세그먼트가 줄을 밀어내면 여기서 잡힌다.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const overflowX = (await page.evaluate(
    `(() => { var c = document.querySelector(".shell__content");
              return c.scrollWidth - c.clientWidth; })()`,
  )) as number;
  if (overflowX > 1) fail(`좁은 폭 설정 화면이 가로로 ${overflowX}px 넘칩니다`);
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── 10. 엔진 탭 ───────────────────────────────────────────────────
  await page.locator(".rail__link", { hasText: "엔진" }).click();
  await page.waitForURL("**/engine");
  if ((await page.locator(".enginescreen .panel__badge").count()) !== 1) {
    fail("엔진 탭에 상태 표시가 없습니다");
  }
  if ((await page.locator(".enginescreen__console").count()) !== 1) {
    fail("엔진 탭에 콘솔 카드가 없습니다");
  }

  if (errors.length) fail(`콘솔 오류 ${errors.length}건:\n  ${errors.join("\n  ")}`);

  if (!process.exitCode) {
    console.log(
      "스모크 통과 — 레일 6 · 연구 탭 4 · 라우팅 · 토큰(라이트/다크) · 좁은 폭 전환\n" +
        "             보드 2레이어 · 나무 렌더 · H8 착수 · 중복 착수 무시 · 다크 나무\n" +
        `             보드 옆 칸 2장 · 평가 바(판 높이) · 설정 ${rows}줄(검색·저장·좁은 폭) · 엔진 탭`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
