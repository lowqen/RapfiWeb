import { DEFAULT_SIZE, move } from "../model/move";
import { NONSTD, classify } from "../opening/opening26";

/**
 * 수순 열거(환원) — 앱 `core/model/MoveOrder.kt` 의 이식(원본은 데스크톱
 * `Yixin-Board/moveorder.h`, 880줄). 수순 탐색기의 심장이다.
 *
 * 묻는 것: «지금 판의 돌을 **정확히** 만드는 수순은 무엇인가?». 수순은 `b! · w!` 로 폭발하지만
 * (20돌이면 약 13조), 그 사이의 국면 — DAG 의 마디 — 는 `C(n,w) + C(n,w+1)` = 352,716 뿐이다.
 * 그래서 아무것도 늘어놓지 않는다: DAG 를 걸으며 갈래마다 메모한 경로 수를 단다.
 *
 * 합법성 층(데스크톱이 거는 그대로):
 *   - **L0** 번갈아 두기 — 구조(짝수 수가 흑)
 *   - **L1** 중간 오목 금지(`noFive`) — 마지막 수 전에 오목이 나면 대국이 끝났을 것이다
 *   - **L3** 오프닝 규칙(`openingRule`) — 첫 네 수에서 *p+1* 수째는 천원에서 체비셰프 거리 *p* 안
 *   - **L3b** 2수 고정(`move2Fix`) — H9 / I9, 3×3 고리의 두 대칭 부류
 *
 * 렌주 금수(3-3 · 4-4 · 장목)는 **판정하지 않는다** — 데스크톱 · 앱과 같은 정직한 빈틈이다
 * (마디 수백만에 엔진 왕복 하나씩은 가망이 없다, 개발_핸드북 §8.5).
 *
 * JS 로 옮기며 바뀐 것 둘: 64비트 정수가 없어 메모 열쇠는 돌이 52개 이하면 수, 넘으면
 * 문자열이고(`keyOf`), 「몇 수째가 될 수 있나」 비트 집합은 `bigint` 다(60수까지).
 */

/** 색당 최대 돌 수 — 색별 비트마스크의 폭(`MO_MAXSTONES`). */
export const MO_MAX_STONES = 30;

/** 화면이 쓰는 마디 예산 — 변형 전체가 나눠 쓴다(`MO_GUI_NODES`). */
export const MO_GUI_NODES = 300_000;

/** DAG 의 한 갈래 — 다음에 둘 수 있는 돌. */
export interface MoveOrderChild {
  readonly cell: number;
  /** 1 = 흑, 2 = 백(데스크톱의 `col`). */
  readonly color: 1 | 2;
  /** 이 갈래를 지나는 완전한 합법 수순의 수. */
  readonly count: number;
}

/** 아직 놓지 않은 돌 — 작은 판이 그리는 모양. */
export interface MoveOrderGhost {
  readonly cell: number;
  readonly color: 1 | 2;
  /** 살아 있는 모든 배치가 이 돌을 여기 둔다 — 반투명 돌 + 수 번호. 아니면 작은 점(main.c:6365). */
  readonly common: boolean;
  /** 비트 *p* = 이 돌이 *p+1* 수째가 될 수 있다. 모르면 0. */
  readonly plies: bigint;
}

const DY = [1, 0, 1, 1];
const DX = [0, 1, 1, -1];

/** 배치 하나(D4 변형 하나)와 그 DP — `MoCtx` 의 이식. 한 줄기에서만 쓴다. */
class MoCtx {
  readonly b: number[] = [];
  readonly w: number[] = [];
  private readonly occ: Uint8Array;
  private memo = new Map<number | string, number>();
  private readonly key: (bm: number, wm: number) => number | string;
  nodes = 0;
  maxNodes = Infinity;
  overflow = false;

  constructor(
    readonly boardSize: number,
    readonly rule: number,
    readonly openingRule: boolean,
    readonly noFive: boolean,
    readonly move2Fix: boolean,
    cells: readonly number[],
  ) {
    cells.forEach((c, i) => (i % 2 === 0 ? this.b : this.w).push(c));
    this.occ = new Uint8Array(boardSize * boardSize);
    // bm · wm 을 한 열쇠로. 합쳐 52비트 안이면 정확한 수, 넘으면 문자열.
    const shift = 2 ** this.w.length;
    this.key = this.n <= 52 ? (bm, wm) => bm * shift + wm : (bm, wm) => `${bm},${wm}`;
  }

