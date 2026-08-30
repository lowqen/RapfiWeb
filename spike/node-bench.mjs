/**
 * W0-3: 4종 빌드의 BENCH 해시 대조.
 *
 *   node node-bench.mjs <variant>
 *
 * BENCH 는 커맨드라인 모듈이 아니라 **stdin 프로토콜 명령**이다
 * (`printf 'BENCH\nEND\n' | pbrain-rapfi` — build_engine_android.sh [7/7]).
 * 그래서 NO_COMMAND_MODULES=ON 이어도 살아 있다.
 *
 * 해시가 결정적인 근거는 둘이다:
 *   - upstream 이 `-ffp-contract=off` 로 컴파일한다 → 탐색 결과가 명령어 집합과 무관
 *   - Networks/config-example/config.toml 의 default_thread_num = 1
 * 두 번째 때문에 **스레드 수를 건드리면 안 된다**. 멀티스레드 변형도 이 config 로
 * 돌리므로 실제로는 1스레드로 벤치한다 — 그게 폰·x86 과 대조가 성립하는 조건이다.
 *
 * 여기서는 블로킹 stdin 이 필요 없다: 보낼 명령을 미리 다 알기 때문에 바이트를
 * 앞에 채워 두고 소진되면 EOF 를 준다. 이 방식으로는 대화형 앱을 만들 수 없다는
 * 사실이 곧 W0-1 이 따로 필요한 이유다.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createEngine, runMain } from "./src/engine-core.js";
import { makePreloadedStdin } from "./src/sab-stdin.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = resolve(process.env.ENGINE_DIR ?? resolve(HERE, "../out/engine"));
const BENCH_DIR = resolve(process.env.BENCH_DIR ?? resolve(HERE, "../out/bench"));
const EXPECT = (process.env.EXPECT_HASH ?? "e240ab16").toLowerCase();
const variant = process.argv[2] ?? "single";

const js = resolve(ENGINE_DIR, `rapfi-${variant}.js`);
const wasm = resolve(ENGINE_DIR, `rapfi-${variant}.wasm`);
if (!existsSync(js)) {
  console.error(`없음: ${js}`);
  process.exit(2);
}

const files = readdirSync(BENCH_DIR)
  .filter((n) => !n.endsWith(".txt"))
  .map((name) => ({ name, bytes: readFileSync(join(BENCH_DIR, name)) }));

const out = [];
const t0 = Date.now();
let exitCode = null;
let error = null;

try {
  const Module = await createEngine({
    factoryUrl: pathToFileURL(js).href,
    wasmUrl: wasm,
    files,
    stdin: makePreloadedStdin("BENCH\nEND\n"),
    onLine: (l) => out.push(l),
  });
  ({ exitCode } = runMain(Module));
} catch (e) {
  error = String((e && e.stack) || e);
}

const text = out.join("\n");
const hash = (text.match(/Hash:\s*([0-9a-f]+)/i) ?? [])[1]?.toLowerCase() ?? null;
const nodes = (text.match(/Nodes:\s*([\d,]+)/i) ?? [])[1] ?? null;
const nps = (text.match(/Nodes\/s:\s*([\d,]+)/i) ?? [])[1] ?? null;

const report = {
  test: "W0-3 (BENCH 해시)",
  variant,
  pass: hash === EXPECT,
  hash,
  expected: EXPECT,
  nodes,
  nodesPerSec: nps,
  wallSec: +((Date.now() - t0) / 1000).toFixed(1),
  exitCode,
  error,
  tail: out.slice(-15),
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
