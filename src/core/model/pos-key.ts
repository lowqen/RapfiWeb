import { DEFAULT_SIZE, move, type Move } from "./move";

/**
 * 국면 키 — 앱 `core/model/PosKey.kt` 의 이식(그 원본은 데스크톱 `web_poskey_n()` /
 * `web_tf()` / `web_tf_inv()`, main.c:4670-4736).
 *
 * 키는 8대칭 가운데 **사전순으로 가장 작은 직렬화**다: `"<size>"` 뒤에 돌마다
 * `"<열><행><b|w>"` 를 (변환한) 보드 인덱스 순서로 잇고, 색은 수순의 홀짝으로 정한다.
 * 그래서 한 수순의 회전·거울상이 모두 한 키로 접힌다 — 오프닝 탐색기 · 수순 · 정석
 * 역조회가 기대는 성질이다.
 *
 * **이것이 다섯 번째 구현이다** — `main.c web_poskey()`, `Yixin-Board/tests/test_webkey.c`,
 * `rifdb/rifkey.py`, Zenyth `PosKey.kt`. `rifdb/rif_crosscheck.py --emit` 이 앞의 셋이
 * 합의한 값을 `testdata/poskey_golden.txt` 에도 쓰고, `pos-key.test.ts` 가 그것을 읽는다.
 * 어느 하나를 고치면 교차검증을 다시 돌려야 한다(test-yixin/docs/개발_핸드북.md §2-6).
 *
 * 원본이 일부러 지키는 두 가지를 그대로 지킨다:
 * 1. 후보를 보드 인덱스가 아니라 **문자열로** 비교한다 — `"10" < "2"` 라서 인덱스 순서로
 *    비교하면 다른 대칭을 고른다.
 * 2. 동률이면 **가장 작은 변환 번호**를 남긴다(데스크톱은 엄격한 `<` 에서만 바꾼다).
 *    `transform` 은 팩에 저장된 다음 수를 판 위로 되돌리는 데 쓰이므로, 동률을 반대로
 *    깨면 키는 맞는데 수가 엉뚱한 자리에 그려진다.
 */

/** 빈 판의 키 — 팩이 전체 합계를 이 키 아래 둔다. */
export const emptyKey = (size = DEFAULT_SIZE): string => String(size);

/**
 * 대칭 변환 `t`(0..7) — 키 탐색이 도는 바로 그 표. `web_tf` 의 이식이고,
 * `moveorder.h` 의 변환 번호와는 **다르다**(군의 원소 순서가 다르다).
 */
export function tf(t: number, size: number, m: Move): Move {
  const s = size - 1;
  const { x, y } = m;
  switch (t) {
    case 0:
      return move(x, y);
    case 1:
      return move(s - x, y);
    case 2:
      return move(x, s - y);
    case 3:
      return move(s - x, s - y);
    case 4:
      return move(y, x);
    case 5:
      return move(s - y, x);
    case 6:
      return move(y, s - x);
    default:
      return move(s - y, s - x);
  }
}

/** `t` 를 되돌리는 변환 — 5 와 6 만 서로의 역이고 나머지는 자기 자신이 역이다. */
export const inverse = (t: number): number => (t === 5 ? 6 : t === 6 ? 5 : t);

/** 키, 그것을 낸 대칭, 그리고 그 키와 동률인 모든 대칭. */
export interface Canonical {
  readonly key: string;
  readonly transform: number;
  /** 대칭 *t* 가 같은 키를 내면 *t* 번째 비트가 켜진다. 결코 0 이 아니다. */
  readonly stabiliser: number;
}

function serialize(t: number, moves: readonly Move[], size: number): string {
  // (보드 인덱스, 색)을 인덱스 순으로 — 데스크톱의 삽입 정렬. 한 칸에 돌은 하나라
  // 인덱스가 모두 달라 정렬의 안정성은 아무것도 정하지 않는다.
  const stones = moves
    .map((m, i) => {
      const p = tf(t, size, m);
      return { idx: p.y * size + p.x, col: i % 2 === 1 ? "w" : "b" };
    })
    .sort((a, b) => a.idx - b.idx);
  let out = String(size);
  for (const { idx, col } of stones) {
    out += String.fromCharCode(97 + (idx % size)) + String(size - Math.floor(idx / size)) + col;
  }
  return out;
}

/**
 * 키 + 채택한 대칭 + **안정자**(같은 키를 내는 모든 대칭). 팩을 모을 때는 안정자가
 * 필요하고 조회에는 필요 없다 — 다음 수를 그 국면의 대칭으로 접어 하나의 대표로
 * 불러야 전치를 합칠 수 있기 때문이다(`rifdb/rifkey.py canon_next`).
 *
 * 키와 채택 대칭이 이 한 루프에서 나오므로 `of` 와 어긋날 수 없다.
 */
export function canonical(moves: readonly Move[], size = DEFAULT_SIZE): Canonical {
  let best: string | null = null;
  let bestT = 0;
  let stabiliser = 0;
  for (let t = 0; t < 8; t++) {
    const cur = serialize(t, moves, size);
    // JS 의 문자열 비교는 UTF-16 코드 단위 순 — 키는 ASCII 뿐이라 Kotlin
    // `String.compareTo` · C `strcmp` 와 같은 순서다.
    if (best === null || cur < best) {
      best = cur;
      bestT = t;
      stabiliser = 1 << t;
    } else if (cur === best) {
      stabiliser |= 1 << t;
    }
  }
  return { key: best ?? emptyKey(size), transform: bestT, stabiliser };
}

/** 조회 결과 — 키와 그것을 낸 대칭. */
export interface PosKeyResult {
  readonly key: string;
  readonly transform: number;
}

/**
 * 키 + 그것을 낸 대칭. 팩의 추천 수는 그 대칭의 프레임으로 나오므로
 * `toBoard(result, cell)` 로 판 위에 되돌린다.
 */
export function of(moves: readonly Move[], size = DEFAULT_SIZE): PosKeyResult {
  const c = canonical(moves, size);
  return { key: c.key, transform: c.transform };
}

/** 키만 — 수를 되돌릴 일이 없는 호출부용. */
export const keyOf = (moves: readonly Move[], size = DEFAULT_SIZE): string =>
  canonical(moves, size).key;

/** 키의 정규 프레임에 있는 칸을 판 위로 되돌린다. */
export const toBoard = (r: PosKeyResult, cell: Move, size = DEFAULT_SIZE): Move =>
  tf(inverse(r.transform), size, cell);

/**
 * `stabiliser` 아래에서 `m` 의 궤도 대표 — 가장 작은 **보드 인덱스**의 상(가장 작은
 * 문자열이 아니다).
 *
 * 인덱스 순서는 일부러다: 키는 직렬화를 문자열로 비교하지만(`"10" < "2"`), 다음 수는
 * 칸이고 `rifkey.canon_next` 는 칸을 `y * size + x` 로 줄 세운다. 여기서 문자열 규칙을
 * 쓰면 다른 대표를 골라 한 이음수가 둘로 갈라진다.
 */
export function canonNext(stabiliser: number, m: Move, size = DEFAULT_SIZE): Move {
  let best: Move | null = null;
  let bestIdx = Number.MAX_SAFE_INTEGER;
  for (let t = 0; t < 8; t++) {
    if ((stabiliser & (1 << t)) === 0) continue;
    const p = tf(t, size, m);
    const idx = p.y * size + p.x;
    if (idx < bestIdx) {
      bestIdx = idx;
      best = p;
    }
  }
  return best ?? m;
}
