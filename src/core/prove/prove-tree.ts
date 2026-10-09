import { DEFAULT_SIZE, sameMove, type Move } from "../model/move";
import { coord } from "../review/move-quality";

/**
 * 국면 증명 — 앱 `ProveModels.kt` · `ProveTree.kt` 의 이식(원본은 main.c:8918-9979).
 *
 * 둘 차례의 승리를 엔진이 모는 AND/OR 탐색으로 증명하거나 반증한다:
 *   - **OR 마디**(공격 차례): `yxnbest k` 후보, 이기는 줄 하나면 된다
 *   - **AND 마디**(방어 차례): `yxsearchdefend`, 해 볼 만한 방어가 **모두** 져야 한다.
 *     가망 없어 보이는 방어는 미뤘다가 나머지가 다 증명되면 한꺼번에 검증한다(낙관적 가지치기)
 *   - 마디마다 예산은 작게 시작해 다시 올 때마다 늘린다
 *
 * 트리는 순수하다 — 탐색 **순서**가 증명이 1분에 끝나느냐 1시간이 걸리느냐를 가르고, 잘못 옮긴
 * 전파 규칙은 틀린 메이트 기록을 남긴다. 그래서 엔진 없이 시험이 다 닿는다.
 *
 * 결론을 DB 에 쓰는 쓰기 큐는 실행기가 비운다 — DB 가 붙어 있으면 `yxedittvddatabase 7` 로 적고(W8),
 * 없으면 버린다(`features/research/prove/proveRunner.ts`).
 */

// ── 입력 · 출력 (ProveModels) ────────────────────────────────────────

/** 조절 손잡이 — settings_dev.txt 5 · 6 · 12 · 13 · 16 · 17 · 18 · 7 행. */
export interface ProveOptions {
  readonly budget0Sec: number;
  readonly budgetMaxSec: number;
  /** 예산 단위: false = 벽시계 초, true = 정한 탐색 깊이. */
  readonly byDepth: boolean;
  readonly depth0: number;
  readonly depthMax: number;
  /** OR 마디의 공격 후보 수(`yxnbest k`). */
  readonly nbest: number;
  /** 가장 좋은 공격 수 하나만 세우고, 그것이 실패하면 넓힌다. */
  readonly bestFirst: boolean;
  /** 버티는 것처럼 보이는 방어에 값싼 이른 탐침 하나. */
  readonly probe: boolean;
}

export const DEFAULT_PROVE_OPTIONS: ProveOptions = {
  budget0Sec: 5,
  budgetMaxSec: 320,
  byDepth: false,
  depth0: 12,
  depthMax: 30,
  nbest: 4,
  bestFirst: true,
  probe: true,
};

/** `PROVE_NBEST_MAX`(main.c:8939) — `k` 넓히기의 상한이기도 하다. */
export const NBEST_MAX = 8;
/** `PROVE_VERIFY_MS` / `PROVE_VERIFY_DEPTH`(main.c:8940). */
export const VERIFY_MS = 3000;
export const VERIFY_DEPTH = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** 대화상자의 범위(main.c:9894-9915)와 «상한은 시작보다 작지 않게» 두 고침(main.c:9942). */
export function sanitizeProveOptions(o: ProveOptions): ProveOptions {
  const b0 = clamp(o.budget0Sec, 1, 600);
  const d0 = clamp(o.depth0, 4, 64);
  return {
    ...o,
    budget0Sec: b0,
    budgetMaxSec: Math.max(clamp(o.budgetMaxSec, 1, 3600), b0),
    depth0: d0,
    depthMax: Math.max(clamp(o.depthMax, 4, 128), d0),
    nbest: clamp(o.nbest, 1, NBEST_MAX),
  };
}

