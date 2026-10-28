import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./AppShell";
import { BoardScreen } from "../features/board/BoardScreen";
import {
  CurriculumStudio,
  DatabaseScreen,
  EngineScreen,
  JosekiScreen,
  OpeningExplorer,
  RankingScreen,
  ReviewScreen,
  SequenceScreen,
  SettingsScreen,
} from "./screens";

/**
 * 아홉 화면. 계획서 §6 의 라우트 표를 그대로 옮긴 것이다.
 *
 * 국면 딥링크 `?p=…` 는 **전 화면 공통 쿼리**로 둔다 — 앱의 «국면 문자열» 기능이
 * 웹에서 자연스럽게 갖는 등가물이고, 링크로 국면을 주고받을 수 있게 된다.
 * 읽기는 `main.tsx` 가 라우터가 뜨기 전에 한다(`features/board/positionLink.ts`).
 *
 * W1 은 골격이었고 화면마다 `Placeholder`(무엇을 하게 될지 · 어느 단계에서 채워지는지)를
 * 두었다. W7 의 랭킹을 끝으로 모든 화면이 실물이 되어 자리표시자는 걷어냈다.
 */
// Pages 배포에서는 앱이 /Zenyth-web/ 아래 산다. BASE_URL 이 그 값을 들고 있으므로
// 라우터도 같은 것을 봐야 딥링크와 새로고침이 맞는다.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <AppShell />,
      children: [
        { index: true, element: <Navigate to="/board" replace /> },

        // W2 에서 실물이 들어왔다. 대국 규칙·시계·오프닝 협상은 W4 가 이 위에 얹는다.
        { path: "board", element: <BoardScreen /> },

        { path: "research", element: <Navigate to="/research/review" replace /> },
        // W6b: 리뷰(설정 · 큐 · 체크포인트 · 리포트). 증명(W6d)은 같은 화면의 다음 단계.
        { path: "research/review", element: <ReviewScreen /> },
        // W6a: 이름 사슬 · 유불리 · 환원 · 이론 다음 수. W7: 빈도 통계 · 대국 목록(팩이 있으면).
        { path: "research/explorer", element: <OpeningExplorer /> },
        // W6c: 같은 돌에 이르는 다른 수순(MoveOrder — 계산은 워커에서).
        { path: "research/sequence", element: <SequenceScreen /> },
        // W7: RenjuNet `.rif` 를 이 브라우저 안에서 변환한 팩(없으면 내 기보)으로 26주형 · 5수 모양 랭킹.
        { path: "research/ranking", element: <RankingScreen /> },

        // W8: 엔진 yixindb — 파일은 IndexedDB, 엔진이 뜰 때 메모리 FS 로 올린다.
        { path: "database", element: <DatabaseScreen /> },

        // 엔진 상태와 piskvork 콘솔. 콘솔은 보드 옆 칸에서 이리로 왔다.
        { path: "engine", element: <EngineScreen /> },

        // W9: 정석 — 수순 입력(판 · 글), 분기, 메모(마크다운), 분류 자동, 국면으로 찾기.
        { path: "joseki", element: <JosekiScreen /> },
        // 관리자 도구: 공식 커리큘럼 스튜디오(docs/공식-정석-관리.md).
        { path: "joseki/studio", element: <CurriculumStudio /> },

        // 앱 `SettingsScreen.kt` 의 분류(대국·엔진·표시…)를 옮긴 것. 대국 설정·조작은
        // 보드 옆 칸에서 이리로 왔다. settings.txt 67항목 파일 왕복(W5b)은 고급 ▸ 시스템에 있다.
        { path: "settings", element: <SettingsScreen /> },

        { path: "*", element: <Navigate to="/board" replace /> },
      ],
    },
  ],
  { basename },
);
