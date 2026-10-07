import { useEffect, useState, type ReactNode } from "react";
import {
  GroupedColumns,
  IntervalChart,
  Legend,
  TrajectoryChart,
  WdlBar,
  type IntervalRow,
} from "./components/charts";
import { signed } from "./components/format";
import { AMD, CONTROL, MAIN, type MatchReport } from "./data/matches";
import {
  ELO_HISTORY,
  PHASES,
  RELAXED_PAIRED,
  SPEED,
  STATUS_LABEL,
  type Status,
} from "./data/journey";

// 계열 색은 엔티티를 따른다(순위가 아니라) — 어느 차트에서든 같은 엔진은 같은 색.
const C = {
  rx: "var(--s1)", // RapfiWeb single-simd128-relaxed
  gc: "var(--s2)", // gomocalc single-simd128
  simd: "var(--s3)", // RapfiWeb single-simd128
};

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const k = (x: number | null | undefined) => (x == null ? "—" : `${(x / 1000).toFixed(1)}K`);
const eloFmt = (v: number) => (v === 0 ? "0" : signed(v, 0));

// ── 작은 부품 ───────────────────────────────────────────────────────────

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(() => {
    const t = document.documentElement.dataset.theme;
    return t === "light" || t === "dark" ? t : null;
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    try {
      if (theme) localStorage.setItem("rapfi.showcase.theme", theme);
      else localStorage.removeItem("rapfi.showcase.theme");
    } catch {
      /* 저장소가 막힘 — 이번 방문에만 */
    }
  }, [theme]);
  const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const effective = theme ?? (systemDark() ? "dark" : "light");
  return { effective, toggle: () => setTheme(effective === "dark" ? "light" : "dark") };
}

