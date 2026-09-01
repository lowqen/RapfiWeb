import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./AppShell";
import { Placeholder } from "./Placeholder";

/**
 * 아홉 화면. 계획서 §6 의 라우트 표를 그대로 옮긴 것이다.
 *
 * 국면 딥링크 `?p=…` 는 **전 화면 공통 쿼리**로 둔다 — 앱의 «국면 문자열» 기능이
 * 웹에서 자연스럽게 갖는 등가물이고, 링크로 국면을 주고받을 수 있게 된다.
 * (W1 에서는 자리만 잡는다. 파싱은 W4.)
 *
 * W1 은 **골격**이다. 각 화면은 `Placeholder` 로, 그 화면이 무엇을 하게 될지와
 * 어느 단계에서 채워지는지를 적어 둔다 — 빈 div 는 다음 사람에게 아무 말도 하지
 * 않는다.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/board" replace /> },

      {
        path: "board",
        element: (
          <Placeholder
            stage="W4"
            title="보드"
            what="대국·분석 화면. 보드 pane + 분석 pane 2열, 규칙 7종, 오프닝 협상(swap2·soosorv), 시계, 툴바."
            needs={["W2 보드 렌더링", "W3 엔진 워커"]}
          />
        ),
      },

      { path: "research", element: <Navigate to="/research/review" replace /> },
      {
        path: "research/review",
        element: (
          <Placeholder
            stage="W6"
            title="리뷰·증명"
            what="대국 전체를 엔진으로 되짚고, 한 수를 증명 트리로 파고든다. 진행 큐는 워커에 있고 체크포인트는 IndexedDB 에 남는다."
            needs={["W3 엔진 워커", "W4 보드 화면"]}
          />
        ),
      },
      {
        path: "research/explorer",
        element: (
          <Placeholder
            stage="W6"
            title="오프닝"
            what="주형 이름 249개와 흑5수 유불리 1,889모양은 기본 내장이라 팩 없이 동작한다. 빈도 통계는 사용자가 .rif 를 올렸을 때만."
            needs={["W2 보드 렌더링"]}
          />
        ),
      },
      {
        path: "research/sequence",
        element: (
          <Placeholder
            stage="W6"
            title="수순"
            what="같은 국면에 이르는 다른 수순을 찾는다. 정규 키(PosKey, 8대칭)를 쓰므로 팩 없이도 동작한다."
            needs={["W2 보드 렌더링"]}
          />
        ),
      },
      {
        path: "research/ranking",
        element: (
          <Placeholder
            stage="W6"
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
            stage="W6"
            title="데이터베이스"
            what="yixindb 국면 저장소. Emscripten IDBFS 에 올리고, .db 파일 업로드/다운로드. 파일이 없으면 읽기 전용 + 보드 텍스트만."
            needs={["W3 엔진 워커"]}
          />
        ),
      },

      {
        path: "engine",
        element: (
          <Placeholder
            stage="W3"
            title="엔진"
            what="변형(single-simd128)·스레드·해시 크기·국면 슬롯 10칸·유지보수·piskvork 콘솔. 앱의 «연결» 탭에서 서버를 걷어낸 자리에 도구가 남는다."
            needs={["W3 엔진 워커"]}
          />
        ),
      },

      {
        path: "joseki",
        element: (
          <Placeholder
            stage="W8"
            title="정석"
            what="신규 기능. 수순 입력(보드 클릭 또는 좌표 텍스트), 분기, 수마다 서식 있는 메모, 저장·검색·분류, 단계별 재생."
            needs={["W2 보드 렌더링", "W4 보드 화면"]}
          />
        ),
      },

      {
        path: "settings",
        element: (
          <Placeholder
            stage="W5"
            title="설정"
            what="데스크톱 settings.txt 67항목 왕복. 27행이 다크 모드의 오라클이다 — 불러오면 시스템 설정을 이긴다."
            needs={["W3 엔진 워커"]}
          />
        ),
      },

      { path: "*", element: <Navigate to="/board" replace /> },
    ],
  },
]);