/** 새 마디의 예산 — ms, 깊이 방식이면 깊이(main.c:9302). */
export const initialBudget = (o: ProveOptions) => (o.byDepth ? o.depth0 : o.budget0Sec * 1000);
export const maxBudget = (o: ProveOptions) => (o.byDepth ? o.depthMax : o.budgetMaxSec * 1000);
/**
 * 깊이 방식의 시간 끈(main.c:9484). 깊이는 후보 수가 묶인 OR 마디의 일은 묶지만, 모든 방어를
 * 그 깊이로 읽는 AND 마디는 묶지 못한다. 대화상자의 초 상한이 자연스러운 끈이다.
 */
export const depthLeashMs = (o: ProveOptions) => Math.max(o.budgetMaxSec, 1) * 1000;
/** 검증 마디의 예산(main.c:9303). */
export const verifyBudget = (o: ProveOptions) =>
  o.byDepth ? Math.min(o.depth0, VERIFY_DEPTH) : VERIFY_MS;
/** 로그 줄의 예산 부분(main.c:9970 / 9974). */
export const optionsLabel = (o: ProveOptions) =>
  o.byDepth ? `d${o.depth0}..${o.depthMax}` : `${o.budget0Sec}..${o.budgetMaxSec}초`;

export type ProveState = "open" | "resolved" | "exhausted";
/** 마디의 결과 — 언제나 **공격 쪽** 관점(`PR_*`). */
export type ProveResult = "none" | "win" | "nowin";
/**
 * 무엇이 마디를 정했나(`PK_*`). 순서가 짐을 진다: AND 마디의 증명은 가장 약한 자식만큼만
 * 강하고, main.c 는 그것을 수로 가장 큰 종류로 잡는다(mate < db < wr).
 */
export type ProveKind = "none" | "mate" | "db" | "wr";
const KIND_RANK: Record<ProveKind, number> = { none: 0, mate: 1, db: 2, wr: 3 };

/** 뿌리 후보에 그리는 상태(`PM_*`, main.c:9115). */
export type ProveMark = "none" | "open" | "win" | "loss" | "exh" | "latent";

/**
 * 증명 탐색의 PV 하나. `winRate` 는 **없을 수 있다** — `INFO WINRATE` 없이 온 블록의 승률은
 * *모른다*, 0 이 아니다. 0 으로 적으면 정보를 잃는 데 그치지 않고 거짓을 말한다.
 */
export interface ProvePv {
  readonly move: Move;
  /** 두는 쪽 관점 승률 0..1, 블록에 없었으면 `null`. */
  readonly winRate: number | null;
  /** 두는 쪽 관점 메이트 거리, 0 = 없음. */
  readonly mate: number;
  readonly depth: number;
}

/** 탐색 중의 판 덧그림(main.c:9154 `prove_update_overlay`). */
export interface ProveOverlay {
  /** 탐색 중인 줄 — 수 → 수 번호(1부터). */
  readonly line: readonly Move[];
  readonly marks: ReadonlyMap<string, { move: Move; mark: ProveMark; budget: number | null }>;
  readonly rootLen: number;
  readonly byDepth: boolean;
}

/** 열린 후보의 예산 표기(main.c:9124). */
export function budgetText(budget: number | null, byDepth: boolean): string {
  if (budget === null) return "";
  if (budget > 99) return "99+";
  return byDepth ? `d${budget}` : `${budget}초`;
}

// ── 트리 ─────────────────────────────────────────────────────────────

/** 증명 트리의 마디 하나(`ProveNode`, main.c:8949). 거기처럼 바뀐다. */
export class ProveNode {
  state: ProveState = "open";
  result: ProveResult = "none";
  kind: ProveKind = "none";
  /** 둘 차례 관점 값, 엔진 EVAL 처럼 메이트를 담는다. */
  value = 0;
  recDepth = 0;
  expanded = false;
  retries = 0;
  /** 한 번이라도 탐색했다 — 이른 탐침은 썼다. */
  probed = false;
  /**
   * 들은 수를 버린 적이 있다(보류 한도를 넘은 방어, 좌표 없이 온 PV). 탐색은 되고 버티는 방어
   * 하나로 반증될 수는 있지만 **증명**될 수는 없다 — «모든 방어가 진다»는 온전한 집합에 대한
   * 말이고, 이 마디는 제 집합이 온전하지 않음을 안다.
   */
  incomplete = false;
  /** 낙관적 가지치기로 미룬 방어 — 나중에 한꺼번에 검증. */
  readonly pending: Move[] = [];
  /** 아직 세우지 않은 공격 대안(OR 의 게으른 넓히기). */
  readonly alt: ProvePv[] = [];
  altNext = 0;

