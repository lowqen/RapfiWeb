import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./app/routes";
// 본문 글꼴 — 번들 안의 Pretendard 가변 동적 서브셋(OFL-1.1). 근거는 core/design/tokens.ts.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
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
import { wireDatabase } from "./features/database/dbStore";
import { t } from "./i18n/i18n";
import { Root } from "./app/Root";

// 화면 조각(app/screens.ts)을 받지 못했다 — 배포가 바뀐 뒤 오래 열어 둔 탭이 지워진 옛 조각을 찾은 것이다
// (Cloudflare Pages 는 배포마다 자산을 통째로 갈아 끼운다). 새로고침해 새 번들로 연다 — 판은 IndexedDB 에
// 남아 있다(autosave). 새 번들도 못 받는 경우(오프라인)에 되풀이하지 않게 1분에 한 번만.
const RELOADED_AT = "rapfi.chunkReloadAt";
window.addEventListener("vite:preloadError", (e) => {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < 60_000) return;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return; // 저장소가 막혀 있으면 되풀이를 막을 수 없다 — 오류를 그대로 둔다
  }
  e.preventDefault();
  location.reload();
});

// 오프닝 표(4수 이름 · 흑 5수 유불리, 50KB)는 따로 떨어진 조각으로 뒤에서 받는다.
void loadOpeningTables();

// 엔진 DB(W8): 엔진이 뜰 때마다 저장된 rapfi.db 를 다시 붙이고, 자동 저장을 돌린다.
wireDatabase();

// 국면 딥링크(`?p=…`)가 있으면 그 국면으로, 없으면 지난 판을 되살린다. 이 뒤로 판이
// 바뀔 때마다 IndexedDB 에 남긴다. 링크는 읽고 나서 주소에서 걷어낸다 — 새로고침이
// 그동안 둔 수를 링크의 국면으로 되돌리지 않게.
const link = readPositionLink(location.search, DEFAULT_SIZE);
startAutosave(undefined, undefined, link.kind === "ok" ? link.moves : null);
if (link.kind !== "none") {
  if (link.kind === "invalid") useBoardNotice.getState().show(t("링크의 국면을 읽지 못했습니다"));
  const { pathname, search, hash } = router.state.location;
  void router.navigate({ pathname, search: withoutPositionParam(search), hash }, { replace: true });
}

const root = document.getElementById("root");
if (!root) throw new Error("#root 가 없습니다: index.html 이 바뀌었나요?");

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
