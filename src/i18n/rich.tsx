import { Fragment, type ReactNode } from "react";

/**
 * 번역 문장 안에 요소(링크 · 굵게)를 끼운다 — `rich(t("{link}에서 {xml} 을 받습니다"), { link: <a…/>, xml: <b…/> })`.
 * 문장을 조각으로 쪼개 번역하면 언어마다 어순이 달라 문장이 깨진다. 문장 하나를 통째로 번역하고 자리만 채운다.
 */
export function rich(text: string, parts: Readonly<Record<string, ReactNode>>): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<Fragment key={at}>{parts[m[1]!] ?? m[0]}</Fragment>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
