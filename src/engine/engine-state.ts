import { create } from "zustand";
import { positionKey, type Move } from "../core/model/move";
import {
  BootAbortedError,
  EngineClient,
  detectCapabilities,
  isMultiVariant,
  type Capabilities,
  type EnginePreference,
  type EngineVariant,
  type OpeningResponse,
} from "./engine-client";
import {
  EMPTY_SNAPSHOT,
  type AnalysisSnapshot,
  type BootPhase,
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
 * **이 스토어는 스스로 기동하지 않는다.** 앱이 뜰 때 셸이 한 번 `start` 를 부른다
 * (`app/useAutoBoot.ts` — 설정 「앱을 열면 엔진 시작」, 주소의 `?autoboot=0` 으로 끈다).
 * 엔진 산출물이 없는 개발 환경에서는 그 기동이 「오류」로 끝나고 화면이 그대로 말한다.
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
  /**
   * `snapshot` 이 **어느 국면**의 것인가(`positionKey`). 아직 아무 탐색도 없으면 null.
   * 화면은 이 키가 지금 판의 키와 같을 때만 값 칩·PV·최선수를 그린다 — 무르기 직후처럼
   * 국면이 바뀌고 새 탐색의 첫 스냅샷이 아직 오지 않은 틈에 옛 값이 새 판에 얹히지 않게.
   */
  snapshotKey: string | null;
  /** 기동 중이면 지금 단계(로딩 표시용). 기동 중이 아니면 null. */
  bootPhase: BootPhase | null;
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
  /** `evalView` 가 어느 국면의 값인가. 평가 바·형세 그래프가 국면과 짝짓는다. */
  evalKey: string | null;
  /** 떠 있는 엔진 — 어느 변형인지, 물러섰다면 왜. */
  engine: RunningEngine;
  /** 엔진에 실제로 보낸 스레드 수. 아직 안 보냈으면 null. */
  appliedThreads: number | null;
  /**
   * 사용자가 고른 엔진(자동 · 멀티 · relaxed · 일반 SIMD — `planOrder`). **바꾸면 떠 있는
   * 엔진을 깨끗이 내리고 그 변형으로 다시 띄운다**(`restart`) — 바이너리가 다르므로
   * 떠 있는 워커를 고쳐 쓸 수 없다. 꺼져 있으면 다음 기동부터.
   */
  enginePreference: EnginePreference;
  setEnginePreference: (p: EnginePreference) => void;
  /**
   * 엔진을 내렸다가 다시 띄운다(변형 전환). 해시는 잃는다. 분석이 켜져 있었으면 새 엔진이
   * 같은 국면을 이어 읽고, 대국에서 엔진이 생각 중이었다면 그 수는 버려진다
   * (`onEngineReset` — 대국이 판을 풀어 사람이 다시 «두어라» 할 수 있다).
   */
  restart: () => Promise<void>;
  /**
   * 엔진 파라미터(`INFO caution_factor` 등). 기동하면 한 번, 바뀌면 다시 보낸다.
   * **탐색 중에는 보내지 않고 미뤘다가** 다음 탐색 직전에 보낸다 — 워커는 줄에 선
   * 명령을 처리하려고 도는 분석을 멈추므로, 설정 하나 바꿨다고 분석이 끊기면 안 된다.
   */
  configure: (config: EngineConfig) => void;

  start: () => Promise<void>;
  analyze: (stones: readonly Placement[], totalMs?: number) => Promise<void>;
  /**
   * 대국의 한 수. 분석과 달리 조각으로 나누지 않는다.
   *
   * `info` 는 **이 착수에만** 얹는 `INFO` 값이다(대국 레벨의 `max_node` 등). 같은 키의
   * 설정값을 이 탐색 동안만 덮고, 다음 분석은 설정값으로 되돌려 보낸다 — 대국의 레벨이
   * 분석을 얕게 만들지 않게(모드 격리).
   */
  play: (
    stones: readonly Placement[],
    emptyBoard: boolean,
    budget?: { turnMs?: number; matchMs?: number; matchLeftMs?: number },
    info?: readonly EngineCommand[],
  ) => Promise<void>;
  /** 명령 몇 개를 그대로 보낸다(협상 단계 등). */
  send: (...cmds: EngineCommand[]) => void;
  /**
   * 엔진을 **독점**하는 작업(게임 리뷰). 있으면 분석(`analyze`)과 착수(`play`)를 받지 않는다 —
   * 앱의 `EngineBusy.REVIEW` 와 같은 자물쇠다. 리뷰는 국면마다 따로 탐색을 걸고, 그 사이에
   * 분석 따라가기나 대국의 착수가 끼면 리뷰의 국면이 엇갈린다.
   */
  owner: EngineOwner | null;
  /** 자물쇠를 잡는다. 못 잡으면 까닭, 잡으면 `null`. 켜 둔 분석은 끈다. */
  acquire: (owner: EngineOwner) => string | null;
  release: (owner: EngineOwner) => void;
  /**
   * 독점 탐색 하나 — 국면을 세우고 `YXNBEST nbest` 로 `totalMs` 동안(무제한이면 정지까지)
   * 읽고, 끝나면 마지막 스냅샷을 돌려준다. 엔진을 내리면(종료 · 변형 전환) `null`.
   * `info` 는 이 탐색에만 얹는 `INFO`(리뷰의 `max_depth` 등) — 다음 분석은 설정값으로 돌아간다.
   * `onSnapshot` 은 도중의 스냅샷마다(깊이 예산이 「다 읽었다」를 정한다).
   */
  exclusiveSearch: (
    stones: readonly Placement[],
    opts: { totalMs: number; nbest: number; info?: readonly EngineCommand[] },
    onSnapshot?: (s: AnalysisSnapshot) => void,
  ) => Promise<AnalysisSnapshot | null>;
  stop: () => void;
  terminate: () => void;
  clearConsole: () => void;
}

