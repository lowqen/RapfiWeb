import { create } from "zustand";
import { DEFAULT_SIZE, moveKey, sameMove, type Move } from "../../core/model/move";
import { emptyRender, type BoardRender } from "../../core/board/board-renderer";
import type { Placement } from "../../engine/engine-types";
import type { AnalysisSnapshot } from "../../engine/engine-types";

/**
 * 보드 화면의 상태. W2 에서는 **돌을 놓고 무르는 것**까지다 — 규칙 판정도,
 * 엔진도 여기 없다. 그 둘은 W3·W4 에서 이 스토어 위에 얹힌다.
 *
 * 앱과 같은 규칙 하나를 지금부터 지킨다: 라우팅으로 화면을 떠나도 이 상태는
 * 살아 있다. 탭을 옮겼다가 돌아오면 보던 국면이 그대로여야 한다.
 */
interface BoardState {
  render: BoardRender;
  /**
   * 무른 수들 — 다시 둘 차례대로(머리가 바로 다음 수). 보드 아래 이동 바의
   * `>`·`>|` 가 여기서 꺼낸다. 무른 수와 **다른** 수를 두면 갈래가 갈린 것이라
   * 통째로 버린다 — 앱·데스크톱의 되돌리기/앞으로와 같은 규칙이다.
   */
  future: readonly Move[];
  /** 교점을 눌렀을 때. 이미 돌이 있으면 아무 일도 하지 않는다. */
  place: (m: Move) => void;
  undo: () => void;
  clear: () => void;
  toggleNumbers: () => void;
  /** 롱프레스 자리 — W8(DB)의 «보드 텍스트» 진입점이 될 곳. 지금은 표시만 한다. */
  markBlocked: (m: Move) => void;

  /**
   * 지금 국면을 엔진이 받는 모양으로. `own` 은 «엔진이 둘 색»이라 **다음 차례**가
   * 기준이다 — 돌 수가 짝수면 흑 차례이고, 그때 흑돌이 own 이다.
   */
  placements: () => Placement[];

  /** 엔진 스냅샷을 보드에 얹는다. 값 칩·후보·최선수 링·고스트가 여기서 온다. */
  applyAnalysis: (s: AnalysisSnapshot) => void;

  /** 분석 오버레이만 걷어낸다(돌은 그대로). 착수하거나 무를 때 부른다. */
  clearAnalysis: () => void;

  /**
   * 돌 목록을 통째로 갈아 끼운다 — 기보 열기와 자동 저장 되살리기(`gameStore.loadMoves`)가
   * 쓴다. `future` 는 무른 수(다시 둘 차례대로)이고, 주지 않으면 비운다.
   */
  setStones: (stones: readonly Move[], future?: readonly Move[]) => void;

  /** 렌주 금수 목록. 엔진의 `FORBID` 가 채운다(W4). */
  forbidden: readonly Move[];
  setForbidden: (cells: readonly Move[]) => void;
}

/** 분석 오버레이를 비운 상태. 국면이 바뀌는 모든 곳이 이걸 얹는다. */
const CLEARED = {
  tags: new Map(),
  candidates: new Map(),
  loseCells: new Set<number>(),
  bestMark: null,
  ghosts: [],
} as const;

export const useBoardStore = create<BoardState>((set, get) => ({
  render: emptyRender(DEFAULT_SIZE),
  future: [],

  place: (m) =>
    set((s) => {
      if (s.render.stones.some((p) => sameMove(p, m))) return s;
      const head = s.future[0];
      // 국면이 바뀌면 앞선 분석은 그 국면의 것이 아니다. 남겨 두면 값 칩이
      // 한 수 전 판을 말하게 된다 — 조용히 틀린 화면이라 제일 나쁘다.
      return {
        future: head && sameMove(head, m) ? s.future.slice(1) : [],
        render: {
          ...s.render,
          stones: [...s.render.stones, m],
          lastMove: m,
          ...CLEARED,
        },
      };
    }),

  undo: () =>
    set((s) => {
      if (s.render.stones.length === 0) return s;
      const stones = s.render.stones.slice(0, -1);
      const popped = s.render.stones.at(-1)!;
      return {
        future: [popped, ...s.future],
        render: { ...s.render, stones, lastMove: stones.at(-1) ?? null, ...CLEARED },
      };
    }),

  clear: () => set((s) => ({ future: [], render: { ...emptyRender(s.render.size) } })),

  toggleNumbers: () =>
    set((s) => ({ render: { ...s.render, showNumbers: !s.render.showNumbers } })),

  markBlocked: (m) =>
    set((s) => {
      const key = moveKey(m, s.render.size);
      const blocked = new Set(s.render.blocked);
      if (blocked.has(key)) blocked.delete(key);
      else blocked.add(key);
      return { render: { ...s.render, blocked } };
    }),

  placements: () => {
    const { stones } = get().render;
    // own = «엔진이 둘 색». 다음 차례가 흑이면(짝수 개) 짝수 인덱스 돌이 own 이다.
    const blackToMove = stones.length % 2 === 0;
    return stones.map((move, i) => ({ move, own: (i % 2 === 0) === blackToMove }));
  },

  applyAnalysis: (a) =>
    set((s) => ({
      render: {
        ...s.render,
        tags: a.tags,
        candidates: a.candidates,
        loseCells: a.loseCells,
        bestMark: a.bestMove,
        // 고스트는 최선 수순의 **머리를 뺀** 나머지다 — 머리는 최선수 링이 이미 말한다.
        ghosts: a.bestLine.slice(1),
      },
    })),

  clearAnalysis: () => set((s) => ({ render: { ...s.render, ...CLEARED } })),

  setStones: (stones, future = []) =>
    set((s) => ({
      future: [...future],
      render: { ...s.render, stones: [...stones], lastMove: stones.at(-1) ?? null, ...CLEARED },
    })),

  forbidden: [],
  setForbidden: (cells) =>
    set((s) => ({ forbidden: cells, render: { ...s.render, forbidden: cells } })),
}));
