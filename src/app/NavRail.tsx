import { NavLink, useLocation } from "react-router-dom";
import { RAIL, RESEARCH_TABS } from "./destinations";
import { useEngineStore } from "../engine/engine-state";

/**
 * 좌측 아이콘 레일 여섯 항목.
 *
 * - **엔진 상태 점**은 «엔진» 항목에 붙는다 — 앱이 «연결» 탭에 붙이던 그 점이다.
 * - **연구 hover 서브메뉴**: 다른 화면에서도 연구 네 탭에 1클릭으로 닿게 한다.
 *   터치 환경에서는 hover 가 없으므로 CSS `@media (hover: hover)` 로만 켠다 —
 *   터치에서는 «연구» 진입 후 상단 탭(2클릭)이고, 그게 앱과 같은 동작이다.
 */
export function NavRail() {
  const { pathname } = useLocation();
  const status = useEngineStore((s) => s.status);

  return (
    <nav className="rail" aria-label="주 메뉴">
      <ul className="rail__list">
        {RAIL.map((d) => {
          const isResearch = d.path === "/research";
          return (
            <li key={d.path} className="rail__item">
              <NavLink
                to={d.path}
                className={({ isActive }) => "rail__link" + (isActive ? " is-active" : "")}
                aria-current={pathname.startsWith(d.path) ? "page" : undefined}
              >
                <svg className="rail__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={d.icon} />
                </svg>
                <span className="rail__label">{d.label}</span>
                {d.path === "/engine" && (
                  <span
                    className="rail__dot"
                    data-status={status}
                    title={`엔진: ${ENGINE_STATUS_TEXT[status]}`}
                  />
                )}
              </NavLink>

              {isResearch && (
                <ul className="rail__submenu" aria-label="연구 하위 항목">
                  {RESEARCH_TABS.map((t) => (
                    <li key={t.path}>
                      <NavLink
                        to={t.path}
                        className={({ isActive }) =>
                          "rail__sublink" + (isActive ? " is-active" : "")
                        }
                      >
                        {t.label}
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
  idle: "꺼짐",
  starting: "기동 중",
  ready: "대기",
  searching: "탐색 중",
  error: "오류",
} as const;
