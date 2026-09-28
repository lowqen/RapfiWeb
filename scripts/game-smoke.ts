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
 * 그래서 Soosorv-8 과 스왑2 는 **목록에서 내렸다**. 남은 셋(자유 렌주, RIF,
 * 첫 수 이후 교환)은 엔진의 협상 명령이 필요 없고, 여기서 끝까지 돈다.
 * 8단계가 「배포본에 정말 셋만 있는가」를 확인한다.
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
 *
 * **누르기 전에 그 점이 정말 보드인지 본다.** `mouse.click` 은 뷰포트 좌표를
 * 쓰는데, 바로 앞의 `locator.click()`(칩·버튼)이 그 요소를 보이게 하려고
 * 스크롤한다. 두 번 당했다: 한 번은 보드가 뷰포트 위로 424px 밀려 탭이 허공을
 * 눌렀고, 한 번은 보드 윗줄이 고정 상단 바 밑에 깔려 상단 바가 클릭을 받았다.
 * 둘 다 「엔진이 답하지 않는다」처럼 보였지만 클릭이 판에 닿지도 않은 것이다.
 */
async function tap(x: number, y: number) {
  const board = page.locator(".board__view");
  // 누를 **그 점**이 실제로 보드인지 확인하고 누른다. 보드(984px)가 스크롤
  // 영역보다 커서, 스크롤 뒤에는 윗줄이 고정된 상단 바 **밑으로** 들어간다 —
  // 그때 (0,0) 을 누르면 상단 바가 클릭을 받고 판에는 아무 일도 없다.
  // 보드 전체가 보이는지가 아니라 그 한 점이 보이는지를 봐야 한다.
  for (let attempt = 0; attempt < 3; attempt++) {
    const view = await board.boundingBox();
    if (!view) throw new Error("보드가 화면에 없습니다");
    const step = view.width / STEP_DIV;
    const px = view.x + step * (0.75 + x);
    const py = view.y + step * (0.75 + y);
    const onBoard = (await page.evaluate(
      `(() => { var e = document.elementFromPoint(${px}, ${py});
                return !!e && !!e.closest(".board__view"); })()`,
    )) as boolean;
    if (onBoard) {
      await page.mouse.click(px, py);
      await page.waitForTimeout(120);
      return;
    }
    // 가려져 있다 — 그 점이 스크롤 영역 가운데 오도록 민다.
    await page.evaluate(
      `(() => { var c = document.querySelector(".shell__content"); if (!c) return;
                var r = c.getBoundingClientRect();
                c.scrollBy(0, ${py} - (r.top + r.height / 2)); })()`,
    );
    await page.waitForTimeout(100);
  }
  throw new Error(`보드의 (${x},${y}) 가 다른 요소에 가려져 누를 수 없습니다`);
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

/**
 * 엔진의 답을 받는다. **무제한 대국에서 엔진은 「지금 두기」까지 생각한다**
 * (데스크톱·앱의 기본 레벨과 같다) — 조금 읽게 두었다가 눌러서 두게 한다.
 * 시간제 대국이면 버튼이 없고, 엔진이 제 예산 안에서 스스로 둔다.
 */
async function engineReply(n: number, why: string, thinkMs = 2_000) {
  await page.waitForTimeout(thinkMs);
  const now = page.getByRole("button", { name: "지금 두기", exact: true });
  if (await now.count()) await now.click();
  await waitStones(n, 90_000, why);
}

/**
 * 분석 한 번이 건강했는가 — 사용자 보고(분석 중 `MaxTime 0ms` · 좌표가 줄줄이
 * 튀어나옴)를 그대로 검사로 옮긴 것.
 *
 * - 조각마다 국면을 다시 세웠는가(YXBOARD ≥ YXNBEST). YXNBEST 는 끝에 최선수를
 *   엔진 판에 **실제로 두므로**, 안 그러면 조각마다 한 수씩 앞선 국면을 읽는다.
 * - 어느 조각도 0ms 로 돌지 않았는가. 앞선 시간제 대국의 대국 예산이 남아
 *   있으면 조각마다 `time_left` 가 깎여 금세 0 이 된다.
 * - 분석이 대국 판에 돌을 두지 않았는가.
 */
async function analysisHealthy(label: string) {
  const before = await stoneCount();
  await click("분석");
  await page.locator('.panel__badge[data-status="searching"]').waitFor({ timeout: 10_000 });
  await page.locator('.panel__badge[data-status="ready"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
  const lines = (await page.evaluate(`window.__rapfiConsole()`)) as string[];
  // 가장 최근 분석: 마지막 `YXNBEST 5` 에서 거슬러 올라가 분석 머리
  // (`timeout_match 0`)까지. 대국의 무제한 착수는 YXNBEST 1 이라 섞이지 않는다.
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === "> YXNBEST 5") {
      end = i;
      break;
    }
  }
  let start = end;
  while (start > 0 && lines[start] !== "> INFO timeout_match 0") start--;
  const win = lines.slice(start, end + 400);
  const slices = win.filter((l) => l === "> YXNBEST 5").length;
  const boards = win.filter((l) => l.startsWith("> YXBOARD")).length;
  const TIME = /MaxTime ([\d.]+)(ms|s|min|h)/;
  const zero = win.filter((l) => {
    const m = TIME.exec(l);
    return m !== null && m[2] === "ms" && Number(m[1]) < 50;
  });
  const after = await stoneCount();
  if (end < 0) {
    fail(`${label}: 분석 명령을 찾지 못했습니다 (콘솔 ${lines.length}줄)`);
    const sent = lines.filter((l) => l.startsWith(">")).slice(-25);
    console.error(sent.map((l) => `      ${l}`).join("\n"));
  }
  else if (boards < slices)
    fail(`${label}: 조각 ${slices}개에 국면은 ${boards}번 — 국면이 흘렀습니다`);
  else if (zero.length) fail(`${label}: ${zero.length}개 조각이 0ms 로 돌았습니다 — ${zero[0]}`);
  else if (after !== before) fail(`${label}: 분석이 판에 돌을 두었습니다 (${before}→${after})`);
  else ok(`${label}: 조각 ${slices}개 · 조각마다 국면 재설정 · 0ms 조각 없음 · 판 그대로`);
}

