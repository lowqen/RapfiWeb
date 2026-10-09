/**
 * 시간 직접 입력 — 착수 시간 · 분석 시간 · 리뷰 예산 · 증명 예산 칸이 함께 쓰는 해석기.
 *
 * 받는 꼴(대소문자 · 앞뒤 빈칸 무시, 소수점은 `.` 과 `,` 둘 다):
 *
 * ```
 *  2.5      → 단위 없는 수는 그 칸의 기본 단위(`unit`, 대개 초)
 *  2.5s · 2.5초 · 2.5sec
 *  1500ms · 1500밀리초
 *  1m · 1분 · 1min · 1h · 1시간
 *  0 · 무제한 · ∞ · unlimited   → 그 칸이 무제한을 받을 때만(`unlimited`) — 값은 0
 * ```
 *
 * **고쳐 쓸 수 있는 것은 고치고, 뜻을 알 수 없는 것은 기본값으로 돌린다.** 범위를 벗어난
 * 수는 끝값으로 자른다(뜻은 분명하다 — 「더 길게/짧게」). 음수 · 글자 · 빈칸 · NaN · Infinity 는
 * 뜻을 알 수 없으니 그 칸의 **기본값**으로 돌리고, 왜 돌렸는지 한 줄을 함께 돌려준다 — 화면이
 * 그 줄을 그대로 띄운다.
 */

export type DurationUnit = "ms" | "s";

export interface DurationSpec {
  /** 가장 짧은 값(ms). 무제한(0)은 이 검사를 받지 않는다. */
  readonly minMs: number;
  /** 가장 긴 값(ms). */
  readonly maxMs: number;
  /** 뜻을 알 수 없는 입력일 때 돌아갈 값(ms). 0 이면 무제한. */
  readonly defaultMs: number;
  /** 단위 없이 친 수의 단위. */
  readonly unit: DurationUnit;
  /** 무제한(0)을 받는 칸인가. */
  readonly unlimited?: boolean;
  /** 이 배수로 반올림한다(ms). 초 단위로만 저장하는 값이면 1000. 기본 1. */
  readonly stepMs?: number;
}

export type DurationResult =
  | { readonly kind: "ok"; readonly ms: number }
  | { readonly kind: "clamped"; readonly ms: number; readonly note: string }
  | { readonly kind: "fallback"; readonly ms: number; readonly note: string };

const UNIT_MS: Record<string, number> = {
  ms: 1,
  밀리초: 1,
  s: 1000,
  sec: 1000,
  초: 1000,
  m: 60_000,
  min: 60_000,
  분: 60_000,
  h: 3_600_000,
  시간: 3_600_000,
};

const UNLIMITED_WORDS = new Set(["무제한", "∞", "unlimited", "inf", "infinite"]);

/** 사람이 읽는 시간 — 「무제한」 · 「800ms」 · 「2.5초」 · 「90초」 · 「10분」. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "무제한";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms >= 600_000 && ms % 60_000 === 0) return `${ms / 60_000}분`;
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : Number(s.toFixed(2))}초`;
}

/** 입력 칸에 다시 채울 글 — 그 칸의 기본 단위로, 단위 글자 없이. 무제한은 빈칸. */
export function durationText(ms: number, unit: DurationUnit): string {
  if (ms <= 0) return "";
  const v = unit === "s" ? ms / 1000 : ms;
  return String(Number.isInteger(v) ? v : Number(v.toFixed(3)));
}

export function parseDuration(text: string, spec: DurationSpec): DurationResult {
  const fallback = (why: string): DurationResult => ({
    kind: "fallback",
    ms: spec.defaultMs,
    note: `${why} — 기본값(${formatDuration(spec.defaultMs)})으로 돌렸습니다`,
  });

  const raw = text.trim().toLowerCase().replace(/\s+/g, "");
  if (raw === "") return fallback("시간이 비었습니다");
  if (UNLIMITED_WORDS.has(raw)) {
    return spec.unlimited ? { kind: "ok", ms: 0 } : fallback("이 칸은 무제한을 받지 않습니다");
  }

  const m = /^([+-]?\d+(?:[.,]\d*)?|[+-]?[.,]\d+)([a-z가-힣]*)$/.exec(raw);
  if (!m) return fallback(`«${text.trim()}» 는 시간이 아닙니다`);
  const num = Number(m[1]!.replace(",", "."));
  const unitWord = m[2]!;
  const factor = unitWord === "" ? UNIT_MS[spec.unit]! : UNIT_MS[unitWord];
  if (factor === undefined) return fallback(`«${unitWord}» 는 모르는 단위입니다`);
  if (!Number.isFinite(num)) return fallback("수가 아닙니다");
  if (num < 0) return fallback("음수는 시간이 될 수 없습니다");

  let ms = num * factor;
  if (ms === 0) {
    return spec.unlimited ? { kind: "ok", ms: 0 } : fallback("0 은 이 칸에서 쓸 수 없습니다");
  }

  const step = spec.stepMs && spec.stepMs > 0 ? spec.stepMs : 1;
  ms = Math.round(ms / step) * step;
  if (ms < spec.minMs) {
    return {
      kind: "clamped",
      ms: spec.minMs,
      note: `가장 짧은 ${formatDuration(spec.minMs)}로 맞췄습니다`,
    };
  }
  if (ms > spec.maxMs) {
    return {
      kind: "clamped",
      ms: spec.maxMs,
      note: `가장 긴 ${formatDuration(spec.maxMs)}로 맞췄습니다`,
    };
  }
  return { kind: "ok", ms };
}

// ── 칸마다의 범위 — 저장하는 쪽(sanitize)의 범위와 같아야 한다 ──────────────

/** 대국 엔진 착수 시간 — `gameStore.moveTimeMs`(0 = 무제한). 엔진은 500ms 밑으로 받지 않는다. */
export const MOVE_TIME_SPEC: DurationSpec = {
  minMs: 500,
  maxMs: 3_600_000,
  defaultMs: 0,
  unit: "s",
  unlimited: true,
  stepMs: 100,
};

/** 분석 시간 — 설정 `analysisSec`(정수 초, 0 = 무제한). settings.txt 가 초 단위라 1초 눈금. */
export const ANALYSIS_TIME_SPEC: DurationSpec = {
  minMs: 1_000,
  maxMs: 3_600_000,
  defaultMs: 0,
  unit: "s",
  unlimited: true,
  stepMs: 1_000,
};

/** 리뷰 국면당 시간 — `sanitizeBudget`(1..120초, 정수). */
export const REVIEW_TIME_SPEC: DurationSpec = {
  minMs: 1_000,
  maxMs: 120_000,
  defaultMs: 3_000,
  unit: "s",
  stepMs: 1_000,
};

/** 증명 마디당 시작 예산 — `sanitizeProveOptions`(1..600초, 정수). */
export const PROVE_START_SPEC: DurationSpec = {
  minMs: 1_000,
  maxMs: 600_000,
  defaultMs: 5_000,
  unit: "s",
  stepMs: 1_000,
};

/** 증명 마디당 상한 — `sanitizeProveOptions`(1..3600초, 정수, 시작 예산 이상). */
export const PROVE_MAX_SPEC: DurationSpec = {
  minMs: 1_000,
  maxMs: 3_600_000,
  defaultMs: 320_000,
  unit: "s",
  stepMs: 1_000,
};