  get nb() {
    return this.b.length;
  }
  get nw() {
    return this.w.length;
  }
  get n() {
    return this.b.length + this.w.length;
  }

  /** 방금 놓은 돌이 오목(규칙이 치면 장목)을 이루나 — `make_move` 끝의 승리 검사와 같다. */
  private makesFive(cell: number): boolean {
    const s = this.boardSize;
    const col = this.occ[cell];
    const y0 = Math.floor(cell / s);
    const x0 = cell % s;
    for (let d = 0; d < 4; d++) {
      let k = 1;
      for (const sign of [1, -1]) {
        let ny = y0;
        let nx = x0;
        for (let j = 1; j < 6; j++) {
          ny += sign * DY[d]!;
          nx += sign * DX[d]!;
          if (nx < 0 || ny < 0 || nx >= s || ny >= s) break;
          if (this.occ[ny * s + nx] !== col) break;
          k++;
        }
      }
      if (k === 5 || (k > 5 && this.rule !== 1)) return true;
    }
    return false;
  }

  /** *p+1* 수째는 천원 둘레 `(2p+1)²` 상자 안. 홀수 판에서만 뜻이 있다. */
  private openingOk(p: number, cell: number): boolean {
    if (!this.openingRule || p > 3) return true;
    const s = this.boardSize;
    if (s % 2 === 0) return true;
    const ctr = Math.floor(s / 2);
    const y = Math.floor(cell / s);
    const x = cell % s;
    // 정규 2수는 H9 / I9 로 그린다. y 는 아래로 자라므로 «천원 한 줄 위» 는 y = ctr - 1.
    if (p === 1 && this.move2Fix) return y === ctr - 1 && (x === ctr || x === ctr + 1);
    return Math.max(Math.abs(y - ctr), Math.abs(x - ctr)) <= p;
  }

  /** 이 돌이 *p* 수째로 놓일 수 있나. 부르는 쪽은 아직 놓지 않았어야 한다. */
  edgeOk(p: number, color: number, cell: number): boolean {
    if (!this.openingOk(p, cell)) return false;
    if (!this.noFive) return true;
    if (p + 1 >= this.n) return true; // 마지막 수는 대국을 끝내도 된다
    this.occ[cell] = color;
    const ok = !this.makesFive(cell);
    this.occ[cell] = 0;
    return ok;
  }

  place(cell: number, color: number) {
    this.occ[cell] = color;
  }
  clearBoard() {
    this.occ.fill(0);
  }

  /** 부분 배치 (bm, wm), *p* 수째에서 끝까지 가는 완전한 합법 수순의 수. (bm, wm) 로 메모한다. */
  count(bm: number, wm: number, p: number): number {
    if (p >= this.n) return 1;
    if (this.overflow) return 0;
    const k = this.key(bm, wm);
    const hit = this.memo.get(k);
    if (hit !== undefined) return hit;
    if (this.nodes >= this.maxNodes) {
      this.overflow = true;
      return 0;
    }
    this.nodes++;
    let total = 0;
    const black = p % 2 === 0;
    const list = black ? this.b : this.w;
    const used = black ? bm : wm;
    const col = black ? 1 : 2;
    for (let i = 0; i < list.length; i++) {
      if (used & (1 << i)) continue;
      const cell = list[i]!;
      if (!this.edgeOk(p, col, cell)) continue;
      this.occ[cell] = col;
      total += black ? this.count(bm | (1 << i), wm, p + 1) : this.count(bm, wm | (1 << i), p + 1);
      this.occ[cell] = 0;
      if (this.overflow) return 0;
    }
    this.memo.set(k, total);
    return total;
  }

  total(): number {
    this.clearBoard();
    return this.count(0, 0, 0);
  }

  /** (bm, wm), *p* 수째에서 둘 수 있는 다음 돌과 그 경로 수. `occ` 는 (bm, wm) 을 이미 반영해야 한다. */
  children(bm: number, wm: number, p: number): MoveOrderChild[] {
    const out: MoveOrderChild[] = [];
    const black = p % 2 === 0;
    const list = black ? this.b : this.w;
    const used = black ? bm : wm;
    const col = black ? 1 : 2;
    for (let i = 0; i < list.length; i++) {
      if (used & (1 << i)) continue;
      const cell = list[i]!;
      if (!this.edgeOk(p, col, cell)) continue;
      this.occ[cell] = col;
      const c = black ? this.count(bm | (1 << i), wm, p + 1) : this.count(bm, wm | (1 << i), p + 1);
      this.occ[cell] = 0;
      if (c <= 0) continue; // 합법한 걸음이지만 그 뒤로 끝낼 길이 없다
      out.push({ cell, color: col, count: c });
    }
    return out;
  }

