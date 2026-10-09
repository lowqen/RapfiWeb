/**
 * DB 스모크 — 진짜 엔진에 yixindb 를 붙이고 쓰고 저장하고, **새로고침 뒤 다시 읽는다**(W8 검수).
 *
 *   pnpm build && pnpm exec tsx scripts/db-smoke.ts
 *
 * 단위 시험(`yixindb.test.ts` · `dbChannel`)은 엔진의 답을 우리가 만든다. 여기서는 엔진이 실제로
 * 답하는지가 답이다 — FS 를 내보낸 엔진(w8)인가, `info usedatabase 1` 이 메모리 FS 의 파일을
 * 여는가, 고친 기록이 `DATABASE ONE` 으로 돌아오는가, 저장한 바이트가 IndexedDB 를 거쳐 새 엔진에
 * 다시 붙는가.
 */
import { chromium, type Page } from "playwright";
import { createServer } from "node:http";
import { ISOLATION_HEADERS, hasEngine } from "./isolation.ts";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const PORT = Number(process.env.SMOKE_PORT ?? 4183);
const BASE = `http://localhost:${PORT}`;

if (!hasEngine(DIST)) {
  console.log("엔진 산출물이 없어 건너뜁니다 (dist/engine/).");
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
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!existsSync(file) || extname(file) === "") file = join(DIST, "index.html");
  try {
    res.writeHead(200, {
      ...ISOLATION_HEADERS,
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    });
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

interface DbView {
  status: string;
  message: string | null;
  stored: { size: number; savedAt: number } | null;
  moves: number | null;
  cells: { x: number; y: number; tag: string; text: string }[];
  comment: string | null;
  entry: { label: string | null; value: number; depth: number } | null;
  log: string[];
}
const dbView = (page: Page) => page.evaluate("window.__rapfiDb()") as Promise<DbView>;

async function until<T>(
  page: Page,
  what: string,
  read: () => Promise<T>,
  pass: (v: T) => boolean,
  ms = 60_000,
) {
  const t0 = Date.now();
  let last: T | undefined;
  while (Date.now() - t0 < ms) {
    last = await read();
    if (pass(last)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`${what}: 시간 초과 — 마지막 값 ${JSON.stringify(last)}`);
}

async function startEngineAndAttach(page: Page) {
  const start = page.getByRole("button", { name: "엔진 시작", exact: true });
  if (await start.count()) await start.click();
  await until(
    page,
    "엔진 기동",
    () => page.evaluate("window.__rapfiEngine().status") as Promise<string>,
    (s) => s === "ready",
    120_000,
  );
  await until(
    page,
    "DB 붙이기",
    () => dbView(page),
    (v) => v.status === "on" || v.status === "error",
    60_000,
  ).then((v) => {
    if (v.status !== "on") throw new Error(`DB 를 붙이지 못했습니다: ${v.message}`);
  });
}

/** DB 화면 판의 (x, y) 를 누른다 — 15×15, 여백 0.75칸. */
async function tapDbBoard(page: Page, x: number, y: number) {
  const view = await page.locator(".database .board__view").boundingBox();
  if (!view) throw new Error("DB 화면에 판이 없습니다");
  const step = view.width / 15.5;
  await page.mouse.click(view.x + step * (0.75 + x), view.y + step * (0.75 + y));
  await page.waitForTimeout(150);
}

await new Promise<void>((r) => server.listen(PORT, r));
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 1400 },
  acceptDownloads: true,
});
const page = await context.newPage();
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push("[pageerror] " + (e.stack ?? String(e))));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push("[console] " + m.text());
});

