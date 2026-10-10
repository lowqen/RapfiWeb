import { NavLink } from "react-router-dom";
import { RAIL } from "./destinations";
import { t } from "../i18n/i18n";

/**
 * 좁은 폭(<640px)의 하단 탭 — 앱 모습 그대로.
 *
 * 레일과 **같은 여섯 항목**이다. 앱은 다섯이었지만 정석이 늘었고, 여섯은
 * 아직 «한눈에 읽히는» 범위 안이다(앱이 일곱에서 멈춘 그 판단선).
 */
export function BottomTabs() {
  return (
    <nav className="tabs" aria-label={t("주 메뉴")}>
      {RAIL.map((d) => (
        <NavLink
          key={d.path}
          to={d.path}
          className={({ isActive }) => "tabs__link" + (isActive ? " is-active" : "")}
        >
          <svg className="tabs__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d={d.icon} />
          </svg>
          <span className="tabs__label">{t(d.label)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
