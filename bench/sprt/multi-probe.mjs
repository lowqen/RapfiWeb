#!/usr/bin/env node
/**
 * M-1 — 멀티스레드 글루가 Node 에서 Gomocup 엔진으로 쓸 만한가(진행 · 중단 관문). 엔진마다 **자식 프로세스 하나**로 돌려
 * 멈춤 · 지저분한 종료가 그대로 드러나게 한다.
 *
 *   node bench/sprt/multi-probe.mjs --engine "이름|엔진 폴더|변형[|.data]" … [--threads 2] [--turn 1000] [--json out.json]
 *
 * 자식이 하는 일(모두 시간 제한 안):
 *   1. 글루 적재 → INFO RULE 4 · HASH_SIZE · THREAD_NUM <T> → START 15 → OK · ABOUT
 *   2. 기능: 예열 → 탐색 ①(T 스레드 · 수당 <turn>ms) → RESTART → OK → 탐색 ② — 좌표 뒤마다 50ms 정착
 *      (앱 engine-worker.ts SETTLE_MS — 탐색 스레드가 잠깐 입력을 더 읽는다)
 *   3. 스레드: 해시를 비우고 깊이 <depth> 까지의 벽시계를 T · 1 스레드로 번갈아 두 번씩. 멀티 빌드의 `MESSAGE Speed` 는
 *      믿을 수 없다(M-1 첫 런 37628721845 — 2 스레드 159 nps 같은 값) — 노드 수에 기대지 않는다. 스레드를 바꾼 뒤 짧은 예열로
 *      재구성 비용(gomocalc 는 가중치 재적재)을 재는 탐색 밖으로 뺀다.
 *   4. terminate() → 프로세스가 스스로 끝나는가(남은 pthread 가 붙들면 10초 뒤 코드 3)
 * 통과 조건: 기능 탐색 둘 · 깊이 탐색 넷 모두 좌표, RESTART OK, 깊이 도달 시간 비(1 ÷ T) > 1.15, 제한 시간 안에 끝남
 * (코드 0, 또는 코드 3 — 따로 보고).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const all = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const opt = (k, d) => all(k).at(-1) ?? d;

if (argv.includes("--child")) await child();
else await parent();

// ── 부모 ────────────────────────────────────────────────────────────────
async function parent() {
  const threads = Number(opt("threads", 2));
  const turn = Number(opt("turn", 1000));
  const limitMs = Number(opt("limit-ms", 300_000));
  const results = [];
  for (const spec of all("engine")) {
    const [name, dir, variant, data] = spec.split("|");
    const t0 = performance.now();
    const args = [fileURLToPath(import.meta.url), "--child", "--dir", dir, "--variant", variant];
    if (data) args.push("--data", data);
    args.push(
      "--threads",
      String(threads),
      "--turn",
      String(turn),
      "--depth",
      String(opt("depth", 16)),
    );
    const r = await new Promise((done) => {
      const c = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      c.stdout.on("data", (b) => (out += b));
      c.stderr.on("data", (b) => (err += b));
      const timer = setTimeout(() => c.kill("SIGKILL"), limitMs);
      c.on("exit", (code, signal) => {
        clearTimeout(timer);
        done({ code, signal, out, err });
      });
    });
    // 자식은 보고 한 줄 + (terminate 뒤) 끝내기 시간 한 줄을 찍는다 — 둘째 줄이 없으면 terminate 안에서 끝난 것
    const jsonLines = r.out
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l));
    const rep = jsonLines.length ? Object.assign({}, ...jsonLines) : null;
    // 코드 3 = 탐색은 됐지만 terminate 뒤 프로세스가 스스로 끝나지 않음(어댑터가 process.exit 로 끝내면 되는 문제 — 따로 보고)
    const lingered = r.code === 3;
    const ok =
      (r.code === 0 || lingered) &&
      rep?.searches?.length === 6 &&
      rep.searches.every((s) => s.move) &&
      rep.restartOk &&
      rep.threadRatio > 1.15;
    results.push({
      name,
      variant,
      ok,
      lingered,
      exitCode: r.code,
      signal: r.signal,
      wallMs: Math.round(performance.now() - t0),
      ...rep,
      stderrTail: r.err.split("\n").slice(-6),
    });
    const s = rep?.searches ?? [];
    console.log(
      `${ok ? "통과" : "실패"}  ${name} (${variant}) — 종료 ${r.code ?? r.signal} · ${rep?.about ?? "ABOUT 없음"}\n` +
        `      적재 ${rep?.loadMs ?? "-"}ms · START ${rep?.startMs ?? "-"}ms · ` +
        s.map((x) => `${x.tag}(${x.threads}스레드) ${x.move ?? "없음"} ${x.ms}ms`).join(" · ") +
        `
      깊이 ${rep?.depth ?? "-"} 도달 시간 합 ${JSON.stringify(rep?.depthMs ?? {})} → 1 ÷ T = **${rep?.threadRatio?.toFixed(2) ?? "-"}** · RESTART ${rep?.restartOk ? "OK" : "실패"} · 끝내기 ${rep?.exitMs ?? "-"}ms` +
        (lingered ? " · ⚠ terminate 뒤 스스로 끝나지 않음(10초 뒤 강제 종료)" : "") +
        (ok ? "" : `\n      stderr:${r.err.split("\n").slice(-4).join(" | ")}`),
    );
  }
  const json = opt("json");
  if (json) writeFileSync(json, JSON.stringify({ threads, turn, results }, null, 2) + "\n");
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

// ── 자식 ────────────────────────────────────────────────────────────────
async function child() {
  const dir = resolve(opt("dir"));
  const variant = opt("variant");
  const threads = Number(opt("threads", 2));
  const turn = Number(opt("turn", 1000));
  const js = resolve(dir, `rapfi-${variant}.js`);
  const data =
    opt("data") ??
    [resolve(dir, `rapfi-${variant}.data`), resolve(dir, "rapfi.data")].find((p) => existsSync(p));
  const rep = { searches: [], restartOk: false };
  const emit = () => process.stdout.write(JSON.stringify(rep) + "\n");

  const waiters = [];
  const onLine = (line) => {
    for (let i = 0; i < waiters.length; i++)
      if (waiters[i].match(line)) {
        const [w] = waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(line);
        return;
      }
  };
  const taps = new Set();
  const until = (match, ms, what) =>
    new Promise((ok, fail) => {
      const w = {
        match,
        resolve: ok,
        timer: setTimeout(() => fail(new Error(`${what}: ${ms}ms 안에 없음`)), ms),
      };
      waiters.push(w);
    });

  let t = performance.now();
  const factory = createRequire(import.meta.url)(js);
  const exited = new Promise((r) => (rep._exit = r));
  const Module = await factory({
    locateFile: (p) => (p.endsWith(".data") ? data : resolve(dir, p)),
    onReceiveStdout: (l) => {
      for (const f of taps) f(l);
      onLine(l.trim());
    },
    onReceiveStderr: (l) => process.stderr.write(`[engine] ${l}\n`),
    onExit: (c) => rep._exit(c),
    print: () => {},
    printErr: () => {},
  });
  rep.loadMs = Math.round(performance.now() - t);
  const settle = () => new Promise((r) => setTimeout(r, 50));

  try {
    t = performance.now();
    for (const c of ["INFO RULE 4", "INFO HASH_SIZE 65536", `INFO THREAD_NUM ${threads}`])
      Module.sendCommand(c);
    const ok = until((l) => l === "OK", 60_000, "START → OK");
    Module.sendCommand("START 15");
    await ok;
    rep.startMs = Math.round(performance.now() - t);
    const about = until((l) => /name\s*=/.test(l), 10_000, "ABOUT");
    Module.sendCommand("ABOUT");
    rep.about = (await about).replace(/.*version="([^"]+)".*/, "$1");

    const board = ["BOARD", "7,7,2", "8,8,1", "8,6,2", "DONE"].join("\n");
    /** 한 번 탐색 — 좌표 줄까지의 벽시계와 마지막 몇 줄. depth 를 주면 그 깊이까지(시간은 넉넉히) */
    const search = async (tag, n, { depth = 0, ms: turnMs = turn, record = true } = {}) => {
      const tail = [];
      const tap = (l) => {
        tail.push(l);
        if (tail.length > 5) tail.shift();
      };
      taps.add(tap);
      if (depth) {
        Module.sendCommand("YXHASHCLEAR");
        Module.sendCommand(`INFO MAX_DEPTH ${depth}`);
      }
      Module.sendCommand(`INFO TIMEOUT_TURN ${depth ? 120_000 : turnMs}`);
      const t1 = performance.now();
      const mv = until(
        (l) => /^\d+,\d+$/.test(l),
        (depth ? 120_000 : turnMs) + 20_000,
        `탐색 ${tag}`,
      );
      Module.sendCommand(board); // 여러 줄 블록은 한 번에(wasm-pbrain 과 같은 규칙)
      const move = await mv;
      const ms = Math.round(performance.now() - t1);
      await settle();
      taps.delete(tap);
      if (record) rep.searches.push({ tag, threads: n, depth: depth || null, move, ms, tail });
      return ms;
    };
    const setThreads = async (n) => {
      Module.sendCommand(`INFO THREAD_NUM ${n}`);
      await settle();
      // 스레드를 바꾸면 평가기를 다시 세운다(gomocalc 는 P2-2 가 없어 가중치를 다시 푼다 — 0.8초 남짓). 재는 탐색 밖에서 치르게 짧게 한 번.
      await search("예열", n, { ms: 200, record: false });
    };

    // 기능: 예열 → 시간 탐색 → RESTART → 시간 탐색
    await search("예열", threads, { record: false });
    await search("①", threads);
    const r = until((l) => l === "OK", 30_000, "RESTART → OK");
    Module.sendCommand("RESTART");
    await r;
    rep.restartOk = true;
    await search("②", threads);

    // 스레드가 실제로 도는가: 같은 깊이까지 걸린 벽시계(T ↔ 1). 멀티 빌드의 MESSAGE Speed 는 믿을 수 없다(M-1 첫 런 — 159 nps 같은 값)
    // — 노드 수에 기대지 않는다. 해시를 비우고 번갈아 두 번씩, 중앙값 대신 두 번의 합.
    const depth = Number(opt("depth", 16));
    const depthTotal = { [threads]: 0, 1: 0 };
    for (let k = 0; k < 2; k++)
      for (const n of k % 2 ? [1, threads] : [threads, 1]) {
        await setThreads(n);
        depthTotal[n] += await search(`d${depth}`, n, { depth });
      }
    rep.depth = depth;
    rep.depthMs = { [`t${threads}`]: depthTotal[threads], t1: depthTotal[1] };
    rep.threadRatio = depthTotal[threads] ? depthTotal[1] / depthTotal[threads] : null;
  } catch (e) {
    rep.error = e.message;
  }
  // 보고는 terminate **전에** 찍는다 — 글루가 terminate 안에서 프로세스를 끝낼 수도 있다. 끝내기 시간은 둘째 줄로.
  delete rep._exit;
  emit();
  const te = performance.now();
  try {
    Module.terminate();
  } catch {
    /* ExitStatus — 정상 */
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  process.stdout.write(JSON.stringify({ exitMs: Math.round(performance.now() - te) }) + "\n");
  // 남은 pthread 워커가 프로세스를 붙드는지 본다 — 강제로 끝내지 않고 이벤트 루프가 스스로 비기를 기다린다.
  // unref 타이머는 루프를 붙들지 않으므로, 10초 뒤에도 불리면 다른 무언가(워커)가 루프를 붙들고 있는 것 → 코드 3.
  process.exitCode = rep.error ? 1 : 0;
  setTimeout(() => process.exit(3), 10_000).unref();
}
