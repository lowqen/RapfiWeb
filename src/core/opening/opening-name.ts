import { DEFAULT_SIZE, type Move } from "../model/move";
import { t } from "../../i18n/i18n";
import { keyOf as posKeyOf } from "../model/pos-key";
import { MAX_PLY, frameTransform, keyOf, move2Kind } from "./frame";
import { NONSTD, classify, nameOf } from "./opening26";
import { gradeOf, isGradePly, type Grade, type OpeningTables } from "./tables";

/**
 * 국면의 이름과 평가 — 앱 `OpeningName.kt` 의 `nameAt` · `chain` · `gradeAt`.
 *
 * **이름은 드물게 있다.** 1·2·3수는 순수 계산이라 늘 답하고, 4수는 `opening_names.txt`
 * 에서 오므로 대부분의 4수에는 이름이 없다. 그것이 정상이다 — 이름이 있을 거라고 기대하는
 * 곳이 있으면 안 되고, 사슬은 이름이 끊기는 곳에서 그냥 멈춘다.
 */

/** `moves` 의 처음 `ply` 수 뒤 국면의 이름, 없으면 `null`. */
export function nameAt(
  ply: number,
  moves: readonly Move[],
  tables: OpeningTables,
  size = DEFAULT_SIZE,
): string | null {
  if (ply < 1 || ply > MAX_PLY || ply > moves.length) return null;
  const line = moves.slice(0, ply);
  if (frameTransform(line, size) < 0) return null;
  switch (ply) {
    case 1:
      return t("천원");
    case 2: {
      const k = move2Kind(line, size);
      return k === "direct" ? t("직접막기") : k === "indirect" ? t("간접막기") : null;
    }
    case 3: {
      const id = classify(line);
      return id === NONSTD ? null : nameOf(id);
    }
    default: {
      // 4수 — 사용자의 표, 프레임 키로
      const key = keyOf(line, size);
      return (key !== null ? tables.names.get(key)?.ko : null) ?? null;
    }
  }
}

/**
 * `["천원", "간접막기", "화월"]` — 이 수순의 이름 붙은 단계들. 처음 이름이 없는 수에서
 * 멈춘다 — 사슬은 길이지 집합이 아니다.
 */
export function chain(
  moves: readonly Move[],
  tables: OpeningTables,
  size = DEFAULT_SIZE,
): string[] {
  const out: string[] = [];
  for (let ply = 1; ply <= Math.min(MAX_PLY, moves.length); ply++) {
    const n = nameAt(ply, moves, tables, size);
    if (n === null) break;
    out.push(n);
  }
  return out;
}

/**
 * `moves` 뒤 국면의 흑 5수 유불리 등급, 없으면 `null`. 수순이 아니라 **국면**(`PosKey`)으로
 * 찾는다 — 이름과 반대다. 같은 돌에 이르는 두 수순은 같은 판이라 같은 등급이어야 한다.
 */
export function gradeAt(
  moves: readonly Move[],
  tables: OpeningTables,
  size = DEFAULT_SIZE,
): Grade | null {
  if (!isGradePly(moves.length) || tables.evals.size === 0) return null;
  return gradeOf(tables.evals.get(posKeyOf(moves, size)));
}
