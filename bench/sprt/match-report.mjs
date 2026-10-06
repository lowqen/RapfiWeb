#!/usr/bin/env node
/**
 * 대국 결과(runner.mjs 의 --out games.jsonl · --summary summary.json) → 분석 묶음(JSON) · 마크다운 표.
 * gomocalc 대조(match-gomocalc.yml)의 보고서 `docs/gomocalc-대국-분석.md` 와 쇼케이스(`showcase/`)가 같은 숫자를 쓰게 한다.
 *
 *   node bench/sprt/match-report.mjs --games g.jsonl --summary s.json --label "본 매치" [--run ID] [--runner CPU] [--json out.json] [--md out.md]
 *
 * 러너의 집계를 다시 하지 않는다 — 최종 W-D-L · 오각 · Elo 는 summary.json 그대로 쓰고, 기보로는 그 밖의 것만 센다:
 *   - 궤적: 기록 순서대로 러너와 같은 방식(쌍이 끝나면 오각에 넣음)으로 쌓아 일정 간격마다 Elo · 95% 구간 · LLR
 *   - 색별 성적(A 가 흑 · 백일 때), 끝난 까닭, 엔진별 고장(시간 초과 · 크래시 · 불법 수 · 시간 패), 수 수 분포, 개시별 점수
 *   - 속도 몫 예측: 러너가 모은 엔진별 NPS 비를 M3(500ms · 속도 2배 = +105.7 Elo, 95% +82.1 ~ +130.4)로 Elo 환산
 *     — 실제 Elo 와의 차이가 「같은 속도라면 남는」 탐색 · 평가 몫의 대략이다(시간 제어 · 엔진이 M3 와 같을 때만 뜻이 있다)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { summarize } from "./stats.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const gamesPath = arg("games");
const summaryPath = arg("summary");
if (!gamesPath || !summaryPath) {
  console.error(
    "쓰임: node bench/sprt/match-report.mjs --games g.jsonl --summary s.json [--label L] [--json o.json] [--md o.md]",
  );
  process.exit(2);
}

const S = JSON.parse(readFileSync(summaryPath, "utf8"));
const games = readFileSync(gamesPath, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
const A = S.engines.A.name;
const B = S.engines.B.name;
const sprtCfg = S.cfg.sprt;

const aScore = (g) =>
  g.result === "1/2-1/2" ? 0.5 : (g.result === "1-0") === (g.black === A) ? 1 : 0;

// ── 궤적 ────────────────────────────────────────────────────────────────
const tally = { wins: 0, draws: 0, losses: 0, penta: [0, 0, 0, 0, 0] };
const pairs = new Map();
const step = Math.max(2, Math.round(games.length / 120));
const trajectory = [];
games.forEach((g, i) => {
  const s = aScore(g);
  if (s === 1) tally.wins++;
  else if (s === 0) tally.losses++;
  else tally.draws++;
  const ps = pairs.get(g.pair) ?? [];
  ps.push(s);
  pairs.set(g.pair, ps);
  if (ps.length === 2) tally.penta[Math.round((ps[0] + ps[1]) * 2)]++;
  if ((i + 1) % step === 0 || i === games.length - 1) {
    const sm = summarize(tally, sprtCfg);
    const basis = sm.pentanomial.n > 0 ? sm.pentanomial : sm.trinomial;
    if (sm.pentanomial.n >= 20)
      // 처음 몇십 판의 구간은 ±400 을 넘어 축을 망친다 — 쌍 20개부터
      trajectory.push({
        games: i + 1,
        elo: round(basis.elo),
        low: round(basis.eloLow),
        high: round(basis.eloHigh),
        llr: round(sm.sprt.llr, 3),
      });
  }
});

// ── 색 · 까닭 · 고장 · 수 수 · 개시 ─────────────────────────────────────
const colors = { black: { w: 0, d: 0, l: 0 }, white: { w: 0, d: 0, l: 0 } };
for (const g of games) {
  const c = colors[g.black === A ? "black" : "white"];
  const s = aScore(g);
  if (s === 1) c.w++;
  else if (s === 0) c.l++;
  else c.d++;
}
const reasons = {};
for (const g of games) reasons[g.reason] = (reasons[g.reason] ?? 0) + 1;
const FAULTS = ["timeout", "crash", "illegal", "time"];
const faults = { [A]: {}, [B]: {} };
for (const g of games)
  if (FAULTS.includes(g.reason) && g.loser)
    faults[g.loser][g.reason] = (faults[g.loser][g.reason] ?? 0) + 1;
const faultTotal = games.filter((g) => FAULTS.includes(g.reason)).length;

const plies = games.map((g) => g.plies).sort((x, y) => x - y);
const q = (p) => plies[Math.min(plies.length - 1, Math.floor(p * plies.length))];
const bins = [];
for (let lo = 0; lo < 230; lo += 20) {
  const n = plies.filter((p) => p >= lo && p < lo + 20).length;
  if (n || bins.length) bins.push({ from: lo, to: lo + 19, n });
}
while (bins.length && bins[bins.length - 1].n === 0) bins.pop();

const byOpening = new Map();
for (const g of games) {
  const o = byOpening.get(g.opening) ?? { opening: g.opening, games: 0, score: 0 };
  o.games++;
  o.score += aScore(g);
  byOpening.set(g.opening, o);
}
const openings = [...byOpening.values()]
  .map((o) => ({ ...o, pct: round((o.score / o.games) * 100, 1) }))
  .sort((x, y) => y.pct - x.pct || x.opening.localeCompare(y.opening));

// ── 속도 몫 ─────────────────────────────────────────────────────────────
const M3 = { elo2x: 105.7, low: 82.1, high: 130.4 };
const npsA = S.search?.A?.nps ?? null;
const npsB = S.search?.B?.nps ?? null;
const ratio = npsA && npsB ? npsA / npsB : null;
const speedElo = ratio
  ? {
      npsRatio: round(ratio, 4),
      predicted: round((M3.elo2x * Math.log(ratio)) / Math.LN2),
      low: round((M3.low * Math.log(ratio)) / Math.LN2),
      high: round((M3.high * Math.log(ratio)) / Math.LN2),
    }
  : null;

const p = S.summary.pentanomial;
const t = S.summary.trinomial;
const report = {
  label: arg("label", `${A} vs ${B}`),
  run: arg("run") ?? null, // CI 런 번호
  runner: arg("runner") ?? null, // 러너 CPU 한 줄
  generatedAt: new Date().toISOString(),
  engines: { A, B },
  tc: S.tc,
  openingsCount: S.cfg.openings.length,
  concurrency: S.cfg.concurrency,
  fixed: Boolean(S.cfg.fixed),
  sprt: {
    ...sprtCfg,
    llr: round(S.summary.sprt.llr, 3),
    lower: round(S.summary.sprt.lower, 3),
    upper: round(S.summary.sprt.upper, 3),
    decided: S.decided ?? null,
  },
  games: S.summary.games,
  wdl: { w: S.summary.wins, d: S.summary.draws, l: S.summary.losses },
  drawRatio: round(S.summary.drawRatio, 4),
  penta: tally.penta, // summary.json 에는 오각 칸 수가 없다 — 기보에서 러너와 같은 규칙으로 다시 센 것
  elo: {
    pentanomial: {
      score: round(p.score, 4),
      elo: round(p.elo),
      low: round(p.eloLow),
      high: round(p.eloHigh),
      los: round(p.los, 4),
    },
    trinomial: {
      score: round(t.score, 4),
      elo: round(t.elo),
      low: round(t.eloLow),
      high: round(t.eloHigh),
      los: round(t.los, 4),
    },
  },
  colors,
  reasons,
  faults,
  faultRate: round(faultTotal / Math.max(1, games.length), 4),
  plies: {
    median: q(0.5),
    p10: q(0.1),
    p90: q(0.9),
    mean: round(plies.reduce((a, b) => a + b, 0) / plies.length, 1),
    bins,
  },
  avgGameSec: round(games.reduce((a, g) => a + g.ms, 0) / games.length / 1000, 2),
  wallSec: round(S.wallSec, 0),
  leaked: S.leaked?.length ?? 0,
  search: S.search ?? null,
  speedElo,
  trajectory,
  openings,
};

if (arg("json")) {
  mkdirSync(dirname(resolve(arg("json"))), { recursive: true });
  writeFileSync(arg("json"), JSON.stringify(report, null, 2) + "\n");
}

// ── 마크다운 ────────────────────────────────────────────────────────────
const f = (x, d = 1) =>
  x == null || !Number.isFinite(x) ? "—" : (x > 0 ? "+" : "") + x.toFixed(d);
const n0 = (x) => (x == null ? "—" : Math.round(x).toLocaleString("en-US"));
const pc = (x) => `${(x * 100).toFixed(1)}%`;
const md = [];
md.push(`### ${report.label}`, "");
md.push(`| 항목 | 값 |`, `|---|---|`);
md.push(
  `| 대국 | **${report.games}판** (${report.games / 2}쌍 · 개시 ${report.openingsCount}개 순환 · 동시 ${report.concurrency}) · 수당 ${S.tc.A.turn}ms |`,
);
md.push(
  `| W-D-L (${A} 기준) | **${report.wdl.w}-${report.wdl.d}-${report.wdl.l}** · 점수 ${pc(p.score)} · 비김 ${pc(report.drawRatio)} |`,
);
md.push(
  `| **Elo (오각)** | **${f(report.elo.pentanomial.elo)}** (95% ${f(report.elo.pentanomial.low)} ~ ${f(report.elo.pentanomial.high)}) · LOS ${pc(p.los)} |`,
);
md.push(
  `| Elo (삼항, 참고) | ${f(report.elo.trinomial.elo)} (95% ${f(report.elo.trinomial.low)} ~ ${f(report.elo.trinomial.high)}) |`,
);
md.push(`| 오각 [0, ½, 1, 1½, 2] | [${report.penta.join(", ")}] |`);
md.push(
  `| SPRT [${sprtCfg.elo0}, ${sprtCfg.elo1}] | LLR ${report.sprt.llr} / [${report.sprt.lower}, ${report.sprt.upper}] → ` +
    (report.sprt.decided
      ? `**${report.sprt.decided.decision}** (${report.sprt.decided.game}판에서 경계)`
      : "결정 없음") +
    " |",
);
md.push(
  `| 색별 (${A}) | 흑 ${colors.black.w}-${colors.black.d}-${colors.black.l} · 백 ${colors.white.w}-${colors.white.d}-${colors.white.l} |`,
);
md.push(
  `| 끝난 까닭 | ${Object.entries(reasons)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ")} |`,
);
md.push(
  `| 고장(시간 초과 · 크래시 · 불법 수) | **${faultTotal}판 (${pc(report.faultRate)})** · 남은 프로세스 ${report.leaked} |`,
);
md.push(
  `| 수 수 | 중앙값 ${report.plies.median} · p10 ${report.plies.p10} · p90 ${report.plies.p90} · 판당 ${report.avgGameSec}s |`,
);
if (S.search) {
  for (const k of ["A", "B"]) {
    const st = S.search[k];
    md.push(
      `| 탐색 ${S.engines[k].name} | NPS ${n0(st.nps)} · 깊이 ${st.avgDepth?.toFixed(2)}(선택 ${st.avgSelDepth?.toFixed(2)}) · 수당 ${n0(st.avgMoveMs)}ms · ${st.moves}수 |`,
    );
  }
}
if (speedElo)
  md.push(
    `| 속도 몫(M3 환산) | NPS 비 ${speedElo.npsRatio} → **${f(speedElo.predicted)} Elo** (${f(speedElo.low)} ~ ${f(speedElo.high)}) |`,
  );
md.push(`| 벽시계 | ${(report.wallSec / 60).toFixed(0)}분 |`);
md.push("");
const text = md.join("\n");
if (arg("md")) writeFileSync(arg("md"), text + "\n");
console.log(text);

function round(x, d = 1) {
  return x == null || !Number.isFinite(x) ? x : Math.round(x * 10 ** d) / 10 ** d;
}