  /** (bm, wm) 을 완전한 합법 수순으로 늘린다 — 되짚는 욕심쟁이라 count > 0 이면 반드시 찾는다. */
  complete(bm: number, wm: number, p: number, out: number[]): boolean {
    if (p >= this.n) return true;
    const black = p % 2 === 0;
    const list = black ? this.b : this.w;
    const used = black ? bm : wm;
    const col = black ? 1 : 2;
    for (let i = 0; i < list.length; i++) {
      if (used & (1 << i)) continue;
      const cell = list[i]!;
      if (!this.edgeOk(p, col, cell)) continue;
      this.occ[cell] = col;
      out[p] = cell;
      const ok = black
        ? this.complete(bm | (1 << i), wm, p + 1, out)
        : this.complete(bm, wm | (1 << i), p + 1, out);
      this.occ[cell] = 0;
      if (ok) return true;
    }
    return false;
  }

  /**
   * 돌마다 몇 수째가 될 수 있나. 어떤 완전한 수순이 지나가면(닿을 수 있고 `count(뒤) > 0`)
   * 그 (돌, 수) 짝은 쓸모 있다. `total` 로 데운 메모 위에서 DFS 한 번이면 다 표시된다.
   */
  markPlies(bPly: bigint[], wPly: bigint[]) {
    const seen = new Set<number | string>();
    this.clearBoard();
    this.markRec(seen, 0, 0, 0, bPly, wPly);
  }

  private markRec(
    seen: Set<number | string>,
    bm: number,
    wm: number,
    p: number,
    bPly: bigint[],
    wPly: bigint[],
  ) {
    if (p >= this.n) return;
    const k = this.key(bm, wm);
    if (seen.has(k)) return;
    seen.add(k);
    const black = p % 2 === 0;
    const list = black ? this.b : this.w;
    const used = black ? bm : wm;
    const col = black ? 1 : 2;
    const bit = 1n << BigInt(p);
    for (let i = 0; i < list.length; i++) {
      if (used & (1 << i)) continue;
      const cell = list[i]!;
      if (!this.edgeOk(p, col, cell)) continue;
      this.occ[cell] = col;
      const nbm = black ? bm | (1 << i) : bm;
      const nwm = black ? wm : wm | (1 << i);
      if (this.count(nbm, nwm, p + 1) > 0) {
        if (black) bPly[i] = bPly[i]! | bit;
        else wPly[i] = wPly[i]! | bit;
        this.markRec(seen, nbm, nwm, p + 1, bPly, wPly);
      }
      this.occ[cell] = 0;
    }
  }
}

/** 수순 하나와 그것이 사는 배치. */
export interface Completion {
  readonly transform: number;
  readonly order: number[];
}

/** `moveorder.h` 번호의 D4 군, (y, x) 위에서. **`PosKey.tf` 번호와 다르다** — 군은 같고 번호가 다르다. */
export function xform(t: number, size: number, cell: number): number {
  const y = Math.floor(cell / size);
  const x = cell % size;
  const b = size - 1;
  let oy: number;
  let ox: number;
  switch (t) {
    case 0:
      [oy, ox] = [y, x]; // 그대로
      break;
    case 1:
      [oy, ox] = [x, b - y]; // 시계 90°
      break;
    case 2:
      [oy, ox] = [b - y, b - x]; // 180°
      break;
    case 3:
      [oy, ox] = [b - x, y]; // 시계 270°
      break;
    case 4:
      [oy, ox] = [y, b - x]; // 좌우
      break;
    case 5:
      [oy, ox] = [b - y, x]; // 상하
      break;
    case 6:
      [oy, ox] = [x, y]; // \ 대각
      break;
    default:
      [oy, ox] = [b - x, b - y]; // / 대각
  }
  return oy * size + ox;
}

const XFORM_NAME = [
  "원래 방향",
  "90° 회전",
  "180° 회전",
  "270° 회전",
  "좌우 반전",
  "상하 반전",
  "\\ 대각 반전",
  "/ 대각 반전",
];

/** 방향 이름(`mo_xform_name`). */
export const xformName = (t: number): string => XFORM_NAME[t] ?? XFORM_NAME[7]!;

