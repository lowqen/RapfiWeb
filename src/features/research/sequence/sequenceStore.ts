import { create } from "zustand";
import {
  DEFAULT_RULES,
  type MoveOrderRules,
  type MoveOrderView,
} from "../../../core/moveorder/session";
import { cellMove, xformName } from "../../../core/moveorder/move-order";
import type { Move } from "../../../core/model/move";
import { useBoardStore } from "../../board/boardStore";
import { useGameStore } from "../../board/gameStore";
import { useEngineStore } from "../../../engine/engine-state";
import { createMoveOrderService, type MoveOrderService } from "./moveOrderService";

/**
 * 수순 탐색기의 상태 — 앱 `MoveOrderViewModel` 의 이식.
 *
 * 판(무른 수 제외)이나 규칙이 바뀌면 워커에서 다시 세운다. 요청은 차례로 처리되지만, 판이
 * 연달아 바뀌면 앞선 «세우기»의 답은 이미 낡았다 — 세우기마다 번호를 달아 마지막 것만 쓴다.
 * 파고들기 · 되짚기도 그 판의 번호를 달고, 다른 판의 답이면 버린다.
 */

export type SequenceStatus = "empty" | "tooBig" | "ready";

const RULES_KEY = "rapfi.moveorder.rules";

function loadRules(): MoveOrderRules {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(RULES_KEY);
    return raw
      ? { ...DEFAULT_RULES, ...(JSON.parse(raw) as Partial<MoveOrderRules>) }
      : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

interface SequenceState {
  rules: MoveOrderRules;
  status: SequenceStatus;
  view: MoveOrderView | null;
  /** 이 탐색이 본 판 — 실제 대국의 다음 수 · 이유 문구가 쓴다. */
  line: readonly Move[];
  size: number;
  computing: boolean;
  selected: number | null;
  /** 원래 방향이 아닌 배치로 다시 놓기 전에 묻는 물음. */
  applyPrompt: { transform: number; order: number[]; text: string } | null;
  notice: string | null;

  setRules: (r: Partial<MoveOrderRules>) => void;
  /** 지금 판으로 다시 세운다(화면이 열릴 때와 판이 바뀔 때). */
  rebuild: () => Promise<void>;
  drill: (cell: number) => Promise<void>;
  back: () => Promise<void>;
  root: () => Promise<void>;
  select: (cell: number | null) => void;
  /** 파고든 길(나머지는 아무 합법 수순으로)을 보드에 다시 놓는다. */
  apply: (confirmed?: boolean) => Promise<void>;
  dismissPrompt: () => void;
  clearNotice: () => void;
}

let service: MoveOrderService | null = null;
const svc = () => (service ??= createMoveOrderService());
/** 마지막 세우기의 번호 — 낡은 답을 거른다. */
let generation = 0;

export const useSequenceStore = create<SequenceState>((set, get) => {
  /** 답이 아직 이 판의 것인가. */
  const fresh = (gen: number) => gen === generation;

  const showView = (gen: number, view: MoveOrderView | null) => {
    if (!fresh(gen) || !view) return;
    set({ view, computing: false, selected: null });
  };

  return {
    rules: loadRules(),
    status: "empty",
    view: null,
    line: [],
    size: 15,
    computing: false,
    selected: null,
    applyPrompt: null,
    notice: null,

    setRules: (r) => {
      const next = { ...get().rules, ...r };
      set({ rules: next });
      try {
        localStorage.setItem(RULES_KEY, JSON.stringify(next));
      } catch {
        /* 이번 세션만 기억한다 */
      }
      void get().rebuild();
    },

    rebuild: async () => {
      const { stones, size } = useBoardStore.getState().render;
      const gen = ++generation;
      set({ line: stones, size, computing: true, applyPrompt: null });
      try {
        const r = await svc().call({
          op: "build",
          cells: stones.map((m) => m.y * size + m.x),
          size,
          rules: get().rules,
        });
        if (!fresh(gen)) return;
        if (r.kind === "ok")
          set({ status: "ready", view: r.view, computing: false, selected: null });
        else set({ status: r.kind, view: null, computing: false, selected: null });
      } catch (e) {
        if (fresh(gen))
          set({ computing: false, notice: e instanceof Error ? e.message : String(e) });
      }
    },

    drill: async (cell) => {
      const gen = generation;
      showView(gen, await svc().call({ op: "drill", cell }));
    },
    back: async () => {
      const gen = generation;
      showView(gen, await svc().call({ op: "back" }));
    },
    root: async () => {
      const gen = generation;
      showView(gen, await svc().call({ op: "root" }));
    },

    select: (cell) => set({ selected: cell }),

    apply: async (confirmed = false) => {
      const prompt = get().applyPrompt;
      // 리뷰가 엔진을 쥐고 있으면 판을 바꾸지 않는다(main.c:6225 — reviewactive).
      if (useEngineStore.getState().owner) {
        set({ notice: "게임 리뷰나 국면 증명이 진행 중입니다 — 먼저 멈추세요" });
        return;
      }
      const done = confirmed && prompt ? prompt : await svc().call({ op: "complete" });
      if (!done) {
        set({ notice: "여기서 완성할 수 있는 수순이 없습니다" });
        return;
      }
      if (done.transform !== 0 && !confirmed) {
        set({
          applyPrompt: {
            transform: done.transform,
            order: done.order,
            text:
              `이 수순은 ${xformName(done.transform)} 배치에 있습니다 — 돌 위치가 지금 보드와 ` +
              "달라집니다. 그래도 놓을까요?",
          },
        });
        return;
      }
      const size = get().size;
      useGameStore.getState().loadMoves(
        done.order.map((c) => cellMove(c, size)),
        { name: useGameStore.getState().gameName, what: "수순 탐색기 — 이 수순으로 다시 놓기" },
      );
      set({ applyPrompt: null, notice: "보드를 이 수순으로 다시 놓았습니다" });
    },

    dismissPrompt: () => set({ applyPrompt: null }),
    clearNotice: () => set({ notice: null }),
  };
});

/** 시험 전용 — 계산 창구를 갈아 끼운다. */
export function setMoveOrderServiceForTest(s: MoveOrderService | null) {
  service?.dispose();
  service = s;
  generation++;
}
