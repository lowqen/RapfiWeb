/**
 * W0-1 (브라우저): 헤드리스 Chromium 으로 harness.html 을 돌린다.
 *
 *   node browser-test.mjs <variant> [port]
 *
 * node-protocol.mjs 가 통과해도 브라우저에서 막힐 수 있는 것들이 있다 —
 * 모듈 워커 안에서의 동적 import, Emscripten 이 pthread 용으로 스스로 띄우는
 * 중첩 워커, COOP/COEP 격리. 그 셋이 여기서만 드러난다.
 *
 * 서버는 호출자가 미리 띄워 둔다(serve.mjs).
 */
import { chromium } from "playwright";

const variant = process.argv[2] ?? "single";
const port = Number(process.argv[3] ?? process.env.PORT ?? 8787);
const url = `http://localhost:${port}/spike/harness.html`;

const browser = await chromium.launch({
  args: [
    // 헤드리스에서도 SIMD/threads 를 확실히 켠다. 격리 자체는 서버 헤더가 만든다.
    "--enable-features=SharedArrayBuffer",
    "--no-sandbox",
  ],
});
const page = await browser.newPage();
const console_ = [];
page.on("console", (m) => console_.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => console_.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "domcontentloaded" });

const caps = await page.evaluate(() => window.__W0_CAPS__);
if (caps?.crossOriginIsolated !== true) {
  console.log(
    JSON.stringify(
      {
        test: "W0-1 (browser)",
        variant,
        pass: false,
        fatal: "crossOriginIsolated 가 true 가 아닙니다 — COOP/COEP 헤더 문제",
        caps,
        console: console_.slice(-20),
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(1);
}

// 가중치 40MB 로드 + 두 번의 탐색이 들어 있으므로 넉넉히.
page.setDefaultTimeout(10 * 60 * 1000);
const report = await page.evaluate(async (v) => await window.runW0(v), variant);
report.console = console_.slice(-20);

console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.pass ? 0 : 1);
