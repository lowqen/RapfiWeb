/**
 * W10 스모크 — 다국어 · 반응형 · 접근성. 프로덕션 빌드를 띄워 화면마다 훑는다.
 *
 *   pnpm build && pnpm exec tsx scripts/i18n-smoke.ts
 *
 *  1. 영어 브라우저(en-US)로 열면 영어로 뜨고(`<html lang="en">`), 모든 화면에 **한글이 새지 않는다** —
 *     보이는 글과 aria-label · title · placeholder 모두. 번역하지 않는 자료(4수 이름 · 선수 이름 · 원시 로그)는
 *     `lang="ko"` 를 달았거나 `<pre>` 안에 있어 빠진다.
 *  2. 두 언어 모두 화면 문구에 대시(— · – · 띄어 쓴 « - »)가 없다.
 *  3. 휴대폰 세로 · 가로, 태블릿, 데스크톱 폭에서 **가로 스크롤이 생기지 않는다.**
 *  4. 휴대폰 폭에서 누르는 것들의 크기가 24×24 이상이다(WCAG 2.2 AA 2.5.8, 글 속 링크는 예외).
 *  5. 밝게 · 어둡게 두 테마에서 글자 명암비가 4.5:1(큰 글자 3:1) 이상이다(WCAG 1.4.3, 꺼진 조작부는 예외).
 *  6. 상단 바의 언어 단추로 바꾸면 곧바로 바뀌고 새로고침 뒤에도 남는다. 설정의 «언어» 줄도 같다.
 *  7. 보드는 Tab 으로 초점을 받고 방향키 · Enter 로 둘 수 있다.
 */
