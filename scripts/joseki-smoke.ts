/**
 * 정석 스모크(W9) — 판 · 글로 수를 넣고, 갈래를 만들고, 메모를 쓰고, 새로고침 뒤에도 남는지,
 * 뒤집은 판으로 찾아지는지 본다. 엔진이 필요 없다.
 *
 *   pnpm build && pnpm exec tsx scripts/joseki-smoke.ts
 *   SMOKE_SHOT=out.png …   # 편집 화면 스크린숏
 */
import { chromium, type Page } from "playwright";
import { createServer } from "node:http";
import { SITE_HEADERS } from "./isolation.ts";
import { watchBrowser } from "./csp-watch.ts";
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
    res.writeHead(200, {
      ...SITE_HEADERS,
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
const check = (cond: boolean, good: string, bad: string) => (cond ? ok(good) : fail(bad));

/** 정석 판의 칸(열 x · 행 y, 위에서부터)을 누른다. */
async function tap(page: Page, x: number, y: number) {
  // 내 정석 편집기의 판, 또는 공식 레슨의 판(체스닷컴 구조 — 왼쪽 큰 판).
  const view = await page
    .locator(".jboardbox .board__view, .lesson__board .board__view")
    .first()
    .boundingBox();
  if (!view) throw new Error("정석 판이 없습니다");
  const step = view.width / 15.5;
  await page.mouse.click(view.x + step * (0.75 + x), view.y + step * (0.75 + y));
  await page.waitForTimeout(120);
}
const where = (page: Page) => page.locator('[data-k="joseki-where"]').innerText();

await new Promise<void>((r) => server.listen(PORT, r));
const browser = watchBrowser(await chromium.launch());
const page = await browser.newPage({
  locale: "ko-KR", // 한국어 화면으로 고정(W10 — 그 밖의 언어면 영어로 뜬다)
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
  // 정석 화면은 [공식 커리큘럼] 탭으로 연다(처음). 내 정석은 둘째 탭 — 고른 탭은 남는다.
  await page.locator('[data-tab="mine"]').click();
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
  // 이름은 «기호 + 뜻»(W10 접근성, 예: «?! 의문수») — 기호로 시작하는 단추를 집는다.
  await page.getByRole("radio", { name: /^\?! / }).click();
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

  console.log("6. 갈래 쓰임 · 관리자 내보내기(공식 커리큘럼 JSON)");
  await page.evaluate(() => localStorage.setItem("rapfi.adminTools", "1"));
  await page.reload(); // 관리자 스위치는 뜰 때 읽는다 — 새로고침하면 목록으로 돌아와 다시 연다
  await page.locator(".jlist__open", { hasText: "스모크 정석" }).first().click();
  await page.locator(".joseki-editor").waitFor();
  await page.getByRole("button", { name: "앞으로", exact: true }).click();
  await page.getByRole("button", { name: "함정수", exact: true }).click();
  check(
    (await page
      .getByRole("button", { name: "함정수", exact: true })
      .getAttribute("aria-pressed")) === "true",
    "지금 마디에 «함정수» 쓰임",
    "함정수 단추가 눌리지 않았다",
  );
  await page.getByRole("button", { name: "공식 커리큘럼으로 내보내기" }).click();
  await page.locator('[data-k="admin-export"]').waitFor();
  await page.getByLabel("레슨 id").fill("smoke-lesson");
  const [cdl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "curriculum.json 내려받기" }).click(),
  ]);
  const cur = JSON.parse(readFileSync((await cdl.path())!, "utf8"));
  const lessons = cur.courses.flatMap((c: { lessons: { id: string }[] }) => c.lessons);
  const text = JSON.stringify(cur);
  check(
    cur.format === "rapfiweb-curriculum" &&
      lessons.some((l: { id: string }) => l.id === "smoke-lesson") &&
      lessons.some((l: { id: string }) => l.id === "first-three-moves") &&
      text.includes('"role":"trap"'),
    `커리큘럼 내보내기 — 배포 레슨 ${lessons.length - 1}개에 새 레슨을 넣고 함정 쓰임을 지켰다`,
    `커리큘럼 JSON 이 이상하다: ${text.slice(0, 200)}`,
  );
  check(
    (await page.locator('[data-k="admin-export-result"]').innerText()).includes("내려받았습니다"),
    "내보내기 검증 경고 없음",
    `내보내기 결과: ${await page.locator('[data-k="admin-export-result"]').innerText()}`,
  );

  console.log("7. 공식 커리큘럼 — 살펴보기 · 학습");
  await page.goto(`${BASE}/joseki`);
  await page.locator('[data-tab="official"]').click();
  await page.locator('[data-k="curriculum"]').waitFor();
  // 목록 → 코스(썸네일 카드) → 레슨. 코스 머리에는 「시작」이 있다.
  await page.locator('[data-k="curriculum"] .card[data-course]').first().click();
  await page.locator('[data-k="course"]').waitFor();
  check(
    (await page.locator(".lessonlist__item").count()) >= 3 &&
      (await page.locator('[data-k="course-start"]').count()) === 1,
    "코스 · 레슨 목록(배포 파일) · 「시작」",
    "레슨 목록이나 「시작」이 없다",
  );
  await page.locator('.lessonlist__item[data-lesson="first-three-moves"]').click();
  await page.locator('[data-k="lesson"]').waitFor();
  await page.locator(".jtree__move").first().click();
  check(
    (await page.locator('[data-k="lesson-comment"]').innerText()).includes("천원"),
    "살펴보기: 마디 해설",
    "해설이 없다",
  );
  await page.getByRole("tab", { name: "학습", exact: true }).click();
  const fb = () => page.locator('[data-k="quiz-feedback"]').getAttribute("data-kind");
  await tap(page, 7, 7); // h8 — 정답, 백 h9 는 저절로
  check((await fb()) === "correct", "학습: 1수 정답 · 상대 수 자동", `학습 1수: ${await fb()}`);
  await tap(page, 11, 3); // l12 — 알려진 나쁜 수
  check((await fb()) === "mistake", "학습: 나쁜 수는 해설과 함께 오답", `나쁜 수: ${await fb()}`);
  await tap(page, 1, 1); // b14 — 정석 밖
  check((await fb()) === "outside", "학습: 정석 밖의 수", `정석 밖: ${await fb()}`);
  check(
    await page.getByRole("button", { name: "힌트", exact: true }).isDisabled(),
    "두 번 틀리면 힌트가 저절로 열린다",
    "힌트가 열리지 않았다",
  );
  await tap(page, 6, 6); // g9 — 정답, 끝
  const done = await page.locator('[data-k="quiz-done"]').innerText();
  check(done.includes("50점"), `학습 끝: ${done.replace(/\s+/g, " ")}`, `학습 끝: ${done}`);
  await page.getByRole("button", { name: "코스로 돌아가기" }).click();
  await page.locator('[data-k="course"]').waitFor();
  check(
    (await page.locator('.lessonlist__item[data-lesson="first-three-moves"]').innerText()).includes(
      "최고 50점",
    ),
    "진도가 코스의 레슨 카드에 남는다",
    "진도가 없다",
  );

  console.log("8. 레슨 링크 — 주소로 열기 · 링크 복사 · 뒤로");
  await page.goto(`${BASE}/joseki?lesson=direct-and-indirect&mode=learn`);
  await page.locator('[data-k="lesson"][data-lesson="direct-and-indirect"]').waitFor();
  check(
    (await page.locator('[role="tab"][data-mode="learn"]').getAttribute("aria-selected")) ===
      "true" && (await page.locator('[data-k="quiz"]').count()) === 1,
    "?lesson=…&mode=learn 이 그 레슨의 학습 모드로 연다",
    "레슨 링크가 학습 모드로 열리지 않았다",
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await page.locator('[data-k="lesson-copy-link"]').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(
    copied === `${BASE}/joseki?lesson=direct-and-indirect&mode=learn`,
    "링크 복사: 지금 레슨 · 모드의 주소",
    `복사한 링크: ${copied}`,
  );
  await page.getByRole("tab", { name: "살펴보기", exact: true }).click();
  check(
    new URL(page.url()).search === "?lesson=direct-and-indirect",
    "모드를 바꾸면 주소도 바뀐다(기록은 늘리지 않음)",
    `주소: ${page.url()}`,
  );
  await page.getByRole("button", { name: "코스로 돌아가기" }).click();
  await page.locator('[data-k="course"]').waitFor();
  check(
    new URL(page.url()).search.startsWith("?course="),
    "레슨의 ← 는 그 코스로(주소의 레슨이 빠지고 코스가 남는다)",
    page.url(),
  );
  await page.locator('.lessonlist__item[data-lesson="hogetsu-shape"]').click();
  await page.locator('[data-k="lesson"][data-lesson="hogetsu-shape"]').waitFor();
  await page.goBack();
  await page.locator('[data-k="course"]').waitFor();
  check(
    (await page.locator('[data-k="lesson"]').count()) === 0,
    "브라우저 «뒤로»가 한 층 위(코스)로",
    "뒤로가 코스로 가지 않았다",
  );
  await page.getByRole("button", { name: "커리큘럼으로 돌아가기" }).click();
  await page.locator('[data-k="curriculum"]').waitFor();
  check(new URL(page.url()).search === "", "코스의 ← 는 목록으로(주소가 빈다)", page.url());
  await page.goto(`${BASE}/joseki?lesson=no-such-lesson`);
  await page.locator('[data-k="lesson-missing"]').waitFor();
  ok("없는 레슨 id 는 알리고 목록을 보인다");
  await page.locator('[data-tab="mine"]').click();
  check(new URL(page.url()).search === "", "내 정석 탭으로 가면 레슨 링크를 걷는다", page.url());
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

if (errors.length) fail(`페이지 오류: ${errors.join(" | ")}`);
await browser.close();
server.close();
console.log(failures.length ? `실패 ${failures.length}건` : "정석 스모크 통과");
