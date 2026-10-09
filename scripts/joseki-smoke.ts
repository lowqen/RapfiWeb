/**
 * 정석 스모크(W9) — 판 · 글로 수를 넣고, 갈래를 만들고, 메모를 쓰고, 새로고침 뒤에도 남는지,
 * 뒤집은 판으로 찾아지는지 본다. 엔진이 필요 없다.
 *
 *   pnpm build && pnpm exec tsx scripts/joseki-smoke.ts
 *   SMOKE_SHOT=out.png …   # 편집 화면 스크린숏
 */
import { chromium, type Page } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const PORT = Number(process.env.SMOKE_PORT ?? 4184);
const BASE = `http://localhost:${PORT}`;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
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
const check = (cond: boolean, good: string, bad: string) => (cond ? ok(good) : fail(bad));

/** 정석 판의 칸(열 x · 행 y, 위에서부터)을 누른다. */
async function tap(page: Page, x: number, y: number) {
  const view = await page.locator(".jboardbox .board__view").boundingBox();
  if (!view) throw new Error("정석 판이 없습니다");
  const step = view.width / 15.5;
  await page.mouse.click(view.x + step * (0.75 + x), view.y + step * (0.75 + y));
  await page.waitForTimeout(120);
}
const where = (page: Page) => page.locator('[data-k="joseki-where"]').innerText();

await new Promise<void>((r) => server.listen(PORT, r));
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 1000 },
  acceptDownloads: true,
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

try {
  // 자동 기동을 끈다 — 이 스모크는 엔진을 쓰지 않는다.
  await page.goto(`${BASE}/settings`);
  await page.evaluate(() =>
    localStorage.setItem("rapfi.settings", JSON.stringify({ autoBoot: false, v: 3 })),
  );
  await page.goto(`${BASE}/joseki`);
  await page.getByRole("button", { name: "새 정석", exact: true }).click();
  await page.locator(".joseki-editor").waitFor();

  console.log("1. 판과 글로 수를 넣는다");
  await tap(page, 7, 7); // H8
  await tap(page, 8, 6); // I9
  check((await where(page)).startsWith("2수 I9"), "판으로 두 수", `판 입력: ${await where(page)}`);
  await page.getByLabel("수순 글").fill("j10 i10");
  await page.getByRole("button", { name: "넣기", exact: true }).click();
  check(
    (await where(page)).startsWith("4수 I10"),
    "글로 두 수(h8 i9 다음에 이어서)",
    `글 입력: ${await where(page)}`,
  );

  console.log("2. 갈래 · 기호 · 메모");
  await page.getByRole("button", { name: "뒤로", exact: true }).click();
  await page.getByRole("button", { name: "뒤로", exact: true }).click();
  await tap(page, 6, 5); // G10 — I9 다음의 다른 수
  check(
    (await page.locator(".jtree__var").count()) === 1,
    "갈래가 트리에 들여 쓴 줄로",
    "갈래 줄이 없다",
  );
  await page.getByRole("radio", { name: "?!", exact: true }).click();
  await page
    .getByRole("button", { name: "고치기" })
    .click()
    .catch(() => {});
  await page
    .getByLabel("메모", { exact: true })
    .fill("**의문수** — h8 로 돌아가 보자\n- 하나\n- 둘");
  await page.getByRole("button", { name: "미리 보기" }).click();
  const view = page.locator('[data-k="joseki-comment"]');
  check(
    (await view.locator("strong").innerText()) === "의문수",
    "메모의 굵게가 그려진다",
    "굵게가 없다",
  );
  check((await view.locator("li").count()) === 2, "메모의 목록", "목록이 없다");
  await view.locator(".jmd__coord", { hasText: "h8" }).click();
  check(
    (await where(page)).startsWith("1수 H8"),
    "메모의 좌표를 누르면 그 수로",
    `좌표 점프: ${await where(page)}`,
  );
  await page.getByLabel("정석 제목").fill("스모크 정석");

  if (process.env.SMOKE_SHOT) {
    await page.getByRole("button", { name: "끝", exact: true }).click();
    await page.screenshot({ path: process.env.SMOKE_SHOT, fullPage: true });
  }

  console.log("3. 저장 · 새로고침 · 목록");
  await page.getByRole("button", { name: "← 목록" }).click();
  await page.waitForTimeout(300);
  await page.reload();
  const list = page.locator('[data-k="joseki-list"]');
  await list.waitFor();
  check((await list.innerText()).includes("스모크 정석"), "새로고침 뒤에도 목록에", "목록에 없다");
  check(
    (await list.innerText()).includes("5수"),
    "수 5개(주 변화 4 + 갈래 1)",
    `수 세기: ${await list.innerText()}`,
  );

  console.log("4. 뒤집은 판으로 찾기");
  await page.goto(`${BASE}/joseki?p=h8g9f10`);
  await page.getByRole("button", { name: "보드 국면으로 찾기" }).click();
  await page.locator(".jlist__open", { hasText: "3수째 마디로 열기" }).click();
  check(
    (await where(page)).startsWith("3수 J10"),
    "거울 국면 H8 G9 F10 → 정석의 H8 I9 J10",
    `찾기: ${await where(page)}`,
  );

  console.log("5. 내보내기");
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "이 정석 JSON" }).click(),
  ]);
  const json = JSON.parse(readFileSync((await dl.path())!, "utf8"));
  check(
    json.format === "rapfiweb-joseki" && json.trees[0].title === "스모크 정석",
    "JSON 내보내기",
    "JSON 이 이상하다",
  );
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

if (errors.length) fail(`페이지 오류: ${errors.join(" | ")}`);
await browser.close();
server.close();
console.log(failures.length ? `실패 ${failures.length}건` : "정석 스모크 통과");
