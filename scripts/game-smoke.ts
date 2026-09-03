/**
 * 대국 스모크 — 진짜 엔진과 **실제로 한 판 둔다**(W4 검수).
 *
 *   pnpm build && pnpm exec tsx scripts/game-smoke.ts
 *   SMOKE_BASE_URL=https://… pnpm exec tsx scripts/game-smoke.ts   # 배포본 검사
 *
 * `engine-smoke.ts` 가 「분석이 흐른다」를 보는 데 비해 이쪽은 **대국**을 본다:
 * 차례가 오가는가, 시계가 줄어드는가, 협상이 끝까지 가는가, 기권·무승부가
 * 판을 닫는가. W4 의 검수 항목 다섯을 그대로 옮긴 것이다.
 *
 * 왜 단위 시험으로 안 되는가 — `game.test.ts` 는 엔진의 답을 **우리가** 만든다.
 * 그러면 「우리가 상상한 프로토콜」만 검증된다. 여기서는 엔진이 실제로 무엇을
 * 말하는지가 답이다. W0-1 에서 빈 판의 7,7 을 성공으로 읽었던 것과 같은 종류의
 * 착각을 막는 유일한 방법이다.
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

/** 교점 (x, y) 를 누른다. 좌상단이 (0, 14) — 화면 y 는 아래로 간다. */
async function tap(x: number, y: number) {
  const view = await page.locator(".board__view").boundingBox();
  if (!view) throw new Error("보드가 화면에 없습니다");
  const step = view.width / STEP_DIV;
  const px = view.x + step * (0.75 + x);
  const py = view.y + step * (0.75 + (14 - y));
  await page.mouse.click(px, py);
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

/** 돌 수가 `from` 보다 커질 때까지. 「누구 차례인지」를 몰라도 되는 기다림이다. */
async function waitGrew(from: number, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await stoneCount()) > from) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`돌이 ${from}개에서 더 늘지 않습니다`);
}

/**
 * 5수 후보를 몇 개 내라고 하는가. 협상 pane 의 안내문에 굵게 적힌 수다.
 * 그 단계가 아니면 0 — 엔진이 다른 갈래로 갔다는 뜻이고 그것도 정상이다.
 */
async function fifthCountAsked(timeoutMs: number): Promise<number> {
  const t0 = Date.now();
  const el = page.locator(".panel__hint[data-k=fifth] strong");
  while (Date.now() - t0 < timeoutMs) {
    if (await el.count()) {
      const n = Number(/(\d+)/.exec((await el.textContent()) ?? "")?.[1] ?? 0);
      if (n > 0) return n;
    }
    await page.waitForTimeout(200);
  }
  return 0;
}

/** 지금 떠 있는 물음의 종류. 없으면 null. */
async function prompt(): Promise<string | null> {
  const el = page.locator(".ask[data-prompt]");
  return (await el.count()) ? el.first().getAttribute("data-prompt") : null;
}

/** 협상 중 5수 후보를 놓을 자리들. 개시에서 떨어져 있고 서로 겹치지 않는다. */
const FIFTH_SPOTS: readonly [number, number][] = [
  [5, 5],
  [5, 6],
  [6, 5],
  [4, 6],
  [6, 4],
  [4, 4],
  [10, 10],
  [10, 9],
];

/**
 * 협상을 끝까지 몬다 — **묻는 것에 답할 뿐, 수순을 기대하지 않는다.**
 *
 * 처음에는 「2단계 → swap 물음 → 5수 N개」라는 한 갈래만 기다렸다. 그러나
 * 그 갈래를 고르는 것은 엔진이다(교환을 받아 버리면 물음의 종류부터 다르다).
 * 특정 수순을 못 박은 시험은 엔진이 정당하게 다른 길로 갔을 때 빨갛게 되고,
 * 그건 회귀가 아니라 시험의 착각이다.
 *
 * @returns 실제로 지나온 단계들
 */
