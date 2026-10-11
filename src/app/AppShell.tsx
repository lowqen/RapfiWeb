import { Outlet, useLocation } from "react-router-dom";
import { NavRail } from "./NavRail";
import { BottomTabs } from "./BottomTabs";
import { TopBar } from "./TopBar";
import { ResearchTabs } from "../features/research/ResearchTabs";
import { titleFor } from "./destinations";
import { useIsCompact } from "./useIsCompact";
import { useAutoBoot } from "./useAutoBoot";
import { RifImportLayer } from "../features/research/rif/RifImportLayer";

/**
 * 레일 + 상단 바 + 내용. 스낵바 호스트도 결국 여기 하나가 된다(앱과 같이).
 *
 * 좁은 폭(<640px)에서는 레일이 **하단 탭**으로 바뀐다 — 앱 모습 그대로다.
 * 640 은 앱의 `WideLayoutMin` 상수와 같은 값이고, W1 지시서의 분기점이기도 하다.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const compact = useIsCompact();
  const { title } = titleFor(pathname);
  const inResearch = pathname.startsWith("/research");
  // 앱이 뜨면 엔진을 뒤에서 띄운다 — 셸은 화면을 옮겨도 남으므로 한 번만 돈다.
  useAutoBoot();

  return (
    <div className="shell" data-compact={compact || undefined}>
      {!compact && <NavRail />}
      <div className="shell__main">
        <TopBar title={title} />
        {inResearch && <ResearchTabs />}
        <main className="shell__content">
          <Outlet />
        </main>
      </div>
      {compact && <BottomTabs />}
      {/* W7: 어느 화면에 .rif 를 놓아도 변환하고, 진행 · 결과 카드를 띄운다. */}
      <RifImportLayer />
    </div>
  );
}
