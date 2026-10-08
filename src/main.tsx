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

// 지난 판을 되살리고, 이 뒤로 판이 바뀔 때마다 IndexedDB 에 남긴다.
startAutosave();

const root = document.getElementById("root");
if (!root) throw new Error("#root 가 없습니다 — index.html 이 바뀌었나요?");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
