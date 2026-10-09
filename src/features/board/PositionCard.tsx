import { useRef, type CSSProperties } from "react";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { useBoardNotice } from "./boardNotice";
import { useBoardDb } from "./boardDb";
import { openGameFile, saveGameFile } from "./gameFileActions";
import { GAME_FILE_ACCEPT } from "../../core/model/game-file";
import { copyPositionLink } from "./positionLink";
import { useOpeningTables } from "../../data/opening-tables";
import { chain, gradeAt } from "../../core/opening/opening-name";
import { GradeBadge } from "../../components/GradeBadge";
import { useCurrentReview } from "../../data/current-review";
import { QUALITY_INFO, currentBadge, matchesPrefix } from "../../core/review/move-quality";
import { OpeningProgress } from "./OpeningPanel";
import { label } from "../../core/model/move";
import { RULE_LABEL } from "../../core/model/rules";
import { OPENING_LABEL, describeResult } from "../../core/model/game";
import { dbValueText } from "../database/dbTags";

/**
 * 지금 국면을 말하는 값들 — 국면 카드와 국면 요약 줄이 같은 계산을 쓴다.
 *
 * 주형 이름(1~4수)과 흑 5수 유불리(4·5수)는 연구 ▸ 오프닝과 같은 계산이고, 「평가」는 고른
 * 리뷰가 이 판의 수순일 때 마지막 수의 등급이다(데스크톱처럼 지금 수 하나만).
 */
function usePosition() {
  const render = useBoardStore((s) => s.render);
  const ahead = useBoardStore((s) => s.future.length);
  const result = useGameStore((s) => s.result);
  const tables = useOpeningTables((s) => s.tables);
  const review = useCurrentReview();
  const names = chain(render.stones, tables, render.size);
  const grade = gradeAt(render.stones, tables, render.size);
  const badge =
    review.data && matchesPrefix(review.data, render.stones)
      ? currentBadge(
          render.stones,
          render.size,
          review.data.records,
          review.preset,
          review.skipOpening,
        )
      : null;
  return {
    render,
    ahead,
    result,
    names,
    grade,
    badge,
    count: render.stones.length,
    last: render.lastMove ? label(render.lastMove, render.size) : null,
    turn: render.stones.length % 2 === 0 ? "흑" : "백",
  };
}

/**
 * 국면 카드 — 두 탭이 함께 쓴다. 대국을 끝내는 두 버튼(기권 · 무승부)과 개시 진행은
 * **대국 탭에만** 있다 — 분석 탭에서 판을 늘어놓다가 기권이 눌리면 안 된다.
 *
 * **자리.** 넓은 화면에서는 옆 칸 **맨 위**다 — 주형 이름 · 수 · 평가 · 링크는 판을 보며 늘 읽는
 * 값인데, 예전에는 대국/엔진 카드 · 형세 그래프 밑에 있어 스크롤해야 보였다. 좁은 화면(휴대폰
 * 세로 · 낮은 가로)에서는 옆 칸이 짧아 이 카드가 위에 오면 「지금 두기」가 밀려나므로, 카드는
 * 대국/엔진 카드 뒤로 물러서고(`order`, base.css) 대신 `PositionStrip` 한 줄이 옆 칸 맨 위 —
 * 휴대폰 세로에서는 판 바로 밑 — 에 붙는다.
 *
 * 기보 열기 · 저장은 두 탭 모두에 있다(판은 함께 쓴다). 열기는 보드에 파일을 끌어다
 * 놓아도 된다(`BoardScreen`). 저장은 지금 판까지 — 무른 수는 넣지 않는다(데스크톱과 같다).
 * 「링크 복사」는 지금 판을 `?p=…` 주소로 — 받은 사람이 열면 그 국면이 뜬다.
 *
 * DB(W8)가 붙어 있으면 이 국면의 주석을, 분석 탭에서는 DB 의 국면 값도 보인다(`useBoardDb`).
 *
 * 스모크가 `dd[data-k=turn]`·`dd[data-k=last]` 를 이름으로 집는다(순서가 아니라). 요약 줄은
 * 같은 값을 `data-k` 없이 그린다 — 이름이 겹치면 이름으로 찾는 시험이 둘을 함께 집는다.
 */
