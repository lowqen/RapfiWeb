import type { ProveKind, ProveOverlay } from "./prove-tree";

/**
 * 증명의 진행 · 결과 문구 — 앱 `ProveModels.kt` 의 `ProveProgress` · `ProveOutcome` 이식.
 * 문구는 데스크톱 그대로이고, 웹이 다른 곳(DB 가 아직 없다, W8)만 매개변수로 갈린다.
 */

export type ProvePhase = "idle" | "query" | "search" | "edit";

/** 살아 있는 증명 상태 — 배지와 진행 카드가 보이는 전부. */
export interface ProveProgress {
  readonly running: boolean;
  readonly phase: ProvePhase;
  readonly resolved: number;
  readonly searches: number;
  readonly dbWrites: number;
  readonly open: number;
  /** 트리의 마디 수. */
  readonly nodes: number;
  /** 지금 다루는 줄의 표기, 맨 위는 "(root)". */
  readonly path: string;
  /** 지금 마디가 OR(공격) 마디. */
  readonly attack: boolean;
  /** 도는 탐색의 예산: ms, 또는 깊이. */
  readonly budget: number;
  readonly byDepth: boolean;
  readonly elapsedSec: number;
  readonly depth: number;
  readonly mate: number;
  readonly winRatePct: number;
  /** 부모 OR 마디의 공격 후보 번호(1부터), 0 = 해당 없음. */
  readonly candIndex: number;
  readonly candTotal: number;
}

export const IDLE_PROGRESS: ProveProgress = {
  running: false,
  phase: "idle",
  resolved: 0,
  searches: 0,
  dbWrites: 0,
  open: 0,
  nodes: 0,
  path: "",
  attack: true,
  budget: 0,
  byDepth: false,
  elapsedSec: 0,
  depth: 0,
  mate: 0,
  winRatePct: 0,
  candIndex: 0,
  candTotal: 0,
};

/** `prove_badge_lines`(main.c:9223). 첫 줄은 실행 합계, 둘째는 도는 탐색 — 없으면 빈 줄. */
export function badgeLines(p: ProveProgress): [string, string] {
  const first = `증명: 해결 ${p.resolved} / 탐색 ${p.searches} / 미결 ${p.open}`;
  if (p.phase !== "search") return [first, ""];
  const side = p.attack ? "공격" : "방어";
  const value = p.mate !== 0 ? `M${Math.abs(p.mate)}` : `${p.winRatePct}%`;
  let second = p.byDepth
    ? `${side}  d${p.depth}/${p.budget} ${value}  ${p.elapsedSec}s`
    : `${side}  d${p.depth} ${value}  ${p.elapsedSec}s/${Math.floor(p.budget / 1000)}s`;
  if (p.candTotal > 0) second += `  후보 ${p.candIndex}/${p.candTotal}`;
  return [first, second];
}

/** 끝난 실행의 결과(`prove_finish`, main.c:9514). */
export interface ProveOutcome {
  readonly cancelled: boolean;
  readonly resolved: boolean;
  /** 공격 쪽(= 뿌리의 둘 차례)이 이긴다. `resolved` 일 때만 뜻이 있다. */
  readonly win: boolean;
  readonly kind: ProveKind;
  readonly blackToMove: boolean;
  readonly searches: number;
  readonly conclusions: number;
  /** DB 기록 수 — DB 가 없는 실행(웹, W8 전)은 `null`. */
  readonly dbWrites: number | null;
  /** 못 정하고 끝났을 때의 공격 쪽 승률 추정. */
  readonly attackerWinRatePct: number;
}

export const outcomeTitle = (o: ProveOutcome) => (o.cancelled ? "증명 취소" : "증명 완료");

/** 결과 문구 — main.c 가 만드는 그대로, DB 가 없으면 그 부분만 다르게. */
export function outcomeMessage(o: ProveOutcome): string {
  const tally =
    `탐색 ${o.searches}회, 결론 ${o.conclusions}개` +
    (o.dbWrites !== null ? `, DB 기록 ${o.dbWrites}개` : "");
  if (o.resolved) {
    const side = o.blackToMove ? "흑 (차례)" : "백 (차례)";
    const verdict = o.win ? "승리 증명됨" : "승리 불가 (방어 성립/무승부)";
    const by = o.kind === "mate" ? "메이트" : o.kind === "db" ? "데이터베이스" : "승률";
    return `${side}: ${verdict} (${by})\n${tally}`;
  }
  const again =
    o.dbWrites !== null
      ? "다시 실행하면 이어서 계산합니다 (DB 유지)."
      : "DB 가 없어 결론이 남지 않습니다 — 다시 실행하면 처음부터 셉니다.";
  return `미결 (예산 소진), 공격측 승률 ~${o.attackerWinRatePct}%\n${tally}. ${again}`;
}

// ── 덧그림 도움 ──

/** 증명 뿌리는 공격 차례라 홀수 수가 공격. */
export const isAttackPly = (ply: number) => ply % 2 === 1;

/** 덧그림 줄의 `ply` 수째 돌의 색(main.c:9083). */
export const isBlackPly = (o: ProveOverlay, ply: number) => (o.rootLen + ply - 1) % 2 === 0;