  constructor(
    /** 증명 뿌리 아래에서 이 마디에 이르는 수순. */
    readonly moves: readonly Move[],
    readonly parent: number,
    /** 공격 차례. 뿌리가 OR 라 짝수 수가 OR. */
    readonly isOr: boolean,
    /** 공격 쪽 승률 추정. */
    public wratt: number,
    /** 탐색 예산: ms, 깊이 방식이면 깊이. */
    public budget: number,
    /** 미룬 방어의 일괄 검증 — 값싼 예산, 값싼 우선순위. */
    readonly verify: boolean,
    /** 이 마디의 `yxnbest k`, 올릴 때 넓어진다. */
    public k: number,
    /** 이 마디를 만든 PV 에 보이던 공격 메이트(0 = 없음). */
    public pvMate: number,
  ) {}

  get ply() {
    return this.moves.length;
  }
  get lastMove(): Move | null {
    return this.moves.at(-1) ?? null;
  }
}

/** 탐색 결과를 넣은 뒤 실행기가 할 일. */
export type ProveStep = "resolved" | "retry" | "continue";

export const MAX_NODES = 4096;
export const MAX_PLIES = 32;
export const MAX_PENDING = 224;
export const WQ_MAX = 64;
/** `PROVE_TREE_PLIES` — 이 깊이 아래로는 펼치지 않는다(main.c:8938). */
export const TREE_PLIES = 24;
/** 이 승률 이하의 방어는 미룬다(`PROVE_PRUNE_WR`). */
export const PRUNE_WR = 0.02;
/** AND 마디마다 펼치는 방어의 상한. */
export const DEFEND_KEEP = 16;
/** 이 이하의 방어는 이른 탐침 하나(`PROVE_REFUTE_WR`). */
export const REFUTE_WR = 0.35;
/** 한 마디를 포기하기 전의 탐색 횟수. */
export const RETRY_MAX = 3;
/** 엔진이 승률을 말하지 않았을 때의 대역 — 일정 짜기의 사전값이지 증거가 아니다. */
export const UNKNOWN_WR = 0.5;
/** …그러나 **순위**에서는 모르는 승률이 아는 모든 것 아래로 간다. */
const UNKNOWN_RANK = -1;

const TIER_WIN = 0;
const TIER_OPEN = 1;
const TIER_LOSS = 2;

const tier = (pv: ProvePv) => (pv.mate > 0 ? TIER_WIN : pv.mate < 0 ? TIER_LOSS : TIER_OPEN);

/**
 * 이 파일의 유일한 순서(두는 쪽 관점) — `prove_pv_before`(main.c:9653)를 모든 PV 끼리 줄 세울
 * 수 있게 넓힌 것. 세 층: 두는 쪽이 메이트(빠를수록 앞) · 메이트 없음(승률 높을수록, 모르는
 * 승률은 아는 것 모두 아래) · 두는 쪽이 메이트 당함(늦을수록 앞). 같은 열쇠면 `false`.
 */
export function before(a: ProvePv, b: ProvePv): boolean {
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return ta < tb;
  if (ta === TIER_WIN || ta === TIER_LOSS) return a.mate < b.mate;
  return (a.winRate ?? UNKNOWN_RANK) > (b.winRate ?? UNKNOWN_RANK);
}

