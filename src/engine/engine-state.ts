import { create } from "zustand";
import type { Move } from "../core/model/move";
import { EngineClient, detectCapabilities, type Capabilities } from "./engine-client";
import { EMPTY_SNAPSHOT, type AnalysisSnapshot, type EngineStatus, type Placement } from "./engine-types";

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
  stop: () => void;
  terminate: () => void;
  clearConsole: () => void;
}

let client: EngineClient | null = null;

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
      onBestMove: (moves) => set({ lastBestMove: moves[0] ?? null }),
      onForbid: (cells) => set({ forbidden: cells }),
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
        set({ error: e instanceof Error ? e.message : String(e), status: "error" });
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
        set({ error: e instanceof Error ? e.message : String(e), status: "error" });
      }
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
