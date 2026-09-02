import { BoardCanvas } from "../../core/board/BoardCanvas";
import { useBoardStore } from "./boardStore";
import { LadderStrip } from "./LadderStrip";
import { label } from "../../core/model/move";

/**
 * 보드 화면 — W2 판.
 *
 * 지금 있는 것은 **보드와 그것을 확인할 최소한**이다: 두기·무르기·번호 토글,
 * 그리고 값 사다리 견본. 대국 규칙도 시계도 오프닝 협상도 없다 — W4 가 이 위에
 * 얹힌다. 분석 pane 자리는 아직 비워 둔다(W3 의 엔진이 들어올 곳).
 */
export function BoardScreen() {
  const render = useBoardStore((s) => s.render);
  const place = useBoardStore((s) => s.place);
  const undo = useBoardStore((s) => s.undo);
  const clear = useBoardStore((s) => s.clear);
  const toggleNumbers = useBoardStore((s) => s.toggleNumbers);
  const markBlocked = useBoardStore((s) => s.markBlocked);

  const last = render.lastMove;
  const turn = render.stones.length % 2 === 0 ? "흑" : "백";

  return (
    <div className="boardscreen">
      <div className="boardscreen__board">
        <BoardCanvas render={render} onTap={place} onLongPress={markBlocked} />
      </div>

      <aside className="boardscreen__side">
        <section className="panel">
          <h2 className="panel__title">국면</h2>
          <dl className="kv">
            <dt>둘 차례</dt>
            <dd className="tnum">{turn}</dd>
            <dt>수</dt>
            <dd className="tnum">{render.stones.length}</dd>
            <dt>마지막</dt>
            <dd className="tnum">{last ? label(last, render.size) : "—"}</dd>
          </dl>
          <div className="panel__actions">
            <button type="button" onClick={undo} disabled={render.stones.length === 0}>
              무르기
            </button>
            <button type="button" onClick={clear} disabled={render.stones.length === 0}>
              비우기
            </button>
            <button type="button" onClick={toggleNumbers}>
              번호 {render.showNumbers ? "끄기" : "켜기"}
            </button>
          </div>
          <p className="panel__hint">
            길게 누르면 그 점을 차단 표시합니다 — 데스크톱의 Ctrl+클릭 자리입니다.
            휠이나 두 손가락으로 확대할 수 있습니다.
          </p>
        </section>

        <LadderStrip />

        <section className="panel panel--muted">
          <h2 className="panel__title">분석</h2>
          <p className="panel__hint">
            엔진은 W3 에서 붙습니다. 이 자리에 승률·최선수·PV·콘솔이 들어옵니다.
          </p>
        </section>
      </aside>
    </div>
  );
}