/** main.c 는 «x 가 y 앞인가» 술어로 삽입 정렬을 한다 — 같은 열쇠는 엔진 순서를 지킨다. 그대로. */
function order(pvs: readonly ProvePv[]): ProvePv[] {
  const out = [...pvs];
  for (let a = 1; a < out.length; a++) {
    let b = a;
    while (b > 0 && before(out[b]!, out[b - 1]!)) {
      [out[b], out[b - 1]] = [out[b - 1]!, out[b]!];
      b--;
    }
  }
  return out;
}

const fixed2 = (v: number) => v.toFixed(2);

/**
 * main.c:8918-9979 의 AND/OR 증명 탐색에서 엔진 대화를 뺀 것: 마디 장부, 일의 순서를 정하는
 * 비용 함수, 결론의 전파, 쓰기 큐.
 */
export class ProveTree {
  private readonly nodes: ProveNode[] = [];
  /** 아직 DB 에 써야 할 결론의 마디(LIFO). */
  private readonly writeQueue: number[] = [];
  resolvedCount = 0;

  constructor(
    readonly options: ProveOptions,
    readonly size = DEFAULT_SIZE,
    private readonly log: (text: string) => void = () => {},
  ) {
    this.nodes.push(
      new ProveNode([], -1, true, 0.5, initialBudget(options), false, options.nbest, 0),
    );
  }

  get count() {
    return this.nodes.length;
  }
  get root(): ProveNode {
    return this.nodes[0]!;
  }
  get(i: number): ProveNode {
    return this.nodes[i]!;
  }

  children(i: number): number[] {
    const out: number[] = [];
    this.nodes.forEach((n, j) => {
      if (n.parent === i) out.push(j);
    });
    return out;
  }

  /** 마디의 수순 표기(`prove_fmt_path`, main.c:9002). */
  path(i: number): string {
    const n = this.nodes[i]!;
    return n.moves.length === 0 ? "(root)" : n.moves.map((m) => coord(m, this.size)).join(" ");
  }

  /** 자식 값 → 부모 값. 메이트는 한 수 멀어진다(main.c:9018). */
  negamaxUp(v: number): number {
    const up = -v;
    if (up >= 29500) return up - 1;
    if (up <= -29500) return up + 1;
    return up;
  }

  ancestorResolved(i: number): boolean {
    let p = this.nodes[i]!.parent;
    while (p >= 0) {
      if (this.nodes[p]!.state === "resolved") return true;
      p = this.nodes[p]!.parent;
    }
    return false;
  }

  openCount(): number {
    let c = 0;
    this.nodes.forEach((n, i) => {
      if (n.state === "open" && !this.ancestorResolved(i)) c++;
    });
    return c;
  }

  // ── 일정 ──

  /**
   * `prove_cost`(main.c:9264): 가장 유망한 줄부터 승리를 증명한다. PV 에 이미 보이는 메이트가
   * 무엇보다 앞(짧은 것부터), 아니면 승리가 가장 쉬워 보이는 갈래부터. 실제로 버티는 것처럼
   * 보이는 방어에는 값싼 탐침 하나 — 버티는 방어 하나가 부모를 곧장 반증해 그 아래의 더 쉬운
   * 증명들을 헛일로 만들기 때문이다.
   */
  cost(n: ProveNode): number {
    const o = this.options;
    const unit = o.byDepth ? o.depth0 : o.budget0Sec * 1000;
    const scale = Math.max(n.budget / unit, 1);
    const depth = 1 + 0.15 * n.ply;
    let base: number;
    if (n.pvMate > 0) {
      base = 0.001 * n.pvMate; // 0층: 보이는 메이트부터 끝낸다
    } else {
      base = 1 - n.wratt;
      if (o.probe && !n.probed && n.wratt <= REFUTE_WR && 0.5 * n.wratt < base)
        base = 0.5 * n.wratt;
      base += 0.02;
    }
    base *= scale * depth;
    if (n.verify) base *= 0.3;
    return base;
  }

