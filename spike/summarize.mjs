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
  out.push("### W0-3 — BENCH 해시 대조", "");
  out.push("| 변형 | 결과 | Hash | 기대값 | Nodes/s | 소요 |");
  out.push("|---|---|---|---|---|---|");
  for (const r of bench) {
    out.push(
      `| \`${r.variant}\` | ${mark(r.pass)} | \`${r.hash ?? "—"}\` | \`${r.expected}\` | ${r.nodesPerSec ?? "—"} | ${r.wallSec ?? "—"}s |`,
    );
  }
  out.push("");
}

const proto = reports.filter((r) => r.test?.startsWith("W0-1"));
if (proto.length) {
  out.push("### W0-1 — stdin 왕복 (SAB + Atomics.wait)", "");
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

const failed = reports.filter((r) => !r.pass);
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
process.exit(failed.length ? 1 : 0);
