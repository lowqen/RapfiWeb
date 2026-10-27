import { useEffect, useState, type ReactNode } from "react";
import { t } from "../../i18n/i18n";
import { useEngineStore } from "../../engine/engine-state";
import type { SearchStats } from "../../engine/engine-types";
import { useBoardStore } from "./boardStore";
import { label } from "../../core/model/move";
import { colorsForTag, DEFAULT_PALETTE } from "../../core/board/ladder";
import { useSettingsStore } from "../settings/settingsStore";
import { useDisplayedAnalysis } from "./currentAnalysis";
import { STATUS_TEXT, useStartAnalysis, useStopAnalysis } from "./analysisActions";
import { AnalysisTimeControl, MultiPvControl, PlayBestOnStopControl, Row } from "./boardControls";
import { Disclosure } from "../../components/Disclosure";
import { useRememberedOpen } from "../../components/useRememberedOpen";

/**
 * [분석] 탭의 엔진 카드 — 앱의 수치 줄(DEPTH·EVAL·WINRATE·NPS…)과 후보 수순을 한 카드에
 * 모았다. 분석의 설정(시간 · 후보 수 · 정지하면 최선수 두기)은 바로 아래 `AnalysisOptions`
 * 카드가 진다.
 *
 * **처음 보는 사람 기준(UI 개편).** 화면 글은 영문 약어 대신 «최선수 · 승률 · 평가 · 깊이»이고,
 * 최선수가 맨 위다. 시간 · 노드 · 속도는 «세부 수치»를 켰을 때만 보인다(켠 것은 기억한다).
 * 아직 아무것도 읽지 않았으면 «없음» 일곱 칸 대신 한 줄 안내다. 엔진 「종료」는 엔진 화면에 있다.
 *
 * 숫자는 엔진의 집계된 스냅샷에서 온다(`useDisplayedAnalysis`). **멈춰도 지우지 않는다** —
 * 정지(최선수 착수) · 무르기 · 새 수로 판이 바뀌어도 마지막 결과(깊이 · 평가 · 승률 · BEST · PV)를
 * 그대로 두고 «직전 국면(N수)의 분석»이라고 밝힌다(`data-stale`, 흐리게). 새 국면의 답이 오면 그것으로
 * 바뀐다. 판 위의 값 칩 · 최선수 링은 지금 국면의 것만 그린다(`useCurrentAnalysis`).
 * 원시 줄은 워커 안에서 파싱되고 메인 스레드는 ~10Hz 스냅샷만 받는다(계획서 §3).
 *
 * 실시간으로 바뀌는 숫자(깊이·노드·속도)는 **보간하지 않는다.** 초당 몇 번씩
 * 바뀌는 값을 애니메이션하는 것은 이미 지나간 값에 대한 거짓말이다(`Motion.kt` 규칙).
 * 대신 `tnum` 으로 폭만 고정해 줄이 흔들리지 않게 한다.
 *
 * **TIME 만은 예외로 이 화면이 직접 센다**(`useSearchClock`). Rapfi 는 카운터를
 * 깊이 한 단계가 끝날 때만 찍는데, 후보 수 1 로 멀티스레드 무제한 분석을 하면 깊은
 * 단계 하나에 몇 초가 걸려 시간이 멈춘 것처럼 보였다. 경과 시간은 추정이 아니라
 * 벽시계라 보간의 거짓말이 아니다 — 엔진이 말한 값과 벽시계 중 큰 쪽을 그린다.
 * 노드·속도는 여전히 엔진이 말한 값만.
 *
 * **정지는 최선수를 둔다**(설정 「정지하면 최선수 두기」, 기본 켬). 정지를 누르는 그 순간의
 * BEST — PV 의 첫 수 — 를 판에 두고, 빈 판이면 엔진을 기다리지 않고 천원(H8)이다.
 *
 * 수치는 `dl.kv` 안에 남긴다 — 엔진 스모크가 «상태 점을 가진 패널의 `.kv dd`»로
 * 스트림 도착을 보고, **마지막 `dd` 를 최선수**로 읽는다. 그래서 BEST 가 맨 끝이다.
 */
