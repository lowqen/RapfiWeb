/**
 * 한 점. 앱의 `core/model/Move.kt` 에서 웹이 지금 필요한 만큼만.
 *
 * 좌표계는 **엔진의 것**이다: `x` 는 왼→오른쪽 0..n-1, `y` 는 위→아래 0..n-1.
 * 화면 좌표와 같은 방향이라 렌더러가 뒤집을 일이 없다. 사람이 읽는 표기
 * (`H8` 같은 것)만 `y` 를 뒤집는다 — 그 변환은 `label()` 한 곳에만 있다.
 */
export interface Move {
  readonly x: number;
  readonly y: number;
}

export const DEFAULT_SIZE = 15;

export const move = (x: number, y: number): Move => ({ x, y });

export const sameMove = (a: Move | null, b: Move | null): boolean =>
  a != null && b != null && a.x === b.x && a.y === b.y;

/** 맵/집합 키. 좌표 두 개를 하나의 정수로 — 문자열 키보다 싸고 충돌이 없다. */
export const moveKey = (m: Move, size = DEFAULT_SIZE): number => m.y * size + m.x;

export const fromKey = (key: number, size = DEFAULT_SIZE): Move => ({
  x: key % size,
  y: Math.floor(key / size),
});

/**
 * 사람이 읽는 표기: 열은 `A`부터, 행은 **아래에서 위로** 1부터.
 * 보드 여백에 그리는 좌표와 같은 규칙이다(`drawLabels`).
 */
export const label = (m: Move, size = DEFAULT_SIZE): string =>
  `${String.fromCharCode(65 + m.x)}${size - m.y}`;

export const inBoard = (m: Move, size = DEFAULT_SIZE): boolean =>
  m.x >= 0 && m.y >= 0 && m.x < size && m.y < size;

/** 판 한가운데(15×15 에서 H8 = 천원). */
export const center = (size = DEFAULT_SIZE): Move => move(size >> 1, size >> 1);

/**
 * 국면 키 — 수순 그대로의 문자열(`"112,96,…"`, 빈 판은 `""`). 엔진의 분석 결과가
 * **어느 국면의 것인지** 붙여 두는 꼬리표다. 무르기·앞으로·새 판으로 국면이 바뀐 뒤
 * 옛 국면의 값 칩·PV·평가가 새 판에 얹히지 않게 화면이 이 키로 맞춰 본다.
 *
 * 수순(순서)까지 같아야 같은 키다 — 같은 돌 배치라도 수순이 다르면 기보가 다르고,
 * 형세 그래프의 한 점은 기보의 한 수다.
 */
export const positionKey = (moves: readonly Move[], size = DEFAULT_SIZE): string =>
  moves.map((m) => moveKey(m, size)).join(",");

/** `ancestor` 가 `key` 와 같거나 그 앞 국면(수순의 머리)인가. 빈 판은 모든 국면의 머리다. */
export const isSameOrAncestorKey = (ancestor: string, key: string): boolean =>
  ancestor === key || ancestor === "" || key.startsWith(ancestor + ",");
