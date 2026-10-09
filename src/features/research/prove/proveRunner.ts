import { proveVerdict } from "../../../core/database/yixindb";
import { result as refereeResult } from "../../../core/model/referee";
import type { Move } from "../../../core/model/move";
import {
  ProveTree,
  depthLeashMs,
  maxBudget,
  type ProveOptions,
  type ProveOverlay,
  type ProvePv,
  type ProveStep,
} from "../../../core/prove/prove-tree";
import type { ProveOutcome, ProveProgress } from "../../../core/prove/prove-models";
import type { AnalysisSnapshot, EngineCommand, PvSnapshot } from "../../../engine/engine-types";
import type { ProveDb } from "../../database/dbStore";
import { placementsOf } from "../review/runner";

/**
 * 증명의 엔진 대화 — 앱 `ProveRepositoryImpl` 의 루프(원본은 main.c:9435-9598, 9756-9859).
 * 트리 · 비용 · 전파 규칙은 모두 `ProveTree` 에 있고, 여기는 엔진과 한 번에 한 탐색씩 말한다:
 *
 * ```
 *  가장 싼 열린 마디 → yxnbest k (공격) / yxsearchdefend (방어) → 결론 → 다음 마디
 * ```
 *
 * **DB 단계(W8).** 데스크톱 · 앱처럼 마디마다 먼저 DB 를 묻고(`yxquerydatabaseone`), 증명된
 * 메이트를 DB 에 쓴다(`yxedittvddatabase 7`). DB 가 붙어 있지 않으면(`port.db` 가 null) 두 단계를
 * 건너뛴다 — 결론은 이 실행 안에서만 쓰이고, 쓰기 큐는 비우기만 한다.
 *
 * 리뷰처럼 **보이는 판을 걷지 않는다** — 뿌리는 시작할 때의 수순이고, 국면마다 따로 세운다.
 */

/** 렌주의 승패 판정은 장목을 인정한다(대국 · 리뷰와 같다). */
const ALLOW_OVERLINE = true;

export interface ProvePort {
  search(
    stones: ReturnType<typeof placementsOf>,
    opts: { totalMs: number; nbest: number; info: readonly EngineCommand[]; defend: boolean },
    onSnapshot: (s: AnalysisSnapshot) => void,
  ): Promise<AnalysisSnapshot | null>;
  stop(): void;
  /** 붙어 있는 엔진 DB. 없으면 질의 · 기록 단계를 건너뛴다. */
  db?: ProveDb | null;
}

export interface ProveHooks {
  onProgress(p: ProveProgress): void;
  onOverlay(o: ProveOverlay): void;
  isCancelled(): boolean;
  log(text: string): void;
  now(): number;
}

/**
 * 끝난 탐색이 실제로 세운 것 — **마지막 심화 라운드**의 PV 를 엔진 번호 순으로, 그리고 그
 * 라운드가 온전히 왔는지. 좌표 없이 온 PV 블록은 엔진이 말했는데 우리가 놓을 수 없는 수라
 * 우리가 가진 집합이 있는 집합보다 **작다** — «모든 방어가 진다»는 집합을 세므로 트리가 알아야
 * 한다(`complete`). PV 0 에 수가 없으면 main.c 처럼 탐색을 다시 한다(빈 목록).
 */
export function capturePvs(snap: AnalysisSnapshot | null): { pvs: ProvePv[]; complete: boolean } {
  if (!snap || snap.pvs.length === 0) return { pvs: [], complete: false };
  const newest = Math.max(...snap.pvs.map((p) => p.round));
  const round: PvSnapshot[] = snap.pvs
    .filter((p) => p.round === newest)
    .sort((a, b) => a.index - b.index);
  if (!round.find((p) => p.index === 0)?.line[0]) return { pvs: [], complete: false };
  const usable: ProvePv[] = round.flatMap((p) => {
    const head = p.line[0];
    // 승률은 끝까지 없을 수 있다 — `INFO WINRATE` 없는 블록은 아무것도 말하지 않았다(0% 가 아니다).
    return head ? [{ move: head, winRate: p.winRate, mate: p.mate ?? 0, depth: p.depth }] : [];
  });
  return { pvs: usable, complete: usable.length === round.length };
}