export function AnalysisPanel() {
  const status = useEngineStore((s) => s.status);
  const caps = useEngineStore((s) => s.capabilities);
  const error = useEngineStore((s) => s.error);
  const start = useEngineStore((s) => s.start);
  const startAnalysis = useStartAnalysis();
  const stopAnalysis = useStopAnalysis();
  const playBest = useSettingsStore((s) => s.playBestOnStop);

  const render = useBoardStore((s) => s.render);
  const size = render.size;

  const { snapshot, stale, ply } = useDisplayedAnalysis();
  const { stats, pvs, bestMove } = snapshot;
  const searching = status === "searching";
  const clockMs = useSearchClock(searching);
  // 직전 국면의 값을 보이는 동안은 그 탐색의 시간 — 새 탐색의 벽시계와 섞지 않는다.
  const timeMs = clockMs === null || stale ? stats.timeMs : Math.max(stats.timeMs ?? 0, clockMs);
  const [detail, setDetail] = useRememberedOpen("engine-detail");
  // 아직 읽은 것이 하나도 없으면 «없음» 일곱 칸 대신 한 줄 — 무엇을 누르면 되는지만.
  const blank =
    !searching &&
    !stale &&
    !bestMove &&
    pvs.length === 0 &&
    !stats.depth &&
    stats.evalCp === null &&
    !stats.mate &&
    stats.winRatePct === null;

  if (!caps.variant) {
    return (
      <section className="panel">
        <h2 className="panel__title">{t("엔진")}</h2>
        <p className="panel__hint">{caps.note}</p>
      </section>
    );
  }

  return (
    <section className="panel panel--engine">
      <h2 className="panel__title">
        {t("엔진")} <span className="panel__badge" data-status={status} />
        <span className="panel__status">{STATUS_TEXT[status]}</span>
      </h2>

      <div className="panel__actions">
        {status === "idle" || status === "error" ? (
          <button type="button" onClick={() => void start()}>
            {t("엔진 시작")}
          </button>
        ) : null}
        <button
          type="button"
          className="button--tonal"
          onClick={startAnalysis}
          disabled={searching || status === "starting"}
        >
          {t("분석")}
        </button>
        <button
          type="button"
          onClick={stopAnalysis}
          disabled={!searching}
          title={playBest ? t("정지하고 최선수를 둡니다") : t("정지")}
        >
          {t("정지")}
        </button>
      </div>

      {error && <p className="panel__error">{error}</p>}

      {stale && (
        <p className="panel__hint stats__stale" data-k="analysis-stale">
          {searching
            ? t("새 국면을 읽는 중 · 직전 국면({n}수)의 분석", { n: ply ?? 0 })
            : t("정지됨 · 직전 국면({n}수)의 분석", { n: ply ?? 0 })}
        </p>
      )}

      {blank && (
        <p className="panel__hint" data-k="analysis-empty">
          {t("「분석」을 누르면 엔진이 이 국면의 최선수를 찾습니다")}
        </p>
      )}

      {/* 화면에서는 최선수가 맨 위(CSS order), 문서 순서는 그대로 — 스모크가 첫 dd 를 깊이로,
          마지막 dd 를 최선수로 읽는다. 시간 · 노드 · 속도는 «세부 수치»를 켰을 때만. */}
      <dl
        className="kv stats"
        data-stale={stale || undefined}
        data-detail={detail || undefined}
        hidden={blank}
      >
        <Stat id="depth" k={t("깊이")}>
          {stats.depth || NONE()}
          {stats.depth && stats.selDepth ? `/${stats.selDepth}` : ""}
        </Stat>
        <Stat id="eval" k={t("평가")}>
          {formatEval(stats)}
        </Stat>
        <Stat id="winrate" k={t("승률")}>
          {stats.winRatePct === null ? NONE() : `${stats.winRatePct}%`}
        </Stat>
        <Stat id="time" k={t("시간")} minor>
          {formatTime(timeMs)}
        </Stat>
        <Stat id="nodes" k={t("노드")} minor>
          {compact(stats.nodes)}
        </Stat>
        <Stat id="speed" k={t("속도")} minor>
          {stats.speed === null ? NONE() : `${compact(stats.speed)}/s`}
        </Stat>
        <Stat id="best" k={t("최선수")} wide>
          {bestMove ? label(bestMove, size) : NONE()}
        </Stat>
      </dl>
      {!blank && (
        <button
          type="button"
          className="textbtn stats__toggle"
          aria-pressed={detail}
          onClick={() => setDetail(!detail)}
        >
          {detail ? t("세부 수치 접기") : t("세부 수치")}
        </button>
      )}

      {snapshot.instant && !stale && (
        <p
          className="panel__hint"
          data-instant
          title={t("빈 판의 천원이나 막아야만 하는 수처럼 정해진 자리라 깊이와 평가가 없습니다")}
        >
          {t("즉답: 탐색 없이 정해진 수")}
        </p>
      )}

      {pvs.length > 0 && (
        <ol className="pvlist" aria-label={t("후보 수순(PV)")} data-stale={stale || undefined}>
          {pvs.map((pv) => {
            const c = colorsForTag(
              DEFAULT_PALETTE,
              pv.mate ? (pv.mate > 0 ? "win" : "lose") : "rate",
              pv.winRate === null ? 50 : Math.round(pv.winRate > 1 ? pv.winRate : pv.winRate * 100),
            );
            return (
              <li key={pv.index} className="pvlist__row">
                <span className="pvlist__chip tnum" style={{ background: c.fill, color: c.ink }}>
                  {pv.mate ? (pv.mate > 0 ? `W${pv.mate}` : `L${-pv.mate}`) : pvRate(pv.winRate)}
                </span>
                <span className="pvlist__line tnum">
                  {pv.line
                    .slice(0, 8)
                    .map((m) => label(m, size))
                    .join(" ")}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * [분석] 탭의 설정 카드 — 예전에 설정 화면의 「자주 쓰는 설정」에 있던 줄들.
 *
 * 접혀 있고 머리에 지금 값 한 줄(«무제한 · 후보 1수»)만 보인다. 기본값으로 충분한 사람이
 * 대부분이고, 고치는 사람은 한 번 열면 열린 채로 남는다(`Disclosure`). 예전에 엔진 카드에
 * 따로 있던 «분석 꺼짐 · 무제한 · 후보 1수 · 정지하면 최선수» 줄의 몫도 이 요약이 진다.
 */
export function AnalysisOptions() {
  const multiPv = useEngineStore((s) => s.multiPv);
  const analysisMs = useEngineStore((s) => s.analysisMs);
  const summary = `${Number.isFinite(analysisMs) ? t("{n}초", { n: analysisMs / 1000 }) : t("무제한")} · ${t("후보 {n}수", { n: multiPv })}`;
  return (
    <section className="panel panel--disclosure">
      <Disclosure id="analysis-options" title={t("분석 설정")} summary={summary}>
        <div className="panel__rows">
          <Row id="analysisTime" label={t("분석 시간")} note={t("무제한 = 정지할 때까지")} wide>
            <AnalysisTimeControl />
          </Row>
          <Row id="multiPv" label={t("후보 수")} note={t("1 이면 최선수 하나만 깊게 읽습니다")}>
            <MultiPvControl />
          </Row>
          <Row
            id="playBestOnStop"
            label={t("정지하면 최선수 두기")}
            note={t("정지하는 순간의 최선수를 둡니다(빈 판은 H8)")}
          >
            <PlayBestOnStopControl />
          </Row>
        </div>
      </Disclosure>
    </section>
  );
}

/**
 * 이번 탐색이 시작된 뒤 흐른 벽시계 ms(0.1초 간격). 탐색 중이 아니면 null.
 * 탐색이 끝났다 다시 시작하면(분석 중 착수 등) 0 부터 — 집계기도 그때 0 으로 돈다.
 */
function useSearchClock(searching: boolean): number | null {
  const [ms, setMs] = useState(0);
  // 탐색이 새로 시작되면 0 부터 — 렌더 중에 맞춘다. 탐색 중이 아니면 값은 null 로 읽힌다.
  const [wasSearching, setWasSearching] = useState(searching);
  if (searching !== wasSearching) {
    setWasSearching(searching);
    if (searching) setMs(0);
  }
  useEffect(() => {
    if (!searching) return;
    const t0 = performance.now();
    const id = window.setInterval(() => setMs(performance.now() - t0), 100);
    return () => window.clearInterval(id);
  }, [searching]);
  return searching ? ms : null;
}

/** 값이 아직 없는 칸 — 대시 대신 말로(W10). */
const NONE = () => t("없음");

function Stat({
  id,
  k,
  wide,
  minor,
  children,
}: {
  id: string;
  k: string;
  wide?: boolean;
  minor?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={"stat" + (wide ? " stat--wide" : "") + (minor ? " stat--minor" : "")}
      data-k={id}
    >
      <dt className="stat__key">{k}</dt>
      <dd className="stat__value tnum">{children}</dd>
    </div>
  );
}

function formatEval(stats: Pick<SearchStats, "evalCp" | "mate">): string {
  if (stats.mate !== null && stats.mate !== 0) {
    return stats.mate > 0 ? `+M${stats.mate}` : `-M${-stats.mate}`;
  }
  return stats.evalCp === null ? NONE() : String(stats.evalCp);
}

/** 노드·속도는 자릿수만 읽히면 된다 — 1,234,567 보다 1.23M 이 흘깃 읽힌다. */
function compact(n: number | null): string {
  if (n === null) return NONE();
  if (n < 1e3) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`;
  return `${(n / 1e9).toFixed(2)}G`;
}

function formatTime(ms: number | null): string {
  if (ms === null) return NONE();
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const pvRate = (winRate: number | null): string => {
  if (winRate === null) return NONE();
  const v = winRate > 1 ? winRate : winRate * 100;
  return `${Math.round(v)}%`;
};
