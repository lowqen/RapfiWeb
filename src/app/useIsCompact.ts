import { useEffect, useState } from "react";
import { LAYOUT } from "../core/design/tokens";

/**
 * 좁은 폭인가. 분기점은 앱의 `WideLayoutMin`(640)과 같다.
 *
 * `window.innerWidth` 를 resize 로 좇지 않고 `matchMedia` 를 쓴다 — 브라우저가
 * 이미 알고 있는 것을 우리가 다시 계산하면 스크롤 중에도 리렌더가 돈다.
 */
export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() => query().matches);

  useEffect(() => {
    const mq = query();
    const on = (e: MediaQueryListEvent) => setCompact(e.matches);
    mq.addEventListener("change", on);
    setCompact(mq.matches);
    return () => mq.removeEventListener("change", on);
  }, []);

  return compact;
}

function query(): MediaQueryList {
  return window.matchMedia(`(max-width: ${LAYOUT.compactMax}px)`);
}
