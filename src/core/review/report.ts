import {
  GRADED,
  QUALITIES,
  QUALITY_INFO,
  coord,
  grade,
  isRecorded,
  ordinalOf,
  recordAt,
  tally,
  winRateAt,
  qualityName,
  winRateCell,
  worst,
  type GradedMove,
  type GradingPreset,
  type ReviewData,
  type ReviewTally,
} from "./move-quality";
import { pick, t } from "../../i18n/i18n";

/**
 * 끝난 리뷰와 그 내보내기 — 앱 `ReviewModels.kt` 의 `ReviewBudget` · `GameReport` 와
 * `domain/review/ReportFormats.kt` 의 이식(원본은 데스크톱 `review_export_to` ·
 * `queue_write_report` · `report_export_html`).
 *
 *  - CSV  — 일부러 영어(데스크톱과 같다)
 *  - MD   — 지금 언어(한국어는 데스크톱 한국어 화면의 것)
 *  - HTML — 데스크톱과 같은 한 파일 페이지(`report-shell/`)에 같은 `GAME` 객체를 넣는다
 */

/**
 * 국면 하나에 쓰는 엔진 예산(`review_send_budget`, main.c:7073): 시간 한 조각(깊이는
 * 열어 둠)이거나, 정한 깊이(시간은 열어 둠).
 */
export interface ReviewBudget {
  readonly seconds: number;
  readonly byDepth: boolean;
  readonly depth: number;
}

export const DEFAULT_BUDGET: ReviewBudget = { seconds: 3, byDepth: false, depth: 14 };

/** `review_budget_str` — "3 s" 나 "depth 14". 로그와 리포트에. */
export const budgetLabel = (b: ReviewBudget): string =>
  b.byDepth ? `depth ${b.depth}` : `${b.seconds} s`;

/** 감시견 끈: 깊이 예산에는 시간 한도가 없다(main.c:7131). */
export const watchdogSeconds = (b: ReviewBudget): number => (b.byDepth ? 1200 : b.seconds * 2 + 60);

export const sanitizeBudget = (b: ReviewBudget): ReviewBudget => ({
  byDepth: b.byDepth,
  seconds: Math.min(120, Math.max(1, Math.round(b.seconds))),
  depth: Math.min(64, Math.max(4, Math.round(b.depth))),
});

/**
 * 끝난 리뷰: 등급 매긴 수순과 리포트 화면 · 내보내기가 보여 주는 전부. `ReviewData` 만으로
 * 만들므로 기준(preset)을 바꿔도 엔진 없이 다시 만든다.
 */
export interface GameReport {
  readonly title: string;
  readonly size: number;
  readonly budget: ReviewBudget;
  readonly data: ReviewData;
  readonly preset: GradingPreset;
  readonly skipOpening: boolean;
  readonly moves: readonly GradedMove[];
  readonly tally: ReviewTally;
  readonly worst: readonly GradedMove[];
  /** `rule_name`(main.c:8008). 웹은 렌주 전용이다. */
  readonly ruleName: string;
  /** 1970 기준 밀리초 — 리포트 머리에. */
  readonly createdAt: number;
}

export function buildReport(args: {
  title: string;
  data: ReviewData;
  budget: ReviewBudget;
  preset: GradingPreset;
  skipOpening: boolean;
  createdAt: number;
  ruleName?: string;
}): GameReport {
  const moves = grade(args.data, args.preset, args.skipOpening);
  return {
    title: args.title,
    size: args.data.size,
    budget: args.budget,
    data: args.data,
    preset: args.preset,
    skipOpening: args.skipOpening,
    moves,
    tally: tally(moves),
    worst: worst(moves),
    ruleName: args.ruleName ?? "Renju",
    createdAt: args.createdAt,
  };
}

// ── 도움 ─────────────────────────────────────────────────────────────

/** `%.<digits>f` — 로캘과 무관하게. */
export function fixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "0";
  const scale = 10 ** digits;
  const scaled = Math.round(Math.abs(value) * scale);
  const whole = Math.floor(scaled / scale);
  const frac = scaled % scale;
  const sign = value < 0 ? "-" : "";
  return digits === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(frac).padStart(digits, "0")}`;
}

/**
 * JSON 문자열 리터럴 — HTML 리포트의 `<script>const GAME = {…}` 안에 그대로 들어간다.
 *
 * 그래서 JSON 규칙만으로는 모자란다. `<` 를 `<` 로 바꿔 제목 · 코멘트 · 엔진 로그에 든
 * `</script>` · `<!--` 가 스크립트 블록을 끝내지 못하게 하고(보안 강화 계획 F1), U+2028 · U+2029 는
 * 옛 JS 엔진에서 문자열 안의 줄바꿈으로 읽혀 구문 오류가 나므로 이스케이프한다. 둘 다 JSON 으로도
 * 유효해서 `JSON.parse` 결과는 원문과 같다.
 */
export function json(text: string): string {
  let out = '"';
  for (const c of text) {
    if (c === '"') out += '\\"';
    else if (c === "\\") out += "\\\\";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (c === "<") out += "\\u003c";
    else if (c === " ") out += "\\u2028";
    else if (c === " ") out += "\\u2029";
    else if (c < " ") out += `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
    else out += c;
  }
  return out + '"';
}

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const pct1 = (v: number | null) => fixed(v ?? 0, 1);

