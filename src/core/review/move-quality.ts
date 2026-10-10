import { DEFAULT_SIZE, sameMove, type Move } from "../model/move";
import { localized, msg, t } from "../../i18n/i18n";

/**
 * 수 등급 — 앱 `core/model/MoveQuality.kt` 의 이식(원본은 데스크톱의 4단계 분류기,
 * main.c:1264-1600). 이름 · 기호 · 색이 데스크톱의 것이라 같은 리뷰가 세 기계에서 같게
 * 읽힌다.
 *
 * 판정기는 리뷰 자료(`ReviewData`) 위의 순수 함수다 — 엔진 없이 문턱값을 시험한다.
 */

/** 데스크톱 순서(`MQ_NONE`..`MQ_FORCED`). 순서가 곧 서수다 — HTML 리포트가 서수를 쓴다. */
export const QUALITIES = [
  "none",
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
  "missedWin",
  "forced",
] as const;
export type MoveQuality = (typeof QUALITIES)[number];

export interface QualityInfo {
  /** 영어 이름 — CSV 는 데스크톱처럼 이것을 그대로 쓴다. */
  label: string;
  symbol: string;
  color: string;
  /** 데스크톱 한국어 표(main.c:397 `devko`) — 화면에는 `qualityName` 으로(사전 열쇠). */
  korean: string;
}

export const QUALITY_INFO: Record<MoveQuality, QualityInfo> = {
  none: { label: "", symbol: "", color: "#808080", korean: "" },
  brilliant: { label: "Brilliant", symbol: "!!", color: "#26c2a3", korean: msg("명수") },
  great: { label: "Great", symbol: "!", color: "#749bbf", korean: msg("훌륭한 수") },
  best: { label: "Best", symbol: "★", color: "#81b64c", korean: msg("최선") },
  excellent: { label: "Excellent", symbol: "👍", color: "#a0c15a", korean: msg("우수") },
  good: { label: "Good", symbol: "✓", color: "#95b776", korean: msg("좋음") },
  inaccuracy: { label: "Inaccuracy", symbol: "?!", color: "#f7c631", korean: msg("부정확") },
  mistake: { label: "Mistake", symbol: "?", color: "#ffa459", korean: msg("실수") },
  blunder: { label: "Blunder", symbol: "??", color: "#fa412d", korean: msg("대실수") },
  missedWin: { label: "Missed Win", symbol: "✕", color: "#ff7769", korean: msg("놓친 승리") },
  forced: { label: "Forced", symbol: "→", color: "#8c919a", korean: msg("강제") },
};

/** 등급의 화면 이름(지금 언어). */
export const qualityName = (q: MoveQuality): string =>
  q === "none" ? "" : t(QUALITY_INFO[q].korean);

export const ordinalOf = (q: MoveQuality): number => QUALITIES.indexOf(q);

/** 리포트가 늘어놓는 등급들(데스크톱 순서). */
export const GRADED: readonly MoveQuality[] = QUALITIES.filter((q) => q !== "none");

/** `mqpreset`(settings_dev 3행): dWR 등급 문턱의 배율. */
export type GradingPreset = "strict" | "default" | "lenient";
export const PRESET_SCALE: Record<GradingPreset, number> = {
  strict: 0.6,
  default: 1.0,
  lenient: 1.5,
};
export const PRESET_LABEL: Readonly<Record<GradingPreset, string>> = localized({
  strict: msg("엄격"),
  default: msg("기본"),
  lenient: msg("관대"),
});

/**
 * 리뷰가 한 국면에 남긴 것 — 데스크톱의 `wrhistory`/`wrmate`/`wrvalid` 셋과
 * `reviewbestmove` · `reviewgap`. `blackWinRate` 가 `null` 이면 `wrvalid == 0`(탐색 안 함).
 */
export interface PositionRecord {
  readonly blackWinRate: number | null;
  readonly blackMate: number;
  readonly best: Move | null;
  /** 엔진 최선과 차선의 승률 차(두는 쪽 관점). */
  readonly gap: number | null;
}

export const EMPTY_RECORD: PositionRecord = {
  blackWinRate: null,
  blackMate: 0,
  best: null,
  gap: null,
};

export const isRecorded = (r: PositionRecord): boolean => r.blackWinRate !== null;

/** 등급 하나 — 리포트 표와 배지가 쓰는 전부. */
export interface GradedMove {
  readonly index: number;
  readonly move: Move;
  readonly black: boolean;
  readonly quality: MoveQuality;
  /** 두는 쪽의 승률 손실 0..1(`movedelta`). */
  readonly delta: number;
  /** 수 뒤 흑 관점 승률 — 기록이 없으면 보간한 값. */
  readonly blackWinRate: number;
  readonly recorded: boolean;
  readonly blackMate: number;
  readonly best: Move | null;
  readonly gap: number | null;
  readonly comment: string;
}

