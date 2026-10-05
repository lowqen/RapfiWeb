import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { OpeningProgress } from "./OpeningPanel";
import { label } from "../../core/model/move";
import { RULE_LABEL } from "../../core/model/rules";
import { OPENING_LABEL, describeResult } from "../../core/model/game";

/**
 * 국면 카드 — 두 탭이 함께 쓴다. 대국을 끝내는 두 버튼(기권 · 무승부)과 개시 진행은
 * **대국 탭에만** 있다 — 분석 탭에서 판을 늘어놓다가 기권이 눌리면 안 된다.
 *
 * 스모크가 `dd[data-k=turn]`·`dd[data-k=last]` 를 이름으로 집는다(순서가 아니라).
 */
export function PositionCard({ game }: { game: boolean }) {
  const render = useBoardStore((s) => s.render);
  const ahead = useBoardStore((s) => s.future.length);
  const result = useGameStore((s) => s.result);
  const opening = useGameStore((s) => s.opening);
  const resign = useGameStore((s) => s.resign);
  const offerDraw = useGameStore((s) => s.offerDraw);
  const playing = !result && render.stones.length > 0;
  const last = render.lastMove;
  const turn = render.stones.length % 2 === 0 ? "흑" : "백";

  return (
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
        <dd className="tnum" data-k="last">
          {last ? label(last, render.size) : "—"}
        </dd>
      </dl>
      {game && (
        <>
          <OpeningProgress />
          <div className="panel__actions">
            <button type="button" onClick={resign} disabled={!playing}>
              기권
            </button>
            <button type="button" onClick={offerDraw} disabled={!playing}>
              무승부
            </button>
          </div>
        </>
      )}
    </section>
  );
}
