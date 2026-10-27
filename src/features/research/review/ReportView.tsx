import { useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { BoardCanvas } from "../../../core/board/BoardCanvas";
import { emptyRender, type BoardRender } from "../../../core/board/board-renderer";
import { sameMove } from "../../../core/model/move";
import {
  GRADED,
  QUALITY_INFO,
  coord,
  qualityName,
  winRateAt,
  winRateCell,
  type GradedMove,
  type MoveQuality,
} from "../../../core/review/move-quality";
import { budgetLabel, dateStamp, fixed, type GameReport } from "../../../core/review/report";
import { useBoardStore } from "../../board/boardStore";
import { exportCsv, exportHtml, exportMarkdown } from "./exports";
import { pick, t } from "../../../i18n/i18n";

/**
 * 리포트 한 건 — 앱 `ReviewScreen` 의 리포트 부분 + 데스크톱 HTML 리포트의 짜임.
 *
 * 위에서부터 «정확도 → 판 + 형세 그래프 → 등급 집계 · 최악의 수 → 수순 표». 표 · 그래프 ·
 * 최악의 수 어디를 눌러도 같은 커서가 움직이고, 판은 그 수를 둔 직후를 보여 준다 —
 * 둔 수(마지막 수 링)와 엔진이 바랐던 수(최선수 링)를 함께. ← → 키로 한 수씩.
 */

function QualityTag({ q }: { q: MoveQuality }) {
  if (q === "none") return null;
  const info = QUALITY_INFO[q];
  return (
    <span className="qtag" style={{ "--q": info.color } as CSSProperties} title={info.label}>
      <span className="qtag__sym">{info.symbol}</span> {qualityName(q)}
    </span>
  );
}

/** 그래프에 점으로 찍는 등급 — 눈여겨볼 것만(데스크톱 그래프와 같은 고르기). */
const NOTABLE: ReadonlySet<MoveQuality> = new Set([
  "brilliant",
  "great",
  "inaccuracy",
  "mistake",
  "blunder",
  "missedWin",
]);

function WinRateGraph({
  report,
  cursor,
  onPick,
}: {
  report: GameReport;
  cursor: number;
  onPick: (ply: number) => void;
}) {
  const n = Math.max(1, report.moves.length);
  const W = 600;
  const H = 140;
  const PAD = 6;
  const x = (i: number) => PAD + ((W - 2 * PAD) * i) / n;
  const y = (wr: number) => PAD + (H - 2 * PAD) * (1 - wr);
  const pts = Array.from(
    { length: n + 1 },
    (_, i) => [x(i), y(winRateAt(report.data, i, n))] as const,
  );
  const path = pts
    .map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`)
    .join("");
  const area = `${path}L${x(n).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;
  return (
    <svg
      className="wrgraph"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t("흑 승률 그래프")}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const rel = (e.clientX - box.left) / box.width;
        onPick(Math.round(Math.min(1, Math.max(0, (rel * W - PAD) / (W - 2 * PAD))) * n));
      }}
    >
      <rect className="wrgraph__white" x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} />
      <path className="wrgraph__black" d={area} />
      <line className="wrgraph__mid" x1={PAD} x2={W - PAD} y1={y(0.5)} y2={y(0.5)} />
      <line className="wrgraph__cursor" x1={x(cursor)} x2={x(cursor)} y1={PAD} y2={H - PAD} />
      {report.moves
        .filter((m) => NOTABLE.has(m.quality))
        .map((m) => (
          <circle
            key={m.index}
            cx={x(m.index)}
            cy={y(m.blackWinRate)}
            r={4.5}
            fill={QUALITY_INFO[m.quality].color}
            stroke="var(--c-surface)"
            strokeWidth={1.5}
          >
            <title>{`#${m.index} ${coord(m.move, report.size)} ${qualityName(m.quality)}`}</title>
          </circle>
        ))}
    </svg>
  );
}

