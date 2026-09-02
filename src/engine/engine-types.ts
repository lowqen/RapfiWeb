import type { Move } from "../core/model/move";

/**
 * 엔진 계층의 타입 — 명령·응답·집계 결과·워커 메시지.
 *
 * 앱의 `domain/engine/EngineResponse.kt` 를 옮긴 것이되 **W3 범위로 줄였다.**
 * 데이터베이스(`MESSAGE DATABASE …`), 오프닝 협상(`SWAP2`/`SOOSORV`), 증명 오버레이는
 * 지금 `Message` 로 떨어지고 W6·W4 에서 각자의 갈래를 얻는다 — 파서가 그 줄들을
 * **버리지 않는다**는 것만 지금 지킨다(원문이 `raw` 에 남는다).
 */

// ── 명령 ─────────────────────────────────────────────────────────────

/** 보드 한 칸. `own` 은 «내 돌»(엔진이 둘 색) 여부다 — 좌표가 아니라 관점의 문제다. */
export interface Placement {
  move: Move;
  own: boolean;
}

export type EngineCommand =
  | { kind: "about" }
  | { kind: "start"; size: number }
  | { kind: "restart" }
  | { kind: "begin" }
  | { kind: "turn"; move: Move }
  | { kind: "board"; stones: readonly Placement[] }
  /** Rapfi 확장: 수를 두지 않고 분석용 국면만 세운다. */
  | { kind: "yxboard"; stones: readonly Placement[] }
  | { kind: "yxnbest"; n: number }
  | { kind: "info"; key: string; value: string | number }
  /**
   * Rapfi 를 **상세(Yixin) 출력 모드**로 바꾼다.
   *
   * 이걸 보내지 않으면 엔진은 사람이 읽는 `MESSAGE Depth 2-3 | Eval 814 | …` 만
   * 뱉고 `INFO PV/DEPTH/EVAL/WINRATE/BESTLINE` 블록은 한 줄도 오지 않는다.
   * 분석 UI 전체가 그 블록 위에 서 있으므로 **기동 직후 반드시 보낸다**
   * (데스크톱도 `init_engine()` 에서 정확히 이 짝을 보낸다, main.c:14465).
   */
  | { kind: "showDetail"; level: number }
  | { kind: "yxshowinfo" }
  | { kind: "yxshowforbid" }
  | { kind: "stop" }
  | { kind: "end" }
  | { kind: "raw"; line: string };

// ── 응답 ─────────────────────────────────────────────────────────────

export type EngineResponse =
  | { kind: "about"; fields: Record<string, string>; raw: string }
  | { kind: "ok"; raw: string }
  | { kind: "error"; text: string; raw: string }
  | { kind: "debug"; text: string; raw: string }
  | { kind: "message"; text: string; raw: string }
  | { kind: "unknown"; raw: string }
  /** 확정 착수. 한 줄에 둘이 올 수 있다(오프닝 협상). */
  | { kind: "bestMove"; moves: readonly Move[]; raw: string }
  | { kind: "forbid"; cells: readonly Move[]; raw: string }
  | { kind: "capability"; key: string; value: string; raw: string }

  // INFO 스트림 — 상세 모드에서만 온다
  | { kind: "infoPvStart"; index: number; raw: string }
  | { kind: "infoPvDone"; raw: string }
  | { kind: "infoNumPv"; count: number; raw: string }
  | { kind: "infoDepth"; depth: number; raw: string }
  | { kind: "infoBestline"; line: readonly Move[]; raw: string }
  | { kind: "infoWinRate"; winRate: number; raw: string }
  | { kind: "infoEval"; mate: number | null; cp: number | null; raw: string }
  | { kind: "infoStat"; key: "NODE" | "NODES" | "SPEED" | "TIME"; value: number; raw: string }

  // 사람이 읽는 한 줄 요약 — 상세 모드가 아닐 때의 유일한 정보원
  | {
      kind: "thinking";
      depth: number | null;
      selDepth: number | null;
      evalCp: number | null;
      mate: number | null;
      timeMs: number | null;
      nodes: number | null;
      speed: number | null;
      line: readonly Move[];
      raw: string;
    }

  // MESSAGE REALTIME — 탐색 중 보드 오버레이
  | { kind: "realtimeBest"; move: Move; raw: string }
  | { kind: "realtimeLose"; move: Move; raw: string }
  | { kind: "realtimePos"; move: Move; raw: string }
  | { kind: "realtimeDone"; move: Move; raw: string }
  | { kind: "realtimeRefresh"; raw: string }
  | { kind: "realtimePv"; line: readonly Move[]; raw: string }
  | { kind: "realtimeVal"; value: number; raw: string };

