import type { TagKind } from "../../core/board/ladder";
import { kindOf, winRatePct, type DbCell, type DbPositionValue } from "../../core/database/yixindb";
import type { EvalView } from "../../engine/eval-view";
import { t } from "../../i18n/i18n";

/**
 * DB 의 모습을 판 · 평가 바가 그리는 모양으로 — DB 화면과 보드 화면이 함께 쓴다.
 */

/** 판 위 칩 하나. `showText` 면 칸 글자를 태그보다 먼저(settings.txt 34행). */
export function dbCellTag(
  c: DbCell,
  showText: boolean,
): { label: string; kind: TagKind; winRatePct?: number } {
  const label = showText && c.text ? c.text : c.tag || c.text;
  const k = kindOf(c.tag || c.text);
  if (k === "win") return { label, kind: "win" };
  if (k === "loss") return { label, kind: "lose" };
  return { label, kind: "rate", winRatePct: k === "rate" ? (winRatePct(c) ?? 50) : 50 };
}

/**
 * DB 가 말하는 국면 값(`positionValue`, 흑 관점)을 평가 바의 값으로. 수를 모르는 승패
 * (메이트 걸음이 없는 `W`/`L`)는 외통 대신 100% / 0% 로 그린다 — 몇 수인지 지어내지 않는다.
 */
export function dbEvalView(v: DbPositionValue): EvalView {
  if (v.blackMate !== null) {
    return {
      blackPct: v.blackMate > 0 ? 100 : 0,
      blackEval: null,
      mate: { winner: v.blackMate > 0 ? "black" : "white", plies: Math.abs(v.blackMate) },
    };
  }
  return { blackPct: v.blackWinRate * 100, blackEval: null, mate: null };
}

/** 국면 값 한 줄 — 「승 5」 · 「패 *」 · 「63%」 (둘 차례 관점). DB 화면과 국면 카드가 쓴다. */
export function dbValueText(v: DbPositionValue): string {
  if (v.stmMate !== null)
    return `${v.stmMate > 0 ? t("승") : t("패")} ${Math.abs(v.stmMate) || "*"}`;
  return `${Math.round(v.stmWinRate * 100)}%`;
}
