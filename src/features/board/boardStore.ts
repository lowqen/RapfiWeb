import { create } from "zustand";
import { DEFAULT_SIZE, moveKey, sameMove, type Move } from "../../core/model/move";
import { emptyRender, type BoardRender } from "../../core/board/board-renderer";

/**
 * 보드 화면의 상태. W2 에서는 **돌을 놓고 무르는 것**까지다 — 규칙 판정도,
 * 엔진도 여기 없다. 그 둘은 W3·W4 에서 이 스토어 위에 얹힌다.
 *
 * 앱과 같은 규칙 하나를 지금부터 지킨다: 라우팅으로 화면을 떠나도 이 상태는
 * 살아 있다. 탭을 옮겼다가 돌아오면 보던 국면이 그대로여야 한다.
 */
interface BoardState {
  render: BoardRender;
  /** 교점을 눌렀을 때. 이미 돌이 있으면 아무 일도 하지 않는다. */
  place: (m: Move) => void;
  undo: () => void;
  clear: () => void;
  toggleNumbers: () => void;
  /** 롱프레스 자리 — W6 의 «보드 텍스트» 진입점이 될 곳. 지금은 표시만 한다. */
  markBlocked: (m: Move) => void;
}

export const useBoardStore = create<BoardState>((set) => ({
  render: emptyRender(DEFAULT_SIZE),

  place: (m) =>
    set((s) => {
      if (s.render.stones.some((p) => sameMove(p, m))) return s;
      return {
        render: { ...s.render, stones: [...s.render.stones, m], lastMove: m },
      };
    }),

  undo: () =>
    set((s) => {
      if (s.render.stones.length === 0) return s;
      const stones = s.render.stones.slice(0, -1);
      return { render: { ...s.render, stones, lastMove: stones.at(-1) ?? null } };
    }),

  clear: () => set((s) => ({ render: { ...emptyRender(s.render.size) } })),

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
}));
