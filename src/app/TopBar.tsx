import { ThemeToggle } from "./ThemeToggle";
import { EngineIndicator } from "./EngineIndicator";

/**
 * 제목과 부제 — 현재 위치를 말로 확인해 주는 자리.
 *
 * 레일의 활성 표시(배경 + 굵기)와 **두 번** 말한다. 중복이 아니라 요구 사항이다:
 * «각 기능에 한 번의 클릭으로 닿고 현재 위치가 분명할 것».
 *
 * 오른쪽에는 엔진 표시(`EngineIndicator`)와 테마 단추뿐이다 — 어느 화면에서든 엔진이 지금
 * 어떤지 한 눈에 보인다. 엔진 선택과 언어는 설정 ▸ 자주 쓰는 설정으로 옮겼다(상단 바가 붐볐다).
 */
export function TopBar({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="topbar">
      <div className="topbar__text">
        <h1 className="topbar__title">{title}</h1>
        {subtitle && <p className="topbar__subtitle">{subtitle}</p>}
      </div>
      <div className="topbar__end">
        <EngineIndicator />
        <ThemeToggle />
      </div>
    </header>
  );
}
