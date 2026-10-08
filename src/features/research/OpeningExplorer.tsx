import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { BoardCanvas } from "../../core/board/BoardCanvas";
import type { BoardRender } from "../../core/board/board-renderer";
import { label, moveKey, sameMove, type Move } from "../../core/model/move";
import { chain, gradeAt } from "../../core/opening/opening-name";
import { keyOf, transpositions } from "../../core/opening/frame";
import { theoryNext } from "../../core/opening/explore";
import { GradeBadge } from "../../components/GradeBadge";
import { useOpeningTables } from "../../data/opening-tables";
import { useBoardStore } from "../board/boardStore";
import { useGameStore } from "../board/gameStore";

/**
 * 연구 ▸ 오프닝 — **팩 없이 되는 부분**(W6a). 앱 `OpeningExplorerSection` 의 이름 사슬 ·
 * 환원 · 이론 다음 수.
 *
 * 판은 보드 화면과 **같은 판**이다 — 여기서 둔 수는 보드에도 있고, 보드에서 둔 수를
 * 여기서 이어 본다. 그래서 보드의 두 스토어를 직접 읽는다(`features/README.md` 의 예외). 계획서 §6 의 «국면 → 다음 수» 순서대로 한 열로 읽는다.
 *
 * 둘 수 있는 것은 표에 있는 수(판 위의 점 · 등급 표식)뿐이다 — 이 화면은 이론을 훑는 곳이고,
 * 아무 데나 두는 것은 보드 화면의 일이다. 빈도 통계(몇 판 · 흑 승률)는 사용자가 `.rif`
 * 를 올린 뒤에야 생긴다(W7).
 */

const fmtLine = (moves: readonly Move[], size: number) =>
  moves.map((m) => label(m, size)).join(" ");

export function OpeningExplorer() {
  const render = useBoardStore((s) => s.render);
  const future = useBoardStore((s) => s.future);
  const tables = useOpeningTables((s) => s.tables);
  const loaded = useOpeningTables((s) => s.loaded);
  const { stones, size } = render;

  const names = useMemo(() => chain(stones, tables, size), [stones, tables, size]);
  const grade = useMemo(() => gradeAt(stones, tables, size), [stones, tables, size]);
  const rows = useMemo(() => theoryNext(stones, tables, size), [stones, tables, size]);
  const offFrame = stones.length > 0 && keyOf(stones, size) === null;
  const alts = useMemo(() => {
    const self = keyOf(stones, size);
    return transpositions(stones, size)
      .filter((l) => keyOf(l, size) !== self)
      .map((l) => ({ line: l, chain: chain(l, tables, size) }));
  }, [stones, tables, size]);

  // 판에는 돌과 «표에 있는 다음 수»만 — 값 칩이나 엔진 표식은 얹지 않는다(여기는 이론이다).
  // 등급이 있는 수는 그 등급의 모양 표식(목록의 `GradeBadge` 와 같은 그림), 이름만 있는
  // 수는 작은 점이다.
  const view: BoardRender = useMemo(
    () => ({
      ...render,
      tags: new Map(),
      bestMark: null,
      ghosts: [],
      loseCells: new Set(),
      candidates: new Map(
        rows.filter((r) => !r.grade).map((r) => [moveKey(r.move, size), "done" as const]),
      ),
      marks: new Map(
        rows.flatMap((r) =>
          r.grade
            ? [
                [
                  moveKey(r.move, size),
                  { shape: r.grade.mark, fill: r.grade.fill, dot: r.grade.dot },
                ] as const,
              ]
            : [],
        ),
      ),
    }),
    [render, rows, size],
  );

  const play = useCallback(
    (m: Move) => {
      const g = useGameStore.getState();
      const head = future[0];
      g.loadMoves([...stones, m], {
        // 무른 수와 같은 수면 앞날을 지킨다 — 보드의 「앞으로」와 같은 규칙.
        future: head && sameMove(head, m) ? future.slice(1) : [],
        name: g.gameName,
        what: `오프닝 탐색 — ${label(m, size)}`,
      });
    },
    [stones, future, size],
  );

  const onTap = useCallback(
    (m: Move) => {
      if (rows.some((r) => sameMove(r.move, m))) play(m);
    },
    [rows, play],
  );

  const undo = useGameStore((s) => s.undoMove);
  const undoAll = useGameStore((s) => s.undoAll);

  return (
    <div className="explorer">
      <div className="explorer__board">
        <BoardCanvas render={view} onTap={onTap} zoomable={false} />
      </div>
      <div className="panel__actions explorer__nav">
        <button type="button" onClick={undoAll} disabled={stones.length === 0}>
          처음으로
        </button>
        <button type="button" onClick={undo} disabled={stones.length === 0}>
          한 수 무르기
        </button>
        <Link className="btn" to="/board">
          보드에서 보기
        </Link>
      </div>

      <section className="panel">
        <h2 className="panel__title">국면</h2>
        <dl className="kv">
          <dt>수순</dt>
          <dd className="tnum" data-k="explorer-line">
            {stones.length ? fmtLine(stones, size) : "시작 국면"}
          </dd>
          <dt>이름</dt>
          <dd data-k="explorer-chain">{names.length ? names.join(" › ") : "—"}</dd>
          {grade && (
            <>
              <dt>유불리</dt>
              <dd>
                <GradeBadge grade={grade} />
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="panel">
        <h2 className="panel__title">
          다음 수 <span className="panel__status">{rows.length ? `${rows.length}곳` : ""}</span>
        </h2>
        {rows.length === 0 ? (
          <p className="panel__hint">
            {stones.length >= 5
              ? "이름과 흑 5수 유불리는 5수까지입니다. 그 뒤로는 엔진이 읽습니다(보드 ▸ 분석)."
              : offFrame
                ? "이 수순은 표준 개시 틀(1수 천원 · 3수까지 가운데 5×5)을 벗어났습니다."
                : "표에 이 국면의 다음 수가 없습니다 — 대부분의 4수에는 이름이 없고, 그것이 정상입니다."}
          </p>
        ) : (
          <ul className="theory" aria-label="이론 다음 수">
            {rows.map((r) => (
              <li key={moveKey(r.move, size)}>
                <button type="button" className="theory__row" onClick={() => play(r.move)}>
                  <span className="theory__move tnum">{label(r.move, size)}</span>
                  <span className="theory__name">{r.name ?? ""}</span>
                  {r.grade && <GradeBadge grade={r.grade} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {alts.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">환원 — 같은 돌, 다른 수순</h2>
          <p className="panel__hint">
            돌과 색이 같으니 한 판이고 유불리도 하나지만, 수순이 달라 이름은 다를 수 있습니다.
          </p>
          <ul className="theory">
            {alts.map((a) => (
              <li key={fmtLine(a.line, size)} className="theory__row theory__row--static">
                <span className="theory__move tnum">{fmtLine(a.line, size)}</span>
                <span className="theory__name">{a.chain.join(" › ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="explorer__note">
        1~3수 이름은 계산하고, 4수 이름 249개와 흑 5수 유불리 1,889모양은 내장 표에서
        읽습니다(유불리 출처: Renju Atlas, CC0 1.0).
        {!loaded && " 표를 받는 중입니다…"} 빈도 통계는 RenjuNet `.rif` 를 올린 뒤에 생깁니다.
      </p>
    </div>
  );
}
