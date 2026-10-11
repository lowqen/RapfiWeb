import { lazy, type ComponentType } from "react";

/**
 * **보드만 첫 번들에 있다.** 나머지 화면은 처음 열 때 받는 조각이다(`React.lazy` — 셸의 `<Suspense>` 가
 * 받는 동안 내용 칸만 비운다). 예전에는 아홉 화면이 한 덩어리(789KB)라 보드를 열어도 연구 · DB · 정석
 * 스튜디오 · 설정의 코드를 다 받아 해석했다.
 *
 * 앱이 뜨고 한가해지면 `prefetchScreens()` 가 조각을 미리 받아 둔다(AppShell) — 화면을 옮기는 순간에는 이미
 * 받아 둔 것이라 기다림이 없고, 배포가 바뀐 뒤 오래 열어 둔 탭이 지워진 옛 조각을 찾는 일도 줄어든다.
 */
const PREFETCH: (() => Promise<unknown>)[] = [];

function lazyScreen<M>(load: () => Promise<M>, name: keyof M): ComponentType {
  PREFETCH.push(load);
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

/** 첫 번들 밖의 화면 조각을 모두 받아 둔다. 실패는 조용히 — 그 화면을 열 때 다시 받는다. */
export function prefetchScreens(): void {
  for (const load of PREFETCH) load().catch(() => undefined);
}

export const ReviewScreen = lazyScreen(
  () => import("../features/research/review/ReviewScreen"),
  "ReviewScreen",
);
export const OpeningExplorer = lazyScreen(
  () => import("../features/research/OpeningExplorer"),
  "OpeningExplorer",
);
export const SequenceScreen = lazyScreen(
  () => import("../features/research/sequence/SequenceScreen"),
  "SequenceScreen",
);
export const RankingScreen = lazyScreen(
  () => import("../features/research/ranking/RankingScreen"),
  "RankingScreen",
);
export const DatabaseScreen = lazyScreen(
  () => import("../features/database/DatabaseScreen"),
  "DatabaseScreen",
);
export const EngineScreen = lazyScreen(
  () => import("../features/engine/EngineScreen"),
  "EngineScreen",
);
export const JosekiScreen = lazyScreen(
  () => import("../features/joseki/JosekiScreen"),
  "JosekiScreen",
);
export const CurriculumStudio = lazyScreen(
  () => import("../features/joseki/studio/CurriculumStudio"),
  "CurriculumStudio",
);
export const SettingsScreen = lazyScreen(
  () => import("../features/settings/SettingsScreen"),
  "SettingsScreen",
);
