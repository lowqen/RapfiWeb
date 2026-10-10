import { DEFAULT_SIZE, fromLabel, label, moveKey, type Move } from "../model/move";
import { t } from "../../i18n/i18n";

/**
 * 손으로 적은 수순 — `h8 i9 j10`, `h8,i9`, `H8I9J10`, `1. h8 2. i9`, 줄바꿈 섞기(계획서 §7).
 *
 * 토큰을 공백 · 쉼표 · 세미콜론으로 나누고, 앞의 수 번호(`1.` · `12)`)를 걷어 낸 뒤, 각 토큰이
 * **좌표만으로** 이뤄져야 한다(`h8i9` 처럼 붙여 써도 된다). 읽지 못한 토큰이 하나라도 있으면
 * 그 토큰을 가리키며 실패한다 — 반쯤 읽힌 수순을 조용히 받으면 정석이 엉뚱한 줄로 들어간다.
 */

export type ParseResult = { ok: true; moves: Move[] } | { ok: false; error: string };

const COORD = /([a-z])(\d{1,2})/giy;

export function parseMoveText(text: string, size = DEFAULT_SIZE): ParseResult {
  const moves: Move[] = [];
  const seen = new Set<number>();
  for (const raw of text.split(/[\s,;]+/)) {
    const tok = raw.replace(/^\d+[.)]/, "").replace(/^[.)]+/, "");
    if (!tok) continue;
    COORD.lastIndex = 0;
    let at = 0;
    while (at < tok.length) {
      COORD.lastIndex = at;
      const m = COORD.exec(tok);
      if (!m) return { ok: false, error: t("«{raw}» 를 좌표로 읽지 못했습니다", { raw }) };
      // 두 자리 수가 판 밖이면 한 자리만 — `h1i9` 가 아니라 `a15b1` 같은 경우를 위해.
      let digits = m[2]!;
      let mv = fromLabel(m[1]! + digits, size);
      if (!mv && digits.length === 2) {
        digits = digits[0]!;
        mv = fromLabel(m[1]! + digits, size);
      }
      if (!mv) return { ok: false, error: t("«{c}» 는 판 밖입니다", { c: `${m[1]}${m[2]}` }) };
      const k = moveKey(mv, size);
      if (seen.has(k))
        return {
          ok: false,
          error: t("{n}수 {m} 는 이미 둔 자리입니다", { n: moves.length + 1, m: label(mv, size) }),
        };
      seen.add(k);
      moves.push(mv);
      at += 1 + digits.length;
    }
  }
  return { ok: true, moves };
}

/** 수순을 사람이 읽는 한 줄로(`h8 i9 j10`) — 위 파서의 역. */
export const movesText = (moves: readonly Move[], size = DEFAULT_SIZE): string =>
  moves.map((m) => label(m, size).toLowerCase()).join(" ");
