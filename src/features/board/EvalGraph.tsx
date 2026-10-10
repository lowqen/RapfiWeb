import { useMemo, useState, type KeyboardEvent } from "react";
import { moveKey, label, type Move } from "../../core/model/move";
import type { EvalView } from "../../engine/eval-view";
import { useBoardStore } from "./boardStore";
import { t } from "../../i18n/i18n";
import { useGameStore } from "./gameStore";
import { useEvalHistory } from "./currentAnalysis";
import { buildSeries, evalAtOrBefore, showMarkers, type SeriesPoint } from "./evalSeries";

/**
 * 형세 그래프 — 기보의 수마다 흑의 승률(0~100%).
 *
 * 한 계열이라 범례가 없다(제목이 말한다). 50% 선은 머리카락 굵기의 기준선이고, 위로
 * 가면 흑, 아래로 가면 백이 앞선다 — 평가 바와 같은 방향이다.
 *
 * 엔진이 읽은 국면끼리 **이어 긋는다**(`buildSeries`) — 대국에서는 엔진 차례의 국면만
 * 평가가 있어 한 수 걸러 점이 선다. 점이 드물면 점 표시를 함께 그려 실제로 읽은 국면을 가른다.
 * 축과 기준선은 데이터가 없어도(빈 판 · 아직 분석 전) 늘 그린다.
 *
 * 크기는 `viewBox` 가 진다 — 컨테이너 폭을 재지 않으므로 탭을 오가며 다시 붙어도 0 폭으로
 * 그려질 일이 없다. 가로축은 지금 판 + 앞으로 갈 수(무른 수)까지, 곧 기보 한 줄이다.
 * 포인터를 대면 가장 가까운 수로 붙는 세로선과 값이 뜨고, 누르면(또는 ← → 뒤 Enter) 그
 * 국면으로 간다. 생각 중이거나 물음이 떠 있으면 옮기지 않는다 — 이동 바와 같은 규칙이다.
 */

const W = 320;
const H = 120;
const PAD = { top: 8, right: 10, bottom: 18, left: 30 };
const PW = W - PAD.left - PAD.right;
const PH = H - PAD.top - PAD.bottom;