export function PositionCard({ game }: { game: boolean }) {
  const p = usePosition();
  const opening = useGameStore((s) => s.opening);
  const resign = useGameStore((s) => s.resign);
  const offerDraw = useGameStore((s) => s.offerDraw);
  const gameName = useGameStore((s) => s.gameName);
  const showNotice = useBoardNotice((s) => s.show);
  const db = useBoardDb();
  const fileInput = useRef<HTMLInputElement>(null);
  const playing = !p.result && p.count > 0;

  return (
    <section className="panel panel--position" aria-labelledby="position-card-title">
      <div className="poscard__head">
        <h2 id="position-card-title" className="panel__title">
          국면
        </h2>
        <span className="poscard__rule" data-k="ruleset">
          {RULE_LABEL.renju} · {OPENING_LABEL[opening]}
        </span>
      </div>
      {p.result && (
        <p className="gameover" data-winner={p.result.winner ?? "draw"}>
          {describeResult(p.result)}
        </p>
      )}
      {/* 늘 읽는 셋 — 차례 · 수 · 마지막 — 은 한 줄 타일로. */}
      <dl className="poscard__tiles">
        <div className="poscard__tile">
          <dt>둘 차례</dt>
          <dd className="tnum" data-k="turn" data-side={p.turn === "흑" ? "black" : "white"}>
            {p.turn}
          </dd>
        </div>
        <div className="poscard__tile">
          <dt>수</dt>
          <dd className="tnum">
            {p.count}
            {p.ahead > 0 && <span className="kv__aside"> / {p.count + p.ahead}</span>}
          </dd>
        </div>
        <div className="poscard__tile">
          <dt>마지막</dt>
          <dd className="tnum" data-k="last">
            {p.last ?? "—"}
          </dd>
        </div>
      </dl>
      {(p.names.length > 0 || p.badge || gameName || db) && (
        <dl className="kv poscard__rows">
          {p.names.length > 0 && (
            <>
              <dt>주형</dt>
              <dd data-k="opening-name">
                {p.names.join(" › ")}
                {p.grade && (
                  <>
                    {" "}
                    <GradeBadge grade={p.grade} compact />
                  </>
                )}
              </dd>
            </>
          )}
          {p.badge && (
            <>
              <dt>평가</dt>
              <dd data-k="move-grade">
                <span
                  className="qtag"
                  style={{ "--q": QUALITY_INFO[p.badge].color } as CSSProperties}
                  title="연구 ▸ 리뷰에서 고른 리포트의 등급"
                >
                  <span className="qtag__sym">{QUALITY_INFO[p.badge].symbol}</span>{" "}
                  {QUALITY_INFO[p.badge].korean}
                </span>
              </dd>
            </>
          )}
          {/* DB 값은 분석 탭에만 — 대국 중의 훈수가 되지 않게(판 위 DB 칩과 같은 규칙). */}
          {db && !game && (
            <>
              <dt>DB</dt>
              <dd
                className="tnum"
                data-k="db-value"
                title="데이터베이스의 자식 값으로 읽은 국면 값"
              >
                {db.value ? `${dbValueText(db.value)} (${p.turn})` : "값 없음"}
                <span className="kv__aside"> · 기록 {db.snap.cells.size}</span>
              </dd>
            </>
          )}
          {db && db.snap.comment && (
            <>
              <dt>주석</dt>
              <dd className="poscard__comment" data-k="db-comment">
                {db.snap.comment}
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
      )}
      <div className="panel__actions panel__actions--compact">
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
          disabled={p.count === 0}
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

/**
 * 국면 요약 한 줄 — 좁은 화면에서만 보인다(base.css `.possum`). 옆 칸 맨 위에 붙어(스크롤해도
 * 남는다) 휴대폰 세로에서는 판과 이동 바 바로 밑이 된다. 차례 · 수 · 마지막 수 · 주형 이름 ·
 * 유불리 · 결과를 넣고, 넘치면 주형 이름이 말줄임으로 줄어든다.
 */
export function PositionStrip({ game }: { game: boolean }) {
  const p = usePosition();
  const db = useBoardDb();
  return (
    <div className="possum" role="group" aria-label="국면 요약">
      <span className="possum__turn" data-side={p.turn === "흑" ? "black" : "white"}>
        <span className="possum__stone" aria-hidden="true" />
        {p.result ? describeResult(p.result) : `${p.turn} 차례`}
      </span>
      <span className="possum__item tnum">
        {p.count}수{p.last && ` · ${p.last}`}
      </span>
      {p.names.length > 0 && (
        <span className="possum__name" title={p.names.join(" › ")}>
          {p.names.at(-1)}
        </span>
      )}
      {p.grade && <GradeBadge grade={p.grade} compact />}
      {p.badge && (
        <span
          className="qtag"
          style={{ "--q": QUALITY_INFO[p.badge].color } as CSSProperties}
          title={QUALITY_INFO[p.badge].korean}
        >
          <span className="qtag__sym">{QUALITY_INFO[p.badge].symbol}</span>
        </span>
      )}
      {db?.value && !game && (
        <span className="possum__item tnum" title="데이터베이스의 국면 값(둘 차례)">
          DB {dbValueText(db.value)}
        </span>
      )}
    </div>
  );
}
