/**
 * 탐색 한 번의 원시 출력을 그대로 찍는다 — 파서를 쓰기 전에 두 엔진이 무엇을 말하는지
 * 눈으로 보는 용도.
 *
 *   node bench/gomocalc/probe.mjs <gomocalc|rapfiweb> <variant> [cmd...]
 */
import { chromium } from "playwright";
import { Host, serve, isMove } from "./lib.mjs";

const [engine = "rapfiweb", variant = "multi-simd128", ...extra] = process.argv.slice(2);
const port = 4290 + Math.floor(Math.random() * 100);
const server = await serve(port);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("console", (m) => console.log("[console]", m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("worker", (w) => w.on("console", (m) => console.log("[worker]", m.text())));
  await page.goto(`http://127.0.0.1:${port}/page/index.html`);
  const host = new Host(page);
  console.log("load", await host.load(engine, variant));
  const cmds = extra.length
    ? extra
    : ["ABOUT", "INFO SHOW_DETAIL 3", "YXSHOWINFO", "INFO RULE 4", "START 15"];
  for (const c of cmds) await host.send(c);
  await new Promise((r) => setTimeout(r, 1500));
  for (const l of await host.drain()) console.log(Math.round(l.t), l.line);
  console.log("--- search");
  for (const c of [
    "INFO THREAD_NUM 1",
    "INFO TIMEOUT_TURN 2000",
    "INFO TIMEOUT_MATCH 0",
    // 블록 명령은 한 번에 — 단일 빌드는 받자마자 한 바퀴 돌린다(engine-worker.ts 주석).
    ["YXBOARD", "7,7,2", "7,6,1", "8,6,2", "DONE"].join("\n"),
    "YXNBEST 1",
  ])
    await host.post(c);
  const lines = await host.until(isMove, 20000, "착수").catch(async (e) => {
    console.log("errors", await page.evaluate(() => window.bench.errors));
    throw e;
  });
  for (const l of lines) console.log(Math.round(l.t), l.line);
  console.log("mem", await host.memoryBytes());
} finally {
  await browser.close();
  server.close();
}
