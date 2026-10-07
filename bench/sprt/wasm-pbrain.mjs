/**
 * WASM 엔진을 **stdin/stdout Gomocup 엔진**처럼 보이게 하는 어댑터 — 네이티브 빌드가 없는 기계(이 저장소의
 * 윈도 개발기)에서 SPRT 러너를 돌려 볼 때 쓴다. 엔진 코드는 건드리지 않는다: upstream preamble 의
 * `Module.sendCommand` 펌프(spike/src/engine-core.js 주석)를 그대로 부른다.
 *
 *   node bench/sprt/wasm-pbrain.mjs [--dir public/engine] [--variant single-simd128] [--data dist/engine/rapfi.data]
 *
 * - 단일 스레드 변형(single-*): sendCommand 가 탐색이 끝날 때까지 돌아오지 않는다(그동안 stdin 은 쌓인다).
 * - 멀티스레드 변형(multi-*, PROXY_TO_PTHREAD): sendCommand 는 곧바로 돌아오고 탐색은 엔진 pthread 에서 돌며 답은 비동기로 온다.
 *   명령은 **관문**(pbrain-gate.mjs)을 거친다 — 탐색 중에는 정지 · END 만 넘기고 나머지는 줄 세우며, 좌표 뒤 50ms 정착을 지나야
 *   다음 명령을 넘긴다(탐색 스레드가 좌표 뒤 잠깐 입력을 더 읽어 명령을 가로채는 사고 — 앱 engine-worker.ts SETTLE_MS).
 *   탐색 명령 뒤 5초 동안 엔진이 한 줄도 내지 않으면 오류를 찍고 코드 1 로 끝낸다 — 러너가 크래시로 세고 새로 띄운다.
 *   스레드 수는 러너가 START 앞에 보내는 `INFO THREAD_NUM` 그대로(예열 전에 정해져 재구성 비용이 판 안에 들지 않는다).
 *   M-1 탐침(multi-probe.mjs)이 두 배포본(gomocalc 0.43.01 · 우리 릴리스)의 멀티 글루가 Node 에서 이렇게 도는 것을 확인했다.
 * - BOARD · YXBOARD · YXBLOCK 처럼 여러 줄짜리 명령은 DONE 까지 모아 **한 번에** 넘긴다. 줄마다 넘기면
 *   엔진이 다음 줄 대신 EOF 를 읽고 덜 받은 판으로 생각을 시작한다(gomocup.cpp getPosition 의 eof 분기).
 * - END 또는 stdin EOF 에서 끝낸다. 멀티 변형은 남은 pthread 워커가 프로세스를 붙들지 않게 process.exit 로 끝낸다.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { MULTI_LINE, PbrainGate } from "./pbrain-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const dir = resolve(arg("dir", resolve(ROOT, "public/engine")));
const variant = arg("variant", "single-simd128");
const threaded = variant.startsWith("multi");
const data =
  arg("data") ??
  [
    resolve(dir, `rapfi-${variant}.data`),
    resolve(dir, "rapfi.data"),
    resolve(ROOT, "dist/engine/rapfi.data"),
  ].find((p) => existsSync(p));
const js = resolve(dir, `rapfi-${variant}.js`);
if (!existsSync(js) || !data || !existsSync(data)) {
  process.stderr.write(`wasm-pbrain: 엔진 파일이 없습니다 — ${js} · ${data ?? "(.data 없음)"}\n`);
  process.exit(2);
}

const out = (line) => process.stdout.write(line + "\n");
let quitting = false;
/** @type {PbrainGate | null} */
let gate = null;
function quit(code = 0) {
  if (quitting) return;
  quitting = true;
  gate?.close();
  // 비동기 파이프(윈도)에 남은 출력을 흘려보낸 뒤 끝낸다.
  process.stdout.write("", () => process.exit(code));
}

const factory = createRequire(import.meta.url)(js);
const Module = await factory({
  locateFile: (p) => (p.endsWith(".data") ? data : resolve(dir, p)),
  onReceiveStdout: (line) => {
    out(line);
    gate?.output(line);
  },
  onReceiveStderr: (l) => process.stderr.write(l + "\n"),
  onExit: () => quit(0),
  print: () => {},
  printErr: () => {},
});

let block = null;
function run(cmd) {
  if (quitting) return;
  try {
    Module.sendCommand(cmd);
  } catch (e) {
    // END 는 emscripten_force_exit 로 끝나며 ExitStatus 를 던진다 — 정상 종료다.
    if (e && (e.name === "ExitStatus" || typeof e.status === "number")) return quit(e.status ?? 0);
    process.stderr.write(`wasm-pbrain: ${e?.stack ?? e}\n`);
    return quit(1);
  }
  if (/^END\b/i.test(cmd)) quit(0);
}

if (threaded)
  gate = new PbrainGate({
    send: run,
    onFatal: (why) => {
      process.stderr.write(`wasm-pbrain: ${why}\n`);
      out(`ERROR wasm-pbrain: ${why}`);
      quit(1);
    },
  });

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (raw) => {
  if (gate) return gate.input(raw); // 멀티: 블록 조립 · 줄 세우기 · 정착은 관문이
  const line = raw.trim();
  if (!line) return;
  if (block) {
    block.push(line);
    if (/^DONE$/i.test(line)) {
      const cmd = block.join("\n");
      block = null;
      run(cmd);
    }
    return;
  }
  if (MULTI_LINE.test(line)) block = [line];
  else run(line);
});
rl.on("close", () => quit(0));
