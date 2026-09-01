/**
 * results/*.json 을 표로 접는다. CI 요약과 로컬 확인이 같은 것을 읽게 하려는 것.
 *
 *   node spike/summarize.mjs [resultsDir]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "results";
if (!existsSync(dir)) {
  console.log(`결과 폴더가 없습니다: ${dir}`);
  process.exit(1);
}

const reports = readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .map((n) => {
    try {
      return { file: n, ...JSON.parse(readFileSync(join(dir, n), "utf8")) };
    } catch (e) {
      return { file: n, pass: false, fatal: `JSON 파싱 실패: ${e.message}` };
    }
  });

const mark = (b) => (b ? "✅" : "❌");
const out = [];

out.push("## W0 스파이크 결과", "");

const bench = reports.filter((r) => r.test?.startsWith("W0-3"));
if (bench.length) {
  out.push("### W0-3 — BENCH 해시 (웹 회귀 게이트)", "");
  out.push("| 변형 | 결과 | Hash | 웹 기준선 | 네이티브 | Nodes/s | 소요 |");
  out.push("|---|---|---|---|---|---|---|");
  for (const r of bench) {
    // 기준선이 없는 변형은 통과/실패가 아니라 "미판정"이다.
    const verdict = r.gated === false ? "➖" : mark(r.pass);
    out.push(
      `| \`${r.variant}\` | ${verdict} | \`${r.hash ?? "—"}\` | \`${r.webBaseline ?? "미기록"}\` | \`${r.nativeHash ?? "—"}\` | ${r.nodesPerSec ?? "—"} | ${r.wallSec ?? "—"}s |`,
    );
  }
  out.push("");
}

const proto = reports.filter((r) => r.test?.startsWith("W0-1"));
if (proto.length) {
  out.push("### W0-1 — stdin 왕복 (upstream sendCommand 펌프)", "");
  out.push("| 환경 | 변형 | 결과 | 기동 | 최대 지연 | stdin 블록 | 단계 |");
  out.push("|---|---|---|---|---|---|---|");
  for (const r of proto) {
    const env = r.test.includes("browser") ? "브라우저" : "node";
    const okSteps = (r.steps ?? []).filter((s) => s.ok).length;
    const total = (r.steps ?? []).length;
    out.push(
      `| ${env} | \`${r.variant}\` | ${mark(r.pass)} | ${r.bootMs ?? "—"}ms | ${r.maxEventLoopLagMs ?? "—"}ms | ${r.stdinBlocks ?? "—"} | ${okSteps}/${total} |`,
    );
  }
  out.push("");
}

// 배포 경로만 잡의 성패를 정한다. multi-simd128 은 참고 측정이라 실패해도
// 잡을 빨갛게 만들지 않는다 — 그러면 진짜 회귀와 구분이 안 된다.
const isBlocking = (r) => !r.pass && r.gated !== false && !/multi-simd128/.test(r.file ?? "");
const failed = reports.filter((r) => !r.pass);
const blocking = reports.filter(isBlocking);
if (failed.length) {
  out.push("### 실패 상세", "");
  for (const r of failed) {
    out.push(`**${r.file}** — ${r.fatal ?? "단계 실패"}`, "");
    for (const s of r.steps ?? []) {
      if (!s.ok) out.push(`- \`${s.step}\` → ${s.got}`);
    }
    if (r.tail?.length) {
      out.push("", "```", ...r.tail.slice(-8), "```", "");
    }
  }
}

const text = out.join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
}
if (failed.length > blocking.length) {
  console.log("참고: multi-simd128 의 실패는 잡을 실패시키지 않는다(배포 경로 아님).");
}
process.exit(blocking.length ? 1 : 0);
