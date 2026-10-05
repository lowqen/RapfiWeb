import { useMemo, useState, type KeyboardEvent } from "react";
import { moveKey, label, type Move } from "../../core/model/move";
import type { EvalView } from "../../engine/eval-view";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { useEvalHistory } from "./currentAnalysis";

/**
 * 형세 그래프 — 기보의 수마다 흑의 승률(0~100%).
 *
 * 한 계열이라 범례가 없다(제목이 말한다). 50% 선은 머리카락 굵기의 기준선이고, 위로
 * 가면 흑, 아래로 가면 백이 앞선다 — 평가 바와 같은 방향이다. 엔진이 읽지 않은 수는
 * **비워 둔다**(선을 끊는다) — 앞뒤 값을 이어 그으면 읽지 않은 국면을 지어내는 셈이다.
 *
 * 가로축은 지금 판 + 앞으로 갈 수(무른 수)까지, 곧 기보 한 줄이다. 포인터를 대면 가장
 * 가까운 수로 붙는 세로선과 값이 뜨고, 누르면(또는 ← → 뒤 Enter) 그 국면으로 간다.
 * 생각 중이거나 물음이 떠 있으면 옮기지 않는다 — 이동 바와 같은 규칙이다.
 */

const W = 320;
const H = 120;
const PAD = { top: 8, right: 8, bottom: 18, left: 30 };
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

  const known = points.filter(Boolean).length;
  const x = (i: number) => PAD.left + (n === 0 ? PW / 2 : (i / n) * PW);
  const y = (pct: number) => PAD.top + (1 - pct / 100) * PH;

  // 끊긴 구간마다 따로 긋는다.
  const segments: { i: number; pct: number }[][] = [];
  let run: { i: number; pct: number }[] = [];
  points.forEach((p, i) => {
    if (p) run.push({ i, pct: p.blackPct });
    else if (run.length) {
      segments.push(run);
      run = [];
    }
  });
  if (run.length) segments.push(run);

  const path = (seg: { i: number; pct: number }[]) =>
    seg.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.pct).toFixed(1)}`).join("");
  const area = (seg: { i: number; pct: number }[]) =>
    `${path(seg)}L${x(seg.at(-1)!.i).toFixed(1)},${y(50)}L${x(seg[0]!.i).toFixed(1)},${y(50)}Z`;

  const plyAt = (e: { clientX: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    return n === 0 ? 0 : Math.min(n, Math.max(0, Math.round(((px - PAD.left) / PW) * n)));
  };

  const shown = hover ?? current;
  const shownPoint = points[shown] ?? null;
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

  return (
    <section className="panel evalgraph" aria-labelledby="evalgraph-title">
      <h2 id="evalgraph-title" className="panel__title">
        형세 그래프
        <span className="panel__status tnum">
          {known}/{n + 1} 국면
        </span>
      </h2>
      <p className="evalgraph__readout tnum" aria-live="polite">
        <strong>{shownPoint ? describe(shownPoint) : "—"}</strong>
        <span>{plyLabel(shown, line, size)}</span>
      </p>
      <svg
        className="evalgraph__plot"
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label="형세 그래프 — 수를 고르면 그 국면으로 갑니다"
        aria-valuemin={0}
        aria-valuemax={n}
        aria-valuenow={shown}
        aria-valuetext={`${plyLabel(shown, line, size)} · ${shownPoint ? describe(shownPoint) : "평가 없음"}`}
        data-locked={locked || undefined}
        onPointerMove={(e) => setHover(plyAt(e))}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onClick={(e) => go(plyAt(e))}
        onKeyDown={onKey}
      >
        {/* 축과 기준선 — 머리카락 굵기, 물러선 색 */}
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
              {v === 100 ? "흑" : v === 0 ? "백" : "50"}
            </text>
          </g>
        ))}
        <text className="evalgraph__tick" x={PAD.left} y={H - 4}>
          0
        </text>
        <text className="evalgraph__tick" x={W - PAD.right} y={H - 4} textAnchor="end">
          {n}수
        </text>

        {segments.map((seg) => (
          <g key={seg[0]!.i}>
            <path className="evalgraph__area" d={area(seg)} />
            {seg.length > 1 && <path className="evalgraph__line" d={path(seg)} />}
          </g>
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
      {known === 0 && (
        <p className="panel__hint">
          분석한 국면의 흑 승률이 수마다 쌓입니다. 무르거나 앞으로 가면 그래프도 기보를 따라갑니다.
        </p>
      )}
    </section>
  );
}

function describe(v: EvalView): string {
  if (v.mate) return `${v.mate.winner === "black" ? "흑" : "백"} ${v.mate.plies}수 외통`;
  return `흑 ${Math.round(v.blackPct)}%`;
}

function plyLabel(ply: number, line: readonly Move[], size: number): string {
  if (ply === 0) return "빈 판";
  const m = line[ply - 1];
  return m ? `${ply}수 ${label(m, size)}` : `${ply}수`;
}