  /** `prove_continue` 의 고르기(main.c:9581): 가장 싼 열린 마디. */
  pickNext(): number | null {
    let best = -1;
    let bestCost = 0;
    this.nodes.forEach((n, i) => {
      if (n.state !== "open" || this.ancestorResolved(i)) return;
      const c = this.cost(n);
      if (best < 0 || c < bestCost) {
        best = i;
        bestCost = c;
      }
    });
    return best >= 0 ? best : null;
  }

  // ── 자라기 ──

  /** `prove_add_child`(main.c:9287). 한도에 걸리면 -1. */
  addChild(parent: number, move: Move, wratt: number, verify: boolean, pvMate: number): number {
    const p = this.nodes[parent]!;
    if (this.nodes.length >= MAX_NODES || p.ply + 1 >= MAX_PLIES) return -1;
    this.nodes.push(
      new ProveNode(
        [...p.moves, move],
        parent,
        // main.c: `c->is_or = c->nmoves % 2 == 0` — 짝수 수 뒤에 뿌리 쪽이 다시 둔다.
        (p.ply + 1) % 2 === 0,
        wratt,
        verify ? verifyBudget(this.options) : initialBudget(this.options),
        verify,
        this.options.nbest,
        pvMate,
      ),
    );
    return this.nodes.length - 1;
  }

  /**
   * `prove_or_widen`(main.c:9318): 공격 후보 하나가 실패했다 — 이 마디의 다른 후보가 아직 열려
   * 있지 않으면 다음 대안을 세운다. 목록이 바닥나면 마디는 열린 채 남고, 일정이 두 배 예산 ·
   * 넓은 `k` 로 다시 탐색한다.
   */
  orWiden(parent: number) {
    if (parent < 0) return;
    const p = this.nodes[parent]!;
    if (!p.isOr || p.state !== "open") return;
    if (this.children(parent).some((c) => this.nodes[c]!.state === "open")) return;
    if (p.altNext < p.alt.length) {
      const a = p.alt[p.altNext++]!;
      const c = this.addChild(parent, a.move, a.winRate ?? UNKNOWN_WR, false, a.mate);
      if (c >= 0) this.log(`증명: 공격 후보 ${p.altNext + 1}/${p.alt.length + 1} ${this.path(c)}`);
    }
  }

  /** 이미 [i] 의 자식이거나 대기 목록에 있다(main.c:9663). */
  knownMove(i: number, m: Move): boolean {
    return (
      this.children(i).some((c) => {
        const last = this.nodes[c]!.lastMove;
        return last !== null && sameMove(last, m);
      }) || this.nodes[i]!.alt.some((a) => sameMove(a.move, m))
    );
  }

