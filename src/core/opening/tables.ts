import { DEFAULT_SIZE, move, type Move } from "../model/move";
import { pick } from "../../i18n/i18n";
import { keyOf as posKeyOf } from "../model/pos-key";
import { MAX_PLY, keyOf as frameKeyOf } from "./frame";

/**
 * 오프닝 표 두 개 — 앱 `OpeningEval.kt` 의 `OpeningEval` · `OpeningTables` 이식(원본은
 * 데스크톱 `openstore.h`).
 *
 *   `opening_names.txt`  4수 이름        키 = 프레임 키(`frame.ts`)
 *   `opening_evals.txt`  흑 5수 유불리   키 = `PosKey`(돌 집합)
 *
 * 둘 다 **줄이 있을 거라고 기대하지 않는다**: 줄이 없는 국면은 아무것도 보이지 않을 뿐이다.
 *
 * **키가 둘인 것은 일부러다.** 이름은 수순에 달렸다(백 2수가 어느 돌이었나가 한성과 다른
 * 주형을 가른다). 평가는 국면에 달렸다 — 같은 돌 · 같은 차례면 같은 판이므로 수순만 다른
 * 두 줄은 한 등급을 나눠 가져야 한다. 회전 · 거울은 둘 다에서 접힌다.
 *
 * 앱은 이 표를 전역 객체에 두지만 여기서는 **값으로 넘긴다**(`OpeningTables`) — 프레임워크
 * 없는 순수 함수로 남겨 시험이 표를 마음대로 갈아 끼울 수 있게.
 */

/** 등급을 그리는 모양. 엔진 승률 색 사다리와 **일부러 다르다** — 이것은 사람이 적은 값이다.
 *  모양이 뜻을 나르고 색은 거들 뿐이다. `openstore.h` 의 `os_grades` 와 같다. */
export type GradeMark = "circle" | "pentagon" | "square" | "triangle" | "cross";

export interface Grade {
  /** 흑 기준: +5 흑승 … 0 동등 … −5 백승. */
  readonly code: number;
  readonly ko: string;
  readonly en: string;
  readonly mark: GradeMark;
  /** CSS 색. */
  readonly fill: string;
  /** 안쪽 점의 색, 없으면 `null`. */
  readonly dot: string | null;
}

/** 등급 이름 — 지금 언어로(표에 두 언어가 다 있다). */
export const gradeName = (g: Grade): string => pick(g.ko, g.en);

export const gradeLabel = (g: Grade): string => (g.code >= 0 ? `+${g.code}` : `${g.code}`);

const grade = (
  code: number,
  ko: string,
  en: string,
  mark: GradeMark,
  fill: string,
  dot: string | null = null,
): Grade => ({ code, ko, en, mark, fill, dot });

/** 흑에게 좋은 것부터. 문구는 사용자의 평가표를 따른다. 색은 앱의 ARGB 와 같은 값. */
export const LADDER: readonly Grade[] = [
  grade(5, "흑승", "Black wins", "circle", "#16181c"),
  grade(4, "흑 거의 승", "Black nearly wins", "pentagon", "#3b4fc0"),
  grade(3, "흑 매우 유리", "Black clearly better", "pentagon", "#8478df"),
  grade(2, "흑 조금 유리", "Black slightly better", "pentagon", "#a6d5ef"),
  grade(1, "흑 미세 유리", "Black marginally better", "square", "#1f9d3a", "#0d0f12"),
  grade(0, "동등", "Balanced", "square", "#5ce062"),
  grade(-1, "백 미세 유리", "White marginally better", "square", "#bdf0bb", "#ffffff"),
  grade(-2, "백 조금 유리", "White slightly better", "triangle", "#ffe14d"),
  grade(-3, "백 매우 유리", "White clearly better", "triangle", "#ffa726"),
  grade(-4, "백 거의 승", "White nearly wins", "triangle", "#ef5a25"),
  grade(-5, "백승", "White wins", "cross", "#e5322d"),
];

export const MIN_CODE = -5;
export const MAX_CODE = 5;

/** 등급은 4수 · 5수 뒤의 국면에 붙는다(실린 자료는 전부 5수). */
export const GRADE_PLIES = { min: 4, max: 5 } as const;
export const isGradePly = (n: number): boolean => n >= GRADE_PLIES.min && n <= GRADE_PLIES.max;

export const gradeOf = (code: number | null | undefined): Grade | null =>
  code == null ? null : (LADDER.find((g) => g.code === code) ?? null);