// ── CSV ──────────────────────────────────────────────────────────────

export function csv(r: GameReport): string {
  let out = "position,black_winrate,mate,bestmove,played,played_class,gap\n";
  const d = r.data;
  for (let i = 0; i <= r.moves.length; i++) {
    const rec = recordAt(d, i);
    const q = r.moves[i - 1]?.quality ?? "none";
    out += `${i},`;
    out += isRecorded(rec) ? `${fixed(rec.blackWinRate!, 4)},${rec.blackMate},` : ",,";
    out += `${coord(rec.best, r.size)},${coord(d.moves[i], r.size)},`;
    out += `${QUALITY_INFO[q].label},${rec.gap !== null ? fixed(rec.gap, 4) : ""}\n`;
  }
  return out;
}

// ── Markdown ─────────────────────────────────────────────────────────

const gradeCell = (m: GradedMove) =>
  m.quality === "none" ? " " : `${QUALITY_INFO[m.quality].symbol} ${qualityName(m.quality)}`;
const deltaCell = (m: GradedMove) =>
  m.quality === "none" || m.quality === "forced" ? "-" : `-${fixed(m.delta * 100, 1)}%p`;
const gapCell = (m: GradedMove) => (m.gap !== null ? `${Math.round(m.gap * 100)}%p` : "-");

export function markdown(r: GameReport): string {
  let out = `# ${t("게임 리뷰: {title}", { title: r.title })}\n\n`;
  out += `- ${t("수: {n}, 수당 {b}", { n: r.moves.length, b: budgetLabel(r.budget) })}\n`;
  out += `- ${t("정확도: 흑 {b} / 백 {w}", { b: `**${pct1(r.tally.blackAccuracy)}%**`, w: `**${pct1(r.tally.whiteAccuracy)}%**` })}\n\n`;
  out += `| ${t("등급")} | ${t("흑")} | ${t("백")} |\n|---|---|---|\n`;
  for (const q of GRADED) {
    const [b, w] = r.tally.counts.get(q) ?? [0, 0];
    out += `| ${QUALITY_INFO[q].symbol} ${qualityName(q)} | ${b} | ${w} |\n`;
  }
  out += `\n## ${t("최악의 수")}\n\n`;
  for (const m of r.worst) {
    out +=
      `- #${m.index} ${coord(m.move, r.size)} (${m.black ? t("흑") : t("백")}): ` +
      `${qualityName(m.quality)}, -${fixed(m.delta * 100, 1)}%p, ${t("최선은 {best}", { best: coord(m.best, r.size) })}\n`;
  }
  const heads = [
    pick("수", "Move"),
    t("등급"),
    "dWR",
    t("흑 승률"),
    t("최선"),
    t("격차"),
    t("코멘트"),
  ];
  out += `\n## ${t("수순")}\n\n| # | ${heads.join(" | ")} |\n`;
  out += "|---|---|---|---|---|---|---|---|\n";
  for (const m of r.moves) {
    out +=
      `| ${m.index} | ${coord(m.move, r.size)} | ${gradeCell(m)} | ${deltaCell(m)} | ` +
      `${winRateCell(m)} | ${coord(m.best, r.size)} | ${gapCell(m)} | ${m.comment} |\n`;
  }
  return out;
}

/** 큐가 끝났을 때의 요약 파일(`queue_finish`, main.c:7518). */
export function queueSummary(
  entries: readonly { name: string; result: string }[],
  reviewed: number,
  failed: number,
): string {
  let out =
    `# ${t("분석 큐 요약")}\n\n` +
    `${t("총 {n}개: 리뷰 {r}, 실패 {f}, 미실행 {u}", { n: entries.length, r: reviewed, f: failed, u: entries.length - reviewed - failed })}\n\n`;
  entries.forEach((e, i) => {
    out += `- [${String(i + 1).padStart(2, "0")}] ${e.name}: ${e.result || t("미실행")}\n`;
  });
  return out;
}

// ── HTML ─────────────────────────────────────────────────────────────

/** 데스크톱 리포트 페이지의 정적 부분 — 제목 앞 · 제목 뒤(GAME 앞) · GAME 뒤. */
export interface ReportShell {
  readonly head: string;
  readonly body: string;
  readonly tail: string;
}

