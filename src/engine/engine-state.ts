import { create } from "zustand";
import type { Move } from "../core/model/move";
import {
  EngineClient,
  detectCapabilities,
  type Capabilities,
  type EngineVariant,
  type OpeningResponse,
} from "./engine-client";
import {
  EMPTY_SNAPSHOT,
  type AnalysisSnapshot,
  type EngineCommand,
  type EngineStatus,
  type Placement,
} from "./engine-types";
import { toEvalView, type EvalView } from "./eval-view";

/**
 * 엔진의 화면쪽 그림자.
 *
 * 클라이언트를 **여기서 하나만** 들고 있는다. 화면이 여럿이어도 엔진은 하나이고,
 * 라우팅으로 화면을 떠나도 탐색은 계속돼야 한다 — 워커가 살아 있는 한 스토어도 산다.
 *
 * **자동으로 기동하지 않는다.** `public/engine/` 이 비어 있을 수 있고(엔진 산출물은
 * 릴리스 자산으로 나른다), 없는 파일을 받으러 가서 콘솔에 404 를 남길 이유가 없다.
 * 사용자가 「엔진 시작」을 누르거나 분석을 요청할 때 뜬다.
 */

/** 콘솔 링버퍼 상한. 앱과 같은 값(계획서 §3). */
const CONSOLE_MAX = 5000;

/**
 * 후보 수(`YXNBEST n`) 범위. **기본은 1** — 앱(`EngineParams.multiPv`)·데스크톱처럼 최선
 * 한 수를 깊이 읽는 것이 기본이고, 후보 여럿은 필요할 때 설정에서 늘린다. 후보를
 * 늘리면 같은 시간에 수마다 나눠 읽어 최선수의 깊이가 얕아진다.
 */
export const MULTI_PV = { min: 1, max: 10, initial: 1 } as const;

interface EngineState {
  status: EngineStatus;
  capabilities: Capabilities;
  snapshot: AnalysisSnapshot;
  console: readonly string[];
  error: string | null;
  /** 마지막 확정 착수. `TURN`/`BEGIN` 의 응답이다(분석에서는 오지 않는다). */
  lastBestMove: Move | null;
  forbidden: readonly Move[];
  /**
   * 분석이 요청할 후보 수(`YXNBEST n`). 다음 「분석」부터 적용된다 — 도는 탐색의
   * 명령을 도중에 바꾸면 조각마다 후보 수가 달라져 PV 목록이 흔들린다.
   */
  multiPv: number;
  setMultiPv: (n: number) => void;
  /**
   * 분석 한 번의 예산(ms). **기본은 무제한**(`Infinity`) — 정지나 새 국면이 올
   * 때까지 읽는다. 설정 화면이 5초·10초 같은 유한 예산으로 바꿀 수 있다.
   */
  analysisMs: number;
  setAnalysisMs: (ms: number) => void;
  /**
   * 사용자가 분석을 **켜 두었는가**. 탐색 하나하나가 아니라 의도다 — 국면이 바뀌면
   * 새 국면을 이어 읽고, 다른 명령에 잠깐 밀려 끝나도 다시 잇는다. 정지·종료·
   * 대국의 착수·유한 예산 소진만 끈다.
   */
  analyzing: boolean;
  /**
   * 평가 바가 그릴 값(흑 관점). 스냅샷이 **받아들여질 때** 그 탐색 국면의 차례로
   * 돌려 둔다 — 화면에서 스냅샷과 지금 판을 짝지으면, 수를 둔 직후(새 탐색의 첫
   * 스냅샷이 오기 전) 옛 값을 새 차례로 읽어 바가 뒤집힌다. 새 탐색이 아직 아무것도
   * 모르면 앞 값을 그대로 둔다(체스닷컴의 바처럼 비지 않는다).
   */
  evalView: EvalView | null;
  /** 떠 있는 엔진 — 어느 변형인지, 물러섰다면 왜. */
  engine: RunningEngine;
  /** 엔진에 실제로 보낸 스레드 수. 아직 안 보냈으면 null. */
  appliedThreads: number | null;
  /**
   * 멀티스레드 변형을 써도 되는가(설정). 끄면 환경이 되어도 단일로 띄운다. 바꾸면
   * 다음 기동부터 — 떠 있는 엔진은 `restart` 로 다시 띄운다.
   */
  allowThreads: boolean;
  setAllowThreads: (on: boolean) => void;
  /** 엔진을 내렸다가 다시 띄운다(변형 전환). 해시와 분석 의도는 잃는다. */
  restart: () => Promise<void>;
  /**
   * 엔진 파라미터(`INFO caution_factor` 등). 기동하면 한 번, 바뀌면 다시 보낸다.
   * **탐색 중에는 보내지 않고 미뤘다가** 다음 탐색 직전에 보낸다 — 워커는 줄에 선
   * 명령을 처리하려고 도는 분석을 멈추므로, 설정 하나 바꿨다고 분석이 끊기면 안 된다.
   */
  configure: (config: EngineConfig) => void;

