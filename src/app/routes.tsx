import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./AppShell";
import { Placeholder } from "./Placeholder";
import { BoardScreen } from "../features/board/BoardScreen";
import { EngineScreen } from "../features/engine/EngineScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { DatabaseScreen } from "../features/database/DatabaseScreen";
import { JosekiScreen } from "../features/joseki/JosekiScreen";
import { OpeningExplorer } from "../features/research/OpeningExplorer";
import { ReviewScreen } from "../features/research/review/ReviewScreen";
import { SequenceScreen } from "../features/research/sequence/SequenceScreen";

/**
 * 아홉 화면. 계획서 §6 의 라우트 표를 그대로 옮긴 것이다.
 *
 * 국면 딥링크 `?p=…` 는 **전 화면 공통 쿼리**로 둔다 — 앱의 «국면 문자열» 기능이
 * 웹에서 자연스럽게 갖는 등가물이고, 링크로 국면을 주고받을 수 있게 된다.
 * 읽기는 `main.tsx` 가 라우터가 뜨기 전에 한다(`features/board/positionLink.ts`).
 *
 * W1 은 **골격**이다. 각 화면은 `Placeholder` 로, 그 화면이 무엇을 하게 될지와
 * 어느 단계에서 채워지는지를 적어 둔다 — 빈 div 는 다음 사람에게 아무 말도 하지
 * 않는다.
 */
// Pages 배포에서는 앱이 /RapfiWeb/ 아래 산다. BASE_URL 이 그 값을 들고 있으므로
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
        // W6a: 팩 없이 되는 부분(이름 사슬 · 유불리 · 환원 · 이론 다음 수). 빈도 통계는 W7.
        { path: "research/explorer", element: <OpeningExplorer /> },
        // W6c: 같은 돌에 이르는 다른 수순(MoveOrder — 계산은 워커에서).
        { path: "research/sequence", element: <SequenceScreen /> },
        {
          path: "research/ranking",
          element: (
            <Placeholder
              stage="W7"
              title="랭킹"
              what="기록과 순위. RenjuNet 팩이 있어야 의미가 있는 화면이라, 팩이 없으면 «.rif 를 올리세요» 안내로 끝난다."
              needs={["W7 .rif 변환 파이프라인"]}
            />
          ),
        },

        // W8: 엔진 yixindb — 파일은 IndexedDB, 엔진이 뜰 때 메모리 FS 로 올린다.
        { path: "database", element: <DatabaseScreen /> },

        // 엔진 상태와 piskvork 콘솔. 콘솔은 보드 옆 칸에서 이리로 왔다.
        { path: "engine", element: <EngineScreen /> },

        // W9: 정석 — 수순 입력(판 · 글), 분기, 메모(마크다운), 분류 자동, 국면으로 찾기.
        { path: "joseki", element: <JosekiScreen /> },

        // 앱 `SettingsScreen.kt` 의 분류(대국·엔진·표시…)를 옮긴 것. 대국 설정·조작은
        // 보드 옆 칸에서 이리로 왔다. settings.txt 67항목 파일 왕복(W5b)은 고급 ▸ 시스템에 있다.
        { path: "settings", element: <SettingsScreen /> },

        { path: "*", element: <Navigate to="/board" replace /> },
      ],
    },
  ],
  { basename },
);
