import { DEFAULT_SIZE, type Move } from "../model/move";
import { tf } from "../model/pos-key";

/**
 * 국면의 **64비트 정규 해시** — W7 팩(`.rif` 변환)이 국면을 세는 열쇠.
 *
 * `pos-key.ts` 의 문자열 키와 **같은 국면을 같다고 하고 다른 국면을 다르다고 한다**(같은 동치류).
 * 다른 것은 값의 모양뿐이다: 키는 8대칭 중 사전순 가장 작은 직렬화이고, 이것은 8대칭 각각의
 * Zobrist 해시(칸 × 색 난수의 XOR) 중 가장 작은 값이다. 그래서
 *
 *   - 돌 하나를 더할 때 대칭마다 XOR 한 번 — 수순을 따라 **증분으로** 센다. 문자열 키는 접두
 *     국면마다 돌 전체를 다시 직렬화해(접두 하나에 O(n log n)) 15만 판 × 20수를 세면 분 단위가
 *     되던 것이, 이것으로는 초 단위다(계획서 부록 A — W7 실측).
 *   - XOR 은 순서를 모른다 — 같은 돌 집합이면 수순이 달라도(전치) 같은 값이다. 색은 수순의
 *     홀짝으로 정하므로 키와 같은 정의다.
 *
 * **같은 칸에 두 번 둔 수순은 받지 않는다** — XOR 이라 겹친 돌이 서로 지워져 다른 국면과 같은 값이
 * 된다. 변환기는 그런 판을 버린다(앱 `RifParser.parseMoves` · `rif_import.validate_moves` 와 같은 규칙).
 *
 * 충돌: 서로 다른 국면 ~100만 개를 64비트에 담으면 생일 확률이 ~3×10⁻⁸ 이다. 대조 시험
 * (`zobrist.test.ts`)이 골든 벡터와 무작위 국면으로 «해시가 같다 ⇔ 키가 같다»를 본다.
 *
 * **대칭 번호는 `pos-key.ts tf` 의 것을 그대로 쓴다** — 그래야 `stabiliser` 비트가 같은 뜻이고
 * `canonNext`(다음 수를 정규 프레임으로 접기) · `toBoard`(되돌리기)를 그대로 빌려 쓴다. 다만
 * 해시가 고르는 **대표 대칭(`transform`)은 키의 것과 다를 수 있다** — 가장 작은 해시와 가장
 * 작은 문자열이 같은 상일 까닭이 없다. 팩 안에서는 해시의 프레임으로 일관되면 된다.
 */

const SYMS = 8;

/** 대칭 t 에서 칸 c 의 상(보드 인덱스) — `SYM[t * cells + c]`. */
function symTable(size: number): Uint8Array {
  const cells = size * size;
  const out = new Uint8Array(SYMS * cells);
  for (let t = 0; t < SYMS; t++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = tf(t, size, { x, y });
        out[t * cells + y * size + x] = p.y * size + p.x;
      }
    }
  }
  return out;
}

/**
 * 고정된 씨앗의 난수표 — 팩을 만든 기계와 읽는 기계가 같은 표를 써야 하므로 **결정적**이다.
 * 씨앗을 바꾸면 저장된 팩이 모두 무효다(`PACK_VERSION` 을 올릴 것).
 */
function randomTable(cells: number): { hi: Uint32Array; lo: Uint32Array } {
  // splitmix32 — 짧고 고르게 퍼진다. 암호용이 아니다.
  let s = 0x2545f491;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
  const hi = new Uint32Array(2 * cells);
  const lo = new Uint32Array(2 * cells);
  for (let i = 0; i < hi.length; i++) {
    hi[i] = next();
    lo[i] = next();
  }
  return { hi, lo };
}

interface Tables {
  size: number;
  cells: number;
  sym: Uint8Array;
  zHi: Uint32Array;
  zLo: Uint32Array;
}

const cache = new Map<number, Tables>();
function tables(size: number): Tables {
  let t = cache.get(size);
  if (!t) {
    const cells = size * size;
    const { hi, lo } = randomTable(cells);
    t = { size, cells, sym: symTable(size), zHi: hi, zLo: lo };
    cache.set(size, t);
  }
  return t;
}

