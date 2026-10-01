/**
 * 출력량이 탐색 속도에 주는 영향 — `INFO SHOW_DETAIL 3`(앱이 쓰는 상세 출력) 대 2.
 * 멀티 빌드는 pthread 의 출력이 런타임 스레드로 **동기 프록시**되고 preamble 이 글자 단위로
 * 받으므로, 줄이 많을수록 탐색 스레드가 출력에서 기다린다는 가설을 잰다.
 *
 *   node bench/gomocalc/output-probe.mjs [engine] [variant]     (환경: TIME_MS, THREADS, ROUNDS)
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { HERE, Host, search, serve, setup } from "./lib.mjs";

const [engine = "rapfiweb", variant = "multi-simd128"] = process.argv.slice(2);
const TIME_MS = Number(process.env.TIME_MS ?? 4000);
const THREADS = Number(process.env.THREADS ?? 1);
const ROUNDS = Number(process.env.ROUNDS ?? 2);
const { positions } = JSON.parse(await readFile(join(HERE, "positions.json"), "utf8"));
const port = 5500 + Math.floor(Math.random() * 300);
const server = await serve(port);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/page/index.html`);
  const host = new Host(page);
  await host.load(engine, variant);
  await setup(host);
  await host.post(`INFO THREAD_NUM ${THREADS}`);
  await search(host, positions[0].moves, { timeMs: 3000 }); // 예열
  const acc = { 3: { nps: [], lines: 0, ms: 0 }, 2: { nps: [], lines: 0, ms: 0 } };
  for (let r = 0; r < ROUNDS; r++) {
    for (const detail of [3, 2]) {
      await host.post(`INFO SHOW_DETAIL ${detail}`);
      for (const p of positions) {
        const from = await page.evaluate(() => window.bench.lines.length);
        const s = await search(host, p.moves, { timeMs: TIME_MS });
        const n = (await page.evaluate(() => window.bench.lines.length)) - from;
        // SHOW_DETAIL 2 에서는 INFO 줄이 없어 요약 줄(MESSAGE Speed)로 nps 를 읽는다.
        acc[detail].nps.push(s.nps ?? 0);
        acc[detail].lines += n;
        acc[detail].ms += s.wallMs;
      }
    }
  }
  const geo = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(Math.max(1, x)), 0) / xs.length);
  for (const d of [3, 2]) {
    const a = acc[d];
    console.log(
      `SHOW_DETAIL ${d}: nps 기하평균 ${Math.round(geo(a.nps))} · 줄 ${a.lines} (${Math.round((a.lines * 1000) / a.ms)}줄/초)`,
    );
  }
  console.log(
    `비율 2/3 = ${(geo(acc[2].nps) / geo(acc[3].nps)).toFixed(3)} (${engine}/${variant}, t${THREADS})`,
  );
} finally {
  await browser.close();
  server.close();
}