export function EvalGraph() {
  const stones = useBoardStore((s) => s.render.stones);
  const future = useBoardStore((s) => s.future);
  const size = useBoardStore((s) => s.render.size);
  const version = useEvalHistory((s) => s.version);
  const gotoPly = useGameStore((s) => s.gotoPly);
  const locked = useGameStore((s) => s.thinking || s.prompt !== null);
  const [hover, setHover] = useState<number | null>(null);

  const line = useMemo(() => [...stones, ...future], [stones, future]);
  const current = stones.length;
  const n = line.length; // 국면은 0..n (n+1 개)

  // 국면 i(첫 i 수)의 평가. 키를 한 수씩 늘려 가며 맵에서 찾는다.
  const points = useMemo(() => {
    void version; // 기록이 늘면 다시 센다(맵은 제자리에서 바뀐다)
    const byKey = useEvalHistory.getState().byKey;
    const out: (EvalView | null)[] = [];
    let key = "";
    for (let i = 0; i <= n; i++) {
      if (i > 0)
        key = i === 1 ? String(moveKey(line[0]!, size)) : `${key},${moveKey(line[i - 1]!, size)}`;
      out.push(byKey.get(key) ?? null);
    }
    return out;
  }, [line, n, size, version]);

  const series = useMemo(() => buildSeries(points), [points]);
  const x = (i: number) => PAD.left + (n === 0 ? 0 : (i / n) * PW);
  const y = (pct: number) => PAD.top + (1 - pct / 100) * PH;

  const path = (pts: readonly SeriesPoint[]) =>
    pts.map((p, k) => `${k ? "L" : "M"}${x(p.ply).toFixed(1)},${y(p.pct).toFixed(1)}`).join("");
  const area = (pts: readonly SeriesPoint[]) =>
    `${path(pts)}L${x(pts.at(-1)!.ply).toFixed(1)},${y(50)}L${x(pts[0]!.ply).toFixed(1)},${y(50)}Z`;

  const plyAt = (e: { clientX: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    return n === 0 ? 0 : Math.min(n, Math.max(0, Math.round(((px - PAD.left) / PW) * n)));
  };

  const shown = hover ?? current;
  // 읽지 않은 국면이면 그 앞의 가장 가까운 평가를 보여 준다(「몇 수째의 값」인지 함께).
  const shownEval = evalAtOrBefore(points, shown);
  const go = (ply: number) => {
    if (!locked) gotoPly(ply);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const at = hover ?? current;
    if (e.key === "ArrowLeft") setHover(Math.max(0, at - 1));
    else if (e.key === "ArrowRight") setHover(Math.min(n, at + 1));
    else if (e.key === "Enter" || e.key === " ") go(at);
    else return;
    // 이동 바의 ← → 단축키(창 전체)와 겹치지 않게 여기서 멈춘다.
    e.preventDefault();
    e.stopPropagation();
  };

  const readout = shownEval
    ? `${describe(shownEval.view)}${shownEval.ply === shown ? "" : ` (${t("{n}수째", { n: shownEval.ply })})`}`
    : t("평가 없음");
  const markers = showMarkers(series);

  return (
    <section className="panel evalgraph" aria-labelledby="evalgraph-title">
      <h2 id="evalgraph-title" className="panel__title">
        {t("형세 그래프")}
        <span className="panel__status tnum">{plyLabel(shown, line, size)}</span>
      </h2>
      <p className="evalgraph__readout tnum" aria-live="polite">
        <strong>{readout}</strong>
      </p>
      <svg
        className="evalgraph__plot"
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label={t("형세 그래프. 수를 고르면 그 국면으로 갑니다")}
        aria-valuemin={0}
        aria-valuemax={n}
        aria-valuenow={shown}
        aria-valuetext={`${plyLabel(shown, line, size)} · ${readout}`}
        data-points={series.length}
        data-locked={locked || undefined}
        onPointerMove={(e) => setHover(plyAt(e))}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onClick={(e) => go(plyAt(e))}
        onKeyDown={onKey}
      >
        {/* 축과 기준선 — 데이터가 없어도 늘. 머리카락 굵기, 물러선 색. */}
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line
              className={v === 50 ? "evalgraph__mid" : "evalgraph__grid"}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
            />
            <text className="evalgraph__tick" x={PAD.left - 6} y={y(v) + 3} textAnchor="end">
              {v === 100 ? t("흑") : v === 0 ? t("백") : "50"}
            </text>
          </g>
        ))}
        <text className="evalgraph__tick" x={PAD.left} y={H - 4}>
          0
        </text>
        {n > 0 && (
          <text className="evalgraph__tick" x={W - PAD.right} y={H - 4} textAnchor="end">
            {t("{n}수", { n })}
          </text>
        )}

        {series.length > 0 && <path className="evalgraph__area" d={area(series)} />}
        {series.length > 1 && <path className="evalgraph__line" d={path(series)} />}
        {markers &&
          series.map((p) => (
            <circle
              key={p.ply}
              className="evalgraph__dot evalgraph__dot--point"
              cx={x(p.ply)}
              cy={y(p.pct)}
              r={4}
            />
          ))}

        {/* 지금 국면 — 판에 놓인 수까지. */}
        <line
          className="evalgraph__now"
          x1={x(current)}
          x2={x(current)}
          y1={PAD.top}
          y2={PAD.top + PH}
        />
        {points[current] && (
          <circle
            className="evalgraph__dot"
            cx={x(current)}
            cy={y(points[current]!.blackPct)}
            r={4}
          />
        )}
        {hover !== null && hover !== current && (
          <>
            <line
              className="evalgraph__cross"
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + PH}
            />
            {points[hover] && (
              <circle
                className="evalgraph__dot evalgraph__dot--hover"
                cx={x(hover)}
                cy={y(points[hover]!.blackPct)}
                r={4}
              />
            )}
          </>
        )}
      </svg>
      {series.length === 0 && <p className="panel__hint">{t("분석하면 수마다 쌓입니다")}</p>}
    </section>
  );
}

function describe(v: EvalView): string {
  if (v.mate)
    return v.mate.winner === "black"
      ? t("흑 {n}수 외통", { n: v.mate.plies })
      : t("백 {n}수 외통", { n: v.mate.plies });
  return t("흑 {b}%", { b: Math.round(v.blackPct) });
}

function plyLabel(ply: number, line: readonly Move[], size: number): string {
  if (ply === 0) return t("빈 판");
  const m = line[ply - 1];
  return m ? `${t("{n}수째", { n: ply })} ${label(m, size)}` : t("{n}수째", { n: ply });
}
