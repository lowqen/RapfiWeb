import { create } from "zustand";
import { EMPTY_TABLES, parseEvals, parseNames, type OpeningTables } from "../core/opening/tables";

/**
 * 웹이 싣는 오프닝 표 둘 — `src/core/opening/data/`.
 *
 *   `opening_names.txt`  4수 이름 249줄 — 이 프로젝트가 쓴 표(BSD-2-Clause)
 *   `opening_evals.txt`  흑 5수 유불리 1,889모양
 *
 * 둘 다 RenjuNet 과 무관해 배포물에 실어도 된다(계획서 결정 ①의 «기본 내장»). 50KB 남짓이라
 * 앱이 뜰 때 따로 떨어진 조각으로 받아 둔다 — 첫 그림을 붙들지 않는다. 받기 전에는 빈 표라
 * 1~3수 이름(계산)만 보이고, 4수 이름과 등급은 받은 뒤에 나타난다.
 *
 * 원본은 `test-yixin/opening_names.txt` · `opening_evals.txt`(생성은 `rifdb/` 의
 * 스크립트). 갱신하면 여기 사본도 함께 바꾸고 `pnpm test` 를 돌린다 — 평가 골든과
 * 어긋나면 `opening.test.ts` 가 잡는다.
 */
interface OpeningTablesState {
  tables: OpeningTables;
  loaded: boolean;
}

export const useOpeningTables = create<OpeningTablesState>(() => ({
  tables: EMPTY_TABLES,
  loaded: false,
}));

let loading: Promise<void> | null = null;

export function loadOpeningTables(): Promise<void> {
  loading ??= (async () => {
    try {
      const [names, evals] = await Promise.all([
        import("../core/opening/data/opening_names.txt?raw"),
        import("../core/opening/data/opening_evals.txt?raw"),
      ]);
      useOpeningTables.setState({
        tables: { names: parseNames(names.default).rows, evals: parseEvals(evals.default).rows },
        loaded: true,
      });
    } catch {
      // 받지 못해도(오프라인 첫 방문 등) 계산하는 이름은 그대로 돈다. 다음 기회에 다시.
      loading = null;
    }
  })();
  return loading;
}