  /**
   * `prove_expand`(main.c:9676). OR 마디는 가장 좋은 후보만 세우고 나머지는 대기, AND 마디는
   * 해 볼 만한 방어를 펼치고 가망 없는 것은 미룬다.
   */
  expand(i: number, pvs: readonly ProvePv[]) {
    const n = this.nodes[i]!;
    n.expanded = true;
    if (n.ply >= TREE_PLIES) return;
    if (n.isOr) {
      const limit = n.k > 0 ? n.k : this.options.nbest;
      let live = this.children(i).some((c) => this.nodes[c]!.state === "open");
      for (const pv of order(pvs.slice(0, limit))) {
        const mate = pv.mate > 0 ? pv.mate : 0;
        if (this.knownMove(i, pv.move)) continue;
        if (!this.options.bestFirst || !live) {
          if (
            this.addChild(i, pv.move, pv.winRate ?? UNKNOWN_WR, false, mate) >= 0 &&
            this.options.bestFirst
          ) {
            live = true;
          }
        } else if (n.alt.length < NBEST_MAX) {
          n.alt.push({ ...pv, mate });
        } else {
          // 대기로도 못 두는 공격 후보. OR 마디에는 이기는 수 하나면 되므로 불완전하지 않다.
          this.log(`증명: 공격 후보 ${coord(pv.move, this.size)} 보관 한도 초과`);
        }
      }
    } else {
      // AND 마디는 지금 다시 펼친다 — 한도는 이미 있는 것을 세고, 이미 자식 · 대기 · 보류인
      // 방어는 건너뛴다. 아니면 두 번째 탐색이 방어를 모두 두 벌로 만든다.
      let kept = this.children(i).length;
      let dropped = 0;
      // 방어자 자신의 순서로 — 버틸 것 같은 방어가 먼저. 승률이 없는 방어는 «가망 없음»이 아니다.
      for (const pv of order(pvs)) {
        if (this.knownMove(i, pv.move) || n.pending.some((m) => sameMove(m, pv.move))) continue;
        const defenderWr = pv.winRate ?? UNKNOWN_WR;
        if ((pv.winRate ?? 1) > PRUNE_WR && kept < DEFEND_KEEP) {
          // 방어자 관점 메이트가 음수면 공격 쪽이 메이트한다.
          this.addChild(i, pv.move, 1 - defenderWr, false, pv.mate < 0 ? -pv.mate : 0);
          kept++;
        } else if (n.pending.length < MAX_PENDING) {
          n.pending.push(pv.move);
        } else {
          // 자식도 보류도 아니다: 이 방어는 버려졌고, «모든 방어가 진다»는 주장도 함께 버려졌다.
          dropped++;
          n.incomplete = true;
        }
      }
      if (dropped > 0) {
        this.log(
          `증명: 방어 ${dropped}개를 담지 못해 이 국면은 «모든 방어가 진다» 로 결론내지 않는다`,
        );
      }
      if (kept === 0 && n.pending.length > 0) {
        // 해 볼 만한 것이 없다: 미룬 수를 곧바로 검증한다 — 아니면 이 마디로 전파될 자식이 없다.
        const deferred = n.pending.splice(0);
        for (const m of deferred) this.addChild(i, m, 0.98, true, 0);
      } else if (n.pending.length > 0) {
        this.log(`증명: 약한 방어 ${n.pending.length}개 보류 (나중에 검증)`);
      }
    }
  }

  // ── 결론 ──

  /** `prove_resolve`(main.c:9353). */
  resolve(
    i: number,
    result: ProveResult,
    kind: ProveKind,
    value: number,
    recDepth: number,
    note: string,
  ) {
    const n = this.nodes[i]!;
    if (n.state === "resolved") return;
    n.state = "resolved";
    n.result = result;
    n.kind = kind;
    n.value = value;
    n.recDepth = recDepth;
    n.wratt = result === "win" ? 1 : 0;
    this.resolvedCount++;
    // 판정 낱말은 main.c 철자(WIN/NOWIN, mate/db/wr) — 로그를 데스크톱과 줄마다 견줄 수 있게.
    const verdict = result === "win" ? "WIN" : "NOWIN";
    const by = kind === "mate" ? "mate" : kind === "db" ? "db" : "wr";
    this.log(`증명: ${verdict} ${by}(${note}) ${this.path(i)}`);
    // DB 에서 읽은 기록은 다시 쓸 필요가 없다.
    if (kind !== "db") this.queueWrite(i);
    if (n.parent >= 0) this.propagate(n.parent);
  }

  /** 증명된 메이트만 DB 기록의 값어치가 있다(main.c:9343). */
  private queueWrite(i: number) {
    if (this.nodes[i]!.kind !== "mate") return;
    if (this.writeQueue.length < WQ_MAX) this.writeQueue.push(i);
  }

