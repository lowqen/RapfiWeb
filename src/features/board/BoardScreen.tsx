import { useCallback, useEffect, useState } from "react";
import { BoardCanvas } from "../../core/board/BoardCanvas";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { LadderStrip } from "./LadderStrip";
import { AnalysisPanel } from "./AnalysisPanel";
import { ClockPanel } from "./ClockPanel";
import { GamePanel } from "./GamePanel";
import { OpeningPanel, PromptPanel } from "./OpeningPanel";
import { EngineConsole } from "./EngineConsole";
import { MoveTransport } from "./MoveTransport";
import { useEngineStore } from "../../engine/engine-state";
import { label, type Move } from "../../core/model/move";
import { RULE_LABEL } from "../../core/model/rules";

/**
 * 보드 화면 — W4 판.
 *
 * 탭이 이제 `boardStore.place` 가 아니라 **`gameStore.tap`** 으로 간다. 그래야
 * 금수·차례·협상 단계가 한 곳에서 판단된다 — 보드는 여전히 규칙을 모른다.
 * 「돌을 놓는다」와 「대국의 한 수를 둔다」는 다른 일이고, 그 차이가 이 한 줄이다.
 *
 * **배치.** 왼쪽 칸은 보드와 그 바로 밑의 이동 바(`MoveTransport`)뿐이다.
 * 엔진 수치·후보 수·대국 도구·시계는 전부 오른쪽 칸(좁은 세로 화면에서는 아래)이
 * 카드로 나눠 진다 — 앱의 보드 화면에서 재생 바 밑에 쌓이던 것들이다.
 */
export function BoardScreen() {
  const render = useBoardStore((s) => s.render);
  const ahead = useBoardStore((s) => s.future.length);
  const toggleNumbers = useBoardStore((s) => s.toggleNumbers);
  const markBlocked = useBoardStore((s) => s.markBlocked);
  const applyAnalysis = useBoardStore((s) => s.applyAnalysis);

  const tap = useGameStore((s) => s.tap);
  const refreshForbidden = useGameStore((s) => s.refreshForbidden);
  const snapshot = useEngineStore((s) => s.snapshot);
  const status = useEngineStore((s) => s.status);

  // 엔진이 **놀게 되는 순간**마다 금수를 물어본다. 기동 직후와 탐색이 끝난
  // 직후가 여기다 — 엔진의 착수 응답은 상태가 아직 searching 일 때 도착하므로,
  // 그때의 조회는 대국 스토어 쪽에서 건너뛰고 이 효과가 뒤이어 받아 온다.
  // 대국 스토어가 엔진 상태를 스스로 구독하면 두 스토어가 서로를 보게 된다.
  useEffect(() => {
    if (status === "ready") refreshForbidden();
  }, [status, refreshForbidden]);

  /** 거절 사유를 잠깐 띄운다. 아무 반응이 없으면 「먹통」으로 읽힌다. */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(id);
  }, [notice]);

  const onTap = useCallback(
    (m: Move) => {
      const r = tap(m);
      if (r.kind === "rejected") setNotice(r.reason);
      else setNotice(null);
    },
    [tap],
  );

  // 엔진 스냅샷 → 보드. 스토어를 둘로 나눠 두고 여기서 잇는 이유는, 보드가 엔진을
  // **모르는 채로** 그려질 수 있어야 하기 때문이다(내보내기·정석 미리보기 등).
  useEffect(() => {
    applyAnalysis(snapshot);
  }, [snapshot, applyAnalysis]);

  const last = render.lastMove;
  const turn = render.stones.length % 2 === 0 ? "흑" : "백";

  return (
    <div className="boardscreen">
      <div className="boardscreen__stage">
        <div className="boardscreen__board">
          <BoardCanvas render={render} onTap={onTap} onLongPress={markBlocked} />
          {notice && (
            <p className="board-notice" role="status">
              {notice}
            </p>
          )}
        </div>
        <MoveTransport />
      </div>

      <aside className="boardscreen__side" aria-label="분석과 도구">
        {/* 물음은 맨 위 — 답하기 전까지 판이 잠기므로 가장 먼저 보여야 한다. */}
        <PromptPanel />
        <AnalysisPanel />

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
            <dd className="tnum">
              {render.stones.length}
              {ahead > 0 && <span className="kv__aside"> / {render.stones.length + ahead}</span>}
            </dd>
            <dt>마지막</dt>
            {/* 스모크가 순서가 아니라 이름으로 집게 한다 — kv 에 줄이 하나 늘 때마다
                시험이 헛짚는 것을 W3 에서 한 번 겪었다. */}
            <dd className="tnum" data-k="last">
              {last ? label(last, render.size) : "—"}
            </dd>
          </dl>
          <div className="panel__actions">
            {/* 무르기·앞으로는 보드 밑 이동 바가 진다. 「비우기」는 아래 대국 패널의
                「새 대국」이 한다 — 판만 비우고 시계·협상은 그대로 두는 버튼은 조용히
                어긋난 상태를 만든다. */}
            <button type="button" onClick={toggleNumbers} aria-pressed={render.showNumbers}>
              번호 {render.showNumbers ? "끄기" : "켜기"}
            </button>
          </div>
          <p className="panel__hint">
            길게 누르면 그 점을 차단 표시합니다 — 데스크톱의 Ctrl+클릭 자리입니다. 휠이나 두
            손가락으로 확대할 수 있고, ← → Home End 로 수를 옮깁니다.
          </p>
        </section>

        <ClockPanel />
        <OpeningPanel />
        <GamePanel />
        <EngineConsole />
        <LadderStrip />
      </aside>
    </div>
  );
}
