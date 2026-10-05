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
   * 규칙. gomocup 의 `INFO RULE <id>` 이고 id 는 엔진이 정한다
   * (`command/gomocup.cpp`): 0 = 프리스타일, 1 = 스탠다드, **4 = 렌주**,
   * 5 = swap1, 6 = swap2.
   *
   * **START 보다 먼저 보낸다.** 보드가 이미 있으면 규칙 변경이 `board->newGame()`
   * 을 불러 판을 리셋하고 TT 도 비운다. 기동 순서에서는 그럴 이유가 없다.
   */
  | { kind: "rule"; id: 0 | 1 | 4 | 5 | 6 }
  /** Swap2 협상 단계. `yxswap2step<n>` — 인자도 좌표도 없다. */
  | { kind: "yxswap2step"; step: number }
  /**
   * Soosorv-8 협상 단계. Swap2 와 달리 **수 목록을 스스로 들고 간다**:
   * `yxsoosorvstep2` + `y,x` 줄들 + `done`(main.c:2807). 4·5단계는 5수 개수를 받는다.
   */
  | { kind: "yxsoosorvstep"; step: number; fifthCount?: number; moves?: readonly Move[] }
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
  /** 무승부 제안·기권을 엔진에게 알린다. 엔진은 답하지 않고 기록만 한다. */
  | { kind: "yxdraw" }
  | { kind: "yxresign" }
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
  /**
   * 탐색 카운터. Rapfi 상세 모드의 실제 철자(엔진 출력 캡처로 확인):
   *
   *     INFO NODES 21          ← **이 PV(루트 수) 하나의** 노드 수 — 총계가 아니다
   *     INFO TOTALNODES 206    ← 이번 탐색 전체의 누적 노드 수
   *     INFO TOTALTIME 36      ← 이번 탐색의 경과 ms
   *     INFO SPEED 5722        ← 노드/초
   *     INFO SELDEPTH 6
   *
   * `NODE`·`TIME` 은 옛 Yixin 엔진 철자라 받아 둔다.
   */
  | {
      kind: "infoStat";
      key: "NODE" | "NODES" | "TOTALNODES" | "SPEED" | "TIME" | "TOTALTIME" | "SELDEPTH";
      value: number;
      raw: string;
    }

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
  | { kind: "realtimeVal"; value: number; raw: string }

  // MESSAGE SWAP2 … / MESSAGE SOOSORV … — 오프닝 협상 (W4)
  /** `MOVE<n> <y> <x>`. Soosorv 의 MOVE4 는 5수 후보 개수 N 도 함께 알린다. */
  | {
      kind: "openingMove";
      swap2: boolean;
      /** 협상 안에서의 수 번호 1..5. */
      index: number;
      move: Move;
      fifthCount: number | null;
      raw: string;
    }
  /** `SWAP1 YES|NO`(swap2) / `SWAP2 Y|N`(soosorv). `which` 는 1 또는 2. */
  | { kind: "openingSwap"; swap2: boolean; which: number; yes: boolean; raw: string }
  /**
   * `MESSAGE SOOSORV MOVE5 …` — 5수 단계.
   * `C <y> <x>` 는 엔진이 제시된 5수 중 하나를 고른 것(판이 넷으로 되감긴 뒤),
   * `REFRESH`/`DONE` 이 후보 묶음을 여닫고, 맨 `<y> <x>` 하나는 후보다(main.c:13498).
   */
  | {
      kind: "soosorvFifth";
      stage: "choose" | "refresh" | "done" | "offer";
      move: Move | null;
      raw: string;
    };

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
  /**
   * 엔진이 **탐색 없이** 곧바로 좌표만 돌려준 수다(깊이·평가·카운터 없음). Rapfi 는 빈 판의
   * 첫 수(천원)나 오목을 완성하는 수 · 막아야만 하는 수처럼 정해진 자리에서 그렇게 답한다.
   */
  instant: boolean;
}

export const EMPTY_SNAPSHOT: AnalysisSnapshot = {
  stats: EMPTY_STATS,
  pvs: [],
  tags: new Map(),
  candidates: new Map(),
  loseCells: new Set(),
  bestMove: null,
  bestLine: [],
  instant: false,
};

// ── 워커 메시지 ──────────────────────────────────────────────────────

export type EngineStatus = "idle" | "starting" | "ready" | "searching" | "error";

