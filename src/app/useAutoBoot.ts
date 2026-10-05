import { useEffect } from "react";
import { useEngineStore } from "../engine/engine-state";
import { useSettingsStore } from "../features/settings/settingsStore";

/**
 * 주소의 `?autoboot=0` — 이번 방문은 엔진을 띄우지 않는다(엔진 산출물이 없는 스모크·진단용).
 * **모듈이 읽힐 때 한 번** 본다 — 첫 렌더에서 라우터가 `/` → `/board` 로 옮기며 쿼리를
 * 떨어뜨리기 전이다.
 */
const DISABLED_BY_QUERY = (() => {
  try {
    return (
      typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("autoboot") === "0"
    );
  } catch {
    return false;
  }
})();

/**
 * 앱이 뜨면 엔진을 뒤에서 띄운다(설정 「앱을 열면 엔진 시작」, 기본 켬).
 *
 * 셸에 한 번 건다 — 어느 화면으로 들어와도(딥링크 포함) 엔진이 준비되고, 화면을 옮겨도
 * 다시 부르지 않는다. 기동은 멱등이다(`EngineClient.start` 가 떠 있거나 뜨는 중이면 그것을
 * 돌려준다) — StrictMode 가 효과를 두 번 돌려도 워커는 한 벌이다.
 *
 * 기다리는 동안 화면은 막지 않는다: 판은 바로 둘 수 있고, 상단 바의 표시가 단계(가중치 →
 * 엔진 → 예열)를 말하며, 분석·대국 요청은 기동이 끝나는 대로 이어진다.
 */
export function useAutoBoot() {
  useEffect(() => {
    if (DISABLED_BY_QUERY || !useSettingsStore.getState().autoBoot) return;
    const e = useEngineStore.getState();
    if (!e.capabilities.variant || e.status !== "idle") return;
    void e.start();
  }, []);
}
