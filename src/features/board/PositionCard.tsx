import { useRef } from "react";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { useBoardNotice } from "./boardNotice";
import { GAME_FILE_ACCEPT, openGameFile, saveGameFile } from "./gameFileActions";
import { copyPositionLink } from "./positionLink";
import { useOpeningTables } from "../../data/opening-tables";
import { chain, gradeAt } from "../../core/opening/opening-name";
import { GradeBadge } from "../../components/GradeBadge";
import { OpeningProgress } from "./OpeningPanel";
import { label } from "../../core/model/move";
import { RULE_LABEL } from "../../core/model/rules";
import { OPENING_LABEL, describeResult } from "../../core/model/game";

/**
 * 국면 카드 — 두 탭이 함께 쓴다. 대국을 끝내는 두 버튼(기권 · 무승부)과 개시 진행은
 * **대국 탭에만** 있다 — 분석 탭에서 판을 늘어놓다가 기권이 눌리면 안 된다.
 *
 * 기보 열기 · 저장은 두 탭 모두에 있다(판은 함께 쓴다). 열기는 보드에 파일을 끌어다
 * 놓아도 된다(`BoardScreen`). 저장은 지금 판까지 — 무른 수는 넣지 않는다(데스크톱과 같다).
 * 「링크 복사」는 지금 판을 `?p=…` 주소로 — 받은 사람이 열면 그 국면이 뜬다.
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
  const gameName = useGameStore((s) => s.gameName);
  const showNotice = useBoardNotice((s) => s.show);
  const fileInput = useRef<HTMLInputElement>(null);
  const tables = useOpeningTables((s) => s.tables);
  // 주형 이름(1~4수)과 흑 5수 유불리(4·5수) — 연구 ▸ 오프닝과 같은 계산이다.
  const names = chain(render.stones, tables, render.size);
  const grade = gradeAt(render.stones, tables, render.size);
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
        {names.length > 0 && (
          <>
            <dt>주형</dt>
            <dd data-k="opening-name">
              {names.join(" › ")}
              {grade && (
                <>
                  {" "}
                  <GradeBadge grade={grade} compact />
                </>
              )}
            </dd>
          </>
        )}
        {gameName && (
          <>
            <dt>기보</dt>
            <dd data-k="game-name">{gameName}</dd>
          </>
        )}
      </dl>
      <div className="panel__actions">
        <button type="button" onClick={() => fileInput.current?.click()}>
          기보 열기
        </button>
        <button
          type="button"
          title="Piskvork 기보(.psq)로 저장"
          onClick={() => void saveGameFile("psq")}
        >
          .psq 저장
        </button>
        <button
          type="button"
          title="Yixin 저장 국면(.sav)으로 저장"
          onClick={() => void saveGameFile("sav")}
        >
          .sav 저장
        </button>
        <button
          type="button"
          title="지금 판을 여는 주소(?p=…)를 복사합니다"
          disabled={render.stones.length === 0}
          onClick={() => void copyPositionLink()}
        >
          링크 복사
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={GAME_FILE_ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = ""; // 같은 파일을 다시 골라도 onChange 가 오게
            if (file) void openGameFile(file).then((r) => showNotice(r.text));
          }}
        />
      </div>
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