/** 쪽마다 등급별 수와 정확도(`mq_tally`). */
export interface ReviewTally {
  /** 등급 → [흑, 백]. */
  readonly counts: ReadonlyMap<MoveQuality, readonly [number, number]>;
  /** 0..100, 등급 매긴 수가 없으면 `null`. */
  readonly blackAccuracy: number | null;
  readonly whiteAccuracy: number | null;
}

/**
 * 리뷰한 수순 — 수와 국면마다 기록 하나(0 = 빈 판, 그래서 리뷰 뒤 `records.length` 는
 * `moves.length + 1`).
 */
export interface ReviewData {
  readonly moves: readonly Move[];
  readonly size: number;
  readonly records: readonly PositionRecord[];
}

export const recordAt = (d: ReviewData, i: number): PositionRecord => d.records[i] ?? EMPTY_RECORD;

/** 이 자료가 지금 판의 수순을 따르는가 — 리뷰의 등급은 판이 리뷰한 대국을 따를 때만 뜻이 있다. */
export const matchesPrefix = (d: ReviewData, line: readonly Move[]): boolean =>
  line.length <= d.moves.length && line.every((m, i) => sameMove(m, d.moves[i]!));

/**
 * `wrgraph_maxindex`(main.c:4592): 커서를 실제 기록과 수가 함께 있는 마지막 수까지 늘린 것.
 */
export function maxIndex(d: ReviewData, cursor = d.moves.length): number {
  let n = cursor;
  for (let i = cursor + 1; i <= d.moves.length; i++) if (isRecorded(recordAt(d, i))) n = i;
  return Math.max(n, 1);
}

/** `wrgraph_value_at`: 기록된 값, 빈 곳은 선형 보간. */
export function winRateAt(d: ReviewData, index: number, n = maxIndex(d)): number {
  const own = recordAt(d, index).blackWinRate;
  if (own !== null) return own;
  let prev = -1;
  for (let i = index - 1; i >= 0; i--) {
    if (isRecorded(recordAt(d, i))) {
      prev = i;
      break;
    }
  }
  let next = -1;
  for (let i = index + 1; i <= n; i++) {
    if (isRecorded(recordAt(d, i))) {
      next = i;
      break;
    }
  }
  const p = prev >= 0 ? recordAt(d, prev).blackWinRate : null;
  const q = next >= 0 ? recordAt(d, next).blackWinRate : null;
  if (p !== null && q !== null) return p + ((q - p) * (index - prev)) / (next - prev);
  return p ?? q ?? 0.5;
}

export const hasAnyRecord = (d: ReviewData): boolean => d.records.some(isRecorded);

// ── 판정기 ───────────────────────────────────────────────────────────

const EPS = 1e-9;

/** `SKIP_OPENING_N` — 등급을 매기지 않는 첫 수들(main.c:1078). */
export const SKIP_OPENING_N = 5;

const mover = (blackValue: number, black: boolean) => (black ? blackValue : 1 - blackValue);
const mateFor = (blackMate: number, black: boolean) => (black ? blackMate : -blackMate);

/**
 * `classify_moves`(main.c:1398). 수마다 하나(데스크톱의 1..N), 둔 순서대로.
 */
export function grade(
  d: ReviewData,
  preset: GradingPreset = "default",
  skipOpening = true,
  cursor = d.moves.length,
): GradedMove[] {
  const n = maxIndex(d, cursor);
  const out: GradedMove[] = [];
  for (let i = 1; i <= n; i++) {
    const move = d.moves[i - 1];
    if (!move) break;
    const black = (i - 1) % 2 === 0;
    const before = recordAt(d, i - 1);
    const after = recordAt(d, i);
    const blackAfter = winRateAt(d, i, n);
    const wb = mover(winRateAt(d, i - 1, n), black);
    const wa = mover(blackAfter, black);
    const mb = isRecorded(before) ? mateFor(before.blackMate, black) : 0;
    const ma = isRecorded(after) ? mateFor(after.blackMate, black) : 0;
    const skipped = skipOpening && i <= SKIP_OPENING_N;
    // 데스크톱은 첫 수들에서 등급도 손실도 0 으로 둔다 — 둘 다 적기 전에 `continue` 한다.
    const delta = skipped ? 0 : Math.max(0, wb - wa);
    const quality = skipped ? "none" : classify(move, before, after, wb, wa, mb, ma, delta, preset);
    out.push({
      index: i,
      move,
      black,
      quality,
      delta,
      blackWinRate: blackAfter,
      recorded: isRecorded(after),
      blackMate: after.blackMate,
      best: before.best,
      gap: before.gap,
      comment: "",
    });
  }
  return out.map((g) => ({ ...g, comment: comment(g, d, n) }));
}

