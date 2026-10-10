import { move, sameMove, type Move } from "../model/move";
import { pick, t } from "../../i18n/i18n";

/**
 * 26주형 — 앱 `core/model/Opening26.kt` 의 이식(원본은 데스크톱 `mo_opening26` 분류기와
 * `tools/freq35.py` 의 이름 표). **순수 계산**이라 RenjuNet 자료가 한 바이트도 없다 —
 * 팩 없이 늘 동작한다.
 *
 * 0..12 는 직접(直, D1..D13 — 2수가 H9), 13..25 는 간접(間, I1..I13 — 2수가 I9).
 * `NONSTD`(=26)는 첫 세 수가 개시 규칙을 따르지 않는다는 뜻이다.
 *
 * 좌표는 `Move` 의 것(y 가 위→아래, 천원 = (7,7)). 그래서 H9 = (7,6), I9 = (8,6).
 */
export const COUNT = 26;
export const NONSTD = 26;
const BS = 15;
const CTR = 7;

/** "D1".."D13","I1".."I13" — freq35 의 OPABBR. */
export const ABBR: readonly string[] = [
  ...Array.from({ length: 13 }, (_, i) => `D${i + 1}`),
  ...Array.from({ length: 13 }, (_, i) => `I${i + 1}`),
];

/** 한글 이름 — freq35 OPKO. (유성이 D13 과 I5 에 두 번 나오는 것까지 원본 그대로.) */
// prettier-ignore
export const KOREAN: readonly string[] = [
  "한성", "계월", "소성", "화월", "잔월", "우월", "금성", "송월", "구월",
  "신월", "서성", "산월", "유성", "장성", "협월", "항성", "수월", "유성",
  "운월", "포월", "람월", "은월", "명성", "사월", "명월", "혜성",
];

/** 로마자 이름 — freq35 OPROMAJI. */
// prettier-ignore
export const ROMAJI: readonly string[] = [
  "Kansei", "Keigetsu", "Sosei", "Kagetsu", "Zangetsu", "Ugetsu", "Kinsei",
  "Shogetsu", "Kyugetsu", "Shingetsu", "Zuisei", "Sangetsu", "Yusei",
  "Chosei", "Kyogetsu", "Kosei", "Suigetsu", "Ryusei", "Ungetsu", "Hogetsu",
  "Rangetsu", "Gingetsu", "Myojo", "Shagetsu", "Meigetsu", "Suisei",
];

/** 3수의 천원 기준 오프셋 (dy, dx), y 아래로 — freq35 의 DTBL / ITBL. */
// prettier-ignore
const DTBL: readonly (readonly [number, number])[] = [
  [-2, 0], [-2, -1], [-2, -2], [-1, -1], [-1, -2], [0, -1], [0, -2],
  [1, 0], [1, -1], [1, -2], [2, 0], [2, -1], [2, -2],
];
// prettier-ignore
const ITBL: readonly (readonly [number, number])[] = [
  [-2, 2], [-2, 1], [-2, 0], [-2, -1], [-2, -2], [-1, 0], [-1, -1],
  [-1, -2], [0, -1], [0, -2], [1, -1], [1, -2], [2, -2],
];

const H9 = move(CTR, CTR - 1);
const I9 = move(CTR + 1, CTR - 1);
const CENTER = move(CTR, CTR);

/** 주형 `index` 의 대표 첫 세 수(작은 판 그림용). */
export function representative(index: number): Move[] {
  if (index < 0 || index >= COUNT) throw new RangeError(`opening index ${index}`);
  const [dy, dx] = index < 13 ? DTBL[index]! : ITBL[index - 13]!;
  return [CENTER, index < 13 ? H9 : I9, move(CTR + dx, CTR + dy)];
}

export const isDirect = (index: number): boolean => index < 13;

/** 사람이 읽는 이름 — 한국어 화면은 한글, 영어 화면은 로마자(W10). */
export const nameOf = (index: number): string => pick(KOREAN[index], ROMAJI[index]) ?? "";

/** 예 "D1 한성 (Kansei)". */
export const labelOf = (index: number): string =>
  index === NONSTD
    ? t("기타 (규칙외)")
    : pick(`${ABBR[index]} ${KOREAN[index]} (${ROMAJI[index]})`, `${ABBR[index]} ${ROMAJI[index]}`);

/** "D1".."I13" → 0..25, 모르면 `NONSTD`. */
export function indexOfAbbr(a: string): number {
  const i = ABBR.indexOf(a);
  return i >= 0 ? i : NONSTD;
}

// ---- 분류기 (freq35.opening3 / main.c mo_opening26 의 이식) ----

/** `moveorder.h` 순서의 8 대칭, (y, x) 위에서. `PosKey.tf` 와 번호가 **다르다**. */
function xform(t: number, y: number, x: number): [number, number] {
  const b = BS - 1;
  switch (t) {
    case 0:
      return [y, x];
    case 1:
      return [x, b - y];
    case 2:
      return [b - y, b - x];
    case 3:
      return [b - x, y];
    case 4:
      return [y, b - x];
    case 5:
      return [b - y, x];
    case 6:
      return [x, y];
    default:
      return [b - x, b - y];
  }
}

/** 정규 3수 (종류, y, x) → 주형 번호. */
const OP_MAP = new Map<string, number>([
  ...DTBL.map(([dy, dx], i) => [`0,${CTR + dy},${CTR + dx}`, i] as const),
  ...ITBL.map(([dy, dx], i) => [`1,${CTR + dy},${CTR + dx}`, 13 + i] as const),
]);

/**
 * 첫 세 수를 0..25 로, 아니면 `NONSTD`. 1수가 천원이고 어떤 대칭 아래 2수가 H9(직접)나
 * I9(간접)에 올 때만 — 그런 후보 가운데 가장 작은 것이 이긴다(데스크톱과 같다).
 */
export function classify(moves: readonly Move[]): number {
  if (moves.length < 3 || !sameMove(moves[0]!, CENTER)) return NONSTD;
  const m1 = moves[1]!;
  const m2 = moves[2]!;
  let best: [number, number, number] | null = null;
  for (let t = 0; t < 8; t++) {
    const [wy, wx] = xform(t, m1.y, m1.x);
    let type: number;
    if (wy === H9.y && wx === H9.x) type = 0;
    else if (wy === I9.y && wx === I9.x) type = 1;
    else continue;
    const [ty, tx] = xform(t, m2.y, m2.x);
    const cand: [number, number, number] = [type, ty, tx];
    if (best === null || less(cand, best)) best = cand;
  }
  return best ? (OP_MAP.get(best.join(",")) ?? NONSTD) : NONSTD;
}

function less(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}
