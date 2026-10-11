import { useCallback, useState } from "react";

/**
 * 기억되는 펼침 상태 하나(`rapfi.open.<id>`) — 펼침(`Disclosure`)과 엔진 카드의 «세부 수치»가 쓴다.
 * 컴포넌트 파일과 나눈 것은 React Fast Refresh 규칙 때문이다(`icon-paths.ts` 주석).
 */
const KEY = "rapfi.open.";

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(KEY + id);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

/** 펼침 상태 하나 — 기억되는 불리언. 펼침 머리 말고도(엔진 세부 수치 등) 쓴다. */
export function useRememberedOpen(id: string, fallback = false): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => readOpen(id, fallback));
  const set = useCallback(
    (v: boolean) => {
      setOpen(v);
      try {
        localStorage.setItem(KEY + id, v ? "1" : "0");
      } catch {
        /* 이번 세션만 */
      }
    },
    [id],
  );
  return [open, set];
}