export interface OpeningNameRow {
  readonly ko: string;
  readonly en: string | null;
}

/** 읽어 들인 두 표. */
export interface OpeningTables {
  readonly names: ReadonlyMap<string, OpeningNameRow>;
  readonly evals: ReadonlyMap<string, number>;
}

export const EMPTY_TABLES: OpeningTables = { names: new Map(), evals: new Map() };

/** 쓰지 못한 줄 수 — 「N줄 무시」 안내용. */
export interface Load<T> {
  readonly rows: Map<string, T>;
  readonly bad: number;
}

/**
 * `"h8 h9 g9"` → 수, 읽을 수 없는 토큰이 하나라도 있으면 `null`. 일부러 엄격하다 — 손으로
 * 고치는 파일이라 반쯤 읽힌 줄은 건너뛴 줄보다 나쁘다. 소문자만 받는다(파일 형식 그대로).
 */
export function parseMoves(text: string, size = DEFAULT_SIZE): Move[] | null {
  const out: Move[] = [];
  for (const tok of text.trim().split(/[ \t]/)) {
    if (tok === "") continue;
    if (tok.length < 2 || tok.length > 3) return null;
    const x = tok.charCodeAt(0) - 97;
    const rowText = tok.slice(1);
    if (!/^[+-]?\d+$/.test(rowText)) return null;
    const row = Number(rowText);
    if (x < 0 || x >= size || row < 1 || row > size) return null;
    out.push(move(x, size - row));
  }
  return out;
}

/** 두 파일이 함께 쓰는 모양: UTF-8 BOM, CRLF, `#` 주석, 빈 줄, 탭으로 나뉜 3~4칸.
 *  칸이 모자란 줄은 `null` 로 넘겨 각 파서가 버린 줄로 센다(조용히 잃지 않는다). */
function forEachRow(text: string, body: (f: [string, string, string, string] | null) => void) {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  for (const raw of src.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 3) {
      body(null);
      continue;
    }
    body([f[0]!, f[1]!.trim(), f[2]!.trim(), (f[3] ?? "").trim()]);
  }
}

const plyOf = (s: string): number | null => (/^\s*[+-]?\d+\s*$/.test(s) ? Number(s) : null);

/**
 * `<수>\t<프레임 키>\t<한글>\t<English>`. 키는 좌표로 다시 계산한다 — 손으로 돌려 적은
 * 줄도 제자리에 앉는다. 같은 키가 두 번 나오면 **첫 줄**이 이긴다(파일 순서와 무관하게).
 */
export function parseNames(text: string, size = DEFAULT_SIZE): Load<OpeningNameRow> {
  const rows = new Map<string, OpeningNameRow>();
  let bad = 0;
  forEachRow(text, (f) => {
    const moves = f ? parseMoves(f[1], size) : null;
    const ok =
      f !== null &&
      moves !== null &&
      moves.length > 0 &&
      moves.length <= MAX_PLY &&
      plyOf(f[0]) === moves.length &&
      f[2] !== "";
    const key = ok ? frameKeyOf(moves, size) : null;
    if (!ok || key === null) {
      bad++;
      return;
    }
    if (!rows.has(key)) rows.set(key, { ko: f[2], en: f[3] === "" ? null : f[3] });
  });
  return { rows, bad };
}

/**
 * `<수>\t<대표 수순>\t<등급>\t<비고>`. 둘째 칸은 **키가 아니라** 대표 수순이고, 키는 그
 * 수순의 `PosKey` 다. 그 한 걸음이 환원 병합의 전부다 — 같은 돌의 다른 수순도 똑같이
 * 이 줄을 찾는다.
 */
export function parseEvals(text: string, size = DEFAULT_SIZE): Load<number> {
  const rows = new Map<string, number>();
  let bad = 0;
  forEachRow(text, (f) => {
    const moves = f ? parseMoves(f[1], size) : null;
    const g = f ? f[2].replace(/^\+/, "") : "";
    const code = /^-?\d+$/.test(g) ? Number(g) : null;
    if (
      f === null ||
      moves === null ||
      code === null ||
      !isGradePly(moves.length) ||
      plyOf(f[0]) !== moves.length ||
      code < MIN_CODE ||
      code > MAX_CODE
    ) {
      bad++;
      return;
    }
    const key = posKeyOf(moves, size);
    if (!rows.has(key)) rows.set(key, code);
  });
  return { rows, bad };
}
