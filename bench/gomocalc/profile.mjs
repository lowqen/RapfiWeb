/**
 * 엔진 핫패스 프로파일 — V8 CPU 프로파일을 **wasm 함수 이름별 자기 시간(self time)** 으로 모은다.
 *
 *   node bench/gomocalc/profile.mjs <engine-dir-name> [variant]
 *
 * 함수 이름이 찍히려면 엔진이 `--profiling-funcs` 로 링크돼 있어야 한다(이름 섹션 유지 —
 * 최적화는 그대로). bench-gomocalc.yml 의 `profile` 입력이 그렇게 빌드한 `rapfiweb-prof` 를
 * 만든다. 이름이 없는 배포 빌드에서도 돌지만 `wasm-function[123]` 처럼만 나온다.
 *
 * 단일 변형을 페이지 메인 스레드에서 띄워(host.js `inline`) 페이지의 CDP 세션 하나로 잰다.
 * 국면마다 TIME_MS 동안 1 스레드로 읽는다(기본 5초 × positions.json 5개).
 *
 * 환경 변수: TIME_MS(5000) · TOP(40) · LABEL(profile)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { HERE, Host, search, serve, setup } from "./lib.mjs";

const [engine = "rapfiweb-prof", variant = "single-simd128"] = process.argv.slice(2);
const TIME_MS = Number(process.env.TIME_MS ?? 5000);
const TOP = Number(process.env.TOP ?? 40);
const LABEL = process.env.LABEL ?? "profile";
const { positions } = JSON.parse(await readFile(join(HERE, "positions.json"), "utf8"));

const port = 5100 + Math.floor(Math.random() * 300);
const server = await serve(port);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/page/index.html`);
  const host = new Host(page);
  await page.evaluate(
    ([d, v]) => window.bench.load(d, v, null, true),
    [`/engines/${engine}/`, variant],
  );
  await setup(host);
  await host.post("INFO THREAD_NUM 1");
  // 예열(가중치 풀기 · JIT 승격)은 프로파일 밖에서.
  await search(host, positions[0].moves, { timeMs: 3000 });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); // µs
  await cdp.send("Profiler.start");
  let nodes = 0;
  for (const p of positions) {
    const s = await search(host, p.moves, { timeMs: TIME_MS, settleMs: 0 });
    nodes += s.nodes ?? 0;
  }
  const { profile } = await cdp.send("Profiler.stop");

  // 자기 시간 = 그 노드가 샘플의 맨 위였던 시간. 같은 함수 이름끼리 합친다.
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const dt = profile.timeDeltas[i] ?? 0;
    total += dt;
    const f = n.callFrame;
    const name = f.functionName || `(${f.url ? f.url.split("/").pop() : "anonymous"})`;
    self.set(name, (self.get(name) ?? 0) + dt);
  }
  const rows = [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([name, us]) => ({
      name,
      ms: Math.round(us / 1000),
      pct: +((100 * us) / total).toFixed(2),
    }));
  const out = {
    label: LABEL,
    engine,
    variant,
    timeMs: TIME_MS,
    totalMs: Math.round(total / 1000),
    nodes,
    rows,
  };
  await mkdir(join(HERE, "results"), { recursive: true });
  await writeFile(join(HERE, "results", `${LABEL}.json`), JSON.stringify(out, null, 2));
  console.log(`총 ${out.totalMs}ms · 노드 ${nodes.toLocaleString()}`);
  for (const r of rows)
    console.log(`${String(r.pct).padStart(6)}%  ${String(r.ms).padStart(6)}ms  ${r.name}`);
} finally {
  await browser.close();
  server.close();
}