  start: () => Promise<void>;
  analyze: (stones: readonly Placement[], totalMs?: number) => Promise<void>;
  /** 대국의 한 수. 분석과 달리 조각으로 나누지 않는다. */
  play: (
    stones: readonly Placement[],
    emptyBoard: boolean,
    budget?: { turnMs?: number; matchMs?: number; matchLeftMs?: number },
  ) => Promise<void>;
  /** 명령 몇 개를 그대로 보낸다(협상 단계 등). */
  send: (...cmds: EngineCommand[]) => void;
  stop: () => void;
  terminate: () => void;
  clearConsole: () => void;
}

let client: EngineClient | null = null;

/** 엔진에 밀어 넣는 설정 — 화면의 설정 스토어가 만들어 건넨다. */
export interface EngineConfig {
  /** 기동 직후와 변경 때 보내는 `INFO` 명령들. */
  info: readonly EngineCommand[];
  /** 탐색마다 앞서 `YXHASHCLEAR` 를 보낸다(데스크톱의 「해시 자동 지우기」). */
  hashAutoClear: boolean;
  /**
   * 원하는 스레드 수. 실제로 보내는 값은 떠 있는 변형이 정한다(`threadCommand`) —
   * 단일 변형에는 늘 1 이다.
   */
  threads: number;
}

/** 실제로 떠 있는 엔진. 뜨기 전·종료 뒤에는 변형이 null 이다. */
export interface RunningEngine {
  variant: EngineVariant | null;
  threaded: boolean;
  maxThreads: number | null;
  /** 멀티를 시도했다가 단일로 물러섰다면 그 까닭. */
  fallbackReason: string | null;
}

const NO_ENGINE: RunningEngine = {
  variant: null,
  threaded: false,
  maxThreads: null,
  fallbackReason: null,
};

/**
 * 엔진이 받아들일 수 있는 스레드 수의 상한. 코어 수와 엔진이 알린 상한 중 작은 쪽,
 * 그리고 16 을 넘지 않는다 — 코어보다 많은 스레드는 탐색을 늦출 뿐이고, 스레드마다
 * 스택(2MB)과 워커가 붙는다. 코어 수를 모르면 4.
 */
export function threadCap(hardwareConcurrency: number | null, maxThreads: number | null): number {
  const cores = hardwareConcurrency && hardwareConcurrency > 0 ? hardwareConcurrency : 4;
  return Math.max(1, Math.min(cores, maxThreads ?? cores, 16));
}

/**
 * `INFO THREAD_NUM` 한 줄 — 데스크톱 `set_threadnum`, 앱 `EngineParams.infoPairs()` 의
 * `thread_num` 과 같은 키다. **단일 변형이면 언제나 1** — 그 빌드는 다른 값을 받고
 * 무시하는데(W0c 실측), 보내면 설정이 거짓말이 된다.
 */
