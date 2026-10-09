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
import { ISOLATION_HEADERS, ISOLATE, hasEngine } from "./isolation.ts";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_DEFAULTS,
  render as renderDesktop,
} from "../src/core/settings/desktop-settings.ts";
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

  // 0. **자동 기동.** 앱이 뜨면 엔진이 뒤에서 기동한다 — 산출물이 있으면 「준비」, 없으면
  // (CI 의 첫 스모크는 엔진 조립 전이다) 「오류」로 **조용히** 끝나야 한다: 페이지 오류 없이,
  // 상단 바가 그 사실을 말하고 「다시 시도」를 낸다. 화면은 그동안 막히지 않는다.
  const wantBoot = hasEngine(DIST) ? "ready" : "error";
  const chip = page.locator('[data-k="engine-indicator"]');
  await page
    .waitForFunction(
      (want) =>
        document.querySelector('[data-k="engine-indicator"]')?.getAttribute("data-status") === want,
      wantBoot,
      { timeout: 120_000, polling: 200 },
    )
    .catch(() => undefined);
  const booted = await chip.getAttribute("data-status");
  if (booted !== wantBoot) fail(`자동 기동이 «${wantBoot}» 로 끝나지 않았습니다: ${booted}`);
  if (wantBoot === "error" && (await page.getByRole("button", { name: "엔진 기동" }).count()) !== 1)
    fail("엔진이 뜨지 못했는데 상단 바에 「다시 시도」가 없습니다");
  const engineSelect = page.getByRole("combobox", { name: "엔진 선택" });
  if ((await engineSelect.count()) !== 1) fail("상단 바에 엔진 선택 드롭다운이 없습니다");
  else {
    const opts = await engineSelect.locator("option").allInnerTexts();
    if (opts.length !== 4) fail(`엔진 선택 항목이 넷이 아닙니다: ${opts.join(" · ")}`);
    if ((await engineSelect.inputValue()) !== "auto")
      fail("엔진 선택의 기본이 「자동」이 아닙니다");
  }

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
  // URL 이 /research/review 로 바뀐 것과 상단 바가 탭 제목으로 다시 그려진 것은 따로 일어난다 —
  // 느린 러너에서는 그 사이에 읽어 «연구»만 보였다(web 37256559517). 1. 의 URL 처럼 바뀔 때까지 기다린다.
  await page
    .waitForFunction(
      () =>
        document.querySelector(".topbar__title")?.textContent?.trim().startsWith("연구 ·") ?? false,
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
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
  // [대국] | [분석] 탭 — 기본은 대국. 대국 설정(흑/백 · 시간 · 레벨 · 개시)은 대국 탭 카드에 있다.
  const modeTabs = page.getByRole("tablist", { name: "보드 모드" });
  if ((await modeTabs.getByRole("tab").count()) !== 2) fail("보드에 [대국] | [분석] 탭이 없습니다");
  const gameTab = modeTabs.getByRole("tab", { name: "대국", exact: true });
  if ((await gameTab.getAttribute("aria-selected")) !== "true") fail("기본 탭이 대국이 아닙니다");
  for (const name of ["컴퓨터 백", "3초", "RIF 오프닝"]) {
    const n = await page.getByRole("button", { name, exact: true }).count();
    if (n !== 1) fail(`대국 탭에 「${name}」 이 하나가 아닙니다: ${n}개`);
  }
  if ((await page.getByRole("radiogroup", { name: "레벨" }).count()) !== 1)
    fail("대국 탭에 레벨이 없습니다");
  if ((await page.getByRole("button", { name: "새 대국", exact: true }).count()) !== 0)
    fail("「새 대국」 이 보드에 있습니다 — 새 판은 퀵 바의 몫입니다");
  if ((await page.getByRole("button", { name: "엔진 분석" }).count()) !== 0)
    fail("대국 탭의 이동 바에 분석 ▶ 가 있습니다 — 분석 탭의 것입니다");
  // 퀵 액션 바 — 판 위에 새 판·진영 전환 둘뿐, 국면 카드에 기권·무승부. 분석·무르기·
  // 되돌리기는 이동 바의 몫이라 퀵 바에 다시 생기면 여기서 잡는다(위아래 두 벌).
  const quickbar = page.getByRole("navigation", { name: "퀵 액션" });
  if ((await quickbar.count()) !== 1) fail("보드에 퀵 액션 바가 없습니다");
  const quickButtons = await quickbar.getByRole("button").count();
  if (quickButtons !== 2) fail(`퀵 액션 바 버튼이 둘(새 판·진영 전환)이 아닙니다: ${quickButtons}`);
  for (const name of ["새 판", "진영 전환"]) {
    const n = await quickbar.getByRole("button", { name, exact: true }).count();
    if (n !== 1) fail(`퀵 액션 바에 「${name}」 이 하나가 아닙니다: ${n}개`);
  }
  for (const name of ["기권", "무승부"]) {
    const n = await page.getByRole("button", { name, exact: true }).count();
    if (n !== 1) fail(`보드 국면 카드에 「${name}」 이 하나가 아닙니다: ${n}개`);
  }
  if ((await page.locator(".console").count()) !== 0) fail("콘솔이 아직 보드 화면에 있습니다");

  // [분석] 탭 — 엔진 카드 · 형세 그래프 · 분석 설정 · 국면. 기권·무승부와 대국 설정은 없다.
  // 판(돌 둘)은 탭을 바꿔도 그대로다.
  await modeTabs.getByRole("tab", { name: "분석", exact: true }).click();
  await page.waitForTimeout(150);
  const analysisCards = await page.locator(".boardscreen__side > .panel").count();
  if (analysisCards !== 4) fail(`분석 탭 옆 칸 카드가 넷이 아닙니다: ${analysisCards}`);
  if ((await page.locator(".evalgraph").count()) !== 1) fail("분석 탭에 형세 그래프가 없습니다");
  for (const name of ["기권", "컴퓨터 백"]) {
    if ((await page.getByRole("button", { name, exact: true }).count()) !== 0)
      fail(`분석 탭에 「${name}」 이 있습니다 — 대국 탭의 것입니다`);
  }
  for (const name of ["분석", "정지"]) {
    if ((await page.getByRole("button", { name, exact: true }).count()) !== 1)
      fail(`분석 탭에 「${name}」 이 하나가 아닙니다`);
  }
  if (
    (await page
      .getByRole("switch", { name: "정지하면 최선수 두기" })
      .getAttribute("aria-checked")) !== "true"
  )
    fail("「정지하면 최선수 두기」 가 기본으로 켜져 있지 않습니다");
  if ((await page.getByRole("button", { name: "엔진 분석" }).count()) !== 1)
    fail("분석 탭의 이동 바에 분석 ▶ 가 없습니다");
  const keptStones = await page.locator("canvas[role=img]").getAttribute("aria-label");
  if (!keptStones?.includes("돌 2개")) fail(`탭을 바꾸자 판이 바뀌었습니다: ${keptStones}`);
  // 새로고침해도 고른 탭이 남는다.
  await page.reload({ waitUntil: "networkidle" });
  const keptTab = await page
    .getByRole("tab", { name: "분석", exact: true })
    .getAttribute("aria-selected");
  if (keptTab !== "true") fail("새로고침 뒤 분석 탭이 남지 않았습니다");
  await page.getByRole("tab", { name: "대국", exact: true }).click();
  await page.waitForTimeout(150);

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
  // 처음에는 「자주 쓰는 설정」 카드 하나와 고급 설정 스위치만 — 고급은 접혀 있다.
  const basicGroups = await page.locator(".sgroup").count();
  const basicRows = await page.locator(".srow").count();
  if (basicGroups !== 1) fail(`고급을 접었는데 설정 카드가 하나가 아닙니다: ${basicGroups}`);
  if (basicRows < 5 || basicRows > 9) fail(`자주 쓰는 설정이 엄선되지 않았습니다: ${basicRows}줄`);
  const advSwitch = page.getByRole("switch", { name: "고급 설정", exact: true });
  if ((await advSwitch.count()) !== 1) fail("고급 설정 스위치가 없습니다");
  // 대국·분석 설정은 보드 탭으로 갔다 — 여기에 남으면 같은 값의 조작부가 두 벌이다.
  for (const name of ["컴퓨터 백", "RIF 오프닝", "3초"]) {
    const n = await page.getByRole("button", { name, exact: true }).count();
    if (n !== 0) fail(`설정 탭에 「${name}」 이 아직 있습니다 — 보드의 대국 탭의 것입니다`);
  }
  if ((await page.getByRole("radiogroup", { name: "분석 시간" }).count()) !== 0)
    fail("설정 탭에 분석 시간이 아직 있습니다 — 보드의 분석 탭의 것입니다");
  if ((await page.getByRole("button", { name: "보드 › 대국 탭" }).count()) !== 1)
    fail("설정 탭에 대국·분석 설정의 길잡이가 없습니다");
  if ((await page.getByRole("combobox", { name: "엔진 선택" }).count()) !== 2)
    fail("설정 탭의 「엔진」 줄에 엔진 선택이 없습니다(상단 바와 둘이어야 합니다)");
  if (
    (await page
      .getByRole("switch", { name: "앱을 열면 엔진 시작" })
      .getAttribute("aria-checked")) !== "true"
  )
    fail("「앱을 열면 엔진 시작」 이 기본으로 켜져 있지 않습니다");
  // 스레드 조절 — 격리된 곳이면 멀티 변형이 계획되고 스레드 선택이 켜져 있어야 한다.
  // 격리되지 않은 곳(SMOKE_ISOLATE=0)이면 단일로 계획되고 선택이 잠겨 있어야 한다.
  const isolated = (await page.evaluate("crossOriginIsolated")) as boolean;
  if (isolated !== ISOLATE) fail(`crossOriginIsolated=${isolated} (기대 ${ISOLATE})`);
  const variantText = (await page.locator('[data-k="engine-variant"]').innerText()).trim();
  const wantVariant = ISOLATE ? "multi-simd128" : "single-simd128";
  if (!variantText.includes(wantVariant))
    fail(`스레드 줄의 엔진 변형이 ${wantVariant} 가 아닙니다: ${variantText}`);
  const threadGroup = page.getByRole("radiogroup", { name: "스레드 수" });
  if ((await threadGroup.count()) !== 1) fail("스레드 수 선택이 없습니다");
  else {
    const locked = (await threadGroup.getByRole("radio").first().isDisabled()) === true;
    if (locked === ISOLATE) {
      fail(`스레드 수 선택이 ${ISOLATE ? "잠겨" : "열려"} 있습니다 (격리 ${ISOLATE})`);
    }
  }

  // 검색은 접힌 고급 설정까지 찾는다.
  await page.getByRole("searchbox", { name: "설정 검색" }).fill("hash_size");
  const filtered = await page.locator(".srow").count();
  if (filtered !== 1) fail(`«hash_size» 검색이 한 줄로 좁혀지지 않습니다: ${filtered}줄`);
  // 옮겨 간 설정의 이름으로 찾으면 길잡이 줄이 나온다.
  await page.getByRole("searchbox", { name: "설정 검색" }).fill("착수 시간");
  const moved = await page.locator('.srow[data-row="boardTabs"]').count();
  if (moved !== 1) fail("«착수 시간» 검색이 대국·분석 길잡이 줄을 찾지 못합니다");
  await page.getByRole("searchbox", { name: "설정 검색" }).fill("");
  // 고급을 펼치면 엔진·표시·시스템 카드가 이어진다.
  await advSwitch.click();
  const groups = await page.locator(".sgroup").count();
  const rows = await page.locator(".srow").count();
  if (groups !== 4) fail(`고급을 펼쳤는데 설정 카드가 넷이 아닙니다: ${groups}`);
  // 해시 크기를 바꾸면 새로고침 뒤에도 남는다(localStorage) — 고급 펼침도 함께.
  await page.getByRole("radio", { name: "256", exact: true }).click();
  await page.reload({ waitUntil: "networkidle" });
  const kept = await page
    .getByRole("radio", { name: "256", exact: true })
    .getAttribute("aria-checked")
    .catch(() => "없음(고급이 다시 접힘)");
  if (kept !== "true") fail(`해시 크기가 새로고침 뒤 남지 않았습니다: aria-checked=${kept}`);
  await page.evaluate(() => localStorage.removeItem("rapfi.settings"));

  // W5b: 데스크톱 settings.txt 왕복 — 올리면 웹 값이 되고(해시는 웹 선택지로, 27행은 테마를
  // 고정), 곧바로 내보내면 **올린 바이트 그대로** 나와야 한다(웹이 깎은 해시 8192 도 지킨다).
  // 컴퓨터 흑(4행)과 DB(32행)는 꺼서 올린다 — 켜면 뒤 단계에서 엔진이 판에 끼어든다.
  {
    const crlf = (t: string) => t.replace(/\n/g, "\r\n");
    const values = { ...DESKTOP_DEFAULTS, hashSizeMb: 8192, useDatabase: false };
    const mainText = crlf(renderDesktop(values, "main"));
    const devText = crlf(renderDesktop(values, "dev"));
    const input = page.locator('[data-k="desktop-settings-input"]');
    if ((await input.count()) !== 1) fail("설정에 데스크톱 설정 파일 가져오기가 없습니다");
    else {
      await input.setInputFiles([
        { name: "settings.txt", mimeType: "text/plain", buffer: Buffer.from(mainText) },
        { name: "settings_dev.txt", mimeType: "text/plain", buffer: Buffer.from(devText) },
      ]);
      const result = page.locator('[data-k="desktop-settings-result"]');
      await result.waitFor({ timeout: 5_000 });
      const said = await result.innerText();
      if (!said.includes("8192MB → 512MB")) fail(`가져오기가 해시를 말하지 않습니다: ${said}`);
      if (
        (await page
          .getByRole("radio", { name: "512", exact: true })
          .getAttribute("aria-checked")) !== "true"
      )
        fail("가져온 해시(→512)가 설정에 들어가지 않았습니다");
      if ((await page.evaluate("document.documentElement.dataset.theme")) !== "dark")
        fail("27행(다크)이 테마를 고정하지 않았습니다");
      const downloads: { name: string; text: string }[] = [];
      const got = new Promise<void>((done) => {
        page.on("download", async (d) => {
          const path = await d.path();
          downloads.push({
            name: d.suggestedFilename(),
            text: path ? readFileSync(path, "utf8") : "",
          });
          if (downloads.length === 2) done();
        });
      });
      await page.getByRole("button", { name: "내보내기", exact: true }).click();
      await Promise.race([got, page.waitForTimeout(10_000)]);
      const back = Object.fromEntries(downloads.map((d) => [d.name, d.text]));
      if (back["settings.txt"] !== mainText) fail("내보낸 settings.txt 가 올린 파일과 다릅니다");
      if (back["settings_dev.txt"] !== devText)
        fail("내보낸 settings_dev.txt 가 올린 파일과 다릅니다");
    }
    await page.evaluate(() => {
      for (const k of [
        "rapfi.desktop",
        "rapfi.theme",
        "rapfi.settings",
        "rapfi.prove",
        "rapfi.db",
        "rapfi.review",
      ])
        localStorage.removeItem(k);
    });
    await page.reload({ waitUntil: "networkidle" });
  }
  // 좁은 폭에서도 가로로 넘치지 않는가 — 칩·세그먼트가 줄을 밀어내면 여기서 잡힌다.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const overflowX = (await page.evaluate(
    `(() => { var c = document.querySelector(".shell__content");
              return c.scrollWidth - c.clientWidth; })()`,
  )) as number;
  if (overflowX > 1) fail(`좁은 폭 설정 화면이 가로로 ${overflowX}px 넘칩니다`);
  // 상단 바(제목 · 엔진 표시 · 엔진 선택 · 테마)도 좁은 폭에서 넘치지 않는다.
  const topOverflow = (await page.evaluate(
    `(() => { var t = document.querySelector(".topbar"); var r = t.getBoundingClientRect();
              var over = 0;
              t.querySelectorAll("*").forEach(function (e) {
                var b = e.getBoundingClientRect(); if (b.width) over = Math.max(over, b.right - r.right);
              });
              return Math.max(over, document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth); })()`,
  )) as number;
  if (topOverflow > 1) fail(`좁은 폭 상단 바가 ${topOverflow}px 넘칩니다`);
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
        `             자동 기동(${wantBoot}) · 엔진 선택 · [대국]|[분석] 탭 · 탭 기억\n` +
        "             보드 2레이어 · 나무 렌더 · H8 착수 · 중복 착수 무시 · 다크 나무\n" +
        `             보드 옆 칸 2장 · 퀵 바 · 평가 바(판 높이) · 설정 ${basicRows}+${rows - basicRows}줄(고급 스위치·검색·저장·좁은 폭) · 엔진 탭`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