/** 모든 변형이 함께 쓰는 가중치 파일 하나 — `engine-manifest.json` 이 값을 준다. */
export interface WeightsSpec {
  /** 절대 URL(버전 쿼리 포함 — HTTP 캐시가 옛 파일을 내주지 않게). */
  url: string;
  size: number;
  /** 소문자 16진 SHA-256. 캐시에서 꺼낸 것도, 새로 받은 것도 이 값과 맞아야 쓴다. */
  sha256: string;
}

export type ToWorker =
  | {
      type: "boot";
      engineBaseUrl: string;
      variant: string;
      sliceMs: number;
      size: number;
      /** 기동 핸드셰이크 한도(ms). 기본 15초 — 시험이 줄여 쓴다. */
      handshakeMs?: number;
      /**
       * 공유 가중치(.data) — 있으면 워커가 **직접** 받아(캐시 계층, 해시 검증) 글루에
       * `getPreloadedPackage` 로 넘긴다. 없으면 예전처럼 글루가 `rapfi-<변형>.data` 를
       * 스스로 받는다(시험·스파이크 하네스).
       */
      weights?: WeightsSpec;
      /**
       * 기동 직후 예열 탐색 시간(ms). 0·없음이면 건너뛴다. 가중치 풀기(첫 탐색에서 일어난다)와
       * JIT 승격을 사용자의 첫 요청 **앞으로** 당긴다.
       */
      warmupMs?: number;
      /**
       * 기동 설정(`INFO thread_num`·`hash_size` 등) — START 의 OK 뒤, **예열 전에** 보낸다.
       * 예열 뒤에 스레드 수를 바꾸면 엔진이 스레드를 모두 다시 세우며 예열이 푼 가중치를
       * 버리고 다음 탐색에서 다시 푼다(T1: 0.73~0.85초, docs/최적화-마스터플랜.md §3.2-①).
       */
      settings?: readonly EngineCommand[];
    }
  | { type: "send"; commands: readonly EngineCommand[] }
  /**
   * 시간 분할 탐색. 조각 사이에 워커의 이벤트 루프가 돌아온다 — 그 틈에만
   * 정지가 닿는다(단일 스레드 빌드는 탐색 도중에 입력을 읽지 못한다).
   *
   * `setup`(국면 세우기)과 `repeat`(탐색 시작)을 **조각마다 둘 다** 보낸다.
   * 예전엔 setup 을 한 번만 보냈는데, `YXNBEST` 는 탐색이 끝나면 최선수를 엔진
   * 자신의 판에 **실제로 둔다**(`sendActionAndUpdateBoard`). 그래서 조각마다 한
   * 수씩 앞선 국면을 분석해 PV 가 엉뚱한 곳으로 흘렀다. 해시 테이블은 YXBOARD 로
   * 지워지지 않으므로 다시 세워도 깊이는 이어진다.
   *
   * `mode: "move"` 는 **무제한 대국의 한 수**다. 정지(= 「지금 두기」)가 올 때까지
   * 조각을 돌고, 마지막 조각의 최선수를 착수로 올린다. 데스크톱·앱의 기본 레벨
   * (level 0: 시간·노드 무제한, 사용자가 멈추면 둔다)과 같은 동작이다.
   */
  | {
      type: "search";
      mode: "analyze" | "move";
      setup: readonly EngineCommand[];
      repeat: readonly EngineCommand[];
      /** 전체 예산. `Infinity` 면 정지가 올 때까지. */
      totalMs: number;
      /** 요청 번호. `searchDone` 이 그대로 돌려준다 — 밀려난 탐색의 끝을 가려낸다. */
      id: number;
    }
  /**
   * **착수** 요청. 분석과 다르다 — 조각으로 나누지 않고 `INFO timeout_turn` 하나로
   * 묶어 한 번만 돌린다. 대국의 한 수는 시계가 정하는 유한한 일이고, 조각마다
   * 다시 물으면 매번 새 탐색이 되기 때문이다.
   */
  | {
      type: "move";
      commands: readonly EngineCommand[];
      turnMs: number;
      /**
       * `INFO timeout_match` — 대국 전체 예산. 0 이면 무제한.
       *
       * **매 수마다 보낸다.** 엔진의 시간 설정은 이전 명령이 남긴 값이 그대로
       * 살아 있으므로, 착수 요청이 스스로 완결되지 않으면 앞선 값(분석 조각 등)이
       * 새어 든다. 그리고 이 값이 0 이면 Rapfi 는 `time_left` 를 **무시한다**
       * (`TimeControl::init` — matchTime 0 은 무제한) — 5분 대국에서 엔진이 대국
       * 예산을 모른 채 수마다 차례 한도(30초)를 거의 다 쓴 이유다.
       */
      matchMs: number;
      /**
       * `INFO time_left` — 대국 예산의 남은 양. 데스크톱은 매 차례 앞에 이것도
       * 보낸다(main.c:2742). `matchMs` 가 0 이면 엔진이 보지 않는다.
       */
      matchLeftMs?: number;
      /** 요청 번호. `searchDone` 이 그대로 돌려준다. */
      id: number;
    }
  | { type: "stop" }
  | { type: "shutdown" };

