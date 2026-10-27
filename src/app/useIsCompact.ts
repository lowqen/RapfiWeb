import { useSyncExternalStore } from "react";
import { LAYOUT } from "../core/design/tokens";

/**
 * 좁은 폭인가. 분기점은 앱의 `WideLayoutMin`(640)과 같다.
 *
 * `window.innerWidth` 를 resize 로 좇지 않고 `matchMedia` 를 쓴다 — 브라우저가
 * 이미 알고 있는 것을 우리가 다시 계산하면 스크롤 중에도 리렌더가 돈다.
 * 외부 값의 구독이라 `useSyncExternalStore` — 첫 렌더부터 지금 값을 읽고, effect 안에서
 * 상태를 다시 맞추느라 한 번 더 그리지 않는다.
 */
export function useIsCompact(): boolean {
  return useSyncExternalStore(subscribe, () => query().matches);
}

function subscribe(onChange: () => void): () => void {
  const mq = query();
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function query(): MediaQueryList {
  return window.matchMedia(`(max-width: ${LAYOUT.compactMax}px)`);
}