/** 지금 떠 있는 물음의 종류. 없으면 null. */
async function prompt(): Promise<string | null> {
  const el = page.locator(".ask[data-prompt]");
  return (await el.count()) ? el.first().getAttribute("data-prompt") : null;
}

/**
 * 보드 위 거절 사유. 2.2초 뒤 사라지므로 **탭 직후에** 읽어야 한다 — 실패
 * 덤프까지 기다리면 이미 없다(실제로 그래서 한 번 헛짚었다).
 */
async function tapNotice(): Promise<string> {
  const n = page.locator(".board-notice");
  const badge = await page.locator(".panel__badge").first().getAttribute("data-status");
  const text = (await n.count()) ? (await n.innerText()).trim() : "(안내 없음)";
  return `${text} / 엔진 ${badge}`;
}

/**
 * 엔진이 방금 둔 수에서 **실제로 생각했는가.**
 *
 * 돌이 놓였다는 것만으로는 부족하다 — 시간 예산이 0 으로 넘어가면 엔진은
 * `OptiTime 0ms | MaxTime 0ms`, `Depth 0-0` 으로 아무 수(구석 C1, A1)나
 * 즉시 던지고, 그래도 돌은 놓인다. 콘솔의 마지막 시간 줄과 깊이 줄, 그리고
 * 그 직전에 우리가 보낸 `timeout_turn` 을 함께 본다.
 */