import { chromium, type Browser, type Page } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_HEADERS } from "./isolation.ts";
import { watchBrowser } from "./csp-watch.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const PORT = Number(process.env.SMOKE_PORT ?? 4183);
const BASE = `http://localhost:${PORT}`;

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
    const body = readFileSync(file);
    res.writeHead(200, {
      ...SITE_HEADERS,
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

let failures = 0;
const fail = (m: string) => {
  console.error(`i18n 스모크 실패: ${m}`);
  failures++;
};

/** 훑을 화면 — 경로와, 들어가서 더 펼칠 것(고급 설정 · 정석 편집기). */
const ROUTES: readonly { path: string; prepare?: (p: Page) => Promise<void> }[] = [
  { path: "/board" },
  {
    path: "/board",
    // 대국 탭 — 문구가 아니라 data-mode 로 집는다(언어와 무관하게). 기본 탭은 분석이다.
    prepare: async (p) => {
      await p.locator('[role="tablist"] [role="tab"][data-mode="game"]').click();
    },
  },
  { path: "/research/review" },
  { path: "/research/explorer" },
  { path: "/research/sequence" },
  { path: "/research/ranking" },
  { path: "/database" },
  { path: "/engine" },
  // 정석은 [공식 커리큘럼] 탭으로 연다 — 코스 목록, 코스, 레슨의 살펴보기 · 학습, 그리고 [내 정석]의 편집기.
  {
    path: "/joseki",
    prepare: async (p) => {
      await p.locator('[data-tab="official"]').click();
      await p.locator('[data-k="curriculum"]').waitFor({ timeout: 5000 });
    },
  },
  {
    path: "/joseki",
    prepare: async (p) => {
      await p.locator('[data-tab="official"]').click();
      await p.locator(".card[data-course]").first().click();
      await p.locator('[data-k="course"]').waitFor({ timeout: 5000 });
    },
  },
  {
    path: "/joseki",
    prepare: async (p) => {
      await p.locator('[data-tab="official"]').click();
      await p.locator(".card[data-course]").first().click();
      await p.locator(".lessonlist__item").first().click();
      await p.locator('[data-k="lesson"]').waitFor({ timeout: 5000 });
      await p.locator(".jtree__move").first().click();
    },
  },
  {
    path: "/joseki",
    prepare: async (p) => {
      await p.locator('[data-tab="official"]').click();
      await p.locator(".card[data-course]").first().click();
      await p.locator(".lessonlist__item").first().click();
      await p.locator('[role="tab"][data-mode="learn"]').click();
      await p.locator('[data-k="quiz"]').waitFor({ timeout: 5000 });
    },
  },
  {
    path: "/joseki",
    // 새 정석을 열어 편집기까지 — 목록의 첫 주 단추가 «새 정석»이다.
    prepare: async (p) => {
      await p.locator('[data-tab="mine"]').click();
      await p.locator(".joseki .button--primary").first().click();
      await p.locator(".joseki-editor").waitFor({ timeout: 5000 });
    },
  },
  { path: "/settings" },
];

/** 고급 설정을 켜 둔 채로 열어 숨은 줄까지 훑는다. */
const SEED = `(() => {
  try {
    localStorage.setItem("rapfi.settings", JSON.stringify({ showAdvanced: true, autoBoot: false }));
  } catch {}
})()`;

interface Audit {
  hangul: string[];
  dash: string[];
  overflow: number;
  small: string[];
  contrast: string[];
}

/** 페이지 안에서 도는 점검 — 문자열로 넘긴다(tsx 의 변환이 함수 본문에 도움 함수를 끼우지 않게). */
const AUDIT = `(() => {
  const H = /[가-힣]/;
  const D = /[\\u2014\\u2013]| - /;
  const out = { hangul: [], dash: [], overflow: 0, small: [], contrast: [] };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const ko = (el) => (el.closest("[lang]")?.getAttribute("lang") ?? "").startsWith("ko");
  const raw = (el) => !!el.closest("pre, script, style, textarea, code");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textEls = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? "").trim();
    const el = n.parentElement;
    if (!text || !el || !shown(el) || raw(el)) continue;
    textEls.add(el);
    if (H.test(text) && !ko(el)) out.hangul.push(text.slice(0, 90));
    if (D.test(text)) out.dash.push(text.slice(0, 90));
  }
  for (const el of document.querySelectorAll("[aria-label],[title],[placeholder],[aria-roledescription]")) {
    if (!shown(el)) continue;
    for (const a of ["aria-label", "title", "placeholder", "aria-roledescription"]) {
      const v = el.getAttribute(a);
      if (!v) continue;
      if (H.test(v) && !ko(el)) out.hangul.push(a + "=" + v.slice(0, 90));
      if (D.test(v)) out.dash.push(a + "=" + v.slice(0, 90));
    }
  }
  // 가로 넘침 — 문서와, 화면 본문을 스크롤하는 \`main\` 상자(문서는 넘치지 않아도 본문이 옆으로 밀릴 수 있다).
  const de = document.documentElement;
  const main = document.querySelector("main");
  out.overflow = Math.max(0, de.scrollWidth - de.clientWidth, main ? main.scrollWidth - main.clientWidth : 0);
  // 상단 바는 넘쳐도 스크롤이 생기지 않고 잘린다 — 자식이 오른쪽 끝을 넘는지 따로 잰다.
  const bar = document.querySelector(".topbar");
  if (bar) {
    const right = bar.getBoundingClientRect().right;
    for (const e of bar.querySelectorAll("*")) {
      const b = e.getBoundingClientRect();
      if (b.width) out.overflow = Math.max(out.overflow, b.right - right);
    }
  }

  // 누르는 것의 크기 — 휴대폰 폭에서만 의미가 있다(부르는 쪽이 고른다).
  if (window.innerWidth < 700) {
    const sel = "button, a[href], [role=button], [role=tab], [role=radio], [role=switch], select, input:not([type=hidden]):not([type=file])";
    for (const el of document.querySelectorAll(sel)) {
      if (!shown(el) || el.closest(".sr-only") || el.classList.contains("sr-only")) continue;
      // 글 속 링크는 예외(2.5.8 «inline»): 문단 · 목록 줄 안의 링크와 linkish 단추.
      if (el.closest("p, li") && (el.tagName === "A" || el.classList.contains("linkish"))) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) {
        const name = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);
        out.small.push(name + " " + Math.round(r.width) + "×" + Math.round(r.height));
      }
    }
  }

  // 명암비 — 글자색과, 위로 올라가며 처음 만나는 불투명 배경.
  const rgb = (s) => {
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null; // 그라데이션 · 그림 — 잴 수 없다
      const c = rgb(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let base = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) {
      const c = layers[i];
      base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
    }
    return base;
  };
  for (const el of textEls) {
    if (el.closest("[disabled], [aria-disabled=true], .board, canvas, svg")) continue;
    if (el.closest(".sr-only")) continue;
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    const op = Number(cs.opacity);
    const f = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const L1 = lum(f), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    if (op < 1 || ratio + 0.01 < need) {
      if (op < 1 && ratio + 0.01 >= need) continue;
      out.contrast.push((el.textContent ?? "").trim().slice(0, 40) + " " + ratio.toFixed(2) + ":1 (" + cs.color + " on rgb(" + [bg.r, bg.g, bg.b].map(Math.round).join(",") + "))");
    }
  }
  return out;
})()`;

async function audit(page: Page): Promise<Audit> {
  return (await page.evaluate(AUDIT)) as Audit;
}

const uniq = (xs: readonly string[]) => [...new Set(xs)];

async function sweep(
  browser: Browser,
  opts: {
    locale: string;
    viewport: { width: number; height: number };
    scheme: "light" | "dark";
    checkLang: boolean;
    label: string;
  },
) {
  const ctx = await browser.newContext({
    locale: opts.locale,
    viewport: opts.viewport,
    colorScheme: opts.scheme,
    hasTouch: opts.viewport.width < 700,
  });
  await ctx.addInitScript(SEED);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const r of ROUTES) {
    await page.goto(`${BASE}${r.path}`, { waitUntil: "networkidle" });
    if (r.prepare) await r.prepare(page);
    await page.waitForTimeout(150);
    const a = await audit(page);
    const where = `${opts.label} ${r.path}${r.prepare ? " (펼침)" : ""}`;
    if (opts.checkLang && a.hangul.length)
      fail(
        `${where}: 영어 화면에 한글 ${a.hangul.length}곳 — ${uniq(a.hangul).slice(0, 8).join(" | ")}`,
      );
    if (a.dash.length)
      fail(`${where}: 대시 ${a.dash.length}곳 — ${uniq(a.dash).slice(0, 8).join(" | ")}`);
    if (a.overflow > 1) fail(`${where}: 가로 스크롤 ${a.overflow}px`);
    if (a.small.length)
      fail(`${where}: 24px 보다 작은 조작부 — ${uniq(a.small).slice(0, 8).join(" | ")}`);
    if (a.contrast.length)
      fail(
        `${where}: 명암비 부족 ${a.contrast.length}곳 — ${uniq(a.contrast).slice(0, 6).join(" | ")}`,
      );
  }
  if (errors.length) fail(`${opts.label}: 페이지 오류 — ${errors.slice(0, 3).join(" | ")}`);
  await ctx.close();
}

await new Promise<void>((r) => server.listen(PORT, r));
const browser = watchBrowser(await chromium.launch());

try {
  // 1. 영어 브라우저 → 영어 화면
  {
    const ctx = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
    });
    await ctx.addInitScript(SEED);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/board`, { waitUntil: "networkidle" });
    const lang = await page.evaluate("document.documentElement.lang");
    if (lang !== "en") fail(`영어 브라우저인데 <html lang="${lang}">`);
    if ((await page.getByRole("link", { name: "Board", exact: true }).count()) === 0)
      fail("영어 브라우저인데 레일에 «Board» 가 없습니다");

    // 7. 키보드로 두기 — 보드에 초점 → 위 → Enter. 빈 판이면 천원 위 한 칸에 흑이 놓인다.
    const board = page.locator('.board[tabindex="0"]').first();
    await board.focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const label = await page.locator(".board canvas[role=img]").first().getAttribute("aria-label");
    // 영어는 단수 · 복수를 고른다 — 돌 하나면 «1 stone».
    if (!label || !/\b1 stone\b/.test(label)) fail(`키보드 착수가 돌을 놓지 않았습니다 (${label})`);
    const live = await page.locator(".board .sr-only[aria-live]").first().innerText();
    if (!/H9/.test(live)) fail(`키보드 커서 안내가 «H9» 가 아닙니다 (${live})`);
    await ctx.close();
  }

  // 6. 언어 전환 — 한국어로 열고 설정의 «English» 로 영어, 새로고침 뒤 유지, «한국어» 로 되돌리기.
  {
    const ctx = await browser.newContext({
      locale: "ko-KR",
      viewport: { width: 1440, height: 900 },
    });
    await ctx.addInitScript(SEED);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    if ((await page.evaluate("document.documentElement.lang")) !== "ko")
      fail("한국어 브라우저인데 lang 이 ko 가 아닙니다");
    await page
      .getByRole("radiogroup", { name: "언어" })
      .getByRole("radio", { name: "English" })
      .click();
    await page.getByRole("heading", { name: "Frequently used" }).waitFor({ timeout: 3000 });
    await page.reload({ waitUntil: "networkidle" });
    if ((await page.evaluate("document.documentElement.lang")) !== "en")
      fail("새로고침 뒤 영어가 남지 않았습니다");
    await page
      .getByRole("radiogroup", { name: "Language" })
      .getByRole("radio", { name: "한국어" })
      .click();
    await page.getByRole("heading", { name: "자주 쓰는 설정" }).waitFor({ timeout: 3000 });
    const stored = await page.evaluate("localStorage.getItem('rapfi.lang')");
    if (stored !== "ko") fail(`설정에서 고른 언어가 저장되지 않았습니다 (${stored})`);
    console.log("언어 전환: 설정 → English, 새로고침 유지, 설정 → 한국어 ✓");
    await ctx.close();
  }

  // 0. 검사기 자기 점검 — 한국어 화면에서는 한글을 잡아야 하고, 일부러 넣은 저대비 글 · 작은 단추 · 넘치는
  // 상자도 잡아야 한다. 아니면 아래의 «통과»는 검사기가 눈을 감은 것일 수 있다.
  {
    const ctx = await browser.newContext({
      locale: "en-US",
      viewport: { width: 360, height: 740 },
    });
    await ctx.addInitScript(SEED);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/board`, { waitUntil: "networkidle" });
    // 모양은 CSSOM(`el.style.x = …`)으로 준다. HTML 의 `style="…"` 속성은 CSP(style-src 'self')가
    // 막아(Report-Only 면 위반으로 잡혀) 검사기가 넣은 상자가 모양을 잃는다.
    await page.evaluate(`(() => {
      const d = document.createElement("div");
      const add = (tag, text, style, attrs) => {
        const el = document.createElement(tag);
        el.textContent = text;
        Object.assign(el.style, style);
        for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
        d.appendChild(el);
      };
      add("p", "저대비 — 글", { color: "#888", background: "#999" });
      add("p", "면제되는 한글", {}, { lang: "ko" });
      add("button", "x", { width: "10px", height: "10px" });
      add("div", "", { width: "2000px", height: "1px" });
      document.querySelector("main")?.appendChild(d);
    })()`);
    const a = await audit(page);
    if (!a.hangul.some((x) => x.includes("저대비")))
      fail("자기 점검: 영어 화면에 넣은 한글을 잡지 못했습니다");
    if (a.hangul.some((x) => x.includes("면제되는")))
      fail("자기 점검: lang=ko 를 단 한글까지 잡았습니다");
    if (!a.dash.some((x) => x.includes("저대비"))) fail("자기 점검: 넣은 대시를 잡지 못했습니다");
    if (!a.contrast.some((x) => x.includes("저대비")))
      fail("자기 점검: 넣은 저대비 글을 잡지 못했습니다");
    if (!a.small.some((x) => x.startsWith("x ")))
      fail("자기 점검: 넣은 10px 단추를 잡지 못했습니다");
    if (a.overflow < 100) fail("자기 점검: 넣은 2000px 상자의 가로 넘침을 잡지 못했습니다");
    await ctx.close();
  }

  // 1~5. 화면 훑기 — 영어(데스크톱 · 밝게/어둡게), 한국어(대시 · 반응형), 휴대폰 · 태블릿 폭.
  const VIEWPORTS = [
    { width: 360, height: 740, label: "휴대폰 세로" },
    { width: 740, height: 360, label: "휴대폰 가로" },
    { width: 768, height: 1024, label: "태블릿" },
    { width: 1440, height: 900, label: "데스크톱" },
  ];
  for (const scheme of ["light", "dark"] as const) {
    await sweep(browser, {
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
      scheme,
      checkLang: true,
      label: `en ${scheme}`,
    });
  }
  for (const v of VIEWPORTS) {
    await sweep(browser, {
      locale: v.width < 700 ? "en-US" : "ko-KR",
      viewport: v,
      scheme: "dark",
      checkLang: v.width < 700,
      label: `${v.label} ${v.width}×${v.height}`,
    });
  }
  console.log(`화면 ${ROUTES.length}곳 × (영어 2테마 + 폭 ${VIEWPORTS.length}가지) 훑음`);
} finally {
  await browser.close();
  server.close();
}

if (failures) {
  console.error(`i18n 스모크: 실패 ${failures}건`);
  process.exit(1);
}
console.log("i18n 스모크 통과");