export function threadCommand(
  threaded: boolean,
  requested: number,
  cap: number,
): { command: EngineCommand; threads: number } {
  const threads = threaded ? Math.max(1, Math.min(cap, Math.round(requested))) : 1;
  return { command: { kind: "info", key: "thread_num", value: threads }, threads };
}

let config: EngineConfig = { info: [], hashAutoClear: false, threads: 1 };
/** 보내지 못하고 미룬 설정이 있는가. */
let configDirty = false;
/**
 * 이 엔진에 마지막으로 보낸 `INFO` 값(키 → 값). 바뀐 것만 보낸다 — 스레드 수 하나를
 * 바꿨다고 `hash_size` 까지 다시 보내면 엔진이 해시 표를 다시 잡을 수 있다. 엔진이
 * 새로 뜰 때마다(`onBooted`) 비운다 — 새 엔진은 아무것도 모른다.
 */
const sentInfo = new Map<string, string>();
/** 마지막으로 분석한 국면 — 밀려 끝난 분석을 다시 이을 때 쓴다. */
let analysisStones: readonly Placement[] = [];
/** 마지막 탐색 요청 국면의 돌 수 — 짝수면 흑 차례. 평가 바의 관점을 정한다. */
let requestPly = 0;

/**
 * 대국 상태 기계가 여기 걸어 두는 손잡이들.
 *
 * `engine-state` 가 `gameStore` 를 직접 부르면 두 모듈이 서로를 import 하게 된다.
 * 대신 게임 쪽이 자기 처리기를 등록한다 — 엔진은 「대국」이라는 것을 몰라도 된다.
 */
let gameHandlers: {
  onEngineMove?: (moves: readonly Move[]) => void;
  onOpening?: (r: OpeningResponse) => void;
  onForbid?: (cells: readonly Move[]) => void;
} = {};

export const setGameHandlers = (h: typeof gameHandlers) => {
  gameHandlers = h;
};

/**
 * 등록된 손잡이를 꺼내 본다 — **시험이 엔진 응답을 흉내 내는 유일한 통로**다.
 * 협상 전체를 실제 워커 없이 돌리려면 「엔진이 이렇게 답했다」를 넣을 자리가
 * 필요하고, 그 자리가 여기다. 화면 코드는 이걸 쓰지 않는다.
 */
export const getGameHandlers = () => gameHandlers;

/**
 * 예외를 사람이 읽을 문장으로. `String(e)` 만 쓰면 평범한 객체가
 * «[object Object]» 로 화면에 뜬다 — 실제로 그렇게 나와서 한 런을 헤맸다.
 */
function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

