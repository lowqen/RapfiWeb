import { create } from "zustand";
import type { GradingPreset, ReviewData } from "../core/review/move-quality";

/**
 * 지금 고른 리포트의 자료 — 보드가 마지막 수의 등급 배지를 그리려고 읽는다.
 *
 * 연구 ▸ 리뷰가 쓰고 보드가 읽는다. 두 화면이 서로를 import 하지 않도록 사이에 둔 작은
 * 칸이다(`features/README.md`). 판이 리포트의 수순을 따르는 동안에만 배지가 뜬다
 * (`matchesPrefix`) — 다른 수를 두면 그 리뷰는 이 판의 이야기가 아니다.
 */
interface CurrentReview {
  data: ReviewData | null;
  preset: GradingPreset;
  skipOpening: boolean;
}

export const useCurrentReview = create<CurrentReview>(() => ({
  data: null,
  preset: "default",
  skipOpening: true,
}));
