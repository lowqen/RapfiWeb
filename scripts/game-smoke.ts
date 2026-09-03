/**
 * 대국 스모크 — 진짜 엔진과 **실제로 한 판 둔다**(W4 검수).
 *
 *   pnpm build && pnpm exec tsx scripts/game-smoke.ts
 *   SMOKE_BASE_URL=https://… pnpm exec tsx scripts/game-smoke.ts   # 배포본 검사
 *
 * `engine-smoke.ts` 가 「분석이 흐른다」를 보는 데 비해 이쪽은 **대국**을 본다:
 * 차례가 오가는가, 시계가 줄어드는가, 개시가 도는가, 기권·무승부가 판을 닫는가.
 *
 * 왜 단위 시험으로 안 되는가 — `game.test.ts` 는 엔진의 답을 **우리가** 만든다.
 * 그러면 「우리가 상상한 프로토콜」만 검증된다. 여기서는 엔진이 실제로 무엇을
 * 말하는지가 답이고, 그 덕에 이 스모크가 W4 의 큰 사실 하나를 찾아냈다:
 *
 *   **Rapfi 는 `yxswap2step*` / `yxsoosorvstep*` 를 모른다.** 그 둘은 Yixin 의
 *   명령이고 데스크톱 main.c 가 말을 거는 상대가 Yixin 이다. Rapfi 의 명령표
 *   (`command/gomocup.cpp` @3c94c2a9)에 없으며, GUI 모드는 모르는 명령을
 *   오류도 없이 삼킨다. 앱(RapfiDroid)도 같은 명령을 보내고 같은 침묵을 받는데,
 *   그쪽 시험도 `FakeEngine` 이라 여태 드러나지 않았다.
 *
 * 그래서 여기서 도는 개시는 **엔진의 협상 명령이 필요 없는 셋**이다(자유 렌주,
 * RIF, 첫 수 이후 교환). Soosorv-8 과 스왑2 는 「협상이 된다」가 아니라
 * 「막혔을 때 판이 잠기지 않는다」를 본다.
 */
import { chromium, type Page } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const PORT = Number(process.env.SMOKE_PORT ?? 4182);

const REMOTE = process.env.SMOKE_BASE_URL?.replace(/\/$/, "") ?? "";
const BASE = REMOTE || `http://localhost:${PORT}`;

const GLUE = join(DIST, "engine/rapfi-single-simd128.js");
const DATA = join(DIST, "engine/rapfi-single-simd128.data");

if (!REMOTE && (!existsSync(GLUE) || !existsSync(DATA))) {
  console.log("엔진 산출물이 없어 건너뜁니다 (dist/engine/).");
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
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end("not found");
  }
});

const failures: string[] = [];
const fail = (m: string) => {
  console.error(`  ✗ ${m}`);
  failures.push(m);
  process.exitCode = 1;
};
const ok = (m: string) => console.log(`  ✓ ${m}`);

if (!REMOTE) await new Promise<void>((r) => server.listen(PORT, r));
const browser = await chromium.launch();
const page: Page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push("[pageerror] " + (e.stack ?? String(e))));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push("[console] " + m.text());
});

// ── 판을 다루는 손 ───────────────────────────────────────────────────

/** 보드는 15×15 에 여백 0.75칸이라 한 변이 15.5 step 이다. */
const STEP_DIV = 15.5;

/**
 * 보드 좌표 (x, y) 를 누른다.
 *
 * **y 를 뒤집지 않는다.** `board-geometry` 의 `cy(y) = origin + y*step` 이라
 * 보드 y 는 화면에서 아래로 자란다 — 뒤집히는 것은 **사람이 읽는 표기**뿐이다
 * (`label` 이 `size - y` 로 센다). 처음에 여기서 14-y 를 쓴 탓에 둘째 수가
 * 엔진이 방금 둔 자리를 눌러 조용히 무시됐다.
 */
async function tap(x: number, y: number) {
  const view = await page.locator(".board__view").boundingBox();
  if (!view) throw new Error("보드가 화면에 없습니다");
  const step = view.width / STEP_DIV;
  await page.mouse.click(view.x + step * (0.75 + x), view.y + step * (0.75 + y));
  await page.waitForTimeout(120);
}

