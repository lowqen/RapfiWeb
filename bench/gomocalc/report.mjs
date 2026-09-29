/**
 * results/*.json → 마크다운 표.
 *
 *   node bench/gomocalc/report.mjs bench/gomocalc/results/local.json
 */
import { readFile } from "node:fs/promises";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("사용: node report.mjs <results.json> [보충.json …]");
  process.exit(2);
}
// 여러 파일을 합친다. 환경·매개변수는 첫 파일의 것. 뒤 파일의 같은 (엔진, 변형) 런은
// 앞의 것을 **대신**하되, 본 측정이 없는 보충 런(SEARCH=0)은 BENCH 만 앞 런에 얹는다.
const [R, ...extra] = await Promise.all(
  files.map(async (f) => JSON.parse(await readFile(f, "utf8"))),
);
R.merged = [];
for (const X of extra) {
  for (const run of X.runs) {
    const i = R.runs.findIndex((r) => r.engine === run.engine && r.variant === run.variant);
    if (!run.searches.length && run.bench && i >= 0) {
      R.runs[i].bench = run.bench;
      R.merged.push(`${run.engine}/${run.variant} BENCH ← ${X.label}`);
    } else if (i >= 0) {
      R.runs[i] = run;
      R.merged.push(`${run.engine}/${run.variant} 전체 ← ${X.label}`);
    } else {
      R.runs.push(run);
      R.merged.push(`${run.engine}/${run.variant} 추가 ← ${X.label}`);
    }
  }
}

const MB = (b) => (b == null ? "—" : `${Math.round(b / 2 ** 20)}`);
const k = (n) => (n == null ? "—" : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const geo = (xs) => (xs.length ? Math.exp(mean(xs.map((x) => Math.log(x)))) : null);
const sd = (xs) => {
  const m = mean(xs);
  return xs.length > 1 ? Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) : 0;
};
const L = (m) => (m ? `${"abcdefghijklmno"[m[0]]}${15 - m[1]}` : "—");
const name = (r) => `${r.engine}/${r.variant.replace("-simd128", "")}`;
const table = (head, rows) =>
  [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

const out = [];
out.push(`## 환경 — ${R.label}`);
out.push(
  `- CPU: ${R.host.cpu} · 논리 코어 ${R.host.logicalCores} · RAM ${R.host.memGB}GB · ${R.host.platform}`,
  `- 브라우저: Chromium ${R.host.browser ?? "?"} (Playwright, 헤드리스)`,
  `- 탐색 ${R.params.TIME_MS}ms × 반복 ${R.params.REPEAT} · 해시 ${R.params.HASH_MB}MB · 스레드 ${R.params.THREADS.join("/")}`,
  `- 측정 ${R.startedAt} → ${R.finishedAt}`,
  ...R.merged.map((m) => `- 보충: ${m}`),
  "",
);

const runs = R.runs.filter((r) => !r.failed);
for (const r of R.runs.filter((r) => r.failed)) out.push(`> ⚠ ${name(r)} 실패: ${r.failed}`, "");

out.push("### 엔진 · 기동 · 메모리");
out.push(
  table(
    [
      "엔진/변형",
      "ABOUT version",
      "호스트",
      "로드 ms",
      "기동 후 wasm MB",
      "탐색 후 wasm MB",
      "페이지 전체 MB",
    ],
    runs.map((r) => [
      name(r),
      /version="([^"]+)"/.exec(r.about ?? "")?.[1] ?? "?",
      r.host,
      r.loadMs,
      MB(r.memAfterStart),
      MB(r.memAfterSearch),
      MB(r.uaMemory),
    ]),
  ),
  "",
);

out.push("### 냉(冷) 탐색 — 기동 직후 첫 탐색, 1 스레드");
out.push(
  table(
    ["엔진/변형", "국면", "시간 ms", "nps", "깊이"],
    runs.map((r) => [
      name(r),
      r.cold.positionId,
      r.cold.timeMs,
      k(r.cold.nps),
      `${r.cold.depth}-${r.cold.selDepth}`,
    ]),
  ),
  "",
);

const benched = runs.filter((r) => r.bench);
if (benched.length) {
  out.push("### Rapfi 내장 BENCH (결정적 · 1 스레드 · 자체 국면 10개)");
  out.push(
    table(
      [
        "엔진/변형",
        "Move Bench moves/s",
        "Search nps (노드÷시간)",
        "엔진이 찍은 Nodes/s",
        "노드",
        "시간 ms",
        "Hash",
      ],
      benched.map((r) => [
        name(r),
        r.bench.movesPerSec?.toLocaleString() ?? "—",
        // 엔진의 Nodes/s 는 wasm32 에서 넘친다(run.mjs runBench 주석) — 직접 셈한 값을 앞에.
        (r.bench.nodes && r.bench.searchBenchMs
          ? Math.round((r.bench.nodes * 1000) / r.bench.searchBenchMs)
          : null
        )?.toLocaleString() ?? "—",
        r.bench.nps?.toLocaleString() ?? "—",
        r.bench.nodes?.toLocaleString() ?? "—",
        r.bench.searchBenchMs?.toLocaleString() ?? "—",
        r.bench.hash,
      ]),
    ),
    "",
  );
}