/**
 * 판에 다는 배지: **지금 수 하나**의 등급. 데스크톱은 모든 수를 매기지만 `bn == piecenum`
 * 하나만 그린다(main.c:2114). 수 양쪽 어디에도 실제 기록이 없으면 `null` — 보간한 값만으로는
 * 매길 것이 없다(main.c:2117).
 */
export function currentBadge(
  moves: readonly Move[],
  size: number,
  records: readonly PositionRecord[],
  preset: GradingPreset = "default",
  skipOpening = true,
): MoveQuality | null {
  const ply = moves.length;
  if (ply < 1) return null;
  const before = records[ply - 1] ?? EMPTY_RECORD;
  const after = records[ply] ?? EMPTY_RECORD;
  if (!isRecorded(before) && !isRecorded(after)) return null;
  const graded = grade({ moves, size, records }, preset, skipOpening, ply).findLast(
    (g) => g.index === ply,
  );
  return graded && graded.quality !== "none" ? graded.quality : null;
}

function classify(
  move: Move,
  before: PositionRecord,
  after: PositionRecord,
  wb: number,
  wa: number,
  mb: number,
  ma: number,
  delta: number,
  preset: GradingPreset,
): MoveQuality {
  const scale = PRESET_SCALE[preset];
  const isBest = before.best !== null && sameMove(before.best, move);
  const gap = before.gap;
  // 차선의 절대 승률(두는 쪽 관점).
  const second = gap !== null ? wb - gap : -1;

  // 명수: 승부가 이 한 수에 달렸거나, 알려지지 않았던 필승을 이 수가 세운다.
  if (
    isBest &&
    gap !== null &&
    gap >= 0.25 - EPS &&
    ((ma > 0 && mb <= 0) || (isRecorded(after) && wb <= 0.7 && wa >= 0.9))
  ) {
    return "brilliant";
  }
  if (ma > 0 && isRecorded(before) && mb <= 0 && wb <= 0.95) return "brilliant";

  // 이미 진 판: 양쪽 메이트 거리가 정확하면 버틴 정도를 매긴다.
  if (wb <= 0.05 && mb <= 0) {
    if (mb < 0 && ma < 0 && isRecorded(before) && isRecorded(after)) {
      const kept = -ma - (-mb - 1);
      if (kept >= 0) return "best";
      if (kept >= -2) return "good";
      if (kept >= -5) return "inaccuracy";
      if (kept >= -9) return "mistake";
      return "blunder";
    }
    return "forced";
  }

  if (mb > 0 && ma <= 0 && isRecorded(after) && wa <= 0.75) return "missedWin";

  // 훌륭한 수: 판을 지키는 유일한 수.
  if (
    isBest &&
    wb < 0.95 &&
    ((gap !== null &&
      gap >= 0.15 - EPS &&
      wb > 0.05 &&
      second > 0.05 + EPS &&
      second <= 0.4 + EPS) ||
      (gap === null &&
        isRecorded(before) &&
        isRecorded(after) &&
        wb < 0.65 &&
        wa - wb >= 0.25 - EPS))
  ) {
    return "great";
  }

  if (isBest) return "best";

  let graded: MoveQuality;
  if (delta <= 0.01 * scale + EPS) graded = "best";
  else if (delta <= 0.03 * scale + EPS) graded = "excellent";
  else if (delta <= 0.08 * scale + EPS) graded = "good";
  else if (delta <= 0.15 * scale + EPS) graded = "inaccuracy";
  else if (delta <= 0.3 * scale + EPS) graded = "mistake";
  else graded = "blunder";
  // 이기던 판을 지는 판으로 만든 수는 손실이 얼마든 대실수다.
  return wb >= 0.65 && wa <= 0.35 ? "blunder" : graded;
}