const stoneCount = async (): Promise<number> => {
  const aria = (await page.locator("canvas[role=img]").getAttribute("aria-label")) ?? "";
  return Number(/돌 (\d+)개/.exec(aria)?.[1] ?? -1);
};

/** 돌 수가 `n` 이 될 때까지. 엔진의 답을 기다리는 거의 모든 자리가 이것이다. */
async function waitStones(n: number, timeoutMs = 60_000, why = "") {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await stoneCount()) === n) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`돌 ${n}개를 기다렸으나 ${await stoneCount()}개 ${why}`);
}

/** 지금 떠 있는 물음의 종류. 없으면 null. */
async function prompt(): Promise<string | null> {
  const el = page.locator(".ask[data-prompt]");
  return (await el.count()) ? el.first().getAttribute("data-prompt") : null;
}

/** 칩·버튼은 이름으로 집는다 — 순서는 화면을 손볼 때마다 바뀐다. */
const click = (name: string) => page.getByRole("button", { name, exact: true }).click();

const clockText = async (side: "human" | "computer", k: "big" | "sub") =>
  (await page.locator(`.clock[data-side=${side}] [data-k=${k}]`).innerText()).trim();

const toMs = (mmss: string): number => {
  const p = mmss.split(":").map(Number);
  if (p.length === 3) return ((p[0] ?? 0) * 3600 + (p[1] ?? 0) * 60 + (p[2] ?? 0)) * 1000;
  return ((p[0] ?? 0) * 60 + (p[1] ?? 0)) * 1000;
};

async function dump(why: string) {
  console.error(`\n──── 실패 지점: ${why} ────`);
  try {
    const lines = (await page.locator(".console").innerText({ timeout: 2000 })).split("\n");
    console.error(`엔진 콘솔 (마지막 40줄):\n${lines.slice(-40).join("\n")}`);
  } catch {
    console.error("엔진 콘솔을 읽지 못했습니다.");
  }
  try {
    console.error(`\n떠 있는 물음: ${await prompt()}`);
    console.error(`돌 ${await stoneCount()}개`);
  } catch {
    /* 화면이 이미 무너졌으면 더 캘 것이 없다 */
  }
  if (pageErrors.length) console.error(`\n페이지 오류:\n${pageErrors.slice(-10).join("\n")}`);
  console.error("────────────────────────────\n");
}

// ── 검수 ─────────────────────────────────────────────────────────────

