import { NavLink, useLocation } from "react-router-dom";
import { RAIL, RESEARCH_TABS } from "./destinations";
import { useEngineStore } from "../engine/engine-state";
import { msg, t } from "../i18n/i18n";

/**
 * 좌측 아이콘 레일 여섯 항목.
 *
 * - **엔진 상태 점**은 «엔진» 항목에 붙는다 — 앱이 «연결» 탭에 붙이던 그 점이다.
 * - **두 묶음**: 보드 · 연구 · 정석이 위, 도구(DB · 엔진 · 설정)가 맨 아래로 떨어진다(`Dest.group`).
 * - **연구 hover 서브메뉴**: 다른 화면에서도 연구 네 탭에 1클릭으로 닿게 한다.
 *   터치 환경에서는 hover 가 없으므로 CSS `@media (hover: hover)` 로만 켠다 —
 *   터치에서는 «연구» 진입 후 상단 탭(2클릭)이고, 그게 앱과 같은 동작이다.
 */
export function NavRail() {
  const { pathname } = useLocation();
  const status = useEngineStore((s) => s.status);

  return (
    <nav className="rail" aria-label={t("주 메뉴")}>
      <ul className="rail__list">
        {RAIL.map((d, i) => {
          const isResearch = d.path === "/research";
          const firstTool = d.group === "tools" && RAIL[i - 1]?.group !== "tools";
          return (
            <li key={d.path} className={"rail__item" + (firstTool ? " rail__item--tools" : "")}>
              <NavLink
                to={d.path}
                className={({ isActive }) => "rail__link" + (isActive ? " is-active" : "")}
                aria-current={pathname.startsWith(d.path) ? "page" : undefined}
              >
                <svg className="rail__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={d.icon} />
                </svg>
                <span className="rail__label">{t(d.label)}</span>
                {d.path === "/engine" && (
                  <span
                    className="rail__dot"
                    data-status={status}
                    title={t("엔진: {s}", { s: t(ENGINE_STATUS_TEXT[status]) })}
                  />
                )}
              </NavLink>

              {isResearch && (
                <ul className="rail__submenu" aria-label={t("연구 하위 항목")}>
                  {RESEARCH_TABS.map((tab) => (
                    <li key={tab.path}>
                      <NavLink
                        to={tab.path}
                        className={({ isActive }) =>
                          "rail__sublink" + (isActive ? " is-active" : "")
                        }
                      >
                        {t(tab.label)}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const ENGINE_STATUS_TEXT = {
  idle: msg("꺼짐"),
  starting: msg("기동 중"),
  ready: msg("대기"),
  searching: msg("탐색 중"),
  error: msg("오류"),
} as const;
