import { Outlet, useLocation } from "react-router-dom";
import { NavRail } from "./NavRail";
import { BottomTabs } from "./BottomTabs";
import { TopBar } from "./TopBar";
import { ResearchTabs } from "../features/research/ResearchTabs";
import { titleFor } from "./destinations";
import { useIsCompact } from "./useIsCompact";

/**
 * 레일 + 상단 바 + 내용. 스낵바 호스트도 결국 여기 하나가 된다(앱과 같이).
 *
 * 좁은 폭(<640px)에서는 레일이 **하단 탭**으로 바뀐다 — 앱 모습 그대로다.
 * 640 은 앱의 `WideLayoutMin` 상수와 같은 값이고, W1 지시서의 분기점이기도 하다.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const compact = useIsCompact();
  const { title, subtitle } = titleFor(pathname);
  const inResearch = pathname.startsWith("/research");

  return (
    <div className="shell" data-compact={compact || undefined}>
      {!compact && <NavRail />}
      <div className="shell__main">
        <TopBar title={title} subtitle={subtitle} />
        {inResearch && <ResearchTabs />}
        <main className="shell__content">
          <Outlet />
        </main>
      </div>
      {compact && <BottomTabs />}
    </div>
  );
}
