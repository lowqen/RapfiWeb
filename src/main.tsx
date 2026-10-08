import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes";
import "./styles/tokens.css";
import "./styles/base.css";
// 저장된 엔진·분석 설정을 엔진 스토어로 흘려 둔다 — 설정 화면을 열지 않아도
// 첫 기동부터 그 값으로 뜨게.
import "./features/settings/settingsStore";
import { startAutosave } from "./features/board/autosave";
import { readPositionLink, withoutPositionParam } from "./features/board/positionLink";
import { useBoardNotice } from "./features/board/boardNotice";
import { DEFAULT_SIZE } from "./core/model/move";
import { loadOpeningTables } from "./data/opening-tables";

// 오프닝 표(4수 이름 · 흑 5수 유불리, 50KB)는 따로 떨어진 조각으로 뒤에서 받는다.
void loadOpeningTables();

// 국면 딥링크(`?p=…`)가 있으면 그 국면으로, 없으면 지난 판을 되살린다. 이 뒤로 판이
// 바뀔 때마다 IndexedDB 에 남긴다. 링크는 읽고 나서 주소에서 걷어낸다 — 새로고침이
// 그동안 둔 수를 링크의 국면으로 되돌리지 않게.
const link = readPositionLink(location.search, DEFAULT_SIZE);
startAutosave(undefined, undefined, link.kind === "ok" ? link.moves : null);
if (link.kind !== "none") {
  if (link.kind === "invalid") useBoardNotice.getState().show("링크의 국면을 읽지 못했습니다");
  const { pathname, search, hash } = router.state.location;
  void router.navigate({ pathname, search: withoutPositionParam(search), hash }, { replace: true });
}

const root = document.getElementById("root");
if (!root) throw new Error("#root 가 없습니다 — index.html 이 바뀌었나요?");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
