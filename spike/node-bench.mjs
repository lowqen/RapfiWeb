/**
 * W0-3: BENCH 해시 대조.
 *
 *   node node-bench.mjs <variant>
 *
 * BENCH 는 커맨드라인 모듈이 아니라 **프로토콜 명령**이라 NO_COMMAND_MODULES=ON
 * 에서도 살아 있다(build_engine_android.sh [7/7] 이 `printf 'BENCH\nEND\n' |` 로
 * 부르는 그것이다).
 *
 * ⚠ 무엇과 비교하는가가 W0-3 이후로 바뀌었다.
 *
 *   처음에는 폰/x86 의 e240ab16 과 비교했다. 그런데 wasm 은 4100a973 을 내고,
 *   설정 차이는 배제됐다(같은 커밋의 호스트 바이너리를 두 config 로 각각 돌려
 *   둘 다 e240ab16 을 얻었다). 노드 수는 4,391,204 로 셋 다 같다 — 탐색 트리는
 *   같고 어떤 값만 다르다.
 *
 *   그래서 웹에 한해 "비트 단위로 폰과 같다"를 게이트에서 내리고,
 *   **웹 자신의 기준선**(spike/web-baseline.json)으로 회귀만 막는다.
 *   네이티브 값은 참고로 계속 함께 보고한다 — 언젠가 둘이 같아지면
 *   그것이 upstream 이슈가 해결됐다는 신호이기 때문이다.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { startEngine } from "./src/engine-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = resolve(process.env.ENGINE_DIR ?? resolve(HERE, "../out/engine"));
const BENCH_DIR = resolve(process.env.BENCH_DIR ?? resolve(HERE, "../out/bench"));

const variant = process.argv[2] ?? "single-simd128";
const baseline = JSON.parse(readFileSync(resolve(HERE, "web-baseline.json"), "utf8"));
const entry = baseline.variants[variant] ?? { hash: null, note: "기준선에 없는 변형" };

/** 참고용 네이티브 값. 빌드가 남긴 것이 있으면 그것이 더 정확하다. */
function nativeHash() {
  for (const f of ["host-wasmcfg.hash", "host-sse128.hash", "host-android.hash"]) {
    const p = resolve(BENCH_DIR, f);
    if (existsSync(p)) {
      const h = readFileSync(p, "utf8").trim().toLowerCase();
      if (h && h !== "none") return { hash: h, from: f.replace(/^host-|\.hash$/g, "") };
    }
  }
  return { hash: baseline.native.hash, from: "web-baseline.json(기록값)" };
}

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
const native = nativeHash();

// 판정 규칙:
//   기준선이 있다  -> 같아야 통과. 다르면 회귀다(웹 게이트).
//   기준선이 없다  -> 판정하지 않는다. 값을 찍어 두고 사람이 기준선에 적어 넣는다.
const gated = typeof entry.hash === "string";
const pass = gated ? hash === entry.hash : false;

const report = {
  test: "W0-3 (BENCH 해시 — 웹 회귀 게이트)",
  variant,
  gated,
  pass,
  hash,
  webBaseline: entry.hash,
  baselineNote: entry.note ?? null,
  nativeHash: native.hash,
  nativeFrom: native.from,
  matchesNative: hash != null && hash === native.hash,
  nodes: (text.match(/Nodes:\s*([\d,]+)/i) ?? [])[1] ?? null,
  nodesPerSec: (text.match(/Nodes\/s:\s*([\d,]+)/i) ?? [])[1] ?? null,
  wallSec: +((Date.now() - t0) / 1000).toFixed(1),
  exitCode,
  error,
  note: !gated
    ? "이 변형에는 웹 기준선이 없다 — 게이트하지 않는다. 값이 나왔다면 spike/web-baseline.json 에 적어 넣을 것."
    : pass
      ? null
      : hash == null
        ? "해시를 얻지 못했다. 엔진이 BENCH 에 응답하지 않았다."
        : `웹 회귀: 기준선 ${entry.hash} 인데 ${hash} 가 나왔다. 엔진/가중치/emsdk 를 올린 적이 없다면 버그다.`,
  tail: out.slice(-20),
};
console.log(JSON.stringify(report, null, 2));
// 기준선이 없는 변형은 실패로 세지 않는다(종료코드 3 = 미판정).
process.exit(pass ? 0 : gated ? 1 : 3);
