#!/usr/bin/env node
/**
 * M-1 — 멀티스레드 글루가 Node 에서 Gomocup 엔진으로 쓸 만한가(진행 · 중단 관문). 엔진마다 **자식 프로세스 하나**로 돌려
 * 멈춤 · 지저분한 종료가 그대로 드러나게 한다.
 *
 *   node bench/sprt/multi-probe.mjs --engine "이름|엔진 폴더|변형[|.data]" … [--threads 2] [--turn 1000] [--json out.json]
 *
 * 자식이 하는 일(모두 시간 제한 안):
 *   1. 글루 적재 → INFO RULE 4 · HASH_SIZE · THREAD_NUM <T> → START 15 → OK · ABOUT
 *   2. 탐색 ① — T 스레드 · 수당 <turn>ms: 좌표 줄까지, 요약 줄(MESSAGE Speed)에서 NPS
 *   3. 좌표 뒤 50ms 정착(앱 engine-worker.ts SETTLE_MS — 탐색 스레드가 잠깐 입력을 더 읽는다) → THREAD_NUM 1 → 탐색 ② 1 스레드
 *   4. RESTART → OK, 같은 국면 탐색 ③(T 스레드) — 판을 갈아도 멀쩡한가
 *   5. terminate() → 프로세스가 스스로 끝나는 데 걸린 시간(남은 pthread 가 붙들지 않는가)
 * 부모는 자식의 종료 코드 · 시간과 자식이 찍은 JSON 한 줄로 판정한다. 통과 조건: 세 탐색 모두 좌표, ①/② NPS 비 > 1.3(스레드가
 * 실제로 돈다), RESTART OK, 자식이 제한 시간 안에 끝남(코드 0, 또는 코드 3 = terminate 뒤 스스로 안 끝남 — 따로 보고).
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
  const limitMs = Number(opt("limit-ms", 120_000));
  const results = [];
  for (const spec of all("engine")) {
    const [name, dir, variant, data] = spec.split("|");
    const t0 = performance.now();
    const args = [fileURLToPath(import.meta.url), "--child", "--dir", dir, "--variant", variant];
    if (data) args.push("--data", data);
    args.push("--threads", String(threads), "--turn", String(turn));
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
      rep?.searches?.length === 3 &&
      rep.searches.every((s) => s.move) &&
      rep.restartOk &&
      rep.threadRatio > 1.3;
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
        s
          .map(
            (x) =>
              `탐색${x.tag}(${x.threads}스레드) ${x.move ?? "없음"} NPS ${x.nps ?? "-"} ${x.ms}ms`,
          )
          .join(" · ") +
        ` · 스레드 NPS 비 ${rep?.threadRatio?.toFixed(2) ?? "-"} · RESTART ${rep?.restartOk ? "OK" : "실패"} · 끝내기 ${rep?.exitMs ?? "-"}ms` +
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
    const search = async (tag, n) => {
      let speed = null;
      const tap = (l) => {
        const m = /^MESSAGE Speed (\d+)/.exec(l);
        if (m) speed = Number(m[1]);
      };
      taps.add(tap);
      Module.sendCommand(`INFO TIMEOUT_TURN ${turn}`);
      const t1 = performance.now();
      const mv = until((l) => /^\d+,\d+$/.test(l), turn + 20_000, `탐색 ${tag}`);
      Module.sendCommand(board); // 여러 줄 블록은 한 번에(wasm-pbrain 과 같은 규칙)
      const move = await mv;
      const ms = Math.round(performance.now() - t1);
      await settle();
      taps.delete(tap);
      rep.searches.push({ tag, threads: n, move, nps: speed, ms });
    };
    // 첫 탐색에서 가중치를 푼다 — 예열 한 번(시간을 재지 않음)
    await search("예열", threads);
    rep.searches.length = 0;
    await search("①", threads);
    Module.sendCommand("INFO THREAD_NUM 1");
    await settle();
    await search("②", 1);
    const r = until((l) => l === "OK", 30_000, "RESTART → OK");
    Module.sendCommand(`INFO THREAD_NUM ${threads}`);
    await settle();
    Module.sendCommand("RESTART");
    await r;
    rep.restartOk = true;
    await search("③", threads);
    const a = rep.searches[0].nps;
    const b = rep.searches[1].nps;
    rep.threadRatio = a && b ? a / b : null;
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
