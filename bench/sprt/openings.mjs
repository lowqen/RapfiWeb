/**
 * 렌주 26개 표준 개시 — SPRT 러너(runner.mjs)와 필승 국면 생성기(gomocalc/make-positions.mjs)가 같이 쓴다.
 *
 * 흑 h8 · 백 h9(직접) 또는 i9(간접) 뒤, 셋째 수를 천원 둘레 5×5 안에 두는 자리를 **대칭으로 묶은 것**이
 * 정확히 13 + 13 이다. 직접은 h 줄 거울(x → 14 − x), 간접은 h8–i9 대각선 거울((x, y) → (14 − y, 14 − x))이
 * 앞의 두 돌을 그대로 둔다. 좌표는 프로토콜 그대로 [x, y](0 기준, y 는 위에서 아래로).
 */

/** 사람이 읽는 좌표(h8). y 는 위에서 아래로 자라므로 표기는 15-y. */
export const label = ([x, y]) => `${"abcdefghijklmno"[x]}${15 - y}`;

/** @returns {Record<string, [number, number][]>} 이름(`direct-f10` 등) → 세 수 */
export function standardOpenings() {
  const out = {};
  const bases = {
    direct: { two: [7, 6], mirror: ([x, y]) => [14 - x, y] },
    indirect: { two: [8, 6], mirror: ([x, y]) => [14 - y, 14 - x] },
  };
  const key = ([x, y]) => y * 15 + x;
  for (const [kind, { two, mirror }] of Object.entries(bases)) {
    let n = 0;
    for (let y = 5; y <= 9; y++) {
      for (let x = 5; x <= 9; x++) {
        if ((x === 7 && y === 7) || (x === two[0] && y === two[1])) continue;
        if (key([x, y]) > key(mirror([x, y]))) continue; // 거울상 쪽이 대표
        out[`${kind}-${label([x, y])}`] = [[7, 7], two, [x, y]];
        n++;
      }
    }
    if (n !== 13) throw new Error(`${kind} 개시가 13개가 아닙니다: ${n}`);
  }
  return out;
}

/**
 * 개시 묶음 파일(make-openings.mjs 가 만든 JSON — `{ openings: [{ name, moves }] }`)을 읽는다.
 * @returns {Record<string, [number, number][]>}
 */
export function loadOpenings(json) {
  const list = Array.isArray(json) ? json : json.openings;
  if (!Array.isArray(list) || !list.length) throw new Error("개시 파일에 openings 가 없습니다");
  const out = {};
  for (const o of list) {
    if (!o.name || !Array.isArray(o.moves) || !o.moves.length)
      throw new Error(`개시 형식이 아닙니다: ${JSON.stringify(o)}`);
    if (out[o.name]) throw new Error(`개시 이름이 겹칩니다: ${o.name}`);
    out[o.name] = o.moves.map(([x, y]) => [x, y]);
  }
  return out;
}

/** 판 가운데(7, 7)를 지키는 8가지 대칭 */
export const SYMMETRIES = [
  ([x, y]) => [x, y],
  ([x, y]) => [14 - x, y],
  ([x, y]) => [x, 14 - y],
  ([x, y]) => [14 - x, 14 - y],
  ([x, y]) => [y, x],
  ([x, y]) => [14 - y, x],
  ([x, y]) => [y, 14 - x],
  ([x, y]) => [14 - y, 14 - x],
];

/** 국면의 대칭 대표 키 — 흑 · 백 돌 집합만 본다(두어진 순서는 무시) */
export function canonicalKey(moves) {
  let best = null;
  for (const t of SYMMETRIES) {
    const tm = moves.map(t);
    const side = (c) =>
      tm
        .filter((_, i) => i % 2 === c)
        .map(([x, y]) => y * 15 + x)
        .sort((a, b) => a - b)
        .join(",");
    const k = `${side(0)}|${side(1)}`;
    if (best === null || k < best) best = k;
  }
  return best;
}