  /** `prove_propagate`(main.c:9375). */
  propagate(parent: number) {
    const p = this.nodes[parent]!;
    if (p.state === "resolved") return;
    let allWin = true;
    let kids = 0;
    let weakest: ProveKind = "mate";
    let bestValue = -2_000_000;
    for (const i of this.children(parent)) {
      const c = this.nodes[i]!;
      kids++;
      if (c.state !== "resolved") {
        allWin = false;
        continue;
      }
      if (p.isOr) {
        if (c.result === "win") {
          // 이기는 공격 하나면 된다
          this.resolve(parent, "win", c.kind, this.negamaxUp(c.value), c.recDepth + 1, "via child");
          return;
        }
      } else {
        if (c.result === "nowin") {
          // 버티는 방어 하나가 반증한다
          this.resolve(
            parent,
            "nowin",
            c.kind,
            this.negamaxUp(c.value),
            c.recDepth + 1,
            "defense holds",
          );
          return;
        }
        if (c.result !== "win") {
          allWin = false;
          continue;
        }
        if (KIND_RANK[c.kind] > KIND_RANK[weakest]) weakest = c.kind;
        if (this.negamaxUp(c.value) > bestValue) bestValue = this.negamaxUp(c.value);
      }
    }
    if (p.isOr) {
      this.orWiden(parent); // 모든 후보가 실패했다: 다음 대안
      return;
    }
    if (kids > 0 && allWin) {
      if (p.pending.length > 0) {
        // 낙관적 가지치기의 보답: 미룬 방어를 한꺼번에 검증한다.
        const deferred = p.pending.splice(0);
        for (const m of deferred) this.addChild(parent, m, 0.98, true, 0);
        this.log(`증명: 보류한 방어 ${deferred.length}개 검증`);
        return;
      }
      if (p.incomplete) {
        // 아는 방어는 모두 지지만, 다 듣지 못했음을 안다 — «모든 방어가 진다»고 말할 수 없다.
        this.log(`증명: 방어 목록이 불완전해 결론 보류 ${this.path(parent)}`);
        return;
      }
      this.resolve(parent, "win", weakest, bestValue, p.recDepth + 1, "all defenses lose");
    }
  }

  // ── 탐색 결과 ──

  /**
   * `prove_on_bestmove` 의 장부(main.c:9756). **진짜 메이트만** 마디를 정한다 — 99% 승률은
   * 증거지 증명이 아니라, 더 큰 예산으로 탐색을 잇게 할 뿐이다.
   */
  onSearchResult(i: number, pvs: readonly ProvePv[], complete = true): ProveStep {
    const n = this.nodes[i]!;
    if (pvs.length === 0) return this.onTimeout(i);
    n.retries = 0;
    if (!complete) n.incomplete = true;
    // 두는 쪽의 **가장 좋은** 줄 — 엔진의 첫 줄이 아니라 이 파일의 순서로.
    let bestIndex = 0;
    for (let j = 1; j < pvs.length; j++) if (before(pvs[j]!, pvs[bestIndex]!)) bestIndex = j;
    const best = pvs[bestIndex]!;
    const mate = best.mate;
    const value =
      mate > 0
        ? 30000 - mate
        : mate < 0
          ? -30000 - mate
          : Math.trunc(((best.winRate ?? UNKNOWN_WR) - 0.5) * 2000);
    // 모르는 승률은 추정을 그대로 둔다 — 아무도 말하지 않은 수로 다시 쓰지 않는다.
    if (best.winRate !== null) n.wratt = n.isOr ? best.winRate : 1 - best.winRate;
    if (mate > 0) {
      this.resolve(i, n.isOr ? "win" : "nowin", "mate", value, best.depth, "search");
      return "resolved";
    }
    // 두는 쪽이 제 가장 좋은 줄에서 메이트 당한다. 거기서 결론 내는 것은 *모든* 수에 대한
    // 주장이라 온전한 집합이 필요하다: 돌아온 모든 PV 가 반증됐고, 오는 길에 버린 것이 없고
    // (`complete`), OR 마디라면 지는 줄이 엔진 자신의 첫 선택이어야 한다(다중 PV 에서 PV k 의
    // 값은 *그 수를 두는* 값이지 국면의 값이 아니다 — 거짓 메이트가 이 모양이었다).
    const everyLineRefuted = complete && !n.incomplete && pvs.every((p) => p.mate < 0);
    const orderAgreesWithEngine = !n.isOr || (bestIndex === 0 && best.winRate !== null);
    if (mate < 0 && everyLineRefuted && orderAgreesWithEngine) {
      this.resolve(i, n.isOr ? "nowin" : "win", "mate", value, best.depth, "search");
      return "resolved";
    }
    // 못 정했다: 펼치고, 올리고, 다시 줄 세운다(또는 소진). 탐침은 썼고, 만든 PV 가 약속한
    // 메이트는 나타나지 않았다.
    n.probed = true;
    n.pvMate = 0;
    // 두 종류 모두 다시 펼친다 — main.c 는 AND 마디를 한 번만 펼쳐, 끈에 잘린 첫 방어 탐색이
    // 그 마디의 방어 집합을 끝까지 얼려 버렸다. 중복은 `knownMove` 가 막는다.
    this.expand(i, pvs);
    const max = maxBudget(this.options);
    if (n.budget >= max) {
      n.state = "exhausted";
      this.log(`증명: 예산 소진 EXHAUSTED wr_att=${fixed2(n.wratt)} ${this.path(i)}`);
      this.orWiden(n.parent);
    } else if (this.options.byDepth) {
      // +2 수는 시간 두 배와 비슷한 값이다.
      n.budget = Math.min(n.budget + 2, max);
      if (n.isOr && n.k < NBEST_MAX) n.k++;
    } else {
      n.budget = Math.min(n.budget * 2, max);
      if (n.isOr && n.k < NBEST_MAX) n.k++;
    }
    return "continue";
  }