export const useEngineStore = create<EngineState>((set, get) => {
  /** 미룬 설정을 보낸다. 엔진이 놀 때만 부른다(탐색 직전 포함). */
  const flushConfig = (c: EngineClient) => {
    if (!configDirty) return;
    configDirty = false;
    // 스레드 수는 **엔진이 놀 때만** 바뀐다 — 이 함수는 기동 직후·탐색 직전·대기 중
    // 설정 변경에서만 불린다. 탐색 중에 스레드 풀을 다시 세우면 엔진이 도는 스레드를
    // 허무는 셈이다(워커도 탐색 중에는 YXSTOP 말고 아무것도 보내지 않는다).
    const e = get().engine;
    const { command, threads } = threadCommand(
      e.threaded,
      config.threads,
      threadCap(c.capabilities.hardwareConcurrency, e.maxThreads),
    );
    const fresh = [...config.info, command].filter(
      (cmd) => cmd.kind !== "info" || sentInfo.get(cmd.key) !== String(cmd.value),
    );
    if (fresh.length) c.send(...fresh);
    for (const cmd of fresh) if (cmd.kind === "info") sentInfo.set(cmd.key, String(cmd.value));
    set({ appliedThreads: threads });
  };

  /** 분석 요청 하나. 의도(`analyzing`)는 부르는 쪽이 정한다. */
  const runAnalysis = (c: EngineClient, stones: readonly Placement[], totalMs?: number) => {
    flushConfig(c);
    if (config.hashAutoClear) c.send({ kind: "raw", line: "YXHASHCLEAR" });
    analysisStones = stones;
    requestPly = stones.length;
    const nbest = get().multiPv;
    const budget = totalMs ?? get().analysisMs;
    // exactOptionalPropertyTypes: 무제한은 키를 비워 둔다(클라이언트 기본값이 무제한).
    c.analyze(stones, Number.isFinite(budget) ? { totalMs: budget, nbest } : { nbest });
  };

  const ensure = (): EngineClient => {
    if (client) return client;
    client = new EngineClient({
      onStatus: (status) => set({ status }),
      onSnapshot: (snapshot) =>
        set((s) => ({ snapshot, evalView: toEvalView(snapshot.stats, requestPly) ?? s.evalView })),
      onConsole: (lines) =>
        set((s) => {
          const next = [...s.console, ...lines];
          return { console: next.length > CONSOLE_MAX ? next.slice(-CONSOLE_MAX) : next };
        }),
      onBestMove: (moves) => {
        set({ lastBestMove: moves[0] ?? null });
        gameHandlers.onEngineMove?.(moves);
      },
      onOpening: (r) => gameHandlers.onOpening?.(r),
      onForbid: (cells) => {
        set({ forbidden: cells });
        gameHandlers.onForbid?.(cells);
      },
      onError: (error) => set({ error }),
      onBooted: (info) => {
        sentInfo.clear();
        set({
          engine: {
            variant: info.variant,
            threaded: info.threaded,
            maxThreads: info.maxThreads,
            fallbackReason: info.fallbackReason,
          },
        });
        // 멈춘 멀티 엔진을 단일로 다시 띄웠다 — 새 엔진은 설정을 모르고, 켜 둔 분석은
        // 끊겼다. 처음 기동은 `start`·`analyze` 가 이 일을 하므로 여기서는 복구만 본다.
        const c = client;
        if (!info.recovered || !c) return;
        configDirty = true;
        flushConfig(c);
        if (get().analyzing) runAnalysis(c, analysisStones);
      },
      onSearchDone: (mode, reason) => {
        if (mode !== "analyze" || !get().analyzing) return;
        const c = client;
        if (reason === "stopped" && c) {
          // **밀려서 끝났다** — 정지 버튼이 아니라(그건 `analyzing` 을 먼저 끈다)
          // 줄에 선 다른 명령(기권 알림 등)이 비켜 달라고 한 것이다. 그 명령은
          // 이미 처리됐으니 같은 국면을 이어 읽는다. 해시가 남아 있어 깊이도 잇는다.
          runAnalysis(c, analysisStones);
          return;
        }
        // 유한 예산을 다 썼다 — 사용자가 고른 끝이다.
        set({ analyzing: false });
      },
    });
    return client;
  };

  return {
    status: "idle",
    capabilities: detectCapabilities(),
    snapshot: EMPTY_SNAPSHOT,
    console: [],
    error: null,
    lastBestMove: null,
    forbidden: [],
    multiPv: MULTI_PV.initial,
    setMultiPv: (n) =>
      set({ multiPv: Math.min(MULTI_PV.max, Math.max(MULTI_PV.min, Math.round(n))) }),
    analysisMs: Infinity,
    setAnalysisMs: (ms) => set({ analysisMs: ms > 0 ? ms : Infinity }),
    analyzing: false,
    evalView: null,
    engine: NO_ENGINE,
    appliedThreads: null,
    allowThreads: true,
    setAllowThreads: (on) => set({ allowThreads: on }),

    restart: async () => {
      get().terminate();
      await get().start();
    },

    configure: (next) => {
      config = next;
      configDirty = true;
      // 놀고 있으면 지금 보낸다. 탐색 중이거나 아직 뜨지 않았으면 미룬다 —
      // 기동이 끝나는 자리와 다음 탐색 직전이 받아 보낸다.
      if (client && client.currentStatus === "ready") flushConfig(client);
    },

    start: async () => {
      set({ error: null });
      try {
        const c = ensure();
        await c.start(get().allowThreads);
        // 기동 직후 한 번. 엔진은 자기 기본값(스타일·해시…)으로 떠 있다.
        configDirty = true;
        flushConfig(c);
      } catch (e) {
        set({ error: describe(e), status: "error" });
      }
    },

    analyze: async (stones, totalMs) => {
      const c = ensure();
      set({ error: null, analyzing: true });
      try {
        if (c.currentStatus === "idle" || c.currentStatus === "error") {
          await c.start(get().allowThreads);
          configDirty = true;
        }
        // 기동을 기다리는 사이에 정지·착수가 의도를 껐다면 시작하지 않는다.
        if (!get().analyzing) return;
        runAnalysis(c, stones, totalMs);
      } catch (e) {
        set({ error: describe(e), status: "error", analyzing: false });
      }
    },

    play: async (stones, emptyBoard, budget) => {
      const c = ensure();
      // 대국의 착수가 엔진을 가져간다 — 분석 의도는 여기서 끝난다. 켜 둔 채면
      // 엔진이 답하자마자 분석이 다시 붙어 대국과 엔진을 나눠 쓰게 된다.
      set({ error: null, analyzing: false });
      try {
        if (c.currentStatus === "idle" || c.currentStatus === "error") {
          await c.start(get().allowThreads);
          configDirty = true;
        }
        flushConfig(c);
        if (config.hashAutoClear) c.send({ kind: "raw", line: "YXHASHCLEAR" });
        requestPly = stones.length;
        c.play(stones, emptyBoard, budget ?? {});
      } catch (e) {
        set({ error: describe(e), status: "error" });
      }
    },

    send: (...cmds) => {
      // 엔진이 아직 없으면 조용히 흘린다 — 「엔진 시작」 전에 눌린 버튼이다.
      client?.send(...cmds);
    },

    stop: () => {
      // 의도를 **먼저** 끈다 — 그래야 뒤따르는 searchDone 이 「밀렸다」로 읽혀
      // 분석이 다시 붙지 않는다.
      set({ analyzing: false });
      client?.stop();
    },

    terminate: () => {
      client?.terminate();
      client = null;
      set({
        status: "idle",
        snapshot: EMPTY_SNAPSHOT,
        lastBestMove: null,
        analyzing: false,
        evalView: null,
        engine: NO_ENGINE,
        appliedThreads: null,
      });
      // 다음 기동은 새 엔진이다 — 설정을 처음부터 다시 보낸다.
      configDirty = true;
    },

    clearConsole: () => set({ console: [] }),
  };
});

/**
 * 떠 있는 엔진을 꺼내 보는 손잡이 — 스모크가 「멀티로 떴는가」를 이걸로 본다.
 * 화면은 `engine`·`appliedThreads` 를 구독한다.
 */
if (typeof window !== "undefined") {
  (window as unknown as { __rapfiEngine: () => unknown }).__rapfiEngine = () => {
    const s = useEngineStore.getState();
    return { ...s.engine, appliedThreads: s.appliedThreads, status: s.status };
  };
}

/**
 * 콘솔 **전체**를 꺼내 보는 손잡이. 화면은 마지막 40줄만 그리므로, 엔진이
 * 이상하게 굴 때(예: `MaxTime 0ms`) 그 직전에 무엇을 보냈는지가 화면에서
 * 밀려나 있다. 브라우저 개발자 도구에서 `__rapfiConsole()` 로 부르면 되고,
 * 대국 스모크도 이걸로 읽는다.
 */
if (typeof window !== "undefined") {
  (window as unknown as { __rapfiConsole: () => readonly string[] }).__rapfiConsole = () =>
    useEngineStore.getState().console;
}
