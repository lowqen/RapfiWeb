/**
 * W7 브라우저 실측 — **로컬 전용**(RenjuNet `.rif` 가 있어야 한다. 저장소에 두지 않는다).
 *
 *   pnpm build && pnpm exec tsx tools/w7/measure-browser.ts <renjunet_*.rif> [출력 폴더]
 *
 * 실제 앱(dist)에 실제 파일을 넣어(`setInputFiles` — 사용자가 고른 것과 같은 File) 변환 워커가 끝날
 * 때까지의 시간과, **워커의** V8 메모리(힙 + ArrayBuffer 저장소)를 DevTools 프로토콜로 50ms 마다 잰다.
 * 같은 일을 데스크톱 · 안드로이드 화면(모바일 뷰포트 · 터치 · UA)으로 되풀이한다.
 *
 * **CPU 감속은 쓰지 않는다** — DevTools 의 `Emulation.setCPUThrottlingRate` 는 페이지 스레드에만 걸리고
 * 변환 워커에는 걸리지 않는다(실측 1× · 2× · 4× 가 5.5 · 6.3 · 6.0초로 같았다). 그래서 시간은 이 기계
 * 그대로의 값이고, 저사양 폰 시간은 실기기에서 잰다 — 배포본을 폰에서 열고 파일을 넣으면 완료
 * 카드가 걸린 시간을 말한다(`__rapfiPack().done.ms`).
 */
import { chromium, type CDPSession } from "playwright";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ISOLATION_HEADERS } from "../../scripts/isolation.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../../dist");
const [rifPath, outDir] = process.argv.slice(2);
if (!rifPath || !existsSync(rifPath)) {
  console.error("사용법: tsx tools/w7/measure-browser.ts <renjunet_*.rif> [출력 폴더]");
  process.exit(2);
}
if (outDir) mkdirSync(outDir, { recursive: true });

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
  res.writeHead(200, {
    ...ISOLATION_HEADERS,
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
  });
  res.end(readFileSync(file));
});
const PORT = 4192;
await new Promise<void>((r) => server.listen(PORT, r));

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const configs = [
  { name: "데스크톱", viewport: { width: 1440, height: 900 }, mobile: false, cpu: 1 },
  { name: "안드로이드 화면", viewport: { width: 393, height: 851 }, mobile: true, cpu: 1 },
];

const MB = (b: number) => `${(b / 1048576).toFixed(1)}MB`;
const browser = await chromium.launch();

for (const c of configs) {
  const context = await browser.newContext({
    viewport: c.viewport,
    isMobile: c.mobile,
    hasTouch: c.mobile,
    deviceScaleFactor: c.mobile ? 2.75 : 1,
    ...(c.mobile ? { userAgent: ANDROID_UA } : {}),
  });
  const page = await context.newPage();
  const cdp: CDPSession = await context.newCDPSession(page);

  // 워커 표적에 붙는다(평평하지 않은 세션 — Playwright 의 CDPSession 으로 자식 세션에 말을 건다).
  let seq = 0;
  const pending = new Map<number, (v: unknown) => void>();
  const workers = new Map<string, string>(); // sessionId → url
  cdp.on(
    "Target.attachedToTarget",
    (e: { sessionId: string; targetInfo: { type: string; url: string } }) => {
      if (e.targetInfo.type !== "worker") return;
      workers.set(e.sessionId, e.targetInfo.url);
      void toWorker(e.sessionId, "Runtime.runIfWaitingForDebugger", {}).catch(() => {});
    },
  );
  cdp.on("Target.receivedMessageFromTarget", (e: { message: string }) => {
    const m = JSON.parse(e.message) as { id?: number; result?: unknown; error?: unknown };
    if (m.id !== undefined) pending.get(m.id)?.(m.error ? null : m.result);
  });
  const toWorker = (sessionId: string, method: string, params: object) =>
    new Promise<unknown>((resolveP) => {
      const id = ++seq;
      pending.set(id, resolveP);
      void cdp
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch(() => resolveP(null));
    });
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });

  await page.goto(`http://localhost:${PORT}/research/ranking?autoboot=0`);
  await page.locator(".ranking").waitFor({ timeout: 30_000 });

  let peak = 0;
  let samples = 0;
  let phase = "read";
  const phasePeak: Record<string, number> = {};
  let attached = false;
  const poll = setInterval(() => {
    void page
      .evaluate(`window.__rapfiPack().job?.phase ?? "save"`)
      .then((p) => (phase = p as string))
      .catch(() => {});
    for (const [sid, url] of workers) {
      if (!url.includes("rif.worker")) continue;
      void toWorker(sid, "Runtime.getHeapUsage", {}).then((r) => {
        const u = r as { usedSize?: number; backingStorageSize?: number } | null;
        if (!u?.usedSize) return;
        samples++;
        attached = true;
        const v = u.usedSize + (u.backingStorageSize ?? 0);
        peak = Math.max(peak, v);
        phasePeak[phase] = Math.max(phasePeak[phase] ?? 0, v);
      });
    }
  }, 50);

  const t0 = Date.now();
  await page.locator('[data-k="rif-input"]').first().setInputFiles(rifPath);
  if (outDir) {
    await page.locator(".rifjob").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(c.cpu * 800);
    await page.screenshot({
      path: join(outDir, `progress-${c.mobile ? "mobile" : "desktop"}-${c.cpu}x.png`),
    });
  }
  const done = (await page
    .waitForFunction(
      `(() => { const p = window.__rapfiPack(); return p.done || (p.error ? { error: p.error } : null); })()`,
      null,
      {
        timeout: 600_000,
        polling: 200,
      },
    )
    .then((h) => h.jsonValue())) as {
    ms?: number;
    games?: number;
    positions?: number;
    packBytes?: number;
    error?: string;
  };
  const wall = Date.now() - t0;
  clearInterval(poll);
  if (done.error) {
    console.log(`${c.name}: 실패 — ${done.error}`);
  } else {
    console.log(
      `${c.name}: 워커 ${((done.ms ?? 0) / 1000).toFixed(1)}초 · 끝까지(저장 포함) ${(wall / 1000).toFixed(1)}초 · ` +
        `워커 메모리 피크 ${samples ? MB(peak) : "(못 잼)"}(${samples}회 표본) · ${done.games?.toLocaleString()}판 · 국면 ${done.positions?.toLocaleString()} · 저장 ${MB(done.packBytes ?? 0)}` +
        (attached ? "" : " · 워커 표적에 붙지 못했다"),
    );
    console.log(
      `  단계별 워커 피크: ${Object.entries(phasePeak)
        .map(([k, v]) => `${k} ${MB(v)}`)
        .join(" · ")}`,
    );
  }
  if (outDir) {
    const tag = c.mobile ? "mobile" : "desktop";
    await page.screenshot({ path: join(outDir, `ranking-${tag}-${c.cpu}x.png`), fullPage: false });
    if (c.cpu <= 2) {
      await page.goto(`http://localhost:${PORT}/research/explorer?p=h8i9j10&autoboot=0`);
      await page.locator(".explorer").waitFor();
      await page.waitForFunction(
        `document.querySelector('[data-k="explorer-games"]')?.textContent.includes("판")`,
        null,
        { timeout: 30_000 },
      );
      await page.screenshot({ path: join(outDir, `explorer-${tag}.png`), fullPage: true });
    }
  }
  await context.close();
}
await browser.close();
server.close();