/** `mq_comment`(main.c:1507): 같은 숫자에서 나오는 코칭 한 줄 — 데스크톱 한국어 표 그대로. */
function comment(g: GradedMove, d: ReviewData, n: number): string {
  const i = g.index;
  const black = g.black;
  const before = recordAt(d, i - 1);
  const after = recordAt(d, i);
  const wb = mover(winRateAt(d, i - 1, n), black);
  const wa = mover(winRateAt(d, i, n), black);
  const mb = isRecorded(before) ? mateFor(before.blackMate, black) : 0;
  const ma = isRecorded(after) ? mateFor(after.blackMate, black) : 0;
  const dp = Math.round(g.delta * 100);
  const resist = wb <= 0.05 && mb < 0 && ma < 0 && isRecorded(before) && isRecorded(after);
  const shed = resist ? -mb - 1 - -ma : 0;
  const best = coord(before.best, d.size);
  switch (g.quality) {
    case "brilliant":
      return t("찾기 어려운 결정타. 승부를 결정지었습니다.");
    case "great":
      return t("국면을 지키는 유일한 수. 다른 수는 모두 무너집니다.");
    case "missedWin":
      return t("필승(M{m})이 있었지만 이 수로 사라졌습니다.", { m: mb });
    case "best":
      if (resist) return t("가장 끈질긴 방어. 메이트를 최대한 늦춥니다.");
      return before.best !== null && sameMove(before.best, g.move)
        ? t("엔진의 최선수입니다.")
        : t("엔진 최선수에 못지않은 수입니다.");
    case "excellent":
      return t("거의 최선({p}%p 손실). {best}이(가) 조금 더 정확했습니다.", { p: dp, best });
    case "good":
      return resist
        ? t("버틸 만한 방어지만 메이트를 필요 이상 {n}수 앞당깁니다.", { n: shed })
        : t("무난하지만 {p}%p 손해. {best}이(가) 더 유리했습니다.", { p: dp, best });
    case "inaccuracy":
      return resist
        ? t("방어가 느슨합니다. 메이트가 필요 이상 {n}수 빨라집니다.", { n: shed })
        : t("{p}%p 손실. {best}이(가) 더 정확했습니다.", { p: dp, best });
    case "mistake":
      return resist
        ? t("약한 저항. 패배까지의 수순을 {n}수 단축시킵니다.", { n: shed })
        : t("{p}%p 손실. {best}이(가) 명백히 더 좋았습니다.", { p: dp, best });
    case "blunder":
      if (wb >= 0.65 && wa <= 0.35) {
        return t("승세를 날렸습니다. 이기던 국면({a}%)이 지는 국면({b}%)이 되었습니다.", {
          a: Math.round(wb * 100),
          b: Math.round(wa * 100),
        });
      }
      if (mb >= 0 && ma < 0)
        return t("필패(M{m})에 걸려들었습니다. {best}을(를) 고려해야 했습니다.", { m: -ma, best });
      if (resist) return t("방어 붕괴. 메이트가 {n}수 가까워졌습니다.", { n: shed });
      return t("{p}%p 손실. 여기서는 {best}이(가) 필요했습니다.", { p: dp, best });
    case "forced":
      return t("이미 패배가 확정된 국면. 어떤 방어도 결과를 바꿀 수 없습니다.");
    case "none":
      return "";
  }
}

/** `review_coordstr`(main.c:6982): 소문자 열 + 아래에서 센 행, 없으면 `-`. */
export const coord = (m: Move | null | undefined, size = DEFAULT_SIZE): string =>
  m ? `${String.fromCharCode(97 + m.x)}${size - m.y}` : "-";

/** `mq_tally`(main.c:1585): 쪽마다 등급별 수와 정확도. */
export function tally(graded: readonly GradedMove[]): ReviewTally {
  const counts = new Map<MoveQuality, [number, number]>();
  for (const q of GRADED) counts.set(q, [0, 0]);
  const sum = [0, 0];
  const n = [0, 0];
  for (const m of graded) {
    if (m.quality === "none") continue;
    const side = m.black ? 0 : 1;
    counts.get(m.quality)![side]++;
    if (m.quality !== "forced") {
      sum[side]! += 100 * Math.exp((-m.delta * 100) / 40);
      n[side]!++;
    }
  }
  return {
    counts,
    blackAccuracy: n[0]! > 0 ? sum[0]! / n[0]! : null,
    whiteAccuracy: n[1]! > 0 ? sum[1]! / n[1]! : null,
  };
}

const worstKey = (m: GradedMove) => m.delta + (m.quality === "missedWin" ? 0.5 : 0);

/** 가장 나쁜 수 셋 — dWR 순, 놓친 승리는 윗무리로 올린다(main.c:7301 / 7706 의 열쇠). */
export function worst(graded: readonly GradedMove[], count = 3): GradedMove[] {
  return graded
    .filter(
      (m) =>
        m.quality !== "forced" &&
        ordinalOf(m.quality) >= ordinalOf("inaccuracy") &&
        worstKey(m) > 0, // 열쇠가 0 에서 출발한다 — 손해 없는 수는 «최악»이 아니다
    )
    .sort((a, b) => worstKey(b) - worstKey(a))
    .slice(0, count);
}

/** `wr` 칸: 메이트면 `B M3` / `W M2`, 아니면 백분율, 보간한 값은 괄호. */
export function winRateCell(m: GradedMove): string {
  if (m.recorded && m.blackMate !== 0) {
    return `${m.blackMate > 0 ? "B" : "W"} M${Math.abs(m.blackMate)}`;
  }
  const p = Math.round(m.blackWinRate * 100);
  return m.recorded ? `${p}%` : `(${p}%)`;
}