// ── 집계 결과 ────────────────────────────────────────────────────────

export interface PvSnapshot {
  index: number;
  depth: number;
  winRate: number | null;
  mate: number | null;
  evalCp: number | null;
  line: readonly Move[];
  /** 이 PV 가 쓰인 심화 라운드. 오래된 줄을 걷어내는 데 쓴다. */
  round: number;
}

export interface SearchStats {
  depth: number;
  selDepth: number | null;
  evalCp: number | null;
  mate: number | null;
  winRatePct: number | null;
  nodes: number | null;
  speed: number | null;
  timeMs: number | null;
}

export const EMPTY_STATS: SearchStats = {
  depth: 0,
  selDepth: null,
  evalCp: null,
  mate: null,
  winRatePct: null,
  nodes: null,
  speed: null,
  timeMs: null,
};

/** 한 점에 붙는 값 라벨. 보드의 값 칩이 이것을 그린다. */
export interface CellTag {
  label: string;
  kind: "win" | "lose" | "rate";
  winRatePct?: number;
  /** 어느 라운드에 쓰였나. 데스크톱과 같은 규칙으로 낡은 태그를 지운다. */
  round: number;
}

/** 보드가 한 프레임에 필요한 분석 결과 전부. */
export interface AnalysisSnapshot {
  stats: SearchStats;
  pvs: readonly PvSnapshot[];
  /** `moveKey` → 태그. */
  tags: ReadonlyMap<number, CellTag>;
  candidates: ReadonlyMap<number, "live" | "done">;
  loseCells: ReadonlySet<number>;
  bestMove: Move | null;
  /** 최선 수순(고스트 돌). 실시간 PV 가 있으면 그것, 없으면 1번 PV. */
  bestLine: readonly Move[];
}

export const EMPTY_SNAPSHOT: AnalysisSnapshot = {
  stats: EMPTY_STATS,
  pvs: [],
  tags: new Map(),
  candidates: new Map(),
  loseCells: new Set(),
  bestMove: null,
  bestLine: [],
};

// ── 워커 메시지 ──────────────────────────────────────────────────────

export type EngineStatus = "idle" | "starting" | "ready" | "searching" | "error";

export type ToWorker =
  | { type: "boot"; engineBaseUrl: string; variant: string; sliceMs: number; size: number }
  | { type: "send"; commands: readonly EngineCommand[] }
  /** 시간 분할 탐색. 조각 사이에 워커의 이벤트 루프가 돌아온다. */
  | { type: "search"; commands: readonly EngineCommand[]; totalMs: number }
  | { type: "stop" }
  | { type: "shutdown" };

export type FromWorker =
  | { type: "booted"; version: string; bootMs: number; about: Record<string, string> }
  /** 집계된 스냅샷. 메인 스레드는 원시 줄이 아니라 이것을 받는다. */
  | { type: "snapshot"; snapshot: SerializableSnapshot }
  /** 콘솔용 원시 줄. 저주파 배치. */
  | { type: "console"; lines: readonly string[] }
  | { type: "bestMove"; moves: readonly Move[] }
  | { type: "forbid"; cells: readonly Move[] }
  | { type: "searchDone"; reason: "finished" | "stopped" | "timeout"; elapsedMs: number }
  | { type: "exit"; code: number }
  | { type: "fatal"; message: string };

/**
 * `postMessage` 로 건너갈 수 있는 모양. 구조화 복제는 `Map`/`Set` 을 그대로
 * 나르지만, 배열이 디버깅과 시험에서 훨씬 다루기 쉬워 경계에서 편다.
 */
export interface SerializableSnapshot {
  stats: SearchStats;
  pvs: readonly PvSnapshot[];
  tags: readonly [number, CellTag][];
  candidates: readonly [number, "live" | "done"][];
  loseCells: readonly number[];
  bestMove: Move | null;
  bestLine: readonly Move[];
}

export const toSerializable = (s: AnalysisSnapshot): SerializableSnapshot => ({
  stats: s.stats,
  pvs: s.pvs,
  tags: [...s.tags],
  candidates: [...s.candidates],
  loseCells: [...s.loseCells],
  bestMove: s.bestMove,
  bestLine: s.bestLine,
});

export const fromSerializable = (s: SerializableSnapshot): AnalysisSnapshot => ({
  stats: s.stats,
  pvs: s.pvs,
  tags: new Map(s.tags),
  candidates: new Map(s.candidates),
  loseCells: new Set(s.loseCells),
  bestMove: s.bestMove,
  bestLine: s.bestLine,
});
