import { inBoard, sameMove, type Move } from "./move";
import { colorAt, type GameResult, type StoneColor } from "./game";

/**
 * 승패 판정 — `core/model/Referee.kt` 의 이식본, 데스크톱 `make_move`(main.c:2211)에서 왔다.
 *
 * 방금 둔 돌에서 네 축을 훑어 각 방향 다섯 걸음까지 세고,
 * `k == 5 || (k > 5 && inforule != 1)` 에서 승리를 선언한다 — 즉 **장목은 표준
 * 오목을 뺀 모든 규칙에서 이긴다.**
 *
 * 렌주의 장목 금지는 여기 없다. 거기서는 흑의 **금수**이고, 엔진이 `FORBID` 로
 * 알려 준다 — 우리가 다시 구현하지 않는 이유다(그리고 렌주 금수 판정을 직접
 * 짜는 것은 이 프로젝트가 사려는 종류의 일이 아니다).
 */

const AXES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

function ownCells(moves: readonly Move[], color: StoneColor): Move[] {
  return moves.filter((_, i) => colorAt(i) === color);
}

const has = (cells: readonly Move[], m: Move) => cells.some((c) => sameMove(c, m));

function isWin(
  moves: readonly Move[],
  size: number,
  last: Move,
  mover: StoneColor,
  allowOverline: boolean,
): boolean {
  const own = ownCells(moves, mover);
  for (const [dx, dy] of AXES) {
    let count = 1;
    // 데스크톱은 각 방향으로 최대 다섯 걸음만 걷는다(j < 6).
    for (let step = 1; step <= 5; step++) {
      const m = { x: last.x + dx * step, y: last.y + dy * step };
      if (!inBoard(m, size) || !has(own, m)) break;
      count++;
    }
    for (let step = 1; step <= 5; step++) {
      const m = { x: last.x - dx * step, y: last.y - dy * step };
      if (!inBoard(m, size) || !has(own, m)) break;
      count++;
    }
    if (count === 5 || (count > 5 && allowOverline)) return true;
  }
  return false;
}

/**
 * 줄이 다 놓인 뒤의 결과, 아직 진행 중이면 `null`.
 * @param allowOverline `inforule != 1` — 렌주에서는 참이다(장목은 흑의 금수로 다뤄진다).
 */
export function result(
  moves: readonly Move[],
  size: number,
  allowOverline: boolean,
): GameResult | null {
  const last = moves.at(-1);
  if (!last) return null;
  const mover = colorAt(moves.length - 1);
  if (isWin(moves, size, last, mover, allowOverline)) return { end: "five", winner: mover };
  // 판이 다 차도 끝난다(main.c:2195).
  if (moves.length >= size * size) return { end: "boardFull", winner: null };
  return null;
}

/** 5목을 만든 돌들 — 승리 강조에 쓴다. */
export function winningLine(moves: readonly Move[], size: number, allowOverline: boolean): Move[] {
  const last = moves.at(-1);
  if (!last) return [];
  const mover = colorAt(moves.length - 1);
  const own = ownCells(moves, mover);
  for (const [dx, dy] of AXES) {
    const line: Move[] = [last];
    for (let step = 1; step <= 5; step++) {
      const m = { x: last.x + dx * step, y: last.y + dy * step };
      // `isWin` 과 같은 걸음이어야 한다 — 판 밖에서 멈추는 것까지 같아야
      // 「이겼다」와 「이긴 줄」이 서로 다른 답을 내지 않는다.
      if (!inBoard(m, size) || !has(own, m)) break;
      line.push(m);
    }
    for (let step = 1; step <= 5; step++) {
      const m = { x: last.x - dx * step, y: last.y - dy * step };
      if (!inBoard(m, size) || !has(own, m)) break;
      line.unshift(m);
    }
    if (line.length === 5 || (line.length > 5 && allowOverline)) return line;
  }
  return [];
}

/**
 * RIF·Soosorv-8 이 첫 세 수에 요구하는 개시 영역: 1수는 천원, 2수는 그 한 점
 * 이내, 3수는 두 점 이내 — 데스크톱이 `yxsoosorvstep2` 앞에서 하는 바운딩 박스
 * 검사다(main.c:2786).
 */
export function openingAreaOk(moves: readonly Move[], size: number): boolean {
  if (moves.length < 3) return true;
  const c = Math.floor(size / 2);
  const [m1, m2, m3] = moves as [Move, Move, Move];
  const within = (m: Move, d: number) =>
    m.x >= c - d && m.x <= c + d && m.y >= c - d && m.y <= c + d;
  return m1.x === c && m1.y === c && within(m2, 1) && within(m3, 2);
}

/**
 * 「첫 수 이후 교환」에서 엔진이 넘겨받는가. 데스크톱은 이것을 엔진에게 묻지 않고
 * 스스로 정한다(main.c:2771): 수를 좌상 사분면으로 접고, 먼 개시에서 교환하며,
 * 경계에 걸친 둘은 동전 던지기다.
 */
export function swapAfterFirstMove(move: Move, size: number, coinFlip: boolean): boolean {
  const x = Math.min(move.x, size - 1 - move.x);
  const y = Math.min(move.y, size - 1 - move.y);
  const borderline = (x === 2 && y === 3) || (x === 3 && y === 2);
  return (borderline && coinFlip) || (x > 1 && y > 1 && x + y > 5);
}
