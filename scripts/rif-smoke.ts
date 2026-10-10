/**
 * W7 스모크 — `.rif` 를 **아무 화면에나 끌어다 놓으면** 변환이 돌고, 랭킹 · 오프닝 통계 · 대국
 * 목록이 서고, 새로고침 뒤에도 남고, 지우면 내 기보로 물러서는지 본다. 엔진이 필요 없다.
 *
 *   pnpm build && pnpm exec tsx scripts/rif-smoke.ts
 *
 * **RenjuNet 기보는 쓰지 않는다** — CI 에도 저장소에도 둘 수 없다(라이선스). 같은 모양의 합성
 * `.rif`(2,000판 — 천원에서 번지는 판, 대칭 상 · 전치 섞음)를 이 스크립트가 만든다. 실제 파일과의
 * 국면별 대조(데스크톱 팩 116,191국면 전부 일치)는 `tools/w7/rif-crosscheck.ts` 가 로컬에서 한다.
 */
import { chromium, type Page } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const PORT = Number(process.env.SMOKE_PORT ?? 4185);
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

// ── 합성 .rif ─────────────────────────────────────────────────────────
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const COLS = "abcdefghijklmno";
const label = (x: number, y: number) => `${COLS[x]}${15 - y}`;
function syntheticRif(games: number): string {
  const r = rng(20261009);
  const lines: [number, number][][] = [];
  const out: string[] = [];
  for (let g = 0; g < games; g++) {
    let line: [number, number][];
    if (g > 20 && r() < 0.25) {
      // 앞선 판의 거울상 — 정규화가 한 국면으로 묶어야 한다
      line = lines[Math.floor(r() * lines.length)]!.map(([x, y]) => [14 - x, y]);
    } else {
      line = [[7, 7]];
      const used = new Set([7 * 15 + 7]);
      const n = 6 + Math.floor(r() * 30);
      while (line.length < n) {
        const [bx, by] = line[Math.floor(r() * line.length)]!;
        const x = Math.min(14, Math.max(0, bx + Math.floor(r() * 3) - 1));
        const y = Math.min(14, Math.max(0, by + Math.floor(r() * 3) - 1));
        if (used.has(y * 15 + x)) continue;
        used.add(y * 15 + x);
        line.push([x, y]);
      }
    }
    lines.push(line);
    const res = ["1", "0", "0.5"][g % 3];
    out.push(
      `<game id="${g + 1}" publisher="1" tournament="${1 + (g % 2)}" round="1" rule="${g % 5 === 0 ? 2 : 1}" ` +
        `black="${1 + (g % 3)}" white="${1 + ((g + 1) % 3)}" bresult="${res}" opening="21" alt="" swap="R">\n` +
        `<move>${line.map(([x, y]) => label(x, y)).join(" ")}</move>\n</game>`,
    );
  }
  // 수순이 빈 판 — 받지 않아야 한다
  out.push(
    `<game id="99999" tournament="1" rule="1" black="1" white="2" bresult="1">\n<move></move>\n</game>`,
  );
  return `<?xml version="1.0"?>
<database version="1.0" date="2026-07-31">
<!-- synthetic test data (not RenjuNet) -->
<countries><country id="1" name="Estonia" abbr="EST" /><country id="6" name="Korea" abbr="KOR" /></countries>
<rules><rule id="1" name="Classic" category="1"><info>-</info></rule><rule id="2" name="Yamaguchi" category="1"><info>-</info></rule></rules>
<players>
<player id="1" name="Ando" surname="Meritee" country="1" />
<player id="2" name="Kim" surname="Smoke" country="6" />
<player id="3" name="김" surname="렌주" country="6" />
</players>
<tournaments>
<tournament id="1" name="Smoke Open" year="2024" rated="1" />
<tournament id="2" name="Smoke Cup" year="2025" rated="0" />
</tournaments>
<games>
${out.join("\n")}
</games>
</database>
`;
}

const GAMES = 2000;
const RIF = syntheticRif(GAMES);