// ── 예열 뒤 본 측정 ──
const configs = [];
for (const r of runs) {
  for (const t of [...new Set(r.searches.map((s) => s.threads))]) {
    configs.push({ r, t, key: `${name(r)} t${t}`, s: r.searches.filter((s) => s.threads === t) });
  }
}
const posIds = [...new Set(runs.flatMap((r) => r.searches.map((s) => s.positionId)))];

out.push(`### 예열 뒤 NPS (국면별 평균, 마지막 열은 기하 평균)`);
out.push(
  table(
    ["엔진/변형 스레드", ...posIds, "기하 평균"],
    configs.map((c) => {
      const per = posIds.map((p) =>
        mean(c.s.filter((s) => s.positionId === p && s.nps).map((s) => s.nps)),
      );
      return [
        c.key,
        ...per.map((x) => k(x == null ? null : Math.round(x))),
        k(Math.round(geo(per.filter(Boolean)) ?? 0)),
      ];
    }),
  ),
  "",
);

out.push(`### 도달 깊이 (평균 깊이-선택 깊이)`);
out.push(
  table(
    ["엔진/변형 스레드", ...posIds],
    configs.map((c) => [
      c.key,
      ...posIds.map((p) => {
        const ss = c.s.filter((s) => s.positionId === p);
        return ss.length
          ? `${mean(ss.map((s) => s.depth)).toFixed(1)}-${mean(ss.map((s) => s.selDepth)).toFixed(0)}`
          : "—";
      }),
    ]),
  ),
  "",
);

// 깊이 도달 시간 — 국면마다 **모든 구성·모든 반복이 도달한** 가장 깊은 깊이와 그 두 단계 아래.
out.push(`### 깊이 도달 시간 (엔진 TOTALTIME ms, 반복 평균) — 같은 스레드 수끼리 비교`);
for (const t of [...new Set(configs.map((c) => c.t))].sort((a, b) => a - b)) {
  const cs = configs.filter((c) => c.t === t);
  if (cs.length < 2) continue;
  const rows = [];
  for (const p of posIds) {
    const all = cs.flatMap((c) => c.s.filter((s) => s.positionId === p));
    if (!all.length) continue;
    const common = Math.min(...all.map((s) => Math.max(0, ...Object.keys(s.depthAt).map(Number))));
    for (const d of [common - 4, common - 2, common].filter((d) => d > 0)) {
      rows.push([
        p,
        d,
        ...cs.map((c) => {
          const v = c.s
            .filter((s) => s.positionId === p)
            .map((s) => s.depthAt[d]?.engineMs)
            .filter((x) => x != null);
          return v.length ? Math.round(mean(v)).toLocaleString() : "—";
        }),
      ]);
    }
  }
  out.push(`**${t} 스레드**`, "", table(["국면", "깊이", ...cs.map((c) => c.key)], rows), "");
}

out.push(`### 평가 일관성 — 최선수(반복별) · 평가값 평균±편차`);
out.push(
  table(
    ["엔진/변형 스레드", ...posIds],
    configs.map((c) => [
      c.key,
      ...posIds.map((p) => {
        const ss = c.s.filter((s) => s.positionId === p);
        if (!ss.length) return "—";
        const moves = ss.map((s) => L(s.move)).join("/");
        const nums = ss.map((s) => Number(s.eval)).filter(Number.isFinite);
        const ev =
          nums.length === ss.length
            ? `${Math.round(mean(nums))}±${Math.round(sd(nums))}`
            : ss.map((s) => s.eval).join("/");
        return `${moves} · ${ev}`;
      }),
    ]),
  ),
  "",
);

// 국면별 최선수 일치율 — 모든 구성·반복의 최선수 중 최빈수와 같은 비율
out.push(`### 최선수 일치율 (전 구성·전 반복의 최빈수 기준)`);
const agree = posIds.map((p) => {
  const mv = configs.flatMap((c) => c.s.filter((s) => s.positionId === p).map((s) => L(s.move)));
  const freq = new Map();
  for (const m of mv) freq.set(m, (freq.get(m) ?? 0) + 1);
  const [top, n] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
  return [p, top, `${n}/${mv.length}`, [...freq.entries()].map(([m, c]) => `${m}×${c}`).join(" ")];
});
out.push(table(["국면", "최빈 최선수", "일치", "분포"], agree), "");

console.log(out.join("\n"));
