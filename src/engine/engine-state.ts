import { create } from "zustand";
import type { Move } from "../core/model/move";
import {
  EngineClient,
  detectCapabilities,
  type Capabilities,
  type OpeningResponse,
} from "./engine-client";
import {
  EMPTY_SNAPSHOT,
  type AnalysisSnapshot,
  type EngineCommand,
  type EngineStatus,
  type Placement,
} from "./engine-types";

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

interface EngineState {
  status: EngineStatus;
  capabilities: Capabilities;
  snapshot: AnalysisSnapshot;
  console: readonly string[];
  error: string | null;
  /** 마지막 확정 착수. `TURN`/`BEGIN` 의 응답이다(분석에서는 오지 않는다). */
  lastBestMove: Move | null;
  forbidden: readonly Move[];

  start: () => Promise<void>;
  analyze: (stones: readonly Placement[], totalMs?: number) => Promise<void>;
  /** 대국의 한 수. 분석과 달리 조각으로 나누지 않는다. */
  play: (
    stones: readonly Placement[],
    emptyBoard: boolean,
    budget?: { turnMs?: number; matchLeftMs?: number },
  ) => Promise<void>;
  /** 명령 몇 개를 그대로 보낸다(협상 단계 등). */
  send: (...cmds: EngineCommand[]) => void;
  stop: () => void;
  terminate: () => void;
  clearConsole: () => void;
}

let client: EngineClient | null = null;

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

export const useEngineStore = create<EngineState>((set) => {
  const ensure = (): EngineClient => {
    if (client) return client;
    client = new EngineClient({
      onStatus: (status) => set({ status }),
      onSnapshot: (snapshot) => set({ snapshot }),
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

    start: async () => {
      set({ error: null });
      try {
        await ensure().start();
      } catch (e) {
        set({ error: describe(e), status: "error" });
      }
    },

    analyze: async (stones, totalMs) => {
      const c = ensure();
      set({ error: null });
      try {
        if (c.currentStatus === "idle" || c.currentStatus === "error") await c.start();
        // exactOptionalPropertyTypes: undefined 를 넘기면 «키가 있는데 값이 없음» 이라
        // 기본값이 안 먹는다. 있을 때만 넣는다.
        c.analyze(stones, totalMs === undefined ? {} : { totalMs });
      } catch (e) {
        set({ error: describe(e), status: "error" });
      }
    },

    play: async (stones, emptyBoard, budget) => {
      const c = ensure();
      set({ error: null });
      try {
        if (c.currentStatus === "idle" || c.currentStatus === "error") await c.start();
        c.play(stones, emptyBoard, budget ?? {});
      } catch (e) {
        set({ error: describe(e), status: "error" });
      }
    },

    send: (...cmds) => {
      // 엔진이 아직 없으면 조용히 흘린다 — 「엔진 시작」 전에 눌린 버튼이다.
      client?.send(...cmds);
    },

    stop: () => client?.stop(),

    terminate: () => {
      client?.terminate();
      client = null;
      set({ status: "idle", snapshot: EMPTY_SNAPSHOT, lastBestMove: null });
    },

    clearConsole: () => set({ console: [] }),
  };
});
