/**
 * CSP 위반 감시 — 스모크의 모든 페이지와 **그 워커**에서 Content-Security-Policy 위반을 잡는다
 * (보안 강화 계획 Phase 1 · §5).
 *
 * 스모크는 `const browser = watchBrowser(await chromium.launch())` 한 줄로 붙인다. 그 브라우저가 여는
 * 페이지 · 컨텍스트마다 자동으로 붙는다. 잡는 길은 셋이다:
 *
 *   1. 문서의 `securitypolicyviolation` 이벤트 — 초기화 스크립트가 콘솔로 옮긴다(`[CSP] …`).
 *   2. 브라우저가 스스로 남기는 위반 로그(`Refused to …` · `[Report Only] …`) — 페이지 콘솔.
 *   3. 같은 로그의 워커 쪽 — 엔진 · rif · 수순 워커와 pthread 워커. WASM 컴파일(`'wasm-unsafe-eval'`)은
 *      엔진 워커 안에서 일어나고, 워커는 자기 스크립트 응답의 CSP 를 따르므로 여기가 가장 중요하다.
 *
 * Report-Only 정책에서도 셋 다 온다 — 강제하기 전에 전부 드러난다.
 *
 * **스모크의 `page.waitForFunction` 술어는 문자열이 아니라 함수로 준다.** Playwright 는 문자열 술어를
 * 폴링할 때마다 페이지 안에서 `eval` 로 컴파일해서, `'unsafe-eval'` 이 없는 이 정책이 그것을 위반으로
 * 잡는다(실측: 문자열 131건 · 함수 0건). 앱이 아니라 시험 하네스의 위반이다. `page.evaluate(문자열)` 은
 * 개발자 도구 프로토콜로 돌아 CSP 대상이 아니다.
 *
 *   CSP_WATCH=fail (기본)  위반 하나면 그 자리에서 실패(exit 1)
 *   CSP_WATCH=log          실패하지 않고 모두 찍는다(정책을 조일 때 목록을 모으는 용도)
 *   CSP_WATCH=off          감시하지 않는다
 */
import type { Browser, BrowserContext, ConsoleMessage, Page, Worker } from "playwright";

const MODE = process.env.CSP_WATCH ?? "fail";

const CSP_TEXT =
  /\[CSP\]|Content[- ]Security[- ]Policy|Refused to (load|execute|compile|create|connect|apply|frame|evaluate|run)/i;

const seen = new Set<string>();

/** 지금까지 본 위반(중복 제거). */
export const cspViolations = (): readonly string[] => [...seen];

function record(where: string, text: string): void {
  const line = `${where} — ${text.replace(/\s+/g, " ").slice(0, 400)}`;
  if (seen.has(line)) return;
  seen.add(line);
  console.error(`  CSP 위반: ${line}`);
  if (MODE === "fail") process.exit(1);
}

const short = (url: string) => url.replace(/^https?:\/\/[^/]+/, "") || "/";

function onConsole(where: () => string) {
  return (m: ConsoleMessage) => {
    const text = m.text();
    if (CSP_TEXT.test(text))
      record(m.worker() ? `워커 ${short(m.worker()!.url())}` : where(), text);
  };
}

function watchWorker(w: Worker): void {
  w.on(
    "console",
    onConsole(() => `워커 ${short(w.url())}`),
  );
}

function watchPage(page: Page): void {
  page.on(
    "console",
    onConsole(() => `페이지 ${short(page.url())}`),
  );
  page.on("worker", watchWorker);
  page.on("pageerror", (e) => {
    if (CSP_TEXT.test(String(e))) record(`페이지 ${short(page.url())}`, String(e));
  });
}

const contexts = new WeakSet<BrowserContext>();

async function watchContext(ctx: BrowserContext): Promise<void> {
  if (contexts.has(ctx)) return;
  contexts.add(ctx);
  await ctx.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(
        `[CSP] ${e.disposition} ${e.effectiveDirective} blocked=${e.blockedURI || "(inline)"} ` +
          `at ${e.sourceFile || "?"}:${e.lineNumber}`,
      );
    });
  });
  ctx.on("page", watchPage);
  for (const p of ctx.pages()) watchPage(p);
}

/** 브라우저를 감싸 그 뒤에 여는 모든 페이지 · 컨텍스트에 감시를 붙인다. */
export function watchBrowser(browser: Browser): Browser {
  if (MODE === "off") return browser;
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = (async (...args: Parameters<Browser["newContext"]>) => {
    const ctx = await newContext(...args);
    await watchContext(ctx);
    return ctx;
  }) as Browser["newContext"];
  browser.newPage = (async (...args: Parameters<Browser["newPage"]>) => {
    const page = await newPage(...args);
    // 암묵 컨텍스트의 «page» 이벤트는 이미 지나갔다 — 페이지를 직접 붙이고, 초기화 스크립트는
    // 첫 탐색 전에 걸리므로 그대로 유효하다.
    await watchContext(page.context());
    return page;
  }) as Browser["newPage"];
  return browser;
}
