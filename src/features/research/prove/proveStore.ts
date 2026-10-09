import { create } from "zustand";
import type { Move } from "../../../core/model/move";
import {
  DEFAULT_PROVE_OPTIONS,
  sanitizeProveOptions,
  type ProveOptions,
  type ProveOverlay,
} from "../../../core/prove/prove-tree";
import {
  IDLE_PROGRESS,
  outcomeMessage,
  type ProveOutcome,
  type ProveProgress,
} from "../../../core/prove/prove-models";
import { useEngineStore } from "../../../engine/engine-state";
import { proveDb } from "../../database/dbStore";
import { useBoardStore } from "../../board/boardStore";
import { useGameStore } from "../../board/gameStore";
import { proveRefusal, runProve, type ProvePort } from "./proveRunner";

/**
 * 국면 증명의 화면 쪽 — 앱 `ProveRepositoryImpl` 의 상태(진행 · 덧그림 · 결과 · 기록).
 *
 * 뿌리는 **시작할 때의 판**(무른 수 제외)이다. 도는 동안 엔진은 증명의 것이다(`owner`) —
 * 리뷰 · 분석 · 대국의 엔진 착수는 기다린다. 리뷰와 같은 자물쇠라 둘이 겹쳐 돌 수 없다.
 */

const OPTIONS_KEY = "rapfi.prove";
const LOG_LIMIT = 80;

function loadOptions(): ProveOptions {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(OPTIONS_KEY);
    return raw
      ? sanitizeProveOptions({
          ...DEFAULT_PROVE_OPTIONS,
          ...(JSON.parse(raw) as Partial<ProveOptions>),
        })
      : DEFAULT_PROVE_OPTIONS;
  } catch {
    return DEFAULT_PROVE_OPTIONS;
  }
}

interface ProveStoreState {
  options: ProveOptions;
  setOptions: (o: Partial<ProveOptions>) => void;
  running: boolean;
  progress: ProveProgress;
  overlay: ProveOverlay | null;
  /** 증명 뿌리 — 덧그림을 그릴 판. */
  root: readonly Move[];
  outcome: ProveOutcome | null;
  log: readonly string[];
  /** 지금 판을 증명한다. 못 하면 까닭. */
  start: () => Promise<string | null>;
  cancel: () => void;
  clearOutcome: () => void;
}

let cancelFlag = false;

const enginePort: ProvePort = {
  search: (stones, opts, onSnapshot) =>
    useEngineStore.getState().exclusiveSearch(stones, opts, onSnapshot),
  stop: () => useEngineStore.getState().stop(),
  get db() {
    return proveDb();
  },
};
let port: ProvePort = enginePort;

export const useProveStore = create<ProveStoreState>((set, get) => {
  const note = (t: string) => set((s) => ({ log: [...s.log, t].slice(-LOG_LIMIT) }));
  return {
    options: loadOptions(),
    setOptions: (o) => {
      const next = sanitizeProveOptions({ ...get().options, ...o });
      set({ options: next });
      try {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
      } catch {
        /* 이번 세션만 */
      }
    },
    running: false,
    progress: IDLE_PROGRESS,
    overlay: null,
    root: [],
    outcome: null,
    log: [],

    start: async () => {
      if (get().running) return "이미 증명이 진행 중입니다";
      if (useGameStore.getState().thinking) return "증명: 진행 중인 계산을 먼저 중지하세요";
      const { stones, size } = useBoardStore.getState().render;
      const why = proveRefusal(stones, size);
      if (why) return why;
      const lock = useEngineStore.getState().acquire("prove");
      if (lock)
        return lock === "이미 진행 중입니다"
          ? "이미 증명이 진행 중입니다"
          : "게임 리뷰가 진행 중입니다 — 먼저 멈추세요";
      cancelFlag = false;
      set({
        running: true,
        root: [...stones],
        outcome: null,
        progress: { ...IDLE_PROGRESS, running: true, nodes: 1, open: 1 },
      });
      try {
        const { outcome, failed } = await runProve(stones, size, get().options, port, {
          onProgress: (progress) => set({ progress }),
          onOverlay: (overlay) => set({ overlay }),
          isCancelled: () => cancelFlag,
          log: note,
          now: () => Date.now(),
        });
        if (failed) note(failed);
        set({ outcome });
        note(
          `증명 ${outcome.cancelled ? "취소" : "완료"}: ${outcomeMessage(outcome).replace(/\n/g, " ")}`,
        );
      } finally {
        useEngineStore.getState().release("prove");
        set({ running: false, progress: IDLE_PROGRESS, overlay: null });
      }
      return null;
    },

    cancel: () => {
      if (!get().running) return;
      cancelFlag = true;
      useEngineStore.getState().stop();
    },

    clearOutcome: () => set({ outcome: null }),
  };
});

/** 시험 전용 — 엔진 포트를 갈아 끼운다(`null` 이면 진짜 엔진). */
export function setProvePortForTest(p: ProvePort | null) {
  port = p ?? enginePort;
  cancelFlag = false;
  useProveStore.setState({
    options: DEFAULT_PROVE_OPTIONS,
    running: false,
    progress: IDLE_PROGRESS,
    overlay: null,
    root: [],
    outcome: null,
    log: [],
  });
}