let client: EngineClient | null = null;

/** 엔진을 독점할 수 있는 작업. */
export type EngineOwner = "review";

/** 독점 탐색이 기다리는 손잡이 — 그 탐색의 스냅샷과 끝을 받는다. */
let exclusive: {
  onSnapshot?: ((s: AnalysisSnapshot) => void) | undefined;
  done: (s: AnalysisSnapshot | null) => void;
  last: AnalysisSnapshot | null;
} | null = null;

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
  /** 앞선 변형(relaxed·멀티)을 시도했다가 물러섰다면 그 까닭. */
  fallbackReason: string | null;
  /** 가중치를 어디서 얻었나 — `cache` 면 내려받지 않았다. 뜨기 전에는 null. */
  weightsSource: "cache" | "network" | "glue" | null;
  weightsMs: number | null;
  /** 기동 예열 탐색의 시간(가중치 풀기 포함). 건너뛰었거나 뜨기 전이면 null. */
  warmupMs: number | null;
}

const NO_ENGINE: RunningEngine = {
  variant: null,
  threaded: false,
  maxThreads: null,
  fallbackReason: null,
  weightsSource: null,
  weightsMs: null,
  warmupMs: null,
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

/**
 * 기동 메시지에 실을 설정 — `INFO` 목록(`hash_size` 등)과 이 변형의 `thread_num`.
 * 워커가 START 뒤·**예열 전에** 보낸다(docs/최적화-마스터플랜.md P1-1). 예열 뒤에 스레드
 * 수가 바뀌면 엔진이 스레드를 다시 세우며 예열이 푼 가중치를 버린다(0.73~0.85초).
 *
 * 엔진이 알릴 상한(`MAX_THREAD_NUM`)은 아직 모르므로 코어 수로만 자른다. 기동 뒤
 * `flushConfig` 가 엔진의 상한으로 다시 셈해 값이 같으면 보내지 않는다.
 */
export function bootCommands(
  c: EngineConfig,
  threaded: boolean,
  hardwareConcurrency: number | null,
): EngineCommand[] {
  return [
    ...c.info,
    threadCommand(threaded, c.threads, threadCap(hardwareConcurrency, null)).command,
  ];
}

let config: EngineConfig = { info: [], hashAutoClear: false, threads: 1 };
/**
 * 이 엔진에 마지막으로 보낸 `INFO` 값(키 → 값). 바뀐 것만 보낸다 — 스레드 수 하나를
 * 바꿨다고 `hash_size` 까지 다시 보내면 엔진이 해시 표를 다시 잡을 수 있다. 엔진이
 * 새로 뜰 때마다(`onBooted`) 기동 메시지로 보낸 설정만 남기고 비운다.
 *
 * 보낼지 말지는 **언제나 이 표와 견줘** 정한다 — 대국 레벨이 착수 동안만 `max_node` 를
 * 덮었다가 다음 분석이 설정값으로 되돌릴 때도 같은 길이다(바뀐 한 줄만 나간다).
 */
const sentInfo = new Map<string, string>();
/** 마지막으로 분석한 국면 — 밀려 끝난 분석을 다시 이을 때 쓴다. */
let analysisStones: readonly Placement[] = [];
/** 마지막 탐색 요청 국면의 돌 수 — 짝수면 흑 차례. 평가 바의 관점을 정한다. */
let requestPly = 0;
/** 마지막 탐색 요청 국면의 키(`positionKey`). 스냅샷·평가에 꼬리표로 붙는다. */
let requestKey: string | null = null;

const keyOf = (stones: readonly Placement[]) => positionKey(stones.map((p) => p.move));

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
  /**
   * 엔진을 내렸다(종료 · 변형 전환). 생각 중이던 대국의 수는 오지 않는다 — 대국이 판을
   * 풀어야 한다. 없으면 무제한 대국에서 판이 「엔진이 생각 중입니다」로 영영 잠겼다.
   */
  onEngineReset?: () => void;
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
  if (e instanceof Error) return tidy(e.message);
  if (typeof e === "string") return tidy(e);
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

/**
 * 화면에 띄울 오류 한 줄. 워커가 올리는 오류는 스택(`at je (…/engine-worker-….js:1:14127)`)을
 * 달고 오는데, 앱이 뜨자마자 엔진이 기동하므로 그것이 첫 화면에 그대로 박혔다. 스택은 콘솔의
 * 몫이다 — 여기서는 「무엇이」만 남긴다.
 */
export function tidy(message: string): string {
  const lines = message.split("\n").filter((l) => !/^\s*at\s/.test(l));
  const text = lines.join(" ").replace(/\s+at\s+\S+\s+\(\S+:\d+:\d+\)/g, "");
  return text.replace(/^(Uncaught\s+)?Error:\s*/, "").trim();
}

/** 같은 키는 뒤의 것이 이긴다 — 대국 레벨이 설정의 `max_node` 를 덮는다. */
function overlay(base: readonly EngineCommand[], over: readonly EngineCommand[]) {
  const keys = new Set(over.flatMap((c) => (c.kind === "info" ? [c.key] : [])));
  return [...base.filter((c) => c.kind !== "info" || !keys.has(c.key)), ...over];
}

export const useEngineStore = create<EngineState>((set, get) => {
  /**
   * 설정을 엔진에 맞춘다 — 보낸 표(`sentInfo`)와 다른 것만. 엔진이 놀 때만 부른다
   * (기동 직후·탐색 직전·대기 중 설정 변경).
   *
   * `over` 는 이번 탐색에만 얹는 값(대국 레벨). 없으면 설정값 그대로라, 앞 착수가 덮어 둔
   * 값이 있으면 이 자리에서 되돌아간다.
   */
  const flushConfig = (c: EngineClient, over: readonly EngineCommand[] = []) => {
    // 스레드 수는 **엔진이 놀 때만** 바뀐다 — 이 함수는 기동 직후·탐색 직전·대기 중
    // 설정 변경에서만 불린다. 탐색 중에 스레드 풀을 다시 세우면 엔진이 도는 스레드를
    // 허무는 셈이다(워커도 탐색 중에는 YXSTOP 말고 아무것도 보내지 않는다).
    const e = get().engine;
    const { command, threads } = threadCommand(
      e.threaded,
      config.threads,
      threadCap(c.capabilities.hardwareConcurrency, e.maxThreads),
    );
    const fresh = [...overlay(config.info, over), command].filter(
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
    requestKey = keyOf(stones);
    const nbest = get().multiPv;
    const budget = totalMs ?? get().analysisMs;
    // exactOptionalPropertyTypes: 무제한은 키를 비워 둔다(클라이언트 기본값이 무제한).
    c.analyze(stones, Number.isFinite(budget) ? { totalMs: budget, nbest } : { nbest });
  };

  /** 엔진을 띄운다 — 떠 있으면 그대로. 사용자가 고른 엔진(`enginePreference`)으로. */
  const boot = (c: EngineClient) => c.start(get().enginePreference);

  const ensure = (): EngineClient => {
    if (client) return client;
    // 이 클라이언트가 **지금의** 엔진일 때만 스토어를 고친다. 변형을 바꾸면 옛 클라이언트를
    // 내리고 새것을 띄우는데, 옛것이 마지막으로 흘린 사건이 새 엔진의 상태를 덮으면 안 된다.
    const c: EngineClient = new EngineClient({
      onStatus: (status) => {
        if (client !== c) return;
        set(status === "starting" ? { status } : { status, bootPhase: null });
      },
      onBootPhase: (bootPhase) => {
        if (client === c) set({ bootPhase });
      },
      onSnapshot: (snapshot) => {
        if (client !== c) return;
        set((s) => {
          const view = toEvalView(snapshot.stats, requestPly);
          return {
            snapshot,
            snapshotKey: requestKey,
            evalView: view ?? s.evalView,
            evalKey: view ? requestKey : s.evalKey,
          };
        });
        if (exclusive) {
          exclusive.last = snapshot;
          exclusive.onSnapshot?.(snapshot);
        }
      },
      onConsole: (lines) =>
        set((s) => {
          const next = [...s.console, ...lines];
          return { console: next.length > CONSOLE_MAX ? next.slice(-CONSOLE_MAX) : next };
        }),
      onBestMove: (moves) => {
        if (client !== c) return;
        set({ lastBestMove: moves[0] ?? null });
        gameHandlers.onEngineMove?.(moves);
      },
      onOpening: (r) => {
        if (client === c) gameHandlers.onOpening?.(r);
      },
      onForbid: (cells) => {
        if (client !== c) return;
        set({ forbidden: cells });
        gameHandlers.onForbid?.(cells);
      },
      onError: (error) => {
        if (client === c) set({ error: tidy(error) });
      },
      // 띄울 변형마다 — 멀티에서 단일로 물러서면 thread_num 은 1 이 된다.
      bootSettings: (variant) =>
        bootCommands(config, isMultiVariant(variant), get().capabilities.hardwareConcurrency),
      onBooted: (info) => {
        if (client !== c) return;
        // 새 엔진은 기동 메시지로 받은 설정만 안다 — 그것을 「보냄」으로 적어 둬야 아래
        // `flushConfig` 가 같은 thread_num 을 다시 보내 스레드를 재구성하지 않는다.
        sentInfo.clear();
        for (const cmd of info.settings) {
          if (cmd.kind === "info") sentInfo.set(cmd.key, String(cmd.value));
        }
        set({
          engine: {
            variant: info.variant,
            threaded: info.threaded,
            maxThreads: info.maxThreads,
            fallbackReason: info.fallbackReason,
            weightsSource: info.weights.source,
            weightsMs: info.weights.ms,
            warmupMs: info.warmupMs,
          },
        });
        // 멈춘 멀티 엔진을 단일로 다시 띄웠다 — 새 엔진은 설정을 모르고, 켜 둔 분석은
        // 끊겼다. 처음 기동은 `start`·`analyze` 가 이 일을 하므로 여기서는 복구만 본다.
        if (!info.recovered) return;
        flushConfig(c);
        if (get().analyzing) runAnalysis(c, analysisStones);
      },
      onSearchDone: (mode, reason) => {
        if (client !== c) return;
        if (exclusive && mode === "analyze") {
          const e = exclusive;
          exclusive = null;
          e.done(e.last);
          return;
        }
        if (mode !== "analyze" || !get().analyzing) return;
        if (reason === "stopped") {
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
    client = c;
    return c;
  };

  /**
   * 기동이 실패했다. 다만 **엔진을 내려서 버려진 기동**(변형 전환)은 오류가 아니다 —
   * 그 사이 새 클라이언트가 떠 있으므로 아무것도 고치지 않는다.
   */
  const bootFailed = (c: EngineClient, e: unknown, extra: Partial<EngineState> = {}) => {
    if (e instanceof BootAbortedError || client !== c) return;
    set({ error: describe(e), status: "error", bootPhase: null, ...extra });
  };

  return {
    status: "idle",
    capabilities: detectCapabilities(),
    snapshot: EMPTY_SNAPSHOT,
    snapshotKey: null,
    bootPhase: null,
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
    evalKey: null,
    engine: NO_ENGINE,
    appliedThreads: null,
    enginePreference: "auto",
    setEnginePreference: (p) => {
      if (p === get().enginePreference) return;
      set({ enginePreference: p });
      // 떠 있거나 뜨는 중이면 깨끗이 다시 띄운다 — 다른 바이너리다. 꺼져 있으면 다음 기동부터.
      if (get().status !== "idle") void get().restart();
    },

    restart: async () => {
      const resume = get().analyzing ? analysisStones : null;
      get().terminate();
      // 분석이 켜져 있었으면 새 엔진이 같은 국면을 이어 읽는다 — `analyze` 가 기동까지 한다.
      // 기동하는 사이 국면이 바뀌면 분석 따라가기(`gameStore`)가 새 국면으로 다시 청한다.
      if (resume) await get().analyze(resume);
      else await get().start();
    },

    configure: (next) => {
      config = next;
      // 놀고 있으면 지금 보낸다. 탐색 중이거나 아직 뜨지 않았으면 미룬다 —
      // 기동 메시지와 다음 탐색 직전(`flushConfig`)이 받아 보낸다.
      if (client && client.currentStatus === "ready") flushConfig(client);
    },

    start: async () => {
      set({ error: null });
      const c = ensure();
      try {
        await boot(c);
        // 기동 직후 한 번. 기동 메시지의 설정은 이미 들어갔으므로 기동 중에 바뀐 값만 나간다.
        if (client === c) flushConfig(c);
      } catch (e) {
        bootFailed(c, e);
      }
    },

    analyze: async (stones, totalMs) => {
      // 리뷰가 엔진을 쥐고 있으면 분석을 받지 않는다 — 리뷰의 국면이 엇갈린다.
      if (get().owner) {
        set({ analyzing: false });
        return;
      }
      const c = ensure();
      set({ error: null, analyzing: true });
      try {
        if (c.currentStatus === "idle" || c.currentStatus === "error") await boot(c);
        else if (c.currentStatus === "starting") await c.whenReady();
        // 기동을 기다리는 사이에 정지·착수·엔진 전환이 의도를 껐다면 시작하지 않는다.
        if (!get().analyzing || client !== c) return;
        runAnalysis(c, stones, totalMs);
      } catch (e) {
        bootFailed(c, e, { analyzing: false });
      }
    },

    play: async (stones, emptyBoard, budget, info = []) => {
      if (get().owner) return; // 대국 쪽이 먼저 거른다(gameStore) — 여기는 마지막 안전망
      const c = ensure();
      // 대국의 착수가 엔진을 가져간다 — 분석 의도는 여기서 끝난다. 켜 둔 채면
      // 엔진이 답하자마자 분석이 다시 붙어 대국과 엔진을 나눠 쓰게 된다.
      set({ error: null, analyzing: false });
      try {
        if (c.currentStatus === "idle" || c.currentStatus === "error") await boot(c);
        else if (c.currentStatus === "starting") await c.whenReady();
        if (client !== c) return;
        flushConfig(c, info);
        if (config.hashAutoClear) c.send({ kind: "raw", line: "YXHASHCLEAR" });
        requestPly = stones.length;
        requestKey = keyOf(stones);
        c.play(stones, emptyBoard, budget ?? {});
      } catch (e) {
        bootFailed(c, e);
      }
    },

    send: (...cmds) => {
      // 엔진이 아직 없으면 조용히 흘린다 — 「엔진 시작」 전에 눌린 버튼이다.
      client?.send(...cmds);
    },

    owner: null,

    acquire: (owner) => {
      const s = get();
      if (s.owner)
        return s.owner === owner ? "이미 진행 중입니다" : "엔진을 다른 작업이 쓰고 있습니다";
      set({ owner });
      // 켜 둔 분석은 끈다. 도는 탐색은 다음 독점 탐색 요청이 비켜 세운다(워커가 줄 뒤의
      // 요청을 보면 앞 탐색을 멈춘다) — 그 탐색의 끝과 스냅샷은 클라이언트가 버린다.
      if (s.analyzing) get().stop();
      return null;
    },

    release: (owner) => {
      if (get().owner === owner) set({ owner: null });
    },

    exclusiveSearch: async (stones, opts, onSnapshot) => {
      const c = ensure();
      set({ error: null });
      try {
        if (c.currentStatus === "idle" || c.currentStatus === "error") await boot(c);
        else if (c.currentStatus === "starting") await c.whenReady();
      } catch (e) {
        bootFailed(c, e);
        return null;
      }
      if (client !== c) return null;
      // 앞선 독점 탐색이 아직 끝을 기다리고 있으면 비운다(정상 흐름에서는 없다).
      exclusive?.done(exclusive.last);
      return new Promise<AnalysisSnapshot | null>((resolve) => {
        exclusive = { onSnapshot, done: resolve, last: null };
        flushConfig(c, opts.info ?? []);
        analysisStones = stones;
        requestPly = stones.length;
        requestKey = keyOf(stones);
        c.analyze(
          stones,
          Number.isFinite(opts.totalMs)
            ? { totalMs: opts.totalMs, nbest: opts.nbest }
            : { nbest: opts.nbest },
        );
      });
    },

    stop: () => {
      // 의도를 **먼저** 끈다 — 그래야 뒤따르는 searchDone 이 「밀렸다」로 읽혀
      // 분석이 다시 붙지 않는다.
      set({ analyzing: false });
      client?.stop();
    },

    terminate: () => {
      const c = client;
      // 독점 탐색이 끝을 기다리고 있었다면 — 그 끝은 오지 않는다. 빈손으로 풀어 준다.
      if (exclusive) {
        const e = exclusive;
        exclusive = null;
        e.done(null);
      }
      // 먼저 떼어 낸다 — `terminate` 가 흘리는 마지막 사건(상태 idle 등)은 받지 않는다.
      client = null;
      c?.terminate();
      requestKey = null;
      set({
        status: "idle",
        bootPhase: null,
        snapshot: EMPTY_SNAPSHOT,
        snapshotKey: null,
        lastBestMove: null,
        analyzing: false,
        evalView: null,
        evalKey: null,
        engine: NO_ENGINE,
        appliedThreads: null,
      });
      // 다음 기동은 새 엔진이다 — 보낸 표는 그 엔진의 기동 메시지가 다시 채운다.
      sentInfo.clear();
      gameHandlers.onEngineReset?.();
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