/** 정규 2수 두 칸(H9 / I9), 천원이 없는 짝수 판이면 `null`(`mo_rule2_cells`). */
export function rule2Cells(size: number): [number, number] | null {
  if (size % 2 === 0) return null;
  const ctr = Math.floor(size / 2);
  return [(ctr - 1) * size + ctr, (ctr - 1) * size + ctr + 1];
}

export interface MoveOrderOptions {
  rule?: number;
  openingRule?: boolean;
  noFive?: boolean;
  move2Fix?: boolean;
  withSymmetry?: boolean;
  maxNodes?: number;
}

/**
 * 겹친 D4 변형을 걷어낸 합친 DAG — `MoVarSet` 의 이식.
 *
 * «모양»은 방향이 없다: 이면체군이 같은 모양을 많게는 여덟 배치로 놓는다. 겹치는 변환
 * (스스로 대칭인 모양)은 걷어내고, 살아남은 것들을 합쳐 훑는다: 갈래는 **살아 있는 어느**
 * 변형으로든 들어가는 칸이고, 수는 그 합이다. 변형마다 마지막 돌 집합이 달라 같은 수순을
 * 두 번 세지 않는다.
 *
 * 화면이 파고들고 되짚으므로 상태가 바뀐다 — 한 줄기에서만 쓴다.
 */
export class MoveOrderSet {
  private readonly bm: number[];
  private readonly wm: number[];
  private readonly alive: boolean[];
  private readonly bPly: bigint[][];
  private readonly wPly: bigint[][];
  private readonly path: number[] = [];

  /** 모든 변형의 합법 수순 수. `overflow` 면 0. */
  total = 0;
  /** 마디 예산이 바닥났다 — 틀린 수 대신 «세지 않음»으로 알린다. */
  overflow = false;
  /** `plies` 자료가 유효하다(넘쳤으면 건너뛴다). */
  plyOk = false;

  private constructor(
    readonly boardSize: number,
    private readonly ctx: MoCtx[],
    /** 남은 변형마다 `moveorder.h` 변환 번호. */
    readonly transforms: number[],
  ) {
    this.bm = ctx.map(() => 0);
    this.wm = ctx.map(() => 0);
    this.alive = ctx.map(() => true);
    this.bPly = ctx.map(() => Array.from({ length: MO_MAX_STONES }, () => 0n));
    this.wPly = ctx.map(() => Array.from({ length: MO_MAX_STONES }, () => 0n));
  }

  get variantCount() {
    return this.ctx.length;
  }
  get stoneCount() {
    return this.ctx[0]!.n;
  }
  get blackCount() {
    return this.ctx[0]!.nb;
  }
  get whiteCount() {
    return this.ctx[0]!.nw;
  }
  /** 파고든 길, 칸 번호로. */
  get prefix(): readonly number[] {
    return this.path;
  }

  private build(maxNodes: number) {
    let remaining = maxNodes;
    const totals = this.ctx.map((c) => {
      // 예산은 함께 쓴다 — 뒤의 변형은 남은 것이 없어 넘칠 수 있다(데스크톱도 이 고리를 끊지 않는다).
      c.maxNodes = remaining > 0 ? remaining : 0;
      const t = c.total();
      remaining -= c.nodes;
      if (c.overflow) this.overflow = true;
      this.total += t;
      return t;
    });
    if (this.overflow) {
      this.total = 0; // 같은 정직함 — 틀린 수를 내지 않는다
    } else {
      this.ctx.forEach((c, v) => {
        if (totals[v]! > 0) c.markPlies(this.bPly[v]!, this.wPly[v]!);
      });
      this.plyOk = true;
    }
    this.applyPrefix();
  }

  /** `path` 에서 변형마다 마스크 · 점유 · 생존을 다시 세운다. 파고들기 · 되짚기 · 처음이 한 길이다. */
  private applyPrefix() {
    this.ctx.forEach((c, v) => {
      this.bm[v] = 0;
      this.wm[v] = 0;
      this.alive[v] = true;
      c.clearBoard();
    });
    this.path.forEach((cell, k) => {
      const black = k % 2 === 0;
      const col = black ? 1 : 2;
      this.ctx.forEach((c, v) => {
        if (!this.alive[v]) return;
        const list = black ? c.b : c.w;
        const used = black ? this.bm[v]! : this.wm[v]!;
        const found = list.findIndex((x, i) => x === cell && (used & (1 << i)) === 0);
        if (found < 0 || !c.edgeOk(k, col, cell)) {
          this.alive[v] = false;
          return;
        }
        c.place(cell, col);
        if (black) this.bm[v] = this.bm[v]! | (1 << found);
        else this.wm[v] = this.wm[v]! | (1 << found);
      });
    });
  }