async function negotiate(maxRounds = 12): Promise<string[]> {
  const seen: string[] = [];
  for (let round = 0; round < maxRounds; round++) {
    const kind = await waitSettle();
    if (kind === null) {
      // 물음이 없다 — 5수 후보를 놓으라는 단계일 수 있다.
      const need = await fifthCountAsked(2_000);
      if (need === 0) return seen; // 협상 끝
      seen.push(`5수 후보 ${need}개`);
      const base = await stoneCount();
      for (let i = 0; i < need; i++) await tap(...FIFTH_SPOTS[i]!);
      const placed = await stoneCount();
      if (placed !== base + need) {
        throw new Error(`5수 후보 ${placed}개 (${base}+${need} 기대)`);
      }
      // 엔진이 하나를 고르면 판이 **넷으로 되감기고** 그 하나가 5수가 된다.
      await waitStones(5, 150_000, "(엔진의 5수 선택)");
      seen.push("엔진이 5수 선택");
      continue;
    }

    seen.push(kind);
    switch (kind) {
      case "swap":
        // 「그대로」 — 우리가 잡은 색을 지킨다. 어느 쪽이든 협상은 이어진다.
        await click("그대로");
        break;
      case "fifthCount":
        await click("3");
        break;
      case "swapInfo":
      case "info":
        await click("확인");
        break;
      case "illegalOpening":
        throw new Error("개시 영역 검사가 정상 개시를 물렸습니다");
      case "forbidden":
        await click("확인");
        break;
      default:
        throw new Error(`협상에서 뜻밖의 물음: ${kind}`);
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`협상이 ${maxRounds}바퀴에 안 끝납니다: ${seen.join(" → ")}`);
}

/**
 * 화면이 잠잠해질 때까지 기다린 뒤 지금 떠 있는 물음을 돌려준다.
 * 엔진이 생각하는 동안은 물음도 없고 판도 그대로라, 그 둘이 함께 멎어야
 * 「지금이 우리 차례」다.
 */
async function waitSettle(timeoutMs = 150_000): Promise<string | null> {
  const t0 = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - t0 < timeoutMs) {
    const p = await prompt();
    if (p) return p;
    const n = await stoneCount();
    stable = n === last ? stable + 1 : 0;
    last = n;
    // 1.5초 동안 판이 그대로면 엔진은 말을 마쳤다.
    if (stable >= 6) return null;
    await page.waitForTimeout(250);
  }
  throw new Error("협상이 멎지 않습니다 — 엔진이 계속 생각 중입니다");
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
  await tap(8, 8);
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

  // ── 5. Soosorv-8 협상 전체 흐름 ───────────────────────────────────
  //
  // 여기가 이 스모크의 본론이다. 첫 세 수를 손으로 놓으면 그 뒤는 엔진이
  // 이끈다 — 교환을 물을 수도, 4수와 N 을 낼 수도 있다. **어느 갈래로 갈지는
  // 엔진이 정한다.** 그래서 특정 수순을 기대하지 않고, 묻는 것에 답하며
  // 「협상이 끝나고 평범한 대국으로 이어지는가」를 본다.
  console.log("\n5. Soosorv-8 — 협상 전체");
  await click("Soosorv-8"); // 규칙을 바꾸면 새 대국이다
  await click("컴퓨터 백");

  // 개시 영역: 1수 천원, 2수 한 점 이내, 3수 두 점 이내.
  await tap(7, 7);
  await tap(8, 7);
  await tap(9, 5);
  const opened = await stoneCount();
  if (opened !== 3) fail(`개시 세 수가 놓이지 않았습니다: ${opened}개`);
  else ok("개시 세 수를 손으로 놓았다");

  const seen = await negotiate();
  if (seen.length === 0) fail("협상이 한 번도 말을 걸지 않았습니다");
  else ok(`협상 단계: ${seen.join(" → ")}`);

  const settled = await stoneCount();
  if (settled < 4) fail(`협상이 끝났는데 판이 ${settled}개뿐입니다`);
  else ok(`협상 종료 — 돌 ${settled}개`);

  // 협상이 끝났으면 그 뒤로는 평범한 대국이어야 한다. 몇 수째인지는 위
  // 갈래에 따라 다르므로 **자라는지**만 본다 — 엔진 차례면 저절로, 사람
  // 차례면 한 번 눌러서.
  if (settled % 2 === 0) await tap(1, 1);
  await waitGrew(settled, 150_000);
  ok(`협상 뒤 평범한 대국으로 이어진다 (돌 ${await stoneCount()}개)`);

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
