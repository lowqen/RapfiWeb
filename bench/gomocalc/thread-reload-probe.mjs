/**
 * 스레드 수를 바꾸면 가중치를 다시 푸는가 — `SearchEngine::setNumThreads` 가 스레드를 모두
 * 지우고(평가기·가중치 참조 0 → WeightRegistry 에서 해제) 다시 만드는지 출력으로 확인한다.
 *
 *   node bench/gomocalc/thread-reload-probe.mjs [engine] [variant]
 */
import { chromium } from "playwright";
import { Host, search, serve, setup } from "./lib.mjs";

const [engine = "rapfiweb", variant = "multi-simd128"] = process.argv.slice(2);
const port = 4900 + Math.floor(Math.random() * 90);
const server = await serve(port);
const browser = await chromium.launch();
const pos = [
  [7, 7],
  [7, 6],
  [8, 6],
];
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/page/index.html`);
  const host = new Host(page);
  await host.load(engine, variant);
  await setup(host);
  const step = async (label, pre) => {
    for (const c of pre) await host.post(c);
    const from = await page.evaluate(() => window.bench.lines.length);
    const t0 = Date.now();
    await search(host, pos, { timeMs: 500 });
    const lines = (await page.evaluate((f) => window.bench.lines.slice(f), from)).map(
      (l) => l.line,
    );
    const loaded = lines.filter((l) => /weight loaded in|load weight from/.test(l));
    console.log(
      `${label.padEnd(26)} 벽시계 ${String(Date.now() - t0).padStart(5)}ms · ${loaded.length ? loaded.at(-1) : "가중치 재적재 없음"}`,
    );
  };
  await step("1) 첫 탐색 (thread 1)", []);
  await step("2) 같은 스레드 수", ["INFO THREAD_NUM 1"]);
  await step("3) THREAD_NUM 2 로 변경", ["INFO THREAD_NUM 2"]);
  await step("4) 그대로 2", []);
  await step("5) THREAD_NUM 1 로 되돌림", ["INFO THREAD_NUM 1"]);
} finally {
  await browser.close();
  server.close();
}
