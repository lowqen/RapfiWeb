import { useEffect, useMemo } from "react";
import { Chip, ChipGroup } from "../../../components/controls";
import {
  TOO_BIG,
  actualNext,
  breadcrumb,
  headline,
  note,
  openingLabel,
  orientation,
} from "../../../core/moveorder/session";
import { cellName, formatCount } from "../../../core/moveorder/move-order";
import { useBoardStore } from "../../board/boardStore";
import { MoveOrderBoard, type CandidateRow } from "./MoveOrderBoard";
import { useSequenceStore } from "./sequenceStore";

/**
 * 연구 ▸ 수순 — **같은 돌에 이르는 다른 수순**(W6c). 앱 `MoveOrderSection` 의 이식.
 *
 * 수순은 `b! · w!` 로 폭발하므로 아무것도 늘어놓지 않는다: DAG 의 한 수씩, 갈래마다 그 뒤의
 * 완전한 수순 수를 달고 파고든다. 판은 보드의 지금 판(무른 수 제외)이고, 판이 바뀌면 다시 센다.
 * 「보드에 놓기」는 파고든 길을 아무 합법 수순으로 끝내 보드를 그 순서로 다시 놓는다.
 */
export function SequenceScreen() {
  const stones = useBoardStore((s) => s.render.stones);
  const s = useSequenceStore();

  // 판이 바뀌면 다시 센다(화면이 열릴 때도).
  useEffect(() => {
    void useSequenceStore.getState().rebuild();
  }, [stones]);

  const v = s.view;
  const rows: CandidateRow[] = useMemo(() => {
    if (!v) return [];
    const actual = actualNext(v, s.line, s.size);
    return v.children.map((c) => ({
      ...c,
      share: v.branch > 0 ? c.count / v.branch : 0,
      actual: c.cell === actual,
    }));
  }, [v, s.line, s.size]);

  const r = s.rules;
  const title =
    s.status === "empty"
      ? "보드에 돌을 먼저 놓으세요."
      : s.status === "tooBig"
        ? TOO_BIG
        : v
          ? headline(v)
          : "세는 중…";
  const why = v ? note(v, s.line, s.size, r) : "";
  const opening = openingLabel(v, s.line, s.size);
  const canBack = (v?.prefix.length ?? 0) > 0;
  const canApply = (v?.total ?? 0) > 0;

  return (
    <div className="sequence">
      <section className="panel">
        <h2 className="panel__title" data-k="sequence-headline">
          {title}
        </h2>
        {why && <p className="panel__hint">{why}</p>}
        {opening && <p className="panel__hint">{opening}</p>}
        {s.computing && (
          <div className="review__bar review__bar--busy" role="progressbar" aria-label="세는 중">
            <span />
          </div>
        )}
        <div className="sequence__rules">
          <ChipGroup label="수순 규칙">
            <Chip on={r.openingRule} onClick={() => s.setRules({ openingRule: !r.openingRule })}>
              오프닝 규칙
            </Chip>
            <Chip
              on={r.move2Fix}
              disabled={!r.openingRule}
              title="2수를 H9 / I9 로 — 오프닝 규칙의 하위 규칙"
              onClick={() => s.setRules({ move2Fix: !r.move2Fix })}
            >
              2수 H9/I9
            </Chip>
            <Chip on={r.noFive} onClick={() => s.setRules({ noFive: !r.noFive })}>
              중간 오목 금지
            </Chip>
            <Chip on={r.symmetry} onClick={() => s.setRules({ symmetry: !r.symmetry })}>
              환원(회전·반전)
            </Chip>
          </ChipGroup>
        </div>
        <p className="panel__hint">
          렌주 금수(3-3 · 4-4 · 장목)는 따지지 않습니다 — 데스크톱 · 앱과 같습니다.
        </p>
      </section>

      {v && (
        <section className="panel">
          <p className="sequence__crumb tnum" data-k="sequence-crumb">
            {breadcrumb(v, s.size)}
          </p>
          {orientation(v, r) && <p className="panel__hint">[{orientation(v, r)}]</p>}
          <div className="panel__actions">
            <button type="button" disabled={!canBack} onClick={() => void s.back()}>
              한 수 뒤로
            </button>
            <button type="button" disabled={!canBack} onClick={() => void s.root()}>
              처음으로
            </button>
            <button
              type="button"
              className="button--tonal"
              disabled={!canApply}
              onClick={() => void s.apply()}
            >
              보드에 놓기
            </button>
          </div>
          {s.applyPrompt && (
            <div className="sequence__prompt" role="alertdialog" aria-label="돌 위치가 바뀝니다">
              <p>{s.applyPrompt.text}</p>
              <div className="panel__actions">
                <button
                  type="button"
                  className="button--primary"
                  onClick={() => void s.apply(true)}
                >
                  놓기
                </button>
                <button type="button" onClick={s.dismissPrompt}>
                  취소
                </button>
              </div>
            </div>
          )}
          {s.notice && (
            <p className="panel__hint" role="status">
              {s.notice}{" "}
              <button type="button" className="linkish" onClick={s.clearNotice}>
                닫기
              </button>
            </p>
          )}
        </section>
      )}

      {v && (
        <div className="sequence__board">
          <MoveOrderBoard
            size={s.size}
            prefix={v.prefix}
            ghosts={v.ghosts}
            rows={rows}
            selected={s.selected}
            onTap={(cell) => {
              if (rows.some((x) => x.cell === cell)) void s.drill(cell);
            }}
          />
        </div>
      )}

      {rows.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">
            다음 수 후보 {rows.length}가지{" "}
            <span className="panel__status">누르면 그 갈래로 들어갑니다</span>
          </h2>
          <ul className="mocands" aria-label="다음 수 후보">
            {rows.map((row) => (
              <li key={row.cell}>
                <button
                  type="button"
                  className="mocands__row"
                  aria-pressed={s.selected === row.cell}
                  onMouseEnter={() => s.select(row.cell)}
                  onMouseLeave={() => s.select(null)}
                  onClick={() => void s.drill(row.cell)}
                >
                  <span
                    className={`mocands__stone mocands__stone--${row.color === 1 ? "black" : "white"}`}
                  />
                  <span className="mocands__label tnum">
                    {cellName(row.cell, s.size)}
                    {row.actual && <span className="mocands__actual"> ← 실제 대국</span>}
                  </span>
                  <span className="mocands__count tnum">
                    수순 {formatCount(row.count)}가지 · {Math.round(row.share * 100)}%
                  </span>
                  <span className="mocands__bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(row.share * 100)}%` }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