try {
  // h8 i9 j10 — 흑 차례가 아닌 백 차례 국면.
  await page.goto(`${BASE}/database?p=h8i9j10`);
  await page.locator(".database").waitFor({ timeout: 15_000 });

  console.log("1. 엔진을 띄우고 DB 를 켠다");
  await page.getByRole("switch", { name: "DB 사용" }).click();
  await startEngineAndAttach(page);
  ok("엔진이 DB 를 붙였다(`DATABASE ONE` 왕복)");
  const v0 = await until(
    page,
    "국면 읽기",
    () => dbView(page),
    (v) => v.moves === 3,
  );
  ok(`지금 판(3수)을 읽었다 — 자식 ${v0.cells.length}개`);

  console.log("2. 기록 · 주석 · 칸 글자를 쓴다");
  await page.getByRole("radio", { name: "W 승" }).click();
  const valueField = page.getByLabel("값", { exact: true });
  await valueField.fill("123");
  await valueField.press("Enter");
  await page.locator(".database button", { hasText: "셋 다 적기" }).click();
  const v1 = await until(
    page,
    "기록 고치기",
    () => dbView(page),
    (v) => v.entry?.label === "w" && v.entry.value === 123,
  );
  ok(
    `기록이 엔진에서 돌아왔다 — 라벨 ${v1.entry?.label}, 값 ${v1.entry?.value}, 깊이 ${v1.entry?.depth}`,
  );

  const note = '스모크 주석 "따옴표"\n둘째 줄';
  await page.locator(".db__comment textarea").fill(note);
  await page.locator(".database button", { hasText: "주석 적기" }).click();
  await until(
    page,
    "주석",
    () => dbView(page),
    (v) => v.comment === note,
  );
  ok("여러 줄 · 따옴표 주석이 그대로 돌아왔다");

  await tapDbBoard(page, 10, 10); // K5 근처 빈 칸
  await page.locator(".db__label").fill("AB");
  await page.locator(".database button", { hasText: "칸 글자 적기" }).click();
  await until(
    page,
    "칸 글자",
    () => dbView(page),
    (v) => v.cells.some((c) => c.text === "AB"),
  );
  ok("칸 글자가 자식 칸으로 돌아왔다");

  console.log("3. 저장 → 새로고침 → 새 엔진에 다시 붙는다");
  await page.locator(".database button", { hasText: "지금 저장" }).click();
  const saved = await until(
    page,
    "저장",
    () => dbView(page),
    (v) => (v.stored?.size ?? 0) > 0,
  );
  ok(`IndexedDB 에 ${saved.stored!.size} 바이트`);

  await page.goto(`${BASE}/database?p=h8i9j10`);
  await page.locator(".database").waitFor({ timeout: 15_000 });
  await startEngineAndAttach(page);
  const v2 = await until(
    page,
    "다시 읽기",
    () => dbView(page),
    (v) => v.moves === 3 && v.comment !== null,
  );
  if (v2.entry?.label !== "w") fail(`새로고침 뒤 기록이 없다: ${JSON.stringify(v2.entry)}`);
  else ok("새로고침 뒤에도 기록이 남았다");
  if (v2.comment !== note) fail(`새로고침 뒤 주석이 다르다: ${JSON.stringify(v2.comment)}`);
  else ok("새로고침 뒤에도 주석이 남았다");
  if (!v2.cells.some((c) => c.text === "AB")) fail("새로고침 뒤 칸 글자가 없다");
  else ok("새로고침 뒤에도 칸 글자가 남았다");

  console.log("4. 내보내기");
  const [csv] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.locator(".database button", { hasText: "CSV 내보내기" }).click(),
  ]);
  const csvText = readFileSync((await csv.path())!, "utf8");
  if (csvText.split("\n").filter(Boolean).length < 1) fail("CSV 가 비었다");
  else
    ok(
      `CSV ${csvText.length} 바이트 — 첫 줄 ${JSON.stringify(csvText.split("\n")[0]!.slice(0, 80))}`,
    );
  const [dbFile] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.locator(".database button", { hasText: ".db 내려받기" }).click(),
  ]);
  const size = readFileSync((await dbFile.path())!).byteLength;
  if (size <= 0) fail(".db 가 비었다");
  else ok(`.db ${size} 바이트`);

  // 보드 화면(/board)에서도 DB 의 기록이 보여야 한다 — 국면 카드의 주석, 분석 탭 판의 칸 글자,
  // 그리고 자식 값으로 읽은 국면 값이 평가 바에(엔진이 이 국면을 읽고 있지 않을 때).
  console.log("5. 보드 화면 — 주석 · 칸 글자 · 평가 바");
  await page.locator(".rail__link", { hasText: "보드" }).click();
  await page.locator(".boardscreen").waitFor({ timeout: 15_000 });
  const analysisTab = page.getByRole("tab", { name: "분석", exact: true });
  if ((await analysisTab.getAttribute("aria-selected")) !== "true") await analysisTab.click();
  await until(
    page,
    "보드 국면 카드의 DB 주석",
    () =>
      page
        .locator('[data-k="db-comment"]')
        .innerText()
        .catch(() => ""),
    (t) => t === note,
    20_000,
  );
  ok("국면 카드에 DB 주석이 떴다");
  const boardTags = await until(
    page,
    "보드 판의 DB 칸 글자",
    () => page.evaluate("window.__rapfiBoard()") as Promise<{ tags: { label: string }[] }>,
    (b) => b.tags.some((t) => t.label === "AB"),
    20_000,
  );
  ok(`분석 탭 판에 DB 칩 ${boardTags.tags.length}개(칸 글자 AB 포함)`);
  // h8 i9 로 무르면 j10 이 자식이 되고, 거기 적은 W 기록이 이 국면의 값이 된다.
  await page.getByRole("button", { name: "한 수 뒤로" }).click();
  const meterText = await until(
    page,
    "평가 바의 DB 값",
    () =>
      page.getByRole("meter", { name: "평가 바" }).getAttribute("aria-valuetext") as Promise<
        string | null
      >,
    (t) => (t ?? "").includes("DB 기록"),
    20_000,
  );
  ok(`평가 바가 DB 값을 그린다 — «${meterText}»`);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
  try {
    console.error(JSON.stringify(await dbView(page), null, 1));
    const lines = (await page.evaluate("window.__rapfiConsole()")) as string[];
    console.error(lines.slice(-40).join("\n"));
  } catch {
    /* 페이지가 없다 */
  }
}

const relevant = pageErrors.filter((e) => !/favicon/.test(e));
if (relevant.length) fail(`페이지 오류 ${relevant.length}건:\n${relevant.join("\n")}`);
await browser.close();
server.close();
console.log(failures.length ? `실패 ${failures.length}건` : "DB 스모크 통과");