  aliveCount(): number {
    return this.alive.filter(Boolean).length;
  }

  /** **원래 방향** 배치가 아직 살아 있다 — 그때만 실제 대국의 다음 수가 뜻이 있다(main.c:5943). */
  identityAlive(): boolean {
    const i = this.transforms.indexOf(0);
    return i >= 0 && this.alive[i] === true;
  }

  /** 살아 있는 배치가 딱 하나면 그 변환 번호. */
  soleAliveTransform(): number | null {
    const live = this.alive.flatMap((a, i) => (a ? [i] : []));
    return live.length === 1 ? this.transforms[live[0]!]! : null;
  }

  /** 지금 길을 지나는 완전한 수순 수 — 살아 있는 변형의 합. */
  branchCount(): number {
    let s = 0;
    this.ctx.forEach((c, v) => {
      if (this.alive[v]) s += c.count(this.bm[v]!, this.wm[v]!, this.path.length);
    });
    return s;
  }

  /** 합친 다음 수 후보 — 변형끼리 같은 칸은 한 줄로 수를 더한다. 큰 것부터, 같으면 칸(y, x) 순. */
  children(): MoveOrderChild[] {
    const merged = new Map<number, MoveOrderChild>();
    this.ctx.forEach((c, v) => {
      if (!this.alive[v]) return;
      for (const ch of c.children(this.bm[v]!, this.wm[v]!, this.path.length)) {
        const prev = merged.get(ch.cell);
        merged.set(ch.cell, prev ? { ...prev, count: prev.count + ch.count } : ch);
      }
    });
    return [...merged.values()].sort((a, b) => b.count - a.count || a.cell - b.cell);
  }

  /** 아직 순서를 정하지 않은 돌, 살아 있는 배치를 모아서 — 작은 판의 고스트(main.c:6341). */
  ghosts(): MoveOrderGhost[] {
    const black = new Map<number, number>();
    const white = new Map<number, number>();
    const plies = new Map<number, bigint>();
    let nAlive = 0;
    this.ctx.forEach((c, v) => {
      if (!this.alive[v]) return;
      nAlive++;
      c.b.forEach((cell, i) => {
        if (this.bm[v]! & (1 << i)) return;
        black.set(cell, (black.get(cell) ?? 0) + 1);
        if (this.plyOk) plies.set(cell, (plies.get(cell) ?? 0n) | this.bPly[v]![i]!);
      });
      c.w.forEach((cell, i) => {
        if (this.wm[v]! & (1 << i)) return;
        white.set(cell, (white.get(cell) ?? 0) + 1);
        if (this.plyOk) plies.set(cell, (plies.get(cell) ?? 0n) | this.wPly[v]![i]!);
      });
    });
    const cells = new Set([...black.keys(), ...white.keys()]);
    return [...cells].map((cell) => {
      const nb = black.get(cell) ?? 0;
      const nw = white.get(cell) ?? 0;
      const common = (nb === nAlive && nw === 0) || (nw === nAlive && nb === 0);
      return {
        cell,
        color: nb >= nw ? 1 : 2,
        common,
        plies: common ? (plies.get(cell) ?? 0n) : 0n,
      };
    });
  }

  /** 칸 하나로 파고든다. 받아 주는 변형이 없으면 상태를 그대로 두고 `false`. */
  drill(cell: number): boolean {
    if (this.ctx.length === 0 || this.path.length >= this.stoneCount) return false;
    this.path.push(cell);
    this.applyPrefix();
    if (!this.alive.some(Boolean)) {
      this.path.pop();
      this.applyPrefix();
      return false;
    }
    return true;
  }

  back(): boolean {
    if (this.path.length === 0) return false;
    this.path.pop();
    this.applyPrefix();
    return true;
  }

  root() {
    this.path.length = 0;
    this.applyPrefix();
  }

