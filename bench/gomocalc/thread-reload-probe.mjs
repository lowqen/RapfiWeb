/**
 * 스레드 수를 바꾸면 가중치를 다시 푸는가 — `SearchEngine::setNumThreads` 가 스레드를 모두
 * 지우고(평가기·가중치 참조 0 → WeightRegistry 에서 해제) 다시 만드는지 출력으로 확인한다.
 *
 *   node bench/gomocalc/thread-reload-probe.mjs [engine] [variant]
 *   STRICT=1 node bench/gomocalc/thread-reload-probe.mjs patched multi-simd128
 *
 * STRICT=1 이면 첫 탐색(가중치를 처음 푸는 것이 정상) 뒤의 단계에서 재적재 줄이 하나라도 나오면
 * 종료 코드 1 — P2-2(docs/최적화-마스터플랜.md §4)의 게이트, engine-patch.yml 의 reload_gate.
 */
import { chromium } from "playwright";
import { Host, search, serve, setup } from "./lib.mjs";

const [engine = "rapfiweb", variant = "multi-simd128"] = process.argv.slice(2);
const strict = process.env.STRICT === "1";
const port = 4900 + Math.floor(Math.random() * 90);
const server = await serve(port);
const browser = await chromium.launch();
const pos = [
  [7, 7],
  [7, 6],
  [8, 6],
];
const reloads = []; // 첫 탐색 뒤 단계의 재적재 줄
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/page/index.html`);
  const host = new Host(page);
  await host.load(engine, variant);
  await setup(host);
  const step = async (label, pre, first = false) => {
    for (const c of pre) await host.post(c);
    const from = await page.evaluate(() => window.bench.lines.length);
    const t0 = Date.now();
    await search(host, pos, { timeMs: 500 });
    const lines = (await page.evaluate((f) => window.bench.lines.slice(f), from)).map(
      (l) => l.line,
    );
    const loaded = lines.filter((l) => /weight loaded in|load weight from/.test(l));
    if (!first) reloads.push(...loaded.map((l) => `${label}: ${l}`));
    console.log(
      `${label.padEnd(26)} 벽시계 ${String(Date.now() - t0).padStart(5)}ms · ${loaded.length ? loaded.at(-1) : "가중치 재적재 없음"}`,
    );
  };
  await step("1) 첫 탐색 (thread 1)", [], true);
  await step("2) 같은 스레드 수", ["INFO THREAD_NUM 1"]);
  await step("3) THREAD_NUM 2 로 변경", ["INFO THREAD_NUM 2"]);
  await step("4) 그대로 2", []);
  await step("5) THREAD_NUM 1 로 되돌림", ["INFO THREAD_NUM 1"]);
  await step("6) THREAD_NUM 3 으로 변경", ["INFO THREAD_NUM 3"]);
  await step("7) THREAD_NUM 2 로 줄임", ["INFO THREAD_NUM 2"]);
} finally {
  await browser.close();
  server.close();
}
console.log(`재적재 줄(첫 탐색 제외): ${reloads.length}`);
if (strict && reloads.length) {
  for (const r of reloads) console.log(`  X ${r}`);
  process.exit(1);
}