function useCountUp(target: number, ms = 1100) {
  const [v, setV] = useState(() =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? target : 0,
  );
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setV(target * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const STATUS_ICON: Record<Status, string> = {
  adopted: "✓",
  done: "●",
  rejected: "✕",
  dropped: "⊘",
  parked: "❚❚",
};

function Chip({ status }: { status: Status }) {
  return (
    <span className={`chip chip-${status}`}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="section">
      <header className="section-head">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {lead && <p className="lead">{lead}</p>}
      </header>
      {children}
    </section>
  );
}

function Card({
  title,
  sub,
  children,
  wide,
}: {
  title: string;
  sub?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <article className={`card${wide ? " wide" : ""}`}>
      <header>
        <h3>{title}</h3>
        {sub && <p className="sub">{sub}</p>}
      </header>
      {children}
    </article>
  );
}

function Stat({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="stat">
      <p className="stat-label">
        {accent && <span className="key" style={{ background: accent }} />}
        {label}
      </p>
      <p className="stat-value">{value}</p>
      {note && <p className="stat-note">{note}</p>}
    </div>
  );
}

function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="datatable">
      <summary>표로 보기 — {caption}</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ── 화면 ────────────────────────────────────────────────────────────────

const decisionText = (m: MatchReport) =>
  m.sprt.decided
    ? `${m.sprt.decided.decision} 채택 · ${m.sprt.decided.game}판`
    : `결정 없음 · LLR ${m.sprt.llr.toFixed(2)}`;

export function App() {
  const { effective, toggle } = useTheme();
  const main = MAIN.elo.pentanomial;
  const ctrl = CONTROL.elo.pentanomial;
  const hero = useCountUp(main.elo);
  const npsGain = MAIN.speedElo ? MAIN.speedElo.npsRatio - 1 : null;
  const ctrlNpsGain = CONTROL.speedElo ? CONTROL.speedElo.npsRatio - 1 : null;
  const adopted = PHASES.flatMap((p) => p.steps).filter((s) => s.status === "adopted").length;
  const allSteps = PHASES.flatMap((p) => p.steps);
  const statusCount = (Object.keys(STATUS_LABEL) as Status[]).map((s) => ({
    s,
    n: allSteps.filter((x) => x.status === s).length,
  }));

  // Elo 분해 — 실측 · 속도 몫(M3 환산) · 나머지
  const decomp: IntervalRow[] = [
    {
      key: "main",
      label: "본 매치 실측",
      sub: "relaxed vs gomocalc",
      value: main.elo,
      low: main.low,
      high: main.high,
      color: C.rx,
      tip: (
        <>
          본 매치 Elo {signed(main.elo)} (95% {signed(main.low)} ~ {signed(main.high)})
        </>
      ),
    },
    ...(MAIN.speedElo
      ? [
          {
            key: "speed",
            label: "그중 속도 몫",
            sub: `NPS ×${MAIN.speedElo.npsRatio.toFixed(3)} · M3 환산`,
            value: MAIN.speedElo.predicted,
            low: MAIN.speedElo.low,
            high: MAIN.speedElo.high,
            color: "var(--ink-3)",
            tip: (
              <>
                NPS 비를 M3(속도 2배 = +105.7 Elo)로 환산한 예측 — 같은 탐색이라면 속도만으로 얻었을
                몫
              </>
            ),
          },
        ]
      : []),
    {
      key: "ctrl",
      label: "대조 실측",
      sub: "같은 ISA(simd128)끼리",
      value: ctrl.elo,
      low: ctrl.low,
      high: ctrl.high,
      color: C.simd,
      tip: (
        <>
          relaxed 몫을 뺀 소스 · 패치 몫: {signed(ctrl.elo)} (95% {signed(ctrl.low)} ~{" "}
          {signed(ctrl.high)})
        </>
      ),
    },
    ...(CONTROL.speedElo
      ? [
          {
            key: "ctrl-speed",
            label: "대조의 속도 몫",
            sub: `NPS ×${CONTROL.speedElo.npsRatio.toFixed(3)} · M3 환산`,
            value: CONTROL.speedElo.predicted,
            low: CONTROL.speedElo.low,
            high: CONTROL.speedElo.high,
            color: "var(--ink-3)",
            tip: <>같은 ISA 에서의 NPS 차를 M3 로 환산한 예측</>,
          },
        ]
      : []),
  ];

  const npsRows: IntervalRow[] = [
    { m: MAIN, name: "본 매치", aName: "RapfiWeb relaxed", aColor: C.rx },
    { m: CONTROL, name: "대조", aName: "RapfiWeb simd128", aColor: C.simd },
  ].flatMap(({ m, name, aName, aColor }) =>
    m.search
      ? [
          {
            key: `${name}-a`,
            label: aName,
            sub: `${name} · 깊이 ${m.search.A.avgDepth?.toFixed(1) ?? "—"}`,
            value: Math.round(m.search.A.nps ?? 0),
            color: aColor,
            tip: (
              <>
                {aName}: {Math.round(m.search.A.nps ?? 0).toLocaleString("en-US")} NPS ·{" "}
                {m.search.A.moves.toLocaleString("en-US")}수 · 평균 깊이{" "}
                {m.search.A.avgDepth?.toFixed(2)}
              </>
            ),
          },
          {
            key: `${name}-b`,
            label: "Gomocalc simd128",
            sub: `${name} · 깊이 ${m.search.B.avgDepth?.toFixed(1) ?? "—"}`,
            value: Math.round(m.search.B.nps ?? 0),
            color: C.gc,
            tip: (
              <>
                Gomocalc: {Math.round(m.search.B.nps ?? 0).toLocaleString("en-US")} NPS ·{" "}
                {m.search.B.moves.toLocaleString("en-US")}수 · 평균 깊이{" "}
                {m.search.B.avgDepth?.toFixed(2)}
              </>
            ),
          },
        ]
      : [],
  );

  const speedRows: IntervalRow[] = SPEED.map((s) => ({
    key: s.id,
    label: `${s.id} · ${s.label}`,
    sub: STATUS_LABEL[s.status],
    value: s.value,
    low: s.low,
    high: s.high,
    color: s.status === "adopted" ? C.rx : "var(--ink-3)",
    muted: s.status !== "adopted",
    tip: (
      <>
        <strong>
          {s.id} {s.label}
        </strong>
        <div>
          {signed(s.value, 2)}% · {s.note}
        </div>
      </>
    ),
  }));

  const eloRows: IntervalRow[] = [
    {
      key: "this",
      label: "★ 본 매치 — vs Gomocalc",
      sub: `${MAIN.games.toLocaleString("en-US")}판 · ${decisionText(MAIN)}`,
      value: main.elo,
      low: main.low,
      high: main.high,
      color: C.rx,
      tip: (
        <>
          RapfiWeb relaxed vs Gomocalc: {signed(main.elo)} (95% {signed(main.low)} ~{" "}
          {signed(main.high)})
        </>
      ),
    },
    {
      key: "ctrl",
      label: "★ 대조 — 같은 ISA",
      sub: `${CONTROL.games.toLocaleString("en-US")}판 · ${decisionText(CONTROL)}`,
      value: ctrl.elo,
      low: ctrl.low,
      high: ctrl.high,
      color: C.simd,
      tip: (
        <>
          RapfiWeb simd128 vs Gomocalc: {signed(ctrl.elo)} (95% {signed(ctrl.low)} ~{" "}
          {signed(ctrl.high)})
        </>
      ),
    },
    ...(AMD
      ? [
          {
            key: "amd",
            label: "★ 본 매치 — AMD 7B13 러너",
            sub: `${AMD.games.toLocaleString("en-US")}판 · ${decisionText(AMD)}`,
            value: AMD.elo.pentanomial.elo,
            low: AMD.elo.pentanomial.low,
            high: AMD.elo.pentanomial.high,
            color: C.rx,
            tip: (
              <>
                AMD EPYC 7B13 에서 다시 둔 본 매치: {signed(AMD.elo.pentanomial.elo)} (95%{" "}
                {signed(AMD.elo.pentanomial.low)} ~ {signed(AMD.elo.pentanomial.high)})
              </>
            ),
          },
        ]
      : []),
    ...ELO_HISTORY.map((e) => ({
      key: e.id,
      label: e.label,
      sub: `${e.games.toLocaleString("en-US")}판 · ${e.note}`,
      value: e.elo,
      low: e.low,
      high: e.high,
      color: e.status === "adopted" || e.status === "done" ? "var(--ink-1)" : "var(--ink-3)",
      muted: e.status === "rejected",
      tip: (
        <>
          <strong>{e.label}</strong>
          <div>
            Elo {signed(e.elo)} (95% {signed(e.low)} ~ {signed(e.high)}) · {STATUS_LABEL[e.status]}
          </div>
        </>
      ),
    })),
  ];

  const pentaCats = ["0", "½", "1", "1½", "2"];

  const pairedRows: IntervalRow[] = RELAXED_PAIRED.rows.map((r) => ({
    ...r,
    color: r.key === "aa" ? "var(--ink-3)" : C.rx,
    muted: r.key === "aa",
    tip: (
      <>
        <strong>{r.label}</strong>
        <div>
          {signed(r.value, 2)}% (95% {signed(r.low, 2)} ~ {signed(r.high, 2)}) · {r.sub}
        </div>
      </>
    ),
  }));

  const cpuRows: IntervalRow[] = (AMD ? [MAIN, AMD] : [MAIN]).map((m, i) => ({
    key: `cpu-${i}`,
    label: m.runner ?? (i ? "AMD" : "Intel"),
    sub: `${m.games}판 · ${decisionText(m)}${m.speedElo ? ` · NPS ×${m.speedElo.npsRatio.toFixed(2)}` : ""}`,
    value: m.elo.pentanomial.elo,
    low: m.elo.pentanomial.low,
    high: m.elo.pentanomial.high,
    color: C.rx,
    tip: (
      <>
        {m.runner}: Elo {signed(m.elo.pentanomial.elo)} (95% {signed(m.elo.pentanomial.low)} ~{" "}
        {signed(m.elo.pentanomial.high)})
      </>
    ),
  }));
  const runs = [MAIN, CONTROL, ...(AMD ? [AMD] : [])];
  const totalGames = runs.reduce((a, m) => a + m.games, 0);
  const wallH = runs.reduce((a, m) => a + m.wallSec, 0) / 3600;
  const faultRate = runs.reduce((a, m) => a + m.faultRate * m.games, 0) / Math.max(1, totalGames);

  return (
    <>
      <div className="glow" aria-hidden="true" />
      <nav className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          RapfiWeb <span className="brand-sub">Engine Lab</span>
        </a>
        <div className="navlinks">
          <a href="#match">매치</a>
          <a href="#speed">속도</a>
          <a href="#journey">여정</a>
          <a href="#method">방법</a>
        </div>
        <button
          className="theme"
          onClick={toggle}
          aria-label={`${effective === "dark" ? "밝은" : "어두운"} 테마로`}
        >
          {effective === "dark" ? "☀" : "☾"}
        </button>
      </nav>

      <main id="top">
        <header className="hero">
          <p className="eyebrow">
            Gomocalc 순정 vs RapfiWeb 배포 · 렌주 · 1 스레드 WASM · 수당 {MAIN.tc.A.turn}ms
          </p>
          <h1>
            같은 가중치,
            <br />
            <span className="grad">더 강한 엔진.</span>
          </h1>
          <p className="hero-lead">
            gomocalc.com 이 서비스하는 Rapfi 와 RapfiWeb 이 배포하는 Rapfi 를{" "}
            <strong>배포 실물 그대로</strong> 맞붙였다. 가중치는 바이트까지 같다. 차이를 만든 것은
            relaxed SIMD 1 스레드 변형과 그 위의 A3 배치 — 같은 ISA 끼리의 대조에서는 차이가 없었다.
          </p>
          <div className="hero-grid">
            <div className="hero-figure">
              <p className="stat-label">Elo 차 (오각 · 95% 구간)</p>
              <p className="hero-num">
                {hero >= 0 ? "+" : "−"}
                {Math.abs(hero).toFixed(1)}
              </p>
              <p className="hero-ci">
                {signed(main.low)} ~ {signed(main.high)} · LOS {pct(main.los)}
              </p>
              <WdlBar w={MAIN.wdl.w} d={MAIN.wdl.d} l={MAIN.wdl.l} color={C.rx} />
              <p className="hero-foot">
                {MAIN.games.toLocaleString("en-US")}판 · RapfiWeb 기준 승 {MAIN.wdl.w} · 무{" "}
                {MAIN.wdl.d} · 패 {MAIN.wdl.l} · {MAIN.runner} · {decisionText(MAIN)}
              </p>
            </div>
            <div className="kpis">
              <Stat label="점수" value={pct(main.score)} note={`비김 ${pct(MAIN.drawRatio)}`} />
              <Stat
                label="대국 중 NPS"
                value={
                  npsGain == null
                    ? "—"
                    : `${npsGain >= 0 ? "+" : "−"}${Math.abs(npsGain * 100).toFixed(1)}%`
                }
                note={
                  MAIN.search ? `${k(MAIN.search.A.nps)} vs ${k(MAIN.search.B.nps)}` : undefined
                }
              />
              <Stat
                label="같은 ISA 대조"
                value={signed(ctrl.elo)}
                note={`${signed(ctrl.low)} ~ ${signed(ctrl.high)} Elo`}
              />
              <Stat
                label="고장률"
                value={pct(faultRate, 2)}
                note={`시간 초과 · 크래시 · 불법 수 · ${runs.length}개 런`}
              />
              {AMD ? (
                <Stat
                  label="AMD 7B13 에서 다시"
                  value={signed(AMD.elo.pentanomial.elo)}
                  note={`${signed(AMD.elo.pentanomial.low)} ~ ${signed(AMD.elo.pentanomial.high)} · ${decisionText(AMD)}`}
                />
              ) : (
                <Stat
                  label="SPRT [0, 10]"
                  value={MAIN.sprt.decided?.decision ?? "—"}
                  note={decisionText(MAIN)}
                />
              )}
              <Stat
                label="총 대국"
                value={totalGames.toLocaleString("en-US")}
                note={`${wallH.toFixed(1)}시간 · Intel 8488C${AMD ? " · AMD 7B13" : ""}`}
              />
            </div>
          </div>
        </header>

        <Section
          id="match"
          eyebrow="01 · 매치 분석"
          title="판이 쌓일수록 좁혀지는 Elo"
          lead={
            <>
              같은 개시를 색을 바꿔 두 판씩(쌍 대국) 두고, 쌍 하나를 표본 하나로 보는{" "}
              <strong>오각(pentanomial)</strong> 통계로 Elo 와 95% 구간을 냈다. 띠가 0 위로 올라가
              머물면 우연이 아니다.
            </>
          }
        >
          <div className="grid">
            <Card
              title="Elo 추정의 궤적"
              sub="선 = 추정치 · 띠 = 95% 구간 · 마우스를 올리면 그 시점의 값"
              wide
            >
              <Legend
                items={[
                  { label: `본 매치 — RapfiWeb relaxed (${signed(main.elo)})`, color: C.rx },
                  { label: `대조 — RapfiWeb simd128 (${signed(ctrl.elo)})`, color: C.simd },
                ]}
              />
              <TrajectoryChart
                series={[
                  { name: "본 매치", color: C.rx, points: MAIN.trajectory },
                  { name: "대조", color: C.simd, points: CONTROL.trajectory },
                ]}
              />
              <DataTable
                caption="궤적(본 매치)"
                head={["판", "Elo", "하한", "상한", "LLR"]}
                rows={MAIN.trajectory
                  .filter((_, i, a) => i % Math.ceil(a.length / 12) === 0 || i === a.length - 1)
                  .map((p) => [p.games, signed(p.elo), signed(p.low), signed(p.high), p.llr])}
              />
            </Card>
            <Card
              title="쌍 점수 분포 (오각)"
              sub="한 쌍(같은 개시 · 흑백 교대)에서 RapfiWeb 이 딴 점수"
            >
              <Legend
                items={[
                  { label: "본 매치", color: C.rx },
                  { label: "대조", color: C.simd },
                ]}
              />
              <GroupedColumns
                categories={pentaCats}
                yLabel="쌍 점수별 쌍 수"
                series={[
                  { name: "본 매치", color: C.rx, values: MAIN.penta },
                  { name: "대조", color: C.simd, values: CONTROL.penta },
                ]}
              />
              <DataTable
                caption="오각 분포"
                head={["쌍 점수", ...pentaCats]}
                rows={[
                  ["본 매치", ...MAIN.penta],
                  ["대조", ...CONTROL.penta],
                ]}
              />
            </Card>
            <Card
              title="Elo 는 어디서 왔나"
              sub="실측 Elo 와, 대국 중 NPS 비를 M3 계수로 환산한 「속도 몫」"
            >
              <IntervalChart rows={decomp} kind="bar" format={eloFmt} />
              <p className="note">
                실측 Elo 의 대부분은 속도 몫으로 설명된다. 남는 차(실측 − 속도 몫)는 두 구간이 겹쳐
                통계적으로 0 과 구분되지 않는다. 같은 ISA 대조는 속도도(+
                {CONTROL.speedElo ? ((CONTROL.speedElo.npsRatio - 1) * 100).toFixed(1) : "—"}
                %) Elo 도 거의 같다. 환산은 M3(수당 500ms · WASM · 균형 개시)의 +1% ≈ +1.5 Elo.
              </p>
            </Card>
            {AMD && (
              <Card
                title="CPU 를 바꿔 다시 — Intel 8488C ↔ AMD 7B13"
                sub="같은 엔진 · 같은 조건(수당 500ms · 균형 개시 60)으로 러너만 바꿔 둔 본 매치 · 점 = Elo · 수염 = 95% 구간"
                wide
              >
                <IntervalChart rows={cpuRows} kind="dot" format={eloFmt} />
                <DataTable
                  caption="CPU 별 본 매치"
                  head={["러너", "판", "W-D-L", "Elo", "95% 구간", "NPS 비"]}
                  rows={[
                    { m: MAIN, n: MAIN.runner ?? "Intel" },
                    { m: AMD, n: AMD.runner ?? "AMD" },
                  ].map(({ m, n }) => [
                    n,
                    m.games,
                    `${m.wdl.w}-${m.wdl.d}-${m.wdl.l}`,
                    signed(m.elo.pentanomial.elo),
                    `${signed(m.elo.pentanomial.low)} ~ ${signed(m.elo.pentanomial.high)}`,
                    m.speedElo ? `×${m.speedElo.npsRatio.toFixed(3)}` : "—",
                  ])}
                />
              </Card>
            )}
            <Card title="색별 · 끝난 까닭" sub="RapfiWeb 쪽에서 본 승-무-패" wide>
              <div className="mini-table">
                {[
                  { m: MAIN, n: "본 매치", c: C.rx },
                  { m: CONTROL, n: "대조", c: C.simd },
                  ...(AMD ? [{ m: AMD, n: "본 매치 · AMD 7B13", c: C.rx }] : []),
                ].map(({ m, n, c }) => (
                  <div key={n} className="mini-block">
                    <p className="mini-title">
                      <span className="key" style={{ background: c }} />
                      {n}
                    </p>
                    <p>
                      흑일 때{" "}
                      <b>
                        {m.colors.black.w}-{m.colors.black.d}-{m.colors.black.l}
                      </b>{" "}
                      · 백일 때{" "}
                      <b>
                        {m.colors.white.w}-{m.colors.white.d}-{m.colors.white.l}
                      </b>
                    </p>
                    <p className="muted">
                      {Object.entries(m.reasons)
                        .map(([r, v]) => `${REASON[r] ?? r} ${v}`)
                        .join(" · ")}
                    </p>
                    <p className="muted">
                      수 수 중앙값 {m.plies.median} (p10 {m.plies.p10} · p90 {m.plies.p90}) · 판당{" "}
                      {m.avgGameSec.toFixed(1)}초
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </Section>

        <Section
          id="speed"
          eyebrow="02 · 연산 속도"
          title="노드 하나를 더 싸게"
          lead={
            <>
              엔진 시간의 77% 가 NNUE 추론이다. 같은 탐색 트리를 더 빨리 도는 변경만 「결과 불변」
              게이트(BENCH 해시 · 비트 동일)를 통과시켜 쌓았다.
            </>
          }
        >
          <div className="grid">
            <Card
              title="대국 중 실측 NPS"
              sub="러너가 수마다의 요약 줄에서 모은 시간 가중 평균 · 같은 CI 기계"
            >
              <IntervalChart rows={npsRows} kind="bar" format={(v) => k(v)} />
              <DataTable
                caption="대국 중 NPS"
                head={["매치", "엔진", "NPS", "평균 깊이", "수"]}
                rows={[
                  { m: MAIN, n: "본 매치", a: "RapfiWeb relaxed" },
                  { m: CONTROL, n: "대조", a: "RapfiWeb simd128" },
                ].flatMap(({ m, n, a }) =>
                  m.search
                    ? [
                        [
                          n,
                          a,
                          Math.round(m.search.A.nps ?? 0).toLocaleString("en-US"),
                          m.search.A.avgDepth?.toFixed(2) ?? "—",
                          m.search.A.moves,
                        ],
                        [
                          n,
                          "Gomocalc simd128",
                          Math.round(m.search.B.nps ?? 0).toLocaleString("en-US"),
                          m.search.B.avgDepth?.toFixed(2) ?? "—",
                          m.search.B.moves,
                        ],
                      ]
                    : [],
                )}
              />
            </Card>
            <Card
              title="속도 장부"
              sub="같은 러너 · 같은 트리에서 잰 NPS 이득(%) · 수염 = 구간 또는 두 런의 폭"
            >
              <IntervalChart
                rows={speedRows}
                kind="bar"
                format={(v) => `${v > 0 ? "+" : ""}${v}%`}
              />
              <p className="note">
                채택은 둘 이상의 독립 런에서 같은 방향이어야 했다. P2-1 · P2-5 · P3-5 처럼 잡음 바닥
                안의 「개선」은 버렸다.
                {ctrlNpsGain != null && (
                  <> 대국 중에 잰 같은 ISA 의 NPS 차는 {signed(ctrlNpsGain * 100)}% 였다.</>
                )}
              </p>
            </Card>
            <Card
              title="relaxed SIMD 는 어디서 빨라지나"
              sub={`relaxed ↔ 일반 SIMD128 · 같은 런 짝(고정 깊이 15) · ${RELAXED_PAIRED.cpu}(VNNI 없음) · 수염 = 95% 구간`}
              wide
            >
              <IntervalChart
                rows={pairedRows}
                kind="bar"
                format={(v) => `${v > 0 ? "+" : ""}${v}%`}
              />
              <p className="note">
                A/A 가 0 을 품으니 하네스는 믿을 만하다. 큰 몫은 VNNI 없이도 나온다 — 이득을 크게
                가르는 것은 국면의 종류다: NNUE 추론 몫이 큰 개시 · 중반 +43%, 위협 수순이 많은 필승
                국면 +19%. 대국은 개시에서 시작하므로 앞쪽에 가깝다
                {MAIN.search && CONTROL.search?.A.nps && MAIN.search.A.nps ? (
                  <>
                    {" "}
                    (Intel 8488C 대국 중 relaxed ÷ 일반 ={" "}
                    {signed((MAIN.search.A.nps / CONTROL.search.A.nps - 1) * 100)}% — 다른 런)
                  </>
                ) : null}
                .
              </p>
            </Card>
          </div>
        </Section>

        <Section
          id="journey"
          eyebrow="03 · 최적화 여정"
          title={`${allSteps.length}개의 가설, ${adopted}개의 채택`}
          lead={
            <>
              모든 후보는 측정으로 판정했다. 결과 불변 변경은 BENCH 해시 · cachegrind · 고정 깊이
              속도로, 트리를 바꾸는 변경은 SPRT 대국으로만. 불채택도 기록으로 남겼다.
            </>
          }
        >
          <div className="status-strip" role="list">
            {statusCount.map(({ s, n }) => (
              <div key={s} role="listitem" className="status-cell">
                <Chip status={s} />
                <b>{n}</b>
              </div>
            ))}
          </div>
          <ol className="timeline">
            {PHASES.map((p) => (
              <li key={p.key} className="phase">
                <div className="phase-head">
                  <span className="phase-dot" aria-hidden="true" />
                  <div>
                    <h3>{p.name}</h3>
                    <p className="muted">
                      {p.period} · {p.goal}
                    </p>
                  </div>
                </div>
                <div className="steps">
                  {p.steps.map((s) => (
                    <div key={s.id} className={`step step-${s.status}`}>
                      <div className="step-top">
                        <code>{s.id}</code>
                        <Chip status={s.status} />
                      </div>
                      <p className="step-title">{s.title}</p>
                      <p className="step-metric">{s.metric}</p>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <div className="grid">
            <Card
              title="Elo 장부 — 대국으로 판정한 것들"
              sub="점 = Elo · 수염 = 95% 구간 · 0 선 오른쪽이 이득"
              wide
            >
              <IntervalChart rows={eloRows} kind="dot" format={eloFmt} />
              <DataTable
                caption="Elo 장부"
                head={["항목", "판", "Elo", "95% 구간"]}
                rows={eloRows.map((r) => [
                  r.label,
                  r.sub ?? "",
                  signed(r.value),
                  `${signed(r.low ?? 0)} ~ ${signed(r.high ?? 0)}`,
                ])}
              />
            </Card>
          </div>
        </Section>

        <Section id="method" eyebrow="04 · 방법" title="어떻게 쟀나">
          <div className="grid three">
            <Card title="배포 실물 그대로">
              <p>
                gomocalc 는 <code>www.gomocalc.com/build</code> 의 바이너리, 우리는 엔진 릴리스{" "}
                <code>engine-3c94c2a9-a3</code>. 빌드하지 않고 <code>fetch-engines.mjs</code> 로
                받아 Node 에서 Gomocup 엔진처럼 띄웠다(<code>wasm-pbrain.mjs</code>). 금수 판정은
                별도 심판 엔진.
              </p>
            </Card>
            <Card title="쌍 대국 + 오각 SPRT">
              <p>
                균형 개시 {MAIN.openingsCount}개에서 색을 바꿔 두 판씩. 판마다 Wald SPRT 의 LLR 을
                쌓되 고정 판 수(<code>--fixed</code>)로 끝까지 둬서 「낫다」를 넘어 Elo 차 자체를
                좁혔다. 쌍 하나가 표본 하나(개시 편향 상쇄).
              </p>
            </Card>
            <Card title="멈추지 않는 러너">
              <p>
                모든 대기에 시간 제한, stdout · stderr 를 늘 끝까지 읽어 파이프 버퍼 데드락 차단,
                stdin 역압 준수, END → 유예 → kill. 끝에 남은 프로세스 · 자식 핸들을 세어 0 이
                아니면 실패. 이번 대국의 남은 프로세스: <b>{MAIN.leaked + CONTROL.leaked}</b>.
              </p>
            </Card>
          </div>
          <pre className="repro">
            <code>{`# 재현 — CI(self-hosted)에서
gh workflow run match-gomocalc.yml -f test_variant=single-simd128-relaxed -f games=800
gh workflow run match-gomocalc.yml -f test_variant=single-simd128 -f games=400
# 분석 묶음 → 보고서 · 쇼케이스
node bench/sprt/match-report.mjs --games games.jsonl --summary summary.json --json showcase/src/data/match-relaxed.json`}</code>
          </pre>
        </Section>
      </main>
      <footer className="footer">
        <p>
          RapfiWeb · GPL-3.0-or-later · 엔진 Rapfi(dhbloo) · 숫자의 출처:{" "}
          <code>docs/gomocalc-대국-분석.md</code> · <code>docs/최적화-마스터플랜.md</code>
          {MAIN.run && (
            <>
              {" "}
              · CI 런 <code>{MAIN.run}</code>
              {CONTROL.run && (
                <>
                  {" "}
                  · <code>{CONTROL.run}</code>
                </>
              )}
            </>
          )}
        </p>
      </footer>
    </>
  );
}

const REASON: Record<string, string> = {
  five: "오목",
  forbidden: "금수",
  "forbidden(overline)": "장목",
  "board-full": "판 가득",
  "max-plies": "수 제한",
  timeout: "시간 초과",
  crash: "크래시",
  illegal: "불법 수",
  time: "시간 패",
};
