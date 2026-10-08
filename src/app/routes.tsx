import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./AppShell";
import { Placeholder } from "./Placeholder";
import { BoardScreen } from "../features/board/BoardScreen";
import { EngineScreen } from "../features/engine/EngineScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { OpeningExplorer } from "../features/research/OpeningExplorer";

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
        {
          path: "research/review",
          element: (
            <Placeholder
              stage="W6b · W6d"
              title="리뷰·증명"
              what="대국 전체를 엔진으로 되짚고, 한 수를 증명 트리로 파고든다. 진행 큐는 워커에 있고 체크포인트는 IndexedDB 에 남는다."
              needs={["W5a 기보 열기 · Dexie ✓", "증명(W6d)은 리뷰(W6b)의 큐 위에"]}
            />
          ),
        },
        // W6a: 팩 없이 되는 부분(이름 사슬 · 유불리 · 환원 · 이론 다음 수). 빈도 통계는 W7.
        { path: "research/explorer", element: <OpeningExplorer /> },
        {
          path: "research/sequence",
          element: (
            <Placeholder
              stage="W6c"
              title="수순"
              what="같은 국면에 이르는 다른 수순을 찾는다. 정규 키(PosKey, 8대칭)를 쓰므로 팩 없이도 동작한다."
              needs={["W5a PosKey ✓"]}
            />
          ),
        },
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

        {
          path: "database",
          element: (
            <Placeholder
              stage="W8"
              title="데이터베이스"
              what="yixindb 국면 저장소. Emscripten IDBFS 에 올리고, .db 파일 업로드/다운로드. 파일이 없으면 읽기 전용 + 보드 텍스트만."
              needs={["IDBFS 를 넣은 엔진 재빌드"]}
            />
          ),
        },

        // 엔진 상태와 piskvork 콘솔. 콘솔은 보드 옆 칸에서 이리로 왔다.
        { path: "engine", element: <EngineScreen /> },

        {
          path: "joseki",
          element: (
            <Placeholder
              stage="W9"
              title="정석"
              what="신규 기능. 수순 입력(보드 클릭 또는 좌표 텍스트), 분기, 수마다 서식 있는 메모, 저장·검색·분류, 단계별 재생."
              needs={["W5a PosKey · Dexie ✓", "W6a 주형 이름", "W6c 수순"]}
            />
          ),
        },

        // 앱 `SettingsScreen.kt` 의 분류(대국·엔진·표시…)를 옮긴 것. 대국 설정·조작은
        // 보드 옆 칸에서 이리로 왔다. settings.txt 67항목 파일 왕복은 여전히 W5b 의 몫이다.
        { path: "settings", element: <SettingsScreen /> },

        { path: "*", element: <Navigate to="/board" replace /> },
      ],
    },
  ],
  { basename },
);
