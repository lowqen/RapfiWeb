import { DEFAULT_SIZE, type Move } from "../model/move";
import { chain, gradeAt } from "../opening/opening-name";
import { NONSTD, classify as classify26, labelOf } from "../opening/opening26";
import type { Grade, OpeningTables } from "../opening/tables";
import { mainLineFrom, movesTo, type JosekiTree } from "./tree";
import { msg } from "../../i18n/i18n";

/**
 * 정석의 분류 — 사람이 채우는 칸이 아니라 **국면에서 유도되는 값**(계획서 §7 «카테고리»).
 *
 *  - 주형 이름: 주 변화의 이름 사슬(`OpeningName`)의 마지막 — «화월», 4수 이름이 있으면 그것
 *  - 묶음: 3수의 26주형(`Opening26` — D 는 직접, I 는 간접 막기)
 *  - 5수 국면이면 흑 5수 유불리 등급(`OpeningEval`)
 *
 * 사용자가 `category` 를 적었으면 그것이 이긴다.
 */

export interface JosekiClass {
  /** 화면에 보이는 분류 — 사용자가 적은 것, 없으면 유도한 이름, 그것도 없으면 "분류 없음". */
  category: string;
  /** 유도한 주형 이름 사슬(`천원 › 간접막기 › 화월`). */
  chain: string[];
  /** 26주형 묶음(`I2 화월 (Kagetsu)`), 3수 미만이거나 비표준이면 null. */
  group: string | null;
  /** 주 변화의 5수 국면 등급. */
  grade: Grade | null;
}

/** 사전 열쇠 — 화면에는 `t(category)`(사용자 분류는 사전에 없으니 그대로 나온다). */
export const UNCLASSIFIED = msg("분류 없음");

/** 주 변화 수순. */
export const mainLine = (t: JosekiTree): Move[] => movesTo(t.root, mainLineFrom(t.root));

export function classifyTree(t: JosekiTree, tables: OpeningTables): JosekiClass {
  return classifyMoves(mainLine(t), tables, t.category, t.boardSize);
}

export function classifyMoves(
  line: readonly Move[],
  tables: OpeningTables,
  userCategory = "",
  size = DEFAULT_SIZE,
): JosekiClass {
  const names = chain(line, tables, size);
  let group: string | null = null;
  if (line.length >= 3) {
    const id = classify26(line.slice(0, 3));
    if (id !== NONSTD) group = labelOf(id);
  }
  const grade = line.length >= 5 ? gradeAt(line.slice(0, 5), tables, size) : null;
  const user = userCategory.trim();
  return { category: user || names.at(-1) || UNCLASSIFIED, chain: names, group, grade };
}
