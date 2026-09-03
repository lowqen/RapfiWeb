import { useEffect } from "react";
import { BoardCanvas } from "../../core/board/BoardCanvas";
import { useBoardStore } from "./boardStore";
import { LadderStrip } from "./LadderStrip";
import { AnalysisPanel } from "./AnalysisPanel";
import { EngineConsole } from "./EngineConsole";
import { useEngineStore } from "../../engine/engine-state";
import { label } from "../../core/model/move";
import { RULE_LABEL } from "../../core/model/rules";

/**
 * 보드 화면 — W3 판.
 *
 * 보드 pane + 분석 pane 2열. 대국 규칙·시계·오프닝 협상은 아직 없다(W4).
 * 지금 있는 것은 「돌을 놓고, 엔진에 물어보고, 답을 보드에서 읽는다」까지다.
 */
export function BoardScreen() {
  const render = useBoardStore((s) => s.render);
  const place = useBoardStore((s) => s.place);
  const undo = useBoardStore((s) => s.undo);
  const clear = useBoardStore((s) => s.clear);
  const toggleNumbers = useBoardStore((s) => s.toggleNumbers);
  const markBlocked = useBoardStore((s) => s.markBlocked);
  const applyAnalysis = useBoardStore((s) => s.applyAnalysis);

  const snapshot = useEngineStore((s) => s.snapshot);

  // 엔진 스냅샷 → 보드. 스토어를 둘로 나눠 두고 여기서 잇는 이유는, 보드가 엔진을
  // **모르는 채로** 그려질 수 있어야 하기 때문이다(내보내기·정석 미리보기 등).
  useEffect(() => {
    applyAnalysis(snapshot);
  }, [snapshot, applyAnalysis]);

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
            <dt>규칙</dt>
            <dd className="tnum">{RULE_LABEL.renju}</dd>
            <dt>둘 차례</dt>
            <dd className="tnum" data-k="turn">
              {turn}
            </dd>
            <dt>수</dt>
            <dd className="tnum">{render.stones.length}</dd>
            <dt>마지막</dt>
            {/* 스모크가 순서가 아니라 이름으로 집게 한다 — kv 에 줄이 하나 늘 때마다
                시험이 헛짚는 것을 W3 에서 한 번 겪었다. */}
            <dd className="tnum" data-k="last">
              {last ? label(last, render.size) : "—"}
            </dd>
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
            길게 누르면 그 점을 차단 표시합니다 — 데스크톱의 Ctrl+클릭 자리입니다. 휠이나 두
            손가락으로 확대할 수 있습니다.
          </p>
        </section>

        <AnalysisPanel />
        <LadderStrip />
        <EngineConsole />
      </aside>
    </div>
  );
}