/** 깊이 예산을 다 읽었나 — 모든 PV 가 그 깊이에 닿아야. */
function depthDone(s: AnalysisSnapshot, depth: number): boolean {
  if (s.stats.depth < depth) return false;
  return s.pvs.every((p) => p.depth >= depth);
}

export async function runProve(
  rootMoves: readonly Move[],
  size: number,
  options: ProveOptions,
  port: ProvePort,
  hooks: ProveHooks,
): Promise<{ outcome: ProveOutcome; tree: ProveTree; failed: string | null }> {
  const tree = new ProveTree(options, size, hooks.log);
  let searches = 0;
  let dbWrites = 0;
  let current = -1;
  const dbp = port.db ?? null;
  let failed: string | null = null;
  const rootLen = rootMoves.length;
  const info = (budget: number): EngineCommand[] => [
    { kind: "info", key: "max_node", value: -1 },
    { kind: "info", key: "max_depth", value: options.byDepth ? budget : size * size },
  ];

  const progress = (extra: Partial<ProveProgress> = {}) => {
    const node = tree.get(Math.max(0, current));
    const parent = node.parent >= 0 ? tree.get(node.parent) : null;
    const cand = parent?.isOr && parent.alt.length > 0;
    hooks.onProgress({
      running: true,
      phase: "idle",
      resolved: tree.resolvedCount,
      searches,
      dbWrites,
      open: tree.openCount(),
      nodes: tree.count,
      path: tree.path(Math.max(0, current)),
      attack: node.isOr,
      budget: 0,
      byDepth: options.byDepth,
      elapsedSec: 0,
      depth: 0,
      mate: 0,
      winRatePct: 0,
      candIndex: cand ? parent!.altNext + 1 : 0,
      candTotal: cand ? parent!.alt.length + 1 : 0,
      ...extra,
    });
  };

  hooks.log(
    `증명: ${rootLen % 2 === 0 ? "흑" : "백"} 차례, 노드당 예산 ` +
      `${options.byDepth ? `d${options.depth0}..${options.depthMax}` : `${options.budget0Sec}..${options.budgetMaxSec}초`}, ` +
      `nbest ${options.nbest} · ${dbp ? "DB 붙음(질의 · 기록)" : "DB 없음(결론은 이 실행 안에서만)"}`,
  );
  hooks.onOverlay(tree.overlay(null, rootLen));

  /**
   * `prove_flush_writes`(main.c:9505) — 쌓인 결론을 DB 에 쓴다. yixindb 라벨은 **둔 쪽 관점**이라
   * 둘 차례가 이기는 마디는 `L` 로 적는다(`proveWriteTag`). DB 가 없으면 비우기만 한다.
   */
  const flushWrites = async () => {
    for (let i = tree.popWrite(); i !== null; i = tree.popWrite()) {
      if (!dbp || hooks.isCancelled()) continue;
      const w = tree.get(i);
      const winForStm = (w.result === "win") === w.isOr;
      progress({ phase: "edit" });
      if (await dbp.write([...rootMoves, ...w.moves], winForStm, w.value, w.recDepth)) dbWrites++;
    }
  };

  let forced: number | null = null;
  for (;;) {
    if (hooks.isCancelled()) break;
    if (tree.root.state === "resolved") {
      await flushWrites();
      break;
    }
    const next: number | null = forced ?? tree.pickNext();
    forced = null;
    if (next === null) break;
    current = next;
    hooks.onOverlay(tree.overlay(current, rootLen));
    const n = tree.get(next);
    // `prove_send_query`(main.c:9435) — DB 가 이미 아는 마디는 탐색하지 않는다.
    if (dbp) {
      progress({ phase: "query" });
      const rec = await dbp.query([...rootMoves, ...n.moves]);
      if (hooks.isCancelled()) break;
      const verdict = rec ? proveVerdict(rec.label, n.isOr) : null;
      if (rec && verdict) {
        tree.resolve(
          next,
          verdict,
          "db",
          rec.value,
          rec.depth,
          rec.label === 0x64 ? "db draw" : "db",
        );
        await flushWrites();
        hooks.onOverlay(tree.overlay(current, rootLen));
        progress();
        continue;
      }
    }
    const budget = Math.min(n.budget, maxBudget(options));
    // 시간 방식은 예산이 곧 끈이다. 깊이 방식은 초 상한을 끈으로 빌린다 — 깊이만으로는 모든
    // 방어를 그 깊이로 읽는 AND 마디를 묶지 못한다(main.c:9484).
    const leash = options.byDepth ? depthLeashMs(options) : budget;
    const t0 = hooks.now();
    let timedOut = false;
    let stopped = false;
    const stopOnce = () => {
      if (!stopped) {
        stopped = true;
        port.stop();
      }
    };
    // 감시견은 끈 위에 — 느린 엔진이 아니라 말없는 엔진에 답한다.
    const watchdog = setTimeout(
      () => {
        timedOut = true;
        hooks.log(`증명: 엔진 응답 없음 (${tree.path(next)}), 다시 시도`);
        stopOnce();
      },
      (Math.floor(leash / 1000) * 2 + 60) * 1000,
    );
    progress({ phase: "search", budget });
    const snap = await port.search(
      placementsOf([...rootMoves, ...n.moves]),
      {
        totalMs: leash,
        nbest: n.isOr ? (n.k > 0 ? n.k : options.nbest) : 0,
        info: info(budget),
        defend: !n.isOr,
      },
      (s) => {
        if (s.instant) stopOnce();
        else if (options.byDepth && depthDone(s, budget)) stopOnce();
        else if (hooks.isCancelled()) stopOnce();
        progress({
          phase: "search",
          budget,
          elapsedSec: Math.floor((hooks.now() - t0) / 1000),
          depth: s.stats.depth,
          mate: s.stats.mate ?? 0,
          winRatePct: s.stats.winRatePct ?? 0,
        });
      },
    );
    clearTimeout(watchdog);
    searches++;
    if (hooks.isCancelled()) break;
    if (!snap) {
      failed = "엔진이 내려가 증명을 멈췄습니다";
      break;
    }
    let step: ProveStep;
    if (timedOut) step = tree.onTimeout(next);
    else {
      const { pvs, complete } = capturePvs(snap);
      step = tree.onSearchResult(next, pvs, complete);
    }
    if (step === "retry") forced = next;
    await flushWrites();
    hooks.onOverlay(tree.overlay(current, rootLen));
    progress();
  }

  const root = tree.root;
  const outcome: ProveOutcome = {
    cancelled: hooks.isCancelled() || failed !== null,
    resolved: root.state === "resolved",
    win: root.result === "win",
    kind: root.kind,
    blackToMove: rootLen % 2 === 0,
    searches,
    conclusions: tree.resolvedCount,
    dbWrites: dbp ? dbWrites : null,
    attackerWinRatePct: Math.round(root.wratt * 100),
  };
  return { outcome, tree, failed };
}

/** 증명을 시작할 수 없는 국면인가 — 이미 승부가 났으면 까닭(main.c:9867-9882). */
export function proveRefusal(rootMoves: readonly Move[], size: number): string | null {
  if (rootMoves.length >= size * size) return "증명: 판이 가득 찼습니다";
  if (refereeResult(rootMoves, size, ALLOW_OVERLINE) !== null)
    return "증명: 이미 승부가 결정된 국면입니다";
  return null;
}