/**
 * 탐색이 끝난 까닭. `finished` 는 엔진이 스스로 끝낸 것(유한 착수), `timeout` 은
 * 분석 예산을 다 쓴 것, `stopped` 는 정지 요청이나 새 요청에 밀린 것이다.
 */
export type SearchEndReason = "finished" | "stopped" | "timeout";

/**
 * 기동의 어느 단계인가 — 화면의 로딩 표시가 「무엇을 기다리는지」 말하게 한다.
 * `weights` 가중치(~20MB) 받기·캐시 읽기·해시 확인 → `engine` 글루·wasm 인스턴스와
 * START 핸드셰이크 → `warmup` 예열 탐색. 끝은 `booted` 다.
 */
export type BootPhase = "weights" | "engine" | "warmup";

export type FromWorker =
  /** 기동 단계가 바뀌었다(로딩 표시용 — 프로토콜의 의미는 없다). */
  | { type: "phase"; phase: BootPhase }
  | {
      type: "booted";
      version: string;
      bootMs: number;
      about: Record<string, string>;
      /** 엔진이 제 pthread 에서 도는가(멀티 변형). */
      threaded: boolean;
      /** `MESSAGE INFO MAX_THREAD_NUM` — 단일 빌드도 256 을 답하므로 상한으로만 쓴다. */
      maxThreads: number | null;
      /** 가중치를 어디서 얻었나 — `glue` 는 공유 가중치 없이 글루가 받은 것. */
      weights: { source: "cache" | "network" | "glue"; ms: number };
      /** 예열 탐색에 든 시간(가중치 풀기 포함). 건너뛰었으면 null. */
      warmupMs: number | null;
    }
  /**
   * 집계된 스냅샷. 메인 스레드는 원시 줄이 아니라 이것을 받는다. `id` 는 그 스냅샷을
   * 만든 탐색 요청의 번호다 — 밀려난 탐색이 마지막으로 올린 것(옛 국면의 값)을
   * 클라이언트가 버리게 한다. 평가 바가 옛 값을 새 국면의 차례로 읽으면 뒤집힌다.
   */
  | { type: "snapshot"; id: number; snapshot: SerializableSnapshot }
  /** 콘솔용 원시 줄. 저주파 배치. */
  | { type: "console"; lines: readonly string[] }
  | { type: "bestMove"; moves: readonly Move[] }
  /** 오프닝 협상 응답. 대국 상태 기계가 받는다(W4). */
  | {
      type: "opening";
      response: Extract<
        EngineResponse,
        { kind: "openingMove" } | { kind: "openingSwap" } | { kind: "soosorvFifth" }
      >;
    }
  | { type: "forbid"; cells: readonly Move[] }
  /**
   * 탐색 하나가 끝났다. `id` 는 그 요청의 번호다 — 새 요청에 밀려 끝난 탐색의
   * `searchDone` 은 **뒤따르는 탐색이 도는 중에** 도착한다. 번호로 가르지 않으면
   * 화면이 「대기」로 바뀌고, 그 틈에 금수 조회가 나가 돌고 있는 분석을 끊는다.
   */
  | {
      type: "searchDone";
      id: number;
      mode: "analyze" | "move";
      reason: SearchEndReason;
      elapsedMs: number;
    }
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
  instant: boolean;
}

export const toSerializable = (s: AnalysisSnapshot): SerializableSnapshot => ({
  stats: s.stats,
  pvs: s.pvs,
  tags: [...s.tags],
  candidates: [...s.candidates],
  loseCells: [...s.loseCells],
  bestMove: s.bestMove,
  bestLine: s.bestLine,
  instant: s.instant,
});

export const fromSerializable = (s: SerializableSnapshot): AnalysisSnapshot => ({
  stats: s.stats,
  pvs: s.pvs,
  tags: new Map(s.tags),
  candidates: new Map(s.candidates),
  loseCells: new Set(s.loseCells),
  bestMove: s.bestMove,
  bestLine: s.bestLine,
  instant: s.instant,
});