/** 페이지가 키마다 기대는 화면 문구 — 데스크톱의 한국어 묶음(지금 언어로). */
function labels(): string {
  const h = [
    "#",
    pick("수", "Move"),
    t("등급"),
    "ΔWR",
    t("승률"),
    t("최선"),
    t("격차"),
    t("코멘트"),
  ];
  const kv: [string, string][] = [
    ["black", t("흑")],
    ["white", t("백")],
  ];
  const rest: [string, string][] = [
    ["worst", t("최악의 수")],
    ["clean", t("없음. 깔끔한 대국입니다.")],
    ["movesw", t("수")],
    ["acclab", ` ${t("정확도")}`],
    ["gen", t("생성:")],
    ["startpos", t("시작 국면입니다.")],
    ["best", t("최선")],
    ["gap", t("격차")],
    ["empty", t("(비어 있음)")],
    ["t_wr", t("승률")],
    ["t_gr", t("등급")],
    ["t_mv", t("수순")],
    ["t_log", t("엔진 로그")],
    ["t_raw", t("원본 데이터")],
    ["hint", t("← → 키 · 돌/점/행 클릭으로 이동")],
    ["spm", t("초/수")],
    ["dpm", t("깊이")],
    ["permove", t("/수")],
  ];
  const pair = ([k, v]: [string, string]) => `${json(k)}:${json(v)}`;
  return (
    `{${kv.map(pair).join(",")},"h":[${h.map(json).join(",")}],` + `${rest.map(pair).join(",")}}`
  );
}

/** `GAME = {...}` 객체 — main.c:8447 이 쓰는 그대로, 칸마다. */
export function gameJson(r: GameReport, dateStamp: string, log: string, ver = "web"): string {
  const d = r.data;
  const n = r.moves.length;
  const first = recordAt(d, 0);
  const counts = (side: 0 | 1) =>
    QUALITIES.map((q) => (q === "none" ? 0 : (r.tally.counts.get(q)?.[side] ?? 0))).join(",");
  let out = `{"title":${json(r.title)}`;
  out += `,"date":${json(dateStamp)}`;
  out += `,"rule":${json(r.ruleName)}`;
  out += `,"ver":${json(ver)},"commit":"","size":${r.size}`;
  out += `,"spm":${r.budget.byDepth ? 0 : r.budget.seconds}`;
  out += `,"dpm":${r.budget.byDepth ? r.budget.depth : 0}`;
  out += `,"wr0":${fixed(winRateAt(d, 0, Math.max(n, 1)), 4)}`;
  out += `,"mate0":${isRecorded(first) ? first.blackMate : 0}`;
  out += `,"valid0":${isRecorded(first) ? 1 : 0}`;
  out += `,"acc":[${fixed(r.tally.blackAccuracy ?? -1, 1)},${fixed(r.tally.whiteAccuracy ?? -1, 1)}]`;
  out +=
    `,"kk":{"brilliant":${ordinalOf("brilliant")},"great":${ordinalOf("great")}` +
    `,"best":${ordinalOf("best")},"inacc":${ordinalOf("inaccuracy")}` +
    `,"blunder":${ordinalOf("blunder")},"missed":${ordinalOf("missedWin")}` +
    `,"forced":${ordinalOf("forced")}}`;
  out += `,"L":${labels()}`;
  out += `,"mq":[${QUALITIES.map(
    (q) =>
      `{"n":${json(qualityName(q))},"s":${json(QUALITY_INFO[q].symbol)},"c":${json(QUALITY_INFO[q].color)}}`,
  ).join(",")}]`;
  out += `,"cnt":[[${counts(0)}],[${counts(1)}]]`;
  out += `,"moves":[${r.moves
    .map(
      (m) =>
        `{"c":${json(coord(m.move, r.size))},"x":${m.move.x},"y":${m.move.y}` +
        `,"cls":${ordinalOf(m.quality)},"d":${fixed(m.delta, 4)},"iwr":${fixed(m.blackWinRate, 4)}` +
        `,"mate":${m.recorded ? m.blackMate : 0},"v":${m.recorded ? 1 : 0}` +
        `,"best":${json(coord(m.best, r.size))},"bx":${m.best?.x ?? -1},"by":${m.best?.y ?? -1}` +
        `,"gap":${fixed(m.gap ?? -1, 3)},"cmt":${json(m.comment)}}`,
    )
    .join(",")}]`;
  out += `,"movestr":${json(d.moves.map((m) => coord(m, r.size)).join(""))}`;
  out += `,"log":${json(log)}`;
  return out + "}";
}

export function html(r: GameReport, shell: ReportShell, dateStamp: string, log = ""): string {
  return (
    shell.head +
    `${escapeHtml(r.title)} · ${t("RapfiWeb 게임 리포트")}` +
    shell.body +
    gameJson(r, dateStamp, log) +
    shell.tail
  );
}

/** 리포트 머리의 날짜 — `YYYY-MM-DD HH:MM`(현지 시각). */
export function dateStamp(ms: number): string {
  const t = new Date(ms);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}
