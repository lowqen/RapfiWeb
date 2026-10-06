/**
 * 손으로 그린 SVG 차트 — 의존성을 늘리지 않으려고. 규칙(마크 · 색 · 호버)은 한곳에서:
 *   선 2px · 점 r≥4 + 표면색 고리 2px · 막대 ≤24px · 끝 4px 둥글게 · 격자 1px 실선 · 띠 10% 불투명
 *   글자는 글자 토큰(--ink-*)만 — 계열 색은 마크에만 · 2 계열 이상이면 범례
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { signed, ticks } from "./format";

// ── 공용 ────────────────────────────────────────────────────────────────

/** 부모 폭을 따라가는 SVG — 글자가 늘어나지 않게 viewBox 를 실제 픽셀로 맞춘다. */
function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setW(Math.max(240, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const scale = (d0: number, d1: number, r0: number, r1: number) => (v: number) =>
  r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

interface TipState {
  x: number;
  y: number;
  body: ReactNode;
}

function Tooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div className="tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.body}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className={`key${it.dashed ? " dashed" : ""}`} style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

// ── 궤적(선 + 신뢰 띠) ──────────────────────────────────────────────────

export interface TrajSeries {
  name: string;
  color: string;
  points: { games: number; elo: number; low: number; high: number; llr: number }[];
}

export function TrajectoryChart({
  series,
  height = 300,
}: {
  series: TrajSeries[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 44, r: 16, t: 14, b: 34 };
  const all = series.flatMap((s) => s.points);
  const maxG = Math.max(2, ...all.map((p) => p.games));
  const lo = Math.min(0, ...all.map((p) => p.low));
  const hi = Math.max(0, ...all.map((p) => p.high));
  const pad = (hi - lo) * 0.06;
  const yT = ticks(lo - pad, hi + pad, 5);
  const y0 = Math.min(lo - pad, yT[0] ?? lo);
  const y1 = Math.max(hi + pad, yT[yT.length - 1] ?? hi);
  const x = scale(0, maxG, m.l, width - m.r);
  const y = scale(y0, y1, height - m.b, m.t);
  const xT = ticks(0, maxG, width < 480 ? 3 : 6);

  const onMove = useCallback(
    (e: PointerEvent<SVGRectElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      const g = ((e.clientX - box.left) / box.width) * maxG;
      setHover(Math.max(0, Math.min(maxG, g)));
    },
    [maxG],
  );

  const near = (s: TrajSeries, g: number) =>
    s.points.reduce<TrajSeries["points"][number] | undefined>(
      (best, p) => (!best || Math.abs(p.games - g) < Math.abs(best.games - g) ? p : best),
      undefined,
    );

  const tip: TipState | null =
    hover == null
      ? null
      : {
          x: Math.min(x(hover) + 12, width - 190),
          y: m.t,
          body: (
            <>
              <strong>{Math.round(hover)}판 무렵</strong>
              {series.map((s) => {
                const p = near(s, hover);
                return p ? (
                  <div key={s.name} className="tip-row">
                    <span className="key" style={{ background: s.color }} />
                    {s.name} {signed(p.elo)} ({signed(p.low)} ~ {signed(p.high)}) · LLR{" "}
                    {p.llr.toFixed(2)}
                  </div>
                ) : null;
              })}
            </>
          ),
        };

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="판 수에 따른 Elo 추정과 95% 신뢰 구간"
      >
        {yT.map((t) => (
          <g key={t}>
            <line
              x1={m.l}
              x2={width - m.r}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? "axis0" : "grid"}
            />
            <text x={m.l - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {t > 0 ? `+${t}` : t}
            </text>
          </g>
        ))}
        {xT.map((t) => (
          <text key={t} x={x(t)} y={height - m.b + 18} className="tick" textAnchor="middle">
            {t.toLocaleString("en-US")}
          </text>
        ))}
        <text x={width - m.r} y={height - 4} className="tick" textAnchor="end">
          판
        </text>
        {series.map((s) => {
          const band =
            s.points.map((p, i) => `${i ? "L" : "M"}${x(p.games)},${y(p.high)}`).join("") +
            [...s.points]
              .reverse()
              .map((p) => `L${x(p.games)},${y(p.low)}`)
              .join("") +
            "Z";
          const line = s.points.map((p, i) => `${i ? "L" : "M"}${x(p.games)},${y(p.elo)}`).join("");
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.name}>
              <path d={band} fill={s.color} opacity={0.1} />
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {last && (
                <circle
                  cx={x(last.games)}
                  cy={y(last.elo)}
                  r={4.5}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })}
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={height - m.b} className="crosshair" />
            {series.map((s) => {
              const p = near(s, hover);
              return p ? (
                <circle
                  key={s.name}
                  cx={x(p.games)}
                  cy={y(p.elo)}
                  r={4.5}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ) : null;
            })}
          </>
        )}
        <rect
          x={m.l}
          y={m.t}
          width={Math.max(0, width - m.l - m.r)}
          height={height - m.t - m.b}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ── 구간 행(포리스트 · 막대) ────────────────────────────────────────────

export interface IntervalRow {
  key: string;
  label: string;
  sub?: string;
  value: number;
  low?: number;
  high?: number;
  color: string;
  /** 흐리게(불채택 등) */
  muted?: boolean;
  tip: ReactNode;
}

/**
 * 행마다 이름 | 축. 「dot」은 점 + 구간 수염(포리스트), 「bar」는 0 에서 자라는 막대 + 수염.
 * 이름을 HTML 로 두어 좁은 화면에서 줄바꿈되게 한다.
 */
export function IntervalChart({
  rows,
  kind,
  format,
  domain,
}: {
  rows: IntervalRow[];
  kind: "dot" | "bar";
  format: (v: number) => string;
  domain?: [number, number];
}) {
  const [ref, width] = useWidth<HTMLDivElement>(360);
  const [tip, setTip] = useState<TipState | null>(null);
  const [d0, d1] = useMemo(() => {
    if (domain) return domain;
    const vals = rows.flatMap((r) => [r.value, r.low ?? r.value, r.high ?? r.value, 0]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const p = (hi - lo) * 0.08;
    return [lo - p, hi + p] as [number, number];
  }, [rows, domain]);
  const pad = 10;
  const x = scale(d0, d1, pad, width - pad);
  const T = ticks(d0, d1, width < 360 ? 3 : 5);
  const rowH = 34;
  const fmt = format;

  return (
    <div className="ichart">
      <div className="ichart-rows">
        {rows.map((r) => (
          <div
            key={r.key}
            className={`irow${r.muted ? " muted" : ""}`}
            onPointerMove={(e) => {
              const host = e.currentTarget.parentElement?.getBoundingClientRect();
              if (host)
                setTip({
                  x: Math.min(e.clientX - host.left + 12, host.width - 220),
                  y: e.clientY - host.top + 14,
                  body: r.tip,
                });
            }}
            onPointerLeave={() => setTip(null)}
          >
            <div className="ilabel">
              <span className="iname">{r.label}</span>
              {r.sub && <span className="isub">{r.sub}</span>}
            </div>
            <div className="itrack" ref={r === rows[0] ? ref : undefined}>
              <svg width={width} height={rowH} aria-hidden="true">
                {T.map((t) => (
                  <line
                    key={t}
                    x1={x(t)}
                    x2={x(t)}
                    y1={0}
                    y2={rowH}
                    className={t === 0 ? "axis0" : "grid"}
                  />
                ))}
                {kind === "bar" && (
                  <BarMark x0={x(0)} x1={x(r.value)} y={rowH / 2} color={r.color} />
                )}
                {r.low != null && r.high != null && (
                  <g
                    stroke={kind === "bar" ? "var(--ink-2)" : r.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                  >
                    <line x1={x(r.low)} x2={x(r.high)} y1={rowH / 2} y2={rowH / 2} />
                    <line x1={x(r.low)} x2={x(r.low)} y1={rowH / 2 - 5} y2={rowH / 2 + 5} />
                    <line x1={x(r.high)} x2={x(r.high)} y1={rowH / 2 - 5} y2={rowH / 2 + 5} />
                  </g>
                )}
                {kind === "dot" && (
                  <circle
                    cx={x(r.value)}
                    cy={rowH / 2}
                    r={5.5}
                    fill={r.color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                )}
              </svg>
            </div>
            <div className="ivalue">{fmt(r.value)}</div>
          </div>
        ))}
        <div className="irow axisrow" aria-hidden="true">
          <div className="ilabel" />
          <div className="itrack">
            <svg width={width} height={18}>
              {T.map((t) => (
                <text key={t} x={x(t)} y={12} className="tick" textAnchor="middle">
                  {fmt(t)}
                </text>
              ))}
            </svg>
          </div>
          <div className="ivalue" />
        </div>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** 0 에서 자라는 가로 막대 — 끝만 4px 둥글게, 기준선 쪽은 각지게 */
function BarMark({ x0, x1, y, color }: { x0: number; x1: number; y: number; color: string }) {
  const h = 16;
  const w = Math.abs(x1 - x0);
  if (w < 0.5) return null;
  const r = Math.min(4, w);
  const top = y - h / 2;
  const d =
    x1 >= x0
      ? `M${x0},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${top + h - r} Q${x1},${top + h} ${x1 - r},${top + h} H${x0} Z`
      : `M${x0},${top} H${x1 + r} Q${x1},${top} ${x1},${top + r} V${top + h - r} Q${x1},${top + h} ${x1 + r},${top + h} H${x0} Z`;
  return <path d={d} fill={color} />;
}

// ── 묶음 세로 막대(오각 분포 등) ────────────────────────────────────────

export function GroupedColumns({
  categories,
  series,
  height = 220,
  yLabel,
}: {
  categories: string[];
  series: { name: string; color: string; values: number[] }[];
  height?: number;
  yLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const m = { l: 40, r: 8, t: 14, b: 40 };
  const maxV = Math.max(1, ...series.flatMap((s) => s.values));
  const yT = ticks(0, maxV, 4);
  const top = Math.max(maxV, yT[yT.length - 1] ?? maxV);
  const y = scale(0, top, height - m.b, m.t);
  const band = (width - m.l - m.r) / categories.length;
  const barW = Math.min(24, (band * 0.7) / series.length - 2);
  const groupW = series.length * barW + (series.length - 1) * 2;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={yLabel}>
        {yT.map((t) => (
          <g key={t}>
            <line
              x1={m.l}
              x2={width - m.r}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? "axis0" : "grid"}
            />
            <text x={m.l - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {categories.map((c, ci) => {
          const gx = m.l + band * ci + (band - groupW) / 2;
          return (
            <g key={c}>
              <text
                x={m.l + band * ci + band / 2}
                y={height - m.b + 18}
                className="tick"
                textAnchor="middle"
              >
                {c}
              </text>
              {series.map((s, si) => {
                const v = s.values[ci] ?? 0;
                const bx = gx + si * (barW + 2);
                const by = y(v);
                const h = height - m.b - by;
                const r = Math.min(4, h, barW / 2);
                const d = `M${bx},${height - m.b} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + barW - r} Q${bx + barW},${by} ${bx + barW},${by + r} V${height - m.b} Z`;
                return (
                  <g key={s.name}>
                    {h > 0.5 && <path d={d} fill={s.color} />}
                    <rect
                      x={bx - 1}
                      y={m.t}
                      width={barW + 2}
                      height={height - m.b - m.t}
                      fill="transparent"
                      onPointerMove={(e) => {
                        const host = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                        if (host)
                          setTip({
                            x: Math.min(e.clientX - host.left + 12, host.width - 180),
                            y: e.clientY - host.top - 10,
                            body: (
                              <>
                                <strong>{c}</strong>
                                <div className="tip-row">
                                  <span className="key" style={{ background: s.color }} />
                                  {s.name}: {v}
                                </div>
                              </>
                            ),
                          });
                      }}
                      onPointerLeave={() => setTip(null)}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ── W-D-L 띠(한 줄 100% 막대) ───────────────────────────────────────────

export function WdlBar({ w, d, l, color }: { w: number; d: number; l: number; color: string }) {
  const n = w + d + l || 1;
  const parts = [
    { k: "승", v: w, fill: color },
    { k: "무", v: d, fill: "var(--neutral)" },
    { k: "패", v: l, fill: "var(--ink-3)" },
  ];
  return (
    <div className="wdl" role="img" aria-label={`승 ${w} · 무 ${d} · 패 ${l}`}>
      {parts.map((p) =>
        p.v > 0 ? (
          <div
            key={p.k}
            className="wdl-seg"
            style={{ flexGrow: p.v / n, background: p.fill }}
            title={`${p.k} ${p.v}`}
          >
            {p.v / n > 0.12 && (
              <span className={p.k === "승" ? "on-color" : "on-neutral"}>
                {p.k} {p.v}
              </span>
            )}
          </div>
        ) : null,
      )}
    </div>
  );
}