/** 정규 해시 · 그것을 낸 대칭 · 같은 값을 내는 모든 대칭(`pos-key.Canonical` 과 같은 모양). */
export interface Canonical64 {
  readonly hi: number;
  readonly lo: number;
  readonly transform: number;
  /** 대칭 *t* 가 같은 해시를 내면 *t* 번째 비트. 결코 0 이 아니다. */
  readonly stabiliser: number;
}

/**
 * 수순을 따라 한 수씩 더하며 정규 해시를 낸다 — 변환기의 안쪽 고리. 할당 없이 돌도록
 * 결과는 필드(`hi` · `lo` · `transform` · `stabiliser`)에 둔다(`canonical()` 을 부른 뒤 읽는다).
 */
export class ZobristScanner {
  private readonly t: Tables;
  private readonly hHi = new Uint32Array(SYMS);
  private readonly hLo = new Uint32Array(SYMS);
  private ply = 0;
  hi = 0;
  lo = 0;
  transform = 0;
  stabiliser = 1;

  constructor(size = DEFAULT_SIZE) {
    this.t = tables(size);
  }

  reset(): void {
    this.hHi.fill(0);
    this.hLo.fill(0);
    this.ply = 0;
  }

  /** 보드 인덱스(`y * size + x`) 하나 — 색은 지금까지 둔 수의 홀짝(흑부터). */
  push(cell: number): void {
    const { cells, sym, zHi, zLo } = this.t;
    const colorBase = (this.ply & 1) * cells;
    for (let s = 0; s < SYMS; s++) {
      const k = colorBase + sym[s * cells + cell]!;
      this.hHi[s] = (this.hHi[s]! ^ zHi[k]!) >>> 0;
      this.hLo[s] = (this.hLo[s]! ^ zLo[k]!) >>> 0;
    }
    this.ply++;
  }

  /** 지금 국면의 정규 해시를 필드에 계산한다. */
  canonical(): this {
    let bh = this.hHi[0]!;
    let bl = this.hLo[0]!;
    let bt = 0;
    let stab = 1;
    for (let s = 1; s < SYMS; s++) {
      const h = this.hHi[s]!;
      const l = this.hLo[s]!;
      if (h < bh || (h === bh && l < bl)) {
        bh = h;
        bl = l;
        bt = s;
        stab = 1 << s;
      } else if (h === bh && l === bl) {
        stab |= 1 << s;
      }
    }
    this.hi = bh;
    this.lo = bl;
    this.transform = bt;
    this.stabiliser = stab;
    return this;
  }
}

/**
 * 판 위의 칸 하나를 **정규 프레임**으로 접는다 — `pos-key.canonNext(stabiliser, m)` 와 같은 뜻
 * (안정자의 변환들이 보내는 상 가운데 가장 작은 보드 인덱스)이되 할당이 없다. 변환기가 접두
 * 국면마다(수백만 번) 다음 수를 접는 데 쓴다.
 */
export function foldCell(stabiliser: number, cell: number, size = DEFAULT_SIZE): number {
  const { cells, sym } = tables(size);
  let best = 255;
  for (let t = 0; t < SYMS; t++) {
    if (!(stabiliser & (1 << t))) continue;
    const c = sym[t * cells + cell]!;
    if (c < best) best = c;
  }
  return best;
}

/** 수순 하나의 정규 해시 — 조회 쪽(익스플로러 · 대국 목록)이 쓴다. */
export function canonicalHash(moves: readonly Move[], size = DEFAULT_SIZE): Canonical64 {
  const z = new ZobristScanner(size);
  for (const m of moves) z.push(m.y * size + m.x);
  z.canonical();
  return { hi: z.hi, lo: z.lo, transform: z.transform, stabiliser: z.stabiliser };
}

/** (hi, lo) 를 부호 없는 64비트 순서로 견준다 — 팩의 정렬 · 이진 탐색 순서. */
export const compare64 = (aHi: number, aLo: number, bHi: number, bLo: number): number =>
  aHi !== bHi ? (aHi < bHi ? -1 : 1) : aLo !== bLo ? (aLo < bLo ? -1 : 1) : 0;
