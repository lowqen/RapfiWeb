import { DEFAULT_SIZE, fromLabel, label, sameMove, type Move } from "./move";

/**
 * 국면 딥링크 `?p=h8i9j10` 의 수순 문자열 — 계획서 §6 「국면 딥링크」.
 *
 * 앱의 «국면 문자열»이 웹에서 갖는 등가물이다: 좌표를 구분자 없이 잇는다(열 글자가 곧
 * 구분자다). 쓸 때는 소문자, 읽을 때는 대소문자 · 공백 · 쉼표를 가리지 않는다 — 사람이
 * 손으로 고쳐 붙여 넣는 링크이기 때문이다.
 *
 * 기보 파일과 달리 **부분만 읽지 않는다.** 한 토큰이라도 판 밖이거나 이미 돌이 있는
 * 자리면 링크 전체를 거절한다 — 앞부분만 올린 판은 보낸 사람이 뜻한 국면이 아닌데도
 * 그렇게 보이기 때문이다.
 */

/** 링크 쿼리의 이름. */
export const POSITION_PARAM = "p";

export const encodePosition = (moves: readonly Move[], size = DEFAULT_SIZE): string =>
  moves.map((m) => label(m, size).toLowerCase()).join("");

/** 수순 문자열을 읽는다. 빈 문자열은 빈 판, 읽을 수 없으면 `null`. */
export function parsePosition(text: string, size = DEFAULT_SIZE): Move[] | null {
  const src = text.replace(/[\s,]/g, "");
  if (!/^([A-Za-z]\d{1,2})*$/.test(src)) return null;
  const out: Move[] = [];
  for (const tok of src.match(/[A-Za-z]\d{1,2}/g) ?? []) {
    const m = fromLabel(tok, size);
    if (!m || out.some((p) => sameMove(p, m))) return null;
    out.push(m);
  }
  return out;
}
