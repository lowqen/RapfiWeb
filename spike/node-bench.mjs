/**
 * W0-3: BENCH 해시 대조.
 *
 *   node node-bench.mjs <variant>
 *
 * BENCH 는 커맨드라인 모듈이 아니라 **프로토콜 명령**이라 NO_COMMAND_MODULES=ON
 * 에서도 살아 있다(build_engine_android.sh [7/7] 이 `printf 'BENCH\nEND\n' |` 로
 * 부르는 그것이다).
 *
 * ⚠ 대조의 전제가 웹에서 하나 달라졌다. 안드로이드 벤치는 cwd 에
 *   `Networks/config-example/config.toml` 을 두고 돌렸지만, wasm 빌드는
 *   `wasm_preloads.txt` 에 따라 `config-example/gomocalc-mix9svq.toml` 을
 *   `/config.toml` 로 **미리 구워 넣는다**. 설정이 다르면(스레드 수·평가기·해시)
 *   해시는 엔진이 아니라 입력이 달라서 갈린다. 그래서 이 스크립트는 해시를
 *   "맞다/틀리다"로만 보고하지 않고 실제로 쓰인 config 도 함께 남긴다.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { startEngine } from "./src/engine-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = resolve(process.env.ENGINE_DIR ?? resolve(HERE, "../out/engine"));
const BENCH_DIR = resolve(process.env.BENCH_DIR ?? resolve(HERE, "../out/bench"));

/**
 * 무엇과 비교할 것인가. 빌드 스크립트가 호스트 기준선을 남겼으면 **그것**이
 * 정답이다 — wasm 과 같은 config(gomocalc-mix9svq.toml)로 잰 네이티브 해시이므로
 * 설정 차이가 제거된 비교가 된다. 없으면 폰의 값으로 떨어진다.
 */
function expectedHash() {
  const f = resolve(BENCH_DIR, "host-wasmcfg.hash");
  if (existsSync(f)) {
    const h = readFileSync(f, "utf8").trim().toLowerCase();
    if (h && h !== "none") return { hash: h, source: "host(wasmcfg) — 같은 config 의 네이티브 기준선" };
  }
  return {
    hash: (process.env.EXPECT_HASH ?? "e240ab16").toLowerCase(),
    source: "폰/x86 기준선(config-example/config.toml) — config 가 달라 직접 비교는 성립하지 않는다",
  };
}
const EXPECTED = expectedHash();
const EXPECT = EXPECTED.hash;
const variant = process.argv[2] ?? "single-simd128";

const js = resolve(ENGINE_DIR, `rapfi-${variant}.js`);
if (!existsSync(js)) {
  console.error(`없음: ${js}`);
  process.exit(2);
}

const out = [];
const t0 = Date.now();
let exitCode = null;
let error = null;

try {
  const require = createRequire(import.meta.url);
  const factory = require(js);
  const Module = await startEngine({
    factory,
    baseUrl: ENGINE_DIR + "/",
    onLine: (l) => out.push(l),
    onExit: (c) => (exitCode = c),
  });
  // 동기로 끝까지 돈다. 벤치는 몇 분 걸릴 수 있다.
  Module.sendCommand("BENCH");
  Module.sendCommand("END");
} catch (e) {
  // END 를 보내면 엔진이 정상 종료하면서 ExitStatus 를 던진다. 오류가 아니다.
  if (e && (e.name === "ExitStatus" || typeof e.status === "number")) {
    exitCode = e.status ?? 0;
  } else {
    error = String((e && e.stack) || (e && e.message) || e);
  }
}

const text = out.join("\n");
const hash = (text.match(/Hash:\s*([0-9a-f]+)/i) ?? [])[1]?.toLowerCase() ?? null;

const report = {
  test: "W0-3 (BENCH 해시)",
  variant,
  pass: hash === EXPECT,
  hash,
  expected: EXPECT,
  expectedFrom: EXPECTED.source,
  nodes: (text.match(/Nodes:\s*([\d,]+)/i) ?? [])[1] ?? null,
  nodesPerSec: (text.match(/Nodes\/s:\s*([\d,]+)/i) ?? [])[1] ?? null,
  wallSec: +((Date.now() - t0) / 1000).toFixed(1),
  exitCode,
  error,
  note:
    hash && hash !== EXPECT
      ? "해시 불일치. 기준선 출처: " + EXPECTED.source
      : null,
  tail: out.slice(-20),
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