async function thought(label: string) {
  // 화면의 콘솔은 마지막 40줄뿐이라 탐색 시작 줄이 밀려난다 — 전체를 읽는다.
  const lines = (await page.evaluate(`window.__rapfiConsole()`)) as string[];
  const lastIndex = (re: RegExp, before = lines.length) => {
    for (let i = before - 1; i >= 0; i--) if (re.test(lines[i]!)) return i;
    return -1;
  };
  // 마지막 착수 응답(좌표 한 줄)을 기준으로 그 탐색의 줄들을 본다.
  const moveAt = lastIndex(/^\d+,\d+$/);
  // Rapfi 는 시간을 `4970ms`·`29s`·`3min`·`1h` 로 적는다(utils.cpp timeText).
  // 처음엔 ms 만 읽어서, 29s 줄을 지나쳐 **앞 수의** 4970ms 줄을 집었다.
  const TIME = /OptiTime ([\d.]+)(ms|s|min|h) \| MaxTime ([\d.]+)(ms|s|min|h)/;
  const timeAt = lastIndex(TIME, moveAt);
  const depthAt = lastIndex(/Depth \d+-\d+/, moveAt);
  const sentAt = lastIndex(/^> INFO timeout_turn/, moveAt);
  const UNIT: Record<string, number> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000 };
  const toMsUnit = (v: string, u: string) => Number(v) * (UNIT[u] ?? 1);
  const tm = timeAt < 0 ? null : TIME.exec(lines[timeAt]!);
  const maxMs = tm ? toMsUnit(tm[3]!, tm[4]!) : null;
  const d = depthAt < 0 ? -1 : Number(/Depth (\d+)-/.exec(lines[depthAt]!)?.[1]);
  // **즉답**: 이 수를 부른 명령과 좌표 사이에 탐색 줄이 하나도 없다. 5목·막는 수
  // 같은 뻔한 수에 Rapfi 는 탐색 없이 답한다 — 고장이 아니라 정답이다. 0ms 고장은
  // 다르다: 그때는 `OptiTime 0ms` 와 `Depth 0-0` 이 **찍힌다**.
  const askAt = lastIndex(/^> (YXNBEST|BOARD|BEGIN)/, moveAt);
  if (askAt >= 0 && timeAt < askAt && depthAt < askAt) {
    ok(`${label}: 즉답(뻔한 수 — 탐색 없이 둠)`);
    return;
  }
  // 우리가 보낸 차례 예산과 엔진이 실제로 쓴 예산이 맞는가. 명령 흐름이 한 칸
  // 밀리면 엔진은 **앞선** 값(분석 조각 500ms 등)으로 돌고, 돌은 멀쩡히 놓인다 —
  // 깊이만 봐서는 못 잡는다(500ms 로도 Depth 26 이 나온 적이 있다).
  const sentMs = sentAt < 0 ? null : Number(/timeout_turn (\d+)/.exec(lines[sentAt]!)?.[1]);
  const mismatch = maxMs !== null && sentMs !== null && sentMs >= 1000 && maxMs < sentMs * 0.5;
  const bad = (maxMs !== null && maxMs <= 0) || d < 2 || mismatch;
  if (bad) {
    const why = mismatch ? `보낸 ${sentMs}ms 와 다른 예산으로 돌았습니다` : "생각하지 않았습니다";
    fail(`${label}: 엔진이 ${why} (MaxTime ${maxMs ?? "?"}ms · Depth ${d})`);
    // 그 수 직전에 무엇을 보냈고 엔진이 무엇을 했는지 — 원인은 여기 있다.
    const from = Math.max(0, (sentAt >= 0 ? sentAt : moveAt) - 12);
    console.error(
      lines
        .slice(from, moveAt + 1)
        .map((l) => `      ${l}`)
        .join("\n"),
    );
  } else {
    const t = maxMs === null ? "" : `MaxTime ${maxMs}ms · `;
    ok(`${label}: ${t}Depth ${d} · ${lines[sentAt]?.slice(2) ?? "timeout_turn ?"}`);
  }
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
    // 거절당했다면 이유가 보드 위에 떠 있다 — 「클릭이 빗나갔다」와
    // 「눌렀는데 거절됐다」를 가르는 유일한 단서다.
    const n = page.locator(".board-notice");
    console.error(`보드 안내: ${(await n.count()) ? await n.innerText() : "(없음)"}`);
    const box = await page.locator(".board__view").boundingBox();
    const vp = page.viewportSize();
    console.error(`보드 위치: ${JSON.stringify(box)} / 뷰포트: ${JSON.stringify(vp)}`);
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
  // 사람 돌부터 따로 본다 — 「클릭이 빗나갔다」와 「엔진이 답하지 않았다」는
  // 다른 고장인데, 한 번에 2를 기다리면 둘이 같은 메시지로 뭉개진다.
  await waitStones(1, 5_000, "(사람이 놓은 첫 수)");
  await engineReply(2, "(사람 1수 뒤 엔진의 답)");
  ok("사람 → 엔진 → 사람으로 차례가 돌았다");
  await page.waitForTimeout(300); // 콘솔은 100ms 배치로 온다
  await thought("무제한 첫 수");
  await analysisHealthy("대국 중 분석");

  const turn = (await page.locator("dd[data-k=turn]").innerText()).trim();
  if (turn !== "흑") fail(`두 수 뒤 차례가 흑이 아닙니다: ${turn}`);
  else ok("두 수 뒤 흑 차례");

  // 사람이 한 수 더 두고 엔진이 또 답하는지 — 한 번은 우연일 수 있다.
  // **구석에 둔다.** 가운데 근처를 고르면 엔진이 방금 둔 자리와 부딪혀
  // 「무시」로 떨어지고, 시험은 그것을 회귀로 읽는다(실제로 한 번 겪었다).
  await tap(1, 1);
  await engineReply(4, "(둘째 왕복)");
  ok("두 번째 왕복도 정상");
  await page.waitForTimeout(300);
  await thought("무제한 둘째 수");

  // 분석을 한 번 돌린 **뒤**의 착수. 분석은 `timeout_turn` 을 조각 단위(마지막
  // 조각은 몇 ms 일 수도 있다)로 바꿔 두므로, 착수가 자기 예산을 다시 세우지
  // 않으면 그 찌꺼기로 둔다.
  await click("분석");
  await page.locator('.panel__badge[data-status="searching"]').waitFor({ timeout: 10_000 });
  await page.locator('.panel__badge[data-status="ready"]').waitFor({ timeout: 30_000 });
  await tap(1, 13);
  await engineReply(6, "(분석 뒤 왕복)");
  await page.waitForTimeout(300);
  await thought("분석 뒤 착수");

  // 분석이 **도는 도중에** 한 수를 둔다. 워커의 분석은 조각 사이에 이벤트 루프로
  // 돌아오므로, 그 틈에 착수 요청이 끼어든다 — 명령이 섞이기 가장 쉬운 자리다.
  await click("분석");
  await page.locator('.panel__badge[data-status="searching"]').waitFor({ timeout: 10_000 });
  await tap(13, 1);
  await engineReply(8, "(분석 도중 왕복)");
  await page.locator('.panel__badge[data-status="ready"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
  await thought("분석 도중 착수");

  // 그리고 그 다음 수도 — 명령 흐름이 한 칸 밀렸다면 **다음** 수부터 망가진다.
  await tap(13, 13);
  await engineReply(10, "(분석 도중 다음 왕복)");
  await page.waitForTimeout(300);
  await thought("그 다음 착수");

  // 사용자 보고: 무제한인데 대국이 중간에 끊긴다 — 감시견이 15초(예산 5초 + 10초)
  // 뒤에 기다림을 풀어 버렸다. 무제한에서 엔진은 「지금 두기」까지 생각해야 한다.
  // 옛 한도를 넉넉히 넘겨 20초를 기다린다.
  // **새 대국에서** 한다 — 위의 흩어진 사람 수로는 엔진이 곧 5목을 만들어 대국이
  // 끝나 있을 수 있고, 5목·막는 수 같은 뻔한 수는 엔진이 즉답한다(기다림이 없다).
  await click("새 대국");
  await tap(7, 7);
  await waitStones(1, 5_000, "(무제한 대기 전 사람 수)");
  await page.waitForTimeout(20_000);
  const nowBtn = page.getByRole("button", { name: "지금 두기", exact: true });
  const cut = await prompt();
  if (cut === "info") fail("무제한인데 감시견이 대국을 끊었습니다");
  else if ((await nowBtn.count()) === 0)
    fail("20초 뒤 엔진이 생각을 멈췄습니다 (「지금 두기」 없음)");
  else if ((await stoneCount()) !== 1)
    fail(`엔진이 저절로 두었습니다 (돌 ${await stoneCount()}개)`);
  else ok("무제한: 20초가 지나도 끊기지 않고 계속 읽는다");
  await nowBtn.click();
  await waitStones(2, 10_000, "(「지금 두기」 뒤 엔진의 수)");
  await page.waitForTimeout(300);
  await thought("「지금 두기」로 둔 수");

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

  // 시간 제한이 있을 때도 엔진이 생각하는가 — 예산이 시계에서 계산되는 경로다.
  await click("새 대국");
  await click("컴퓨터 백");
  await tap(7, 7);
  await waitStones(2, 60_000, "(5분 제한에서 엔진의 답)");
  await page.waitForTimeout(300);
  await thought("5분 제한 첫 수");

  // 사용자 보고의 자리: 시간제 대국을 둔 **뒤에** 분석. 대국 예산이 엔진에
  // 남아 있으면 조각마다 time_left 가 깎여 0ms 조각이 된다.
  await analysisHealthy("시간제 대국 뒤 분석");

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
  await click("사람 대 사람"); // 엔진이 끼어들면 기권·무승부가 탐색과 엇갈린다
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
  await engineReply(4, "(RIF 개시 뒤 엔진의 4수)");
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
    await engineReply(3, "(교환 뒤 엔진의 3수)");
    ok("색이 넘어간 뒤에도 차례가 돈다");
  } else {
    // 교환하지 않았으면 엔진이 백으로 그대로 이어 둔다.
    await engineReply(2, "(교환 없이 엔진의 2수)");
    ok("교환 없이 엔진이 이어 뒀다");
  }

  // ── 7. 개시 영역 검사 ─────────────────────────────────────────────
  //
  // 손으로 놓는 개시(RIF)에서 천원 둘레를 벗어나면 판을 되돌리고 알린다.
  // **엔진과 무관하다** — 데스크톱도 이건 스스로 판정한다(main.c:2786).
  console.log("\n7. 개시 영역 검사");
  await click("RIF 오프닝"); // 개시를 고르면 새 대국이다
  await click("컴퓨터 백");

  // **앞 단계의 상태를 물려받지 않는다.** 6단계에서 엔진이 색을 가져가
  // 컴퓨터가 흑이 되어 있었고, 그 상태로 개시를 놓으면 첫 탭이 «두어라»로
  // 읽혀 엔진이 대신 둔다 — 그러면 검사할 국면 자체가 만들어지지 않는다.
  // 그래서 고른 값이 실제로 반영됐는지 확인하고 들어간다.
  const sideOn = await page
    .getByRole("button", { name: "컴퓨터 백", exact: true })
    .getAttribute("aria-pressed");
  if (sideOn !== "true") fail(`컴퓨터 색이 백이 아닙니다: aria-pressed=${sideOn}`);
  if ((await stoneCount()) !== 0) fail("새 대국인데 판이 비어 있지 않습니다");

  // 두 수는 그냥 놓인다. **검사는 셋째 수에서 돈다** — 그 자리에서 판이
  // 되돌아가므로 셋째 뒤에 돌 수를 세면 3이 아니라 0이다.
  await tap(0, 0);
  if ((await stoneCount()) !== 1) fail(`개시 1수 없음 — ${await tapNotice()}`);
  await tap(1, 1);
  if ((await stoneCount()) !== 2) fail(`개시 2수 없음 — ${await tapNotice()}`);
  await tap(2, 2);
  await page.waitForTimeout(500);
  if ((await prompt()) !== "illegalOpening") fail("개시 영역 위반을 알리지 않습니다");
  else ok("개시 영역 위반을 잡아 판을 되돌렸다");
  await click("확인");
  if ((await stoneCount()) !== 0) fail("판을 되돌리지 않았습니다");
  else ok("판이 비워졌다");

  // ── 8. 개시 목록은 셋뿐 ───────────────────────────────────────────
  //
  // Soosorv-8 과 스왑2 는 엔진에게 협상을 시키는데 Rapfi 가 그 명령을 모른다
  // (`docs/오프닝-협상-엔진-지원.md`). 화면에 남아 있으면 못 하는 일을 계속
  // 제안하게 되므로 목록에서 내렸다 — **배포본에서 그것을 확인한다.**
  console.log("\n8. 개시 목록");
  const chips = await page.locator('[role=group][aria-label="오프닝"] .chip').allInnerTexts();
  const names = chips.map((c) => c.trim()).sort();
  const want = ["RIF 오프닝", "자유 렌주", "첫 수 이후 교환"].sort();
  if (JSON.stringify(names) !== JSON.stringify(want)) {
    fail(`개시 칩이 기대와 다릅니다: ${names.join(" · ")}`);
  } else {
    ok(`개시 칩 셋: ${names.join(" · ")}`);
  }
  for (const gone of ["스왑2", "Soosorv-8"]) {
    if (names.includes(gone)) fail(`${gone} 이 아직 화면에 있습니다`);
  }
  if (!names.includes("스왑2") && !names.includes("Soosorv-8")) {
    ok("스왑2 · Soosorv-8 은 없다");
  }

  const notice = (await page.locator('[data-k="opening-notice"]').innerText()).trim();
  if (!notice.includes("Rapfi")) fail(`안내 문구가 없습니다: ${notice}`);
  else ok("왜 셋뿐인지 화면이 말한다");

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