/** 페이지의 `body` 에 파일 하나를 떨어뜨린다 — 사용자가 끌어다 놓는 것과 같은 drop 사건. */
async function dropFile(page: Page, name: string, text: string, selector = "body") {
  await page.evaluate(
    `(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: "application/xml" }));
      const el = document.querySelector(${JSON.stringify(selector)});
      el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    })()`,
  );
}

type PackView = {
  ready: boolean;
  job: { phase: string; fraction: number } | null;
  done: { games: number; positions: number; ms: number } | null;
  error: string | null;
  pack: { games: number; positions: number } | null;
  local: { games: number } | null;
};
const packView = (page: Page) => page.evaluate("window.__rapfiPack()") as Promise<PackView>;

await new Promise<void>((r) => server.listen(PORT, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, locale: "ko-KR" });
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  console.log("1. 빈 랭킹 — 가져오기 안내");
  await page.goto(`${BASE}/research/ranking?autoboot=0`);
  await page.locator(".ranking").waitFor({ timeout: 15_000 });
  await page.locator(".rifcard").waitFor({ timeout: 10_000 });
  const link = await page.locator('.rifcard a[href*="renju.net"]').first().getAttribute("href");
  check(
    link === "https://www.renju.net/game/",
    "renju.net 내려받기 링크가 있다",
    `링크가 다르다: ${link}`,
  );

  console.log("2. 보드 화면에 .rif 를 떨어뜨린다 — 어느 화면에서든 변환");
  await page.locator(".rail__link", { hasText: "보드" }).click();
  await page.locator(".boardscreen").waitFor();
  const stonesBefore = await page.locator("canvas[role=img]").getAttribute("aria-label");
  await dropFile(page, "renjunet_smoke.rif", RIF, ".boardscreen__board");
  await page.locator(".rifjob").waitFor({ timeout: 5_000 });
  ok("진행 카드가 떴다");
  const done = await page
    .waitForFunction(
      `(() => { const p = window.__rapfiPack(); return p.done || p.error; })()`,
      null,
      {
        timeout: 60_000,
        polling: 100,
      },
    )
    .then(() => packView(page));
  if (done.error) throw new Error(`변환 실패: ${done.error}`);
  check(
    done.done?.games === GAMES,
    `변환 완료 — ${done.done?.games}판 · 국면 ${done.done?.positions} · ${Math.round(done.done?.ms ?? 0)}ms`,
    `판 수가 다르다: ${done.done?.games} (빈 수순 판은 빠져야 ${GAMES})`,
  );
  const stonesAfter = await page.locator("canvas[role=img]").getAttribute("aria-label");
  check(
    stonesAfter === stonesBefore,
    "보드의 «기보 열기»가 .rif 를 가로채지 않았다",
    `보드 판이 바뀌었다: ${stonesAfter}`,
  );
  const doneText = await page.locator('[data-k="rif-done"]').innerText();
  check(/2,000판/.test(doneText), `완료 카드: ${doneText}`, `완료 카드 글이 다르다: ${doneText}`);

  console.log("3. 랭킹");
  await page.getByRole("button", { name: "랭킹 보기" }).click();
  await page.locator('[data-k="ranking-three"]').waitFor({ timeout: 10_000 });
  const total = await page.locator('[data-k="ranking-total"]').innerText();
  check(total.includes("2,000판"), `26주형 랭킹 — ${total.trim()}`, `총계가 다르다: ${total}`);
  check(
    (await page.locator(".rifcard").count()) === 0,
    "팩이 있으면 가져오기 안내가 사라진다",
    "안내가 남아 있다",
  );
  await page.getByRole("searchbox", { name: "선수 찾기" }).fill("kor");
  const sugg = await page.locator(".ranking__suggest button").allInnerTexts();
  check(
    sugg.length === 2,
    `나라로 선수 찾기 — ${sugg.join(" / ")}`,
    `KOR 선수가 둘이 아니다: ${sugg.length}`,
  );
  await page.locator(".ranking__suggest button").first().click();
  await page.getByRole("radio", { name: "흑으로" }).click();
  const filtered = await page.locator('[data-k="ranking-total"]').innerText();
  check(
    /고른 범위/.test(filtered) && !filtered.includes("2,000판"),
    `선수 · 색 거르기 — ${filtered.trim()}`,
    `거르기가 먹지 않는다: ${filtered}`,
  );
  await page.getByRole("radio", { name: "5수 모양" }).click();
  check(
    (await page.locator('[data-k="ranking-five"] .rankrow').count()) > 0,
    "5수 모양 랭킹",
    "5수 모양이 없다",
  );

  console.log("4. 오프닝 통계 · 대국 목록");
  await page.locator('[data-k="ranking-five"] .rankrow').first().click();
  await page.waitForURL("**/research/explorer");
  await page.locator('[data-k="explorer-games"]').waitFor({ timeout: 10_000 });
  const games5 = await page.locator('[data-k="explorer-games"]').innerText();
  check(
    /\d+판/.test(games5),
    `5수 국면 통계 — ${games5.replace(/\s+/g, " ")}`,
    `국면 통계가 없다: ${games5}`,
  );
  await page.getByRole("button", { name: "처음으로" }).click();
  const root = await page.locator('[data-k="explorer-games"]').innerText();
  check(root.includes("2,000판"), "빈 판 = 모든 판", `빈 판 통계: ${root}`);
  await page.getByRole("button", { name: "대국 목록 보기" }).click();
  const rows = await page.locator('[data-k="explorer-gamelist"] .gamelist__row').count();
  check(rows === 50, "대국 목록 50줄(2,000판 중)", `대국 목록이 ${rows}줄`);
  await page.getByRole("searchbox", { name: "선수 이름으로 거르기" }).fill("김");
  const named = await page
    .locator('[data-k="explorer-gamelist"] .gamelist__players')
    .allInnerTexts();
  check(
    named.length > 0 && named.every((t) => t.includes("김")),
    `선수 이름으로 거르기 — ${named.length}줄`,
    `거르기가 틀렸다: ${named.slice(0, 3).join(" / ")}`,
  );

  console.log("5. 새로고침 뒤에도 남는다(IndexedDB)");
  await page.goto(`${BASE}/research/ranking?autoboot=0`);
  await page.locator('[data-k="ranking-three"]').waitFor({ timeout: 15_000 });
  const again = await packView(page);
  check(
    again.pack?.games === GAMES,
    "새로고침 뒤 팩을 다시 읽었다",
    `새로고침 뒤 팩: ${JSON.stringify(again.pack)}`,
  );

  console.log("6. 지우면 내 기보로 물러선다");
  await page.getByRole("button", { name: "지우기", exact: true }).click();
  await page.locator(".packbar__confirm").getByRole("button", { name: "지우기" }).click();
  await page.locator(".rifcard").waitFor({ timeout: 10_000 });
  const gone = await packView(page);
  check(gone.pack === null, "RenjuNet 팩을 지웠다", "팩이 남아 있다");
  // 보드에 몇 수 두면 내 기보(지금 판)로 센다.
  await page.goto(`${BASE}/board?p=h8i9j10k11&autoboot=0`);
  await page.locator(".boardscreen").waitFor();
  await page.waitForTimeout(1500); // 자동 저장
  await page.locator(".rail__link", { hasText: "연구" }).click();
  await page.locator(".rtabs__tab", { hasText: "랭킹" }).click();
  await page.locator('[data-k="ranking-three"]').waitFor({ timeout: 15_000 });
  const local = await page.locator('[data-k="ranking-total"]').innerText();
  check(
    local.includes("내 기보"),
    `내 기보 폴백 — ${local.trim().slice(0, 40)}…`,
    `내 기보로 물러서지 않았다: ${local}`,
  );

  if (pageErrors.length) fail(`페이지 오류 ${pageErrors.length}건:\n  ${pageErrors.join("\n  ")}`);
} catch (e) {
  fail(e instanceof Error ? e.message.split("\n")[0]! : String(e));
  try {
    console.error(JSON.stringify(await packView(page)));
  } catch {
    /* 페이지가 없다 */
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\nW7 스모크 실패 ${failures.length}건` : "\nW7 스모크 통과");
