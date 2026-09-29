import { useCallback, useEffect, useState } from "react";
import { BoardCanvas } from "../../core/board/BoardCanvas";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { AnalysisPanel } from "./AnalysisPanel";
import { EvalBar } from "./EvalBar";
import { OpeningProgress, PromptPanel } from "./OpeningPanel";
import { MoveTransport } from "./MoveTransport";
import { QuickActions } from "./QuickActions";
import { useEngineStore } from "../../engine/engine-state";
import { useSettingsStore } from "../settings/settingsStore";
import { label, type Move } from "../../core/model/move";
import { RULE_LABEL } from "../../core/model/rules";
import { OPENING_LABEL, describeResult } from "../../core/model/game";

/**
 * 보드 화면 — W4 판.
 *
 * 탭이 이제 `boardStore.place` 가 아니라 **`gameStore.tap`** 으로 간다. 그래야
 * 금수·차례·협상 단계가 한 곳에서 판단된다 — 보드는 여전히 규칙을 모른다.
 * 「돌을 놓는다」와 「대국의 한 수를 둔다」는 다른 일이고, 그 차이가 이 한 줄이다.
 *
 * **배치.** 왼쪽 칸은 위에서부터 퀵 액션 바(`QuickActions` — 분석·무르기·되돌리기·
 * 새 판·진영 전환) · 평가 바와 보드 · 이동 바(`MoveTransport`)다. 오른쪽 칸(좁은 세로
 * 화면에서는 아래)에는 **엔진 상태 · 국면** 두 카드를 두고, 국면 카드가 개시 진행과
 * 대국을 끝내는 두 버튼(기권·무승부)을 진다. 대국 **설정**은 설정 탭, 콘솔은 엔진
 * 탭이다. 대국 시계는 없다.
 */
export function BoardScreen() {
  const render = useBoardStore((s) => s.render);
  const ahead = useBoardStore((s) => s.future.length);
  const result = useGameStore((s) => s.result);
  const opening = useGameStore((s) => s.opening);
  const showEvalBar = useSettingsStore((s) => s.showEvalBar);
  const markBlocked = useBoardStore((s) => s.markBlocked);
  const applyAnalysis = useBoardStore((s) => s.applyAnalysis);

  const resign = useGameStore((s) => s.resign);
  const offerDraw = useGameStore((s) => s.offerDraw);
  const playing = !result && render.stones.length > 0;
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
    <div className="boardscreen" data-evalbar={showEvalBar || undefined}>
      <div className="boardscreen__stage">
        <QuickActions />
        <div className="boardscreen__board">
          {/* 평가 바와 판을 한 줄로 — 판은 바 몫을 뺀 정사각형이고, 바는 판과 같은
              높이다(CSS 의 컨테이너 단위). 둘을 묶어 가운데 둔다. */}
          <div className="boardrow">
            {showEvalBar && <EvalBar empty={render.stones.length === 0} />}
            <BoardCanvas render={render} onTap={onTap} onLongPress={markBlocked} />
          </div>
          {notice && (
            <p className="board-notice" role="status">
              {notice}
            </p>
          )}
        </div>
        <MoveTransport />
      </div>

      <aside className="boardscreen__side" aria-label="엔진 상태와 국면">
        {/* 물음은 맨 위 — 답하기 전까지 판이 잠기므로 가장 먼저 보여야 한다.
            대국 **설정**은 설정 탭으로 갔지만 물음은 판을 잠그는 것이라 여기 남는다. */}
        <PromptPanel />
        <AnalysisPanel />

        <section className="panel">
          <h2 className="panel__title">국면</h2>
          {result && (
            <p className="gameover" data-winner={result.winner ?? "draw"}>
              {describeResult(result)}
            </p>
          )}
          <dl className="kv">
            <dt>규칙</dt>
            <dd className="tnum">
              {RULE_LABEL.renju} · {OPENING_LABEL[opening]}
            </dd>
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
          <OpeningProgress />
          {/* 대국을 끝내는 두 버튼 — 결과가 적히는 이 카드에 둔다. 새 판은 보드 위 퀵 바. */}
          <div className="panel__actions">
            <button type="button" onClick={resign} disabled={!playing}>
              기권
            </button>
            <button type="button" onClick={offerDraw} disabled={!playing}>
              무승부
            </button>
          </div>
          <p className="panel__hint">
            길게 누르면 그 점을 차단 표시합니다 — 데스크톱의 Ctrl+클릭 자리입니다. 휠이나 두
            손가락으로 확대할 수 있고, ← → Home End 로 수를 옮깁니다.
          </p>
        </section>
      </aside>
    </div>
  );
}
