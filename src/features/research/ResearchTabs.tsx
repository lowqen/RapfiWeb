import { NavLink } from "react-router-dom";
import { RESEARCH_TABS } from "../../app/destinations";
import { t } from "../../i18n/i18n";

/**
 * 연구 화면 안의 상단 탭 넷.
 *
 * 앱은 `QuietSwitch` 크로스페이드로 전환한다 — 미끄러지지 않는다. 웹에서는
 * `.quiet-switch` 유틸(150ms 페이드)이 그 자리다. 슬라이드를 넣지 말 것:
 * 보드를 읽는 중에 시선이 끌려간다(`Motion.kt` 의 네 규칙).
 */
export function ResearchTabs() {
  return (
    <div className="rtabs" role="tablist" aria-label={t("연구")}>
      {RESEARCH_TABS.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          role="tab"
          className={({ isActive }) => "rtabs__tab" + (isActive ? " is-active" : "")}
        >
          {t(tab.label)}
        </NavLink>
      ))}
    </div>
  );
}
