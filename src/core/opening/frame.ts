import { DEFAULT_SIZE, move, type Move } from "../model/move";
import { tf } from "../model/pos-key";

/**
 * 오프닝 명칭의 정체성 — 앱 `OpeningName.kt` 의 **프레임 키** 부분(원본은 데스크톱
 * `Yixin-Board/openname.h`).
 *
 * **이것은 `PosKey` 가 아니다.** 탐색기의 국면 키는 전치를 한 줄로 합치려고 수순을
 * 일부러 버리지만, 이름은 그럴 수 없다 — *백 2수가 어느 돌이었나* 가 바로 화월과
 * 다른 주형을 가르기 때문이다. 그래서 이름은 수순을 보존하는 제 키를 갖는다.
 *
 * **프레임.** 한 수순의 8대칭 배치 가운데 1수가 천원, 2수가 `h9`(직접)나 `i9`(간접)에
 * 오는 것만 남긴다 — 렌주 그림을 그리는 바로 그 틀이고 `opening26` 도 같은 정규화를
 * 쓴다. 정확히 둘이 살아남고(h9 · i9 의 안정자 차수가 2), 동률은 수순을 보드 인덱스로
 * 읽어 가장 작은 쪽이 가져간다. 키는 그 틀의 수 목록(예 `"h8 h9 g9 g8"`)이다.
 *
 * `PosKey` 와 헷갈리지 말 것 둘:
 * 1. 후보를 직렬화 문자열이 아니라 **보드 인덱스**로 비교한다 — `mo_opening26` 이
 *    최소화하는 순서이고, 그래야 이 키의 3수 머리와 26주형 분류가 어긋나지 않는다.
 * 2. 변환 번호는 `web_tf` 의 것(`PosKey.tf` 와 같다)이지 `moveorder.h` 의 것이 아니다.
 *
 * `openname.h` · `rifdb/rifkey.py` · 앱 `OpeningName.kt` 에 이은 **네 번째 구현**이다.
 * `rifdb/rif_crosscheck.py` 가 만든 골든(`testdata/openname_golden.txt`)이 묶어 둔다.
 */

/** 이름은 첫 네 수까지만 있다 — 렌주에는 5수 · 6수의 모양별 이름이 없다. */
export const MAX_PLY = 4;

/**
 * 프레임은 이름보다 한 수 더 간다. 5수에는 이름이 없지만 평가(흑 5수 유불리)가 있고,
 * 그 표의 한 줄을 가리키려면 5수 수순의 정체성이 필요하다. 키에 머리 성질이 있어
 * (5수 키의 앞 넷은 언제나 4수 키) 안전하다.
 */
export const FRAME_PLY = 5;

export type Move2Kind = "none" | "direct" | "indirect";

/** 프레임 대칭 + 틀에 넣은 수순. */
export interface Frame {
  readonly transform: number;
  readonly key: string;
}

const cellIndex = (m: Move, size: number) => m.y * size + m.x;

const framed = (t: number, size: number, moves: readonly Move[]): number[] =>
  moves.map((m) => cellIndex(tf(t, size, m), size));

function less(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/** 프레임 대칭, 프레임이 없으면 -1. */
export function frameTransform(moves: readonly Move[], size = DEFAULT_SIZE): number {
  if (size % 2 === 0 || size < 5 || moves.length < 1 || moves.length > FRAME_PLY) return -1;
  const half = Math.floor(size / 2);
  const centre = half * size + half;
  if (cellIndex(moves[0]!, size) !== centre) return -1;
  if (moves.length === 1) return 0; // 천원 혼자는 여덟 대칭 모두에 고정된다
  const direct = (half - 1) * size + half; // h9
  const indirect = direct + 1; // i9
  let best = -1;
  let bestSeq: number[] = [];
  for (let t = 0; t < 8; t++) {
    const seq = framed(t, size, moves);
    if (seq[1] !== direct && seq[1] !== indirect) continue;
    if (best < 0 || less(seq, bestSeq)) {
      best = t;
      bestSeq = seq;
    }
  }
  return best;
}

const cellName = (c: number, size: number) =>
  String.fromCharCode(97 + (c % size)) + String(size - Math.floor(c / size));

/** `"h8 h9 g9 g8"` + 그 대칭, 프레임이 없으면 `null`. */
export function frameOf(moves: readonly Move[], size = DEFAULT_SIZE): Frame | null {
  const t = frameTransform(moves, size);
  if (t < 0) return null;
  return {
    transform: t,
    key: framed(t, size, moves)
      .map((c) => cellName(c, size))
      .join(" "),
  };
}

/** 키만, 없으면 `null`. `opening_names.txt` 조회가 쓴다. */
export const keyOf = (moves: readonly Move[], size = DEFAULT_SIZE): string | null =>
  frameOf(moves, size)?.key ?? null;

/** 2수가 직각으로 막았나(직접막기) 대각으로 막았나(간접막기). */
export function move2Kind(moves: readonly Move[], size = DEFAULT_SIZE): Move2Kind {
  if (moves.length < 2) return "none";
  const t = frameTransform(moves.slice(0, FRAME_PLY), size);
  if (t < 0) return "none";
  const half = Math.floor(size / 2);
  const direct = (half - 1) * size + half;
  return framed(t, size, moves.slice(0, 2))[1] === direct ? "direct" : "indirect";
}

// ---- 환원 (transpositions) ------------------------------------------

/**
 * 1~3수를 담는 가운데 5×5. 렌주의 **규칙**이고 첫 세 수만 묶는다 — 4수의 한계가
 * *아니다*(그 착각이 한때 한성의 h11 을 숨겼다). `ON_RULEBOX` 와 같다.
 */
export const RULE_BOX = 2;

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = items.filter((_, j) => j !== i);
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

function compareLists(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (i >= b.length) return 1;
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/**
 * `moves` 와 **같은 돌, 같은 색**에 이르는 모든 합법 렌주 수순 — 순서만 다르다. 틀에
 * 넣은 수순으로, 보드 인덱스 순으로, 자기 자신의 틀까지 포함해 돌려준다.
 *
 * 두 키를 설명하는 목록이다: 여기 있는 것은 모두 한 판이라 평가는 하나여야 하고, 이름은
 * 줄마다 달라도 된다. 저장하는 것은 없다 — 3!×2! 는 열두 후보이고 거름이 나머지를 한다.
 */
export function transpositions(moves: readonly Move[], size = DEFAULT_SIZE): Move[][] {
  if (moves.length < 1 || moves.length > FRAME_PLY) return [];
  const centre = Math.floor(size / 2);
  const black = moves.filter((_, i) => i % 2 === 0);
  const white = moves.filter((_, i) => i % 2 === 1);
  const seen = new Map<string, { cells: number[]; line: Move[] }>();
  for (const pb of permutations(black)) {
    for (const pw of permutations(white)) {
      const seq = moves.map((_, i) => (i % 2 === 0 ? pb[i >> 1]! : pw[i >> 1]!));
      const outOfBox = seq
        .slice(0, 3)
        .some((m) => Math.abs(m.x - centre) > RULE_BOX || Math.abs(m.y - centre) > RULE_BOX);
      if (outOfBox) continue;
      const t = frameTransform(seq, size);
      if (t < 0) continue;
      const cells = framed(t, size, seq);
      const id = cells.join(",");
      if (!seen.has(id)) {
        seen.set(id, { cells, line: cells.map((c) => move(c % size, Math.floor(c / size))) });
      }
    }
  }
  return [...seen.values()].sort((a, b) => compareLists(a.cells, b.cells)).map((v) => v.line);
}