  /** 쓸 것이 오지 않았다 — 멈춘 엔진이나 빈 PV. 세 번까지, 그다음은 포기(main.c:9768 / 9844). */
  onTimeout(i: number): ProveStep {
    const n = this.nodes[i]!;
    n.retries++;
    if (n.retries < RETRY_MAX) return "retry";
    n.state = "exhausted";
    this.orWiden(n.parent);
    return "continue";
  }

  // ── 쓰기 큐 ──

  get hasWrites(): boolean {
    return this.writeQueue.length > 0;
  }

  /** 데스크톱은 끝에서 꺼낸다(`provewq[--provewqn]`). */
  popWrite(): number | null {
    return this.writeQueue.pop() ?? null;
  }

  // ── 덧그림 ──

  /** `prove_update_overlay`(main.c:9154). */
  overlay(current: number | null, rootLen: number): ProveOverlay {
    const marks = new Map<string, { move: Move; mark: ProveMark; budget: number | null }>();
    const key = (m: Move) => `${m.x},${m.y}`;
    const line =
      current !== null && current >= 0 && current < this.nodes.length
        ? this.nodes[current]!.moves
        : [];
    for (let i = 1; i < this.nodes.length; i++) {
      const c = this.nodes[i]!;
      if (c.parent !== 0) continue;
      const m = c.moves[0];
      if (!m) continue;
      if (c.state === "resolved")
        marks.set(key(m), { move: m, mark: c.result === "win" ? "win" : "loss", budget: null });
      else if (c.state === "exhausted") marks.set(key(m), { move: m, mark: "exh", budget: null });
      else {
        const b = this.options.byDepth ? c.budget : Math.floor(c.budget / 1000);
        marks.set(key(m), { move: m, mark: "open", budget: Math.min(b, 255) });
      }
    }
    // 아직 차례를 기다리는 뿌리 공격 대안.
    const root = this.root;
    for (let a = root.altNext; a < root.alt.length; a++) {
      const m = root.alt[a]!.move;
      if (!marks.has(key(m))) marks.set(key(m), { move: m, mark: "latent", budget: null });
    }
    return { line, marks, rootLen, byDepth: this.options.byDepth };
  }
}