  /**
   * 길을 완전한 합법 수순으로 늘린다(길 포함). 원래 방향 변형을 먼저 — 다시 놓아도 판의
   * 방향이 그대로이게. 끝낼 길이 없으면 `null`.
   */
  complete(): Completion | null {
    for (const identityPass of [true, false]) {
      for (let v = 0; v < this.ctx.length; v++) {
        if (!this.alive[v]) continue;
        if (identityPass !== (this.transforms[v] === 0)) continue;
        const c = this.ctx[v]!;
        const out = new Array<number>(c.n).fill(0);
        this.path.forEach((cell, k) => (out[k] = cell));
        if (c.complete(this.bm[v]!, this.wm[v]!, this.path.length, out)) {
          return { transform: this.transforms[v]!, order: out };
        }
      }
    }
    return null;
  }

  /**
   * 겹친 변형을 걷어내고, 한 예산으로 각각 세고, 돌마다 가능한 수를 표시한다. 국면이 잘못됐거나
   * 색당 `MO_MAX_STONES` 를 넘으면 `null`.
   */
  static create(
    cells: readonly number[],
    size = DEFAULT_SIZE,
    opts: MoveOrderOptions = {},
  ): MoveOrderSet | null {
    const {
      rule = 2,
      openingRule = true,
      noFive = true,
      move2Fix = true,
      withSymmetry = true,
      maxNodes = MO_GUI_NODES,
    } = opts;
    if (cells.length === 0 || cells.length > 2 * MO_MAX_STONES) return null;
    if (cells.some((c) => c < 0 || c >= size * size)) return null;
    if (Math.ceil(cells.length / 2) > MO_MAX_STONES) return null;

    const kept: MoCtx[] = [];
    const ids: number[] = [];
    const seen = new Set<string>();
    for (let t = 0; t < (withSymmetry ? 8 : 1); t++) {
      const tc = cells.map((c) => xform(t, size, c));
      // 색마다 정렬한 칸 목록 — 같은 국면 걷어내기용
      const cb = tc.filter((_, i) => i % 2 === 0).sort((a, b) => a - b);
      const cw = tc.filter((_, i) => i % 2 === 1).sort((a, b) => a - b);
      const id = `${cb.join(",")}|${cw.join(",")}`;
      if (seen.has(id)) continue; // 스스로 대칭: 같은 국면은 한 번만
      seen.add(id);
      kept.push(new MoCtx(size, rule, openingRule, noFive, move2Fix, tc));
      ids.push(t);
    }
    const set = new MoveOrderSet(size, kept, ids);
    set.build(maxNodes);
    return set;
  }
}

// ── 표기 ─────────────────────────────────────────────────────────────

/** 여섯 자리 수도 읽히게 자리를 묶고, 정수로서 뜻이 없어지면 지수 표기로(`mo_fmt_count`). */
export function formatCount(v: number): string {
  const x = v < 0 ? 0 : v;
  if (x >= 1e12) return x.toExponential(2);
  return Math.round(x)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** «이 돌이 몇 수째일 수 있나» — `0x15` → "1·3·5", 넷 이상이면 "min~max"(`mo_fmt_plies`). */
export function formatPlies(mask: bigint): string {
  const ps: number[] = [];
  for (let p = 0; p < 2 * MO_MAX_STONES; p++) if (mask & (1n << BigInt(p))) ps.push(p + 1);
  if (ps.length === 0) return "";
  if (ps.length > 3) return `${ps[0]}~${ps.at(-1)}`;
  return ps.join("·");
}

/** 칸 번호 → "h8"(`mo_cell_name`). */
export const cellName = (cell: number, size = DEFAULT_SIZE): string =>
  `${String.fromCharCode(97 + (cell % size))}${size - Math.floor(cell / size)}`;

/** 칸 번호 → `Move`. */
export const cellMove = (cell: number, size = DEFAULT_SIZE) =>
  move(cell % size, Math.floor(cell / size));

/**
 * 세 수 수순의 주형, 없으면 `null`(`mo_opening26_cells`). 1수 **또는** 3수가 천원이면 된다 —
 * 같은 돌을 지나는 다른 수순이 다른 주형을 이룰 수 있고, 파고든 길이 바로 그것을 보여 준다.
 */
export function opening26Of(
  m1: number,
  m2: number,
  m3: number,
  size = DEFAULT_SIZE,
): number | null {
  if (size % 2 === 0 || size !== DEFAULT_SIZE) return null;
  const ctr = Math.floor(size / 2);
  const tengen = ctr * size + ctr;
  let other: number;
  if (m1 === tengen) other = m3;
  else if (m3 === tengen) other = m1;
  else return null;
  const idx = classify([move(ctr, ctr), cellMove(m2, size), cellMove(other, size)]);
  return idx === NONSTD ? null : idx;
}
