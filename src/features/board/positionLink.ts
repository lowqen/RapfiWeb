import { useBoardStore } from "./boardStore";
import { useBoardNotice } from "./boardNotice";
import { POSITION_PARAM, encodePosition, parsePosition } from "../../core/model/position-link";
import type { Move } from "../../core/model/move";

/**
 * 국면 딥링크 `?p=…` 의 화면 쪽 — 계획서 §6. **전 화면 공통 쿼리**라 어느 주소에 붙어
 * 와도 읽는다(`/research/explorer?p=h8i9j10` 이면 그 국면을 오프닝 탭에서 본다).
 *
 * 읽은 뒤에는 주소에서 `p` 를 걷어낸다(`stripPositionParam`). 남겨 두면 판을 바꾼 뒤
 * 새로고침했을 때 링크의 국면이 다시 올라와 그동안 둔 수를 지운다 — 그 뒤로는 자동
 * 저장이 판을 지킨다.
 */

export type LinkResult = { kind: "none" } | { kind: "ok"; moves: Move[] } | { kind: "invalid" };

/** 주소의 쿼리 문자열에서 국면을 꺼낸다. */
export function readPositionLink(search: string, size: number): LinkResult {
  const p = new URLSearchParams(search).get(POSITION_PARAM);
  if (p === null) return { kind: "none" };
  const moves = parsePosition(p, size);
  return moves ? { kind: "ok", moves } : { kind: "invalid" };
}

/** `search` 에서 `p` 만 뺀 쿼리 문자열(`?` 포함, 남는 게 없으면 빈 문자열). */
export function withoutPositionParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(POSITION_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** 지금 판을 가리키는 링크 — 늘 보드 화면으로 연다. */
export function positionUrl(origin: string, base: string): string {
  const { stones, size } = useBoardStore.getState().render;
  const url = new URL(`${base.replace(/\/?$/, "/")}board`, origin);
  url.searchParams.set(POSITION_PARAM, encodePosition(stones, size));
  return url.toString();
}

/**
 * 지금 판의 링크를 클립보드에 넣는다. 클립보드를 쓸 수 없는 곳(보안 맥락이 아닌 주소 ·
 * 권한 거부)에서는 직접 복사하도록 링크를 대화상자로 보여 준다.
 */
export async function copyPositionLink(): Promise<void> {
  const url = positionUrl(location.origin, import.meta.env.BASE_URL);
  const notice = useBoardNotice.getState().show;
  try {
    await navigator.clipboard.writeText(url);
    notice("이 국면의 링크를 복사했습니다");
  } catch {
    window.prompt("이 국면의 링크 — 복사해 쓰세요", url);
  }
}
