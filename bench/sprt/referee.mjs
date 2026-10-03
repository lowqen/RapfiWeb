/**
 * 렌주 판정 — 러너가 엔진의 수를 받을 때마다 부른다.
 *
 * 순서(렌주 규칙 그대로):
 *   1. 판 밖 · 이미 돌이 있는 자리 → 둔 쪽 패(illegal)
 *   2. 흑: **정확히 다섯** → 흑 승. 오목은 금수보다 앞선다(5 를 만들면서 3-3 이어도 승).
 *   3. 흑: 금수(3-3 · 4-4 · 장목) → 흑 패(forbidden).
 *      3-3 · 4-4 판정은 직접 짜지 않는다 — 앱(src/core/model/referee.ts)과 같은 이유로, **심판 엔진**
 *      (두 선수와 따로 띄운 프로세스)에게 그 국면의 금수 목록을 묻는다(YXSHOWFORBID). 심판이 없으면
 *      장목만 우리가 잡고, 3-3 · 4-4 는 잡지 못한다고 결과에 적는다.
 *   4. 백: 다섯 이상 → 백 승.
 *   5. 판이 다 참 · 수 제한 → 비김.
 */
export const SIZE = 15;
const AXES = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export const BLACK = 1;
export const WHITE = 2;

export class Board {
  constructor(moves = []) {
    this.cells = new Int8Array(SIZE * SIZE);
    this.moves = [];
    for (const m of moves) this.place(m);
  }
  get toMove() {
    return this.moves.length % 2 === 0 ? BLACK : WHITE;
  }
  inside([x, y]) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < SIZE && y < SIZE;
  }
  at([x, y]) {
    return this.cells[y * SIZE + x];
  }
  place(m) {
    if (!this.inside(m) || this.at(m) !== 0) throw new Error(`둘 수 없는 자리: ${m}`);
    this.cells[m[1] * SIZE + m[0]] = this.toMove;
    this.moves.push(m);
  }
  /** 방금 둔 돌을 지나는 네 축의 연속 길이 */
  runs([x, y]) {
    const c = this.at([x, y]);
    return AXES.map(([dx, dy]) => {
      let n = 1;
      for (const s of [1, -1]) {
        let px = x + dx * s;
        let py = y + dy * s;
        while (this.inside([px, py]) && this.at([px, py]) === c) {
          n++;
          px += dx * s;
          py += dy * s;
        }
      }
      return n;
    });
  }
}

/**
 * 수 하나를 판정한다. `board` 는 둔 뒤의 상태로 바뀐다(불법이면 그대로).
 * @param {Board} board
 * @param {[number, number]} move
 * @param {{ forbidden?: (moves: [number, number][]) => Promise<[number, number][]> | null }} judge
 *        흑 차례 국면의 금수 목록을 주는 함수(심판 엔진). null 이면 장목만 잡는다.
 * @param {number} maxPlies
 * @returns {Promise<null | { winner: 1 | 2 | null, reason: string }>} 판이 끝났으면 결과
 */
export async function judgeMove(board, move, { forbidden = null } = {}, maxPlies = SIZE * SIZE) {
  const mover = board.toMove;
  const other = mover === BLACK ? WHITE : BLACK;
  if (!board.inside(move) || board.at(move) !== 0) return { winner: other, reason: "illegal" };

  // 금수 목록은 **두기 전** 국면(흑 차례)에서 묻는다.
  const forbid = mover === BLACK && forbidden ? await forbidden(board.moves) : null;

  board.place(move);
  const runs = board.runs(move);
  if (mover === BLACK) {
    if (runs.includes(5)) return { winner: BLACK, reason: "five" };
    if (forbid) {
      if (forbid.some(([x, y]) => x === move[0] && y === move[1]))
        return { winner: WHITE, reason: "forbidden" };
    } else if (runs.some((n) => n > 5)) {
      return { winner: WHITE, reason: "forbidden(overline)" };
    }
  } else if (runs.some((n) => n >= 5)) {
    return { winner: WHITE, reason: "five" };
  }
  if (board.moves.length >= SIZE * SIZE) return { winner: null, reason: "board-full" };
  if (board.moves.length >= maxPlies) return { winner: null, reason: "max-plies" };
  return null;
}
