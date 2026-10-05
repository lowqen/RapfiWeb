import { create } from "zustand";

/**
 * 보드 위에 잠깐 뜨는 안내 한 줄(거절 사유 · 정지 착수 결과). 판을 누른 쪽(보드)과
 * 정지를 누른 쪽(분석 카드 · 이동 바)이 달라도 같은 자리에 뜨게 한 곳에 둔다.
 * 아무 반응이 없으면 「먹통」으로 읽힌다.
 */
interface BoardNotice {
  text: string | null;
  /** 바뀔 때마다 오른다 — 같은 문구를 다시 띄워도 사라지는 시계가 새로 돈다. */
  seq: number;
  show: (text: string | null) => void;
}

export const useBoardNotice = create<BoardNotice>((set) => ({
  text: null,
  seq: 0,
  show: (text) => set((s) => ({ text, seq: s.seq + 1 })),
}));
