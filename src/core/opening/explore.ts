import { DEFAULT_SIZE, move, moveKey, type Move } from "../model/move";
import { gradeAt, nameAt } from "./opening-name";
import type { Grade, OpeningTables } from "./tables";

/**
 * 팩 없는 오프닝 탐색 — 앱 `ExplorerLookup.theoryOnly` / `nextRows` 의 «이론» 절반.
 *
 * 앱의 다음 수 표는 «둔 수(팩) ∪ 등급 붙은 수»다. 웹은 아직 팩이 없으므로(W7) 둔 수 대신
 * **이름이 붙는 수**를 묻는다 — 빈 칸마다 그 수를 두었을 때의 이름과 등급을 보고, 둘 중
 * 하나라도 있으면 한 줄이다. 그래서 3수 국면을 보면 4수 이름들을, 4수 국면을 보면 5수
 * 등급들을 훑게 된다. 225칸 × 키 계산은 화면 갱신 한 번에 견줄 것이 못 된다.
 */
export interface TheoryRow {
  readonly move: Move;
  /** 이 수가 *만드는* 이름, 없으면 `null`. */
  readonly name: string | null;
  /** 이 수가 닿는 국면의 흑 5수 유불리, 없으면 `null`. */
  readonly grade: Grade | null;
}

/**
 * 순서: 등급이 흑에게 좋은 것부터, 그다음 이름 있는 것, 그다음 보드 인덱스 — «중요한 것이
 * 위»로 읽히게(앱의 «이론 최선부터»와 같다).
 */
export function theoryNext(
  moves: readonly Move[],
  tables: OpeningTables,
  size = DEFAULT_SIZE,
): TheoryRow[] {
  const ply = moves.length + 1;
  const taken = new Set(moves.map((m) => moveKey(m, size)));
  const rows: TheoryRow[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const m = move(x, y);
      if (taken.has(moveKey(m, size))) continue;
      const next = [...moves, m];
      const name = nameAt(ply, next, tables, size);
      const grade = gradeAt(next, tables, size);
      if (name !== null || grade !== null) rows.push({ move: m, name, grade });
    }
  }
  return rows.sort(
    (a, b) =>
      (b.grade?.code ?? -99) - (a.grade?.code ?? -99) ||
      Number(b.name !== null) - Number(a.name !== null) ||
      moveKey(a.move, size) - moveKey(b.move, size),
  );
}