export function ReportView({
  report,
  log,
  onOpenOnBoard,
  onDelete,
}: {
  report: GameReport;
  /** 국면마다 엔진 로그 한 줄(예전 리포트에는 없다). */
  log: readonly string[];
  onOpenOnBoard: (ply: number) => void;
  onDelete: () => void;
}) {
  const n = report.moves.length;
  const [cursor, setCursor] = useState(n);
  // 다른 리포트를 고르면 끝 수부터.
  const [cursorFor, setCursorFor] = useState({ data: report.data, n });
  if (cursorFor.data !== report.data || cursorFor.n !== n) {
    setCursorFor({ data: report.data, n });
    setCursor(n);
  }
  const palette = useBoardStore((s) => s.render.palette);

  const current: GradedMove | undefined = report.moves[cursor - 1];
  const view: BoardRender = useMemo(() => {
    const stones = report.data.moves.slice(0, cursor);
    const best = current?.best ?? null;
    return {
      ...emptyRender(report.size),
      palette,
      stones,
      lastMove: stones.at(-1) ?? null,
      // 엔진이 바랐던 수 — 둔 수와 같으면 링을 겹쳐 그리지 않는다.
      bestMark: best && current && !sameMove(best, current.move) ? best : null,
    };
  }, [report, cursor, current, palette]);

  const step = (d: number) => setCursor((c) => Math.min(n, Math.max(0, c + d)));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "Home") setCursor(0);
    else if (e.key === "End") setCursor(n);
    else return;
    e.preventDefault();
  };

  const acc = (v: number | null) => (v === null ? t("없음") : `${fixed(v, 1)}%`);
  /** 수가 없는 칸은 비워 둔다(«-» 자리표 대신). */
  const at = (m: GradedMove["best"] | undefined) => (m ? coord(m, report.size) : "");
  const side = (black: boolean | undefined) => (black ? t("흑") : t("백"));
  const counted = GRADED.filter((q) => {
    const [b, w] = report.tally.counts.get(q) ?? [0, 0];
    return b + w > 0;
  });

  return (
    <div
      className="report"
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={t("리뷰 리포트: ← → 키로 한 수씩")}
    >
      <header className="report__head">
        <div>
          <h3 className="report__title">{report.title}</h3>
          <p className="report__meta">
            {dateStamp(report.createdAt)} · {t("{n}수", { n })} ·{" "}
            {t("수당 {b}", { b: budgetLabel(report.budget) })}
            {report.skipOpening ? ` · ${t("첫 5수 제외")}` : ""}
          </p>
        </div>
        <div className="report__acc">
          <div className="acc acc--black">
            <span className="acc__label">{t("흑 정확도")}</span>
            <span className="acc__value tnum" data-k="acc-black">
              {acc(report.tally.blackAccuracy)}
            </span>
          </div>
          <div className="acc acc--white">
            <span className="acc__label">{t("백 정확도")}</span>
            <span className="acc__value tnum" data-k="acc-white">
              {acc(report.tally.whiteAccuracy)}
            </span>
          </div>
        </div>
      </header>

      <div className="report__board">
        <BoardCanvas render={view} onTap={() => {}} zoomable={false} />
      </div>
      <div className="report__cursor">
        <button type="button" className="btn" onClick={() => setCursor(0)} disabled={cursor === 0}>
          {t("처음")}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => step(-1)}
          disabled={cursor === 0}
          aria-label={t("한 수 뒤로")}
        >
          ‹
        </button>
        <span className="report__cursorText tnum" data-k="report-cursor">
          {cursor === 0
            ? t("시작 국면")
            : `#${cursor} ${at(current?.move)} (${side(current?.black)})`}
          {current && <QualityTag q={current.quality} />}
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => step(1)}
          disabled={cursor === n}
          aria-label={t("한 수 앞으로")}
        >
          ›
        </button>
        <button type="button" className="btn" onClick={() => setCursor(n)} disabled={cursor === n}>
          {t("끝")}
        </button>
      </div>
      {current && (
        <p className="report__comment">
          {current.comment}
          {current.best && !sameMove(current.best, current.move) && (
            <span className="report__best">
              {" "}
              {t("엔진 최선: {best}", { best: at(current.best) })}
            </span>
          )}
        </p>
      )}

      <WinRateGraph report={report} cursor={cursor} onPick={setCursor} />

      <div className="report__cols">
        <section>
          <h4 className="report__sub">{t("등급")}</h4>
          {counted.length === 0 ? (
            <p className="panel__hint">{t("등급 매긴 수가 없습니다.")}</p>
          ) : (
            <table className="rtable">
              <thead>
                <tr>
                  <th>{t("등급")}</th>
                  <th>{t("흑")}</th>
                  <th>{t("백")}</th>
                </tr>
              </thead>
              <tbody>
                {counted.map((q) => {
                  const [b, w] = report.tally.counts.get(q) ?? [0, 0];
                  return (
                    <tr key={q}>
                      <td>
                        <QualityTag q={q} />
                      </td>
                      <td className="tnum">{b}</td>
                      <td className="tnum">{w}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <section>
          <h4 className="report__sub">{t("최악의 수")}</h4>
          {report.worst.length === 0 ? (
            <p className="panel__hint">{t("없음. 깔끔한 대국입니다.")}</p>
          ) : (
            <ul className="worst">
              {report.worst.map((m) => (
                <li key={m.index}>
                  <button type="button" className="worst__row" onClick={() => setCursor(m.index)}>
                    <span className="tnum">
                      #{m.index} {at(m.move)} ({side(m.black)})
                    </span>
                    <QualityTag q={m.quality} />
                    <span className="tnum">−{fixed(m.delta * 100, 1)}%p</span>
                    <span className="worst__best">{t("최선 {best}", { best: at(m.best) })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <h4 className="report__sub">{t("수순")}</h4>
      <div className="rtable__wrap">
        <table className="rtable rtable--moves">
          <thead>
            <tr>
              <th>#</th>
              <th>{pick("수", "Move")}</th>
              <th>{t("등급")}</th>
              <th>ΔWR</th>
              <th>{t("흑 승률")}</th>
              <th>{t("최선")}</th>
              <th className="rtable__cmt">{t("코멘트")}</th>
            </tr>
          </thead>
          <tbody>
            {report.moves.map((m) => (
              <tr
                key={m.index}
                className={m.index === cursor ? "is-active" : undefined}
                onClick={() => setCursor(m.index)}
              >
                <td className="tnum">{m.index}</td>
                <td className="tnum">
                  {at(m.move)}
                  <span className="rtable__side">{side(m.black)}</span>
                </td>
                <td>
                  <QualityTag q={m.quality} />
                </td>
                <td className="tnum">
                  {m.quality === "none" || m.quality === "forced"
                    ? ""
                    : `−${fixed(m.delta * 100, 1)}`}
                </td>
                <td className="tnum">{winRateCell(m)}</td>
                <td className="tnum">{at(m.best)}</td>
                <td className="rtable__cmt">{m.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {log.length > 0 && (
        <details className="review__log">
          <summary>{t("엔진 로그 ({n}국면)", { n: log.length })}</summary>
          <pre data-k="report-engine-log">{log.join("\n")}</pre>
        </details>
      )}

      <div className="panel__actions">
        <button type="button" className="button--tonal" onClick={() => onOpenOnBoard(cursor)}>
          {t("이 국면을 보드로")}
        </button>
        <Link className="btn" to="/board">
          {t("보드에서 보기")}
        </Link>
        <button type="button" onClick={() => exportCsv(report)}>
          CSV
        </button>
        <button type="button" onClick={() => exportMarkdown(report)}>
          Markdown
        </button>
        <button type="button" onClick={() => void exportHtml(report, log.join("\n"))}>
          {t("HTML 리포트")}
        </button>
        <button type="button" className="btn--danger" onClick={onDelete}>
          {t("리포트 지우기")}
        </button>
      </div>
    </div>
  );
}