try {
  await page.goto(`${BASE}/board`, { waitUntil: "networkidle" });

  const t0 = Date.now();
  await click("엔진 시작");
  await page.locator('.panel__badge[data-status="ready"]').waitFor({ timeout: 180_000 });
  console.log(`엔진 기동 ${Date.now() - t0}ms\n`);

  // ── 1. 렌주 자유 규칙으로 대국 ────────────────────────────────────
  console.log("1. 자유 렌주 — 차례가 오가는가");
  await click("컴퓨터 백");
  await tap(7, 7);
  await waitStones(2, 60_000, "(사람 1수 뒤 엔진의 답)");
  ok("사람 → 엔진 → 사람으로 차례가 돌았다");

  const turn = (await page.locator("dd[data-k=turn]").innerText()).trim();
  if (turn !== "흑") fail(`두 수 뒤 차례가 흑이 아닙니다: ${turn}`);
  else ok("두 수 뒤 흑 차례");

  // 사람이 한 수 더 두고 엔진이 또 답하는지 — 한 번은 우연일 수 있다.
  // **구석에 둔다.** 가운데 근처를 고르면 엔진이 방금 둔 자리와 부딪혀
  // 「무시」로 떨어지고, 시험은 그것을 회귀로 읽는다(실제로 한 번 겪었다).
  await tap(1, 1);
  await waitStones(4, 60_000, "(둘째 왕복)");
  ok("두 번째 왕복도 정상");

  // ── 2. 시계 ───────────────────────────────────────────────────────
  console.log("\n2. 시계 — 줄어드는가");
  await click("새 대국");
  await click("5분");
  await click("사람 대 사람"); // 엔진이 끼어들지 않게 두고 사람 시계만 본다
  await tap(7, 7); // 시계가 돌기 시작한다

  const before = await clockText("human", "big");
  await page.waitForTimeout(2500);
  const after = await clockText("human", "big");
  const delta = toMs(before) - toMs(after);
  if (delta < 1000) fail(`사람 시계가 2.5초에 ${delta}ms 만 줄었습니다`);
  else ok(`사람 시계 카운트다운 ${before} → ${after}`);

  const active = await page.locator(".clock[data-active]").count();
  if (active !== 1) fail(`도는 시계가 정확히 하나가 아닙니다: ${active}개`);
  else ok("도는 시계는 한 쪽뿐");

  // ── 3. 다크 모드에서 시계 가독성 ──────────────────────────────────
  console.log("\n3. 다크 모드 — 시계가 읽히는가");
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.waitForTimeout(300);
  // **문자열로 넘긴다.** tsx(esbuild)가 keep-names 로 이름 있는 함수에
  // `__name(...)` 헬퍼를 끼워 넣는데 그 헬퍼는 브라우저에 없다 —
  // `engine-smoke.ts` 가 같은 자리에서 한 번 죽었고, 여기서 또 죽었다.
  // 문자열은 변환을 거치지 않는다.
  const contrast = (await page.evaluate(`(() => {
    var el = document.querySelector(".clock[data-side=human] [data-k=big]");
    if (!el) return null;
    function lum(c) {
      var m = (c.match(/[\\d.]+/g) || [0, 0, 0]).map(Number);
      var v = m.slice(0, 3).map(function (x) {
        var s = x / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    }
    // 배경은 시계 칸에서 온다 — 글자 자체는 배경이 투명하다.
    var fg = lum(getComputedStyle(el).color);
    var bg = lum(getComputedStyle(el.closest(".clock")).backgroundColor);
    var hi = Math.max(fg, bg), lo = Math.min(fg, bg);
    return (hi + 0.05) / (lo + 0.05);
  })()`)) as number | null;
  if (contrast === null) fail("다크 모드에서 시계를 찾지 못했습니다");
  else if (contrast < 4.5) fail(`다크 시계 대비 ${contrast.toFixed(2)}:1 (4.5 미만)`);
  else ok(`다크 모드 시계 대비 ${contrast.toFixed(2)}:1`);
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));

  // ── 4. 기권 · 무승부 ──────────────────────────────────────────────
  console.log("\n4. 기권 · 무승부");
  await click("새 대국");
  await click("무제한");
  await tap(7, 7);
  await click("기권");
  const resigned = (await page.locator(".gameover").innerText()).trim();
  if (!resigned.includes("기권")) fail(`기권 결과가 표시되지 않습니다: ${resigned}`);
  else ok(`기권 → ${resigned}`);

  await click("새 대국");
  await tap(7, 7);
  await click("무승부");
  const drawn = (await page.locator(".gameover").innerText()).trim();
  if (!drawn.includes("무승부")) fail(`무승부 결과가 표시되지 않습니다: ${drawn}`);
  else ok(`무승부 → ${drawn}`);

  // ── 5. RIF 오프닝 — 첫 세 수를 손으로 ─────────────────────────────
  //
  // RIF 는 협상 명령이 오가지 않는다. 첫 세 수를 개시 영역 안에 손으로 놓고
  // 그 뒤는 평범한 대국이다 — 그래서 이 엔진에서도 온전히 돈다.
  console.log("\n5. RIF 오프닝");
  await click("RIF 오프닝"); // 규칙을 바꾸면 새 대국이다
  await click("컴퓨터 백");
  await tap(7, 7);
  await tap(8, 7);
  await tap(9, 5);
  const rifOpened = await stoneCount();
  if (rifOpened !== 3) fail(`개시 세 수가 놓이지 않았습니다: ${rifOpened}개`);
  else ok("개시 세 수를 손으로 놓았다");
  // 세 수가 차면 백 차례 — 엔진이 받는다.
  await waitStones(4, 90_000, "(RIF 개시 뒤 엔진의 4수)");
  ok("세 수 뒤 엔진이 이어받았다");

  // ── 6. 첫 수 이후 교환 ────────────────────────────────────────────
  //
  // 교환 여부를 **데스크톱이 스스로** 정하는 규칙이라(main.c:2771) 엔진의
  // 협상 명령이 필요 없다. 그래서 이 엔진에서도 온전히 돈다.
  console.log("\n6. 첫 수 이후 교환");
  await click("첫 수 이후 교환");
  await click("컴퓨터 백");
  await tap(7, 7); // 천원 — 먼 개시라 교환 조건에 걸린다
  await page.waitForTimeout(600);
  if ((await prompt()) === "swapInfo") {
    ok("엔진이 색을 가져가고 알렸다");
    await click("확인");
    // 이제 우리가 백이다 — 한 수 두면 엔진(흑)이 답한다.
    await tap(5, 5);
    await waitStones(3, 90_000, "(교환 뒤 엔진의 3수)");
    ok("색이 넘어간 뒤에도 차례가 돈다");
  } else {
    // 교환하지 않았으면 엔진이 백으로 그대로 이어 둔다.
    await waitStones(2, 90_000, "(교환 없이 엔진의 2수)");
    ok("교환 없이 엔진이 이어 뒀다");
  }

  // ── 7. Soosorv-8 · 스왑2 — 이 엔진이 답하지 못하는 협상 ───────────
  //
  // **Rapfi 는 `yxsoosorvstep*` / `yxswap2step*` 를 모른다.** 그 둘은 Yixin 의
  // 명령이고, 데스크톱 main.c 가 말을 거는 상대가 Yixin 이다. Rapfi 의 명령표
  // (`command/gomocup.cpp` @3c94c2a9)에는 없으며 GUI 모드에서는 모르는 명령을
  // 오류도 없이 삼킨다 — 그래서 답이 영원히 오지 않는다.
  //
  // 여기서 보는 것은 「협상이 된다」가 아니라 **「막혔을 때 판이 잠기지
  // 않는다」**다. 감시견이 기다림을 풀고 사람에게 사실을 알려야 한다.
  console.log("\n7. Soosorv-8 · 스왑2 — 엔진이 답하지 않는 협상");

  // 개시 영역 검사는 **우리가** 한다(앱과 같이 Soosorv 에서만) — 엔진과 무관하다.
  //
  // **색을 먼저 고른다.** 개시 칩은 곧 새 대국이고, 새 대국은 「컴퓨터 흑 +
  // 스왑2/Soosorv」면 협상을 먼저 연다. 앞 단계에서 색이 흑으로 넘어와 있으면
  // 여기서 그 협상이 열려 판이 잠긴 채로 시작한다.
  await click("컴퓨터 백");
  await click("Soosorv-8");
  await tap(0, 0);
  await tap(1, 1);
  await tap(2, 2);
  await page.waitForTimeout(400);
  if ((await prompt()) !== "illegalOpening") fail("개시 영역 위반을 알리지 않습니다");
  else ok("개시 영역 위반을 잡아 판을 되돌렸다");
  await click("확인");

  await click("컴퓨터 백");
  await click("스왑2");
  await tap(7, 7);
  await tap(8, 7);
  await tap(8, 8); // 셋째 돌 뒤에 yxswap2step2 가 나간다
  await page.waitForTimeout(600);

  // 감시견이 풀어 줄 때까지. 이게 없으면 판은 영영 «엔진이 생각 중»이다.
  await page.locator('.ask[data-prompt="info"]').waitFor({ timeout: 40_000 });
  ok("협상이 막혀도 감시견이 기다림을 풀었다");
  await click("확인");

  // 그리고 사용자는 빠져나올 수 있어야 한다 — 자유 렌주로 돌아가 이어 둔다.
  await click("자유 렌주");
  await tap(7, 7);
  await waitStones(2, 90_000, "(협상이 막힌 뒤 복구)");
  ok("막힌 협상에서 빠져나와 다시 둘 수 있다");
  if (pageErrors.length) {
    fail(`페이지 오류 ${pageErrors.length}건:\n  ${pageErrors.slice(0, 5).join("\n  ")}`);
  }
} catch (e) {
  const first = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e);
  await dump(first);
  fail(first);
} finally {
  await browser.close();
  if (!REMOTE) server.close();
}

if (failures.length) console.log(`\n대국 스모크 실패 ${failures.length}건`);
else console.log("\n대국 스모크 통과");
