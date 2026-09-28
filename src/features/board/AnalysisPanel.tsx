import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useEngineStore } from "../../engine/engine-state";
import type { SearchStats } from "../../engine/engine-types";
import { useBoardStore } from "./boardStore";
import { label } from "../../core/model/move";
import { colorsForTag, DEFAULT_PALETTE } from "../../core/board/ladder";
import { useGameStore } from "./gameStore";

/**
 * 엔진 상태 카드 — 옆 칸의 맨 위. 앱의 수치 줄(DEPTH·EVAL·WINRATE…)과 후보 수순을
 * 한 카드에 모았다. 후보 수·분석 시간 같은 **설정**은 설정 탭이 진다 — 여기는
 * 지금 엔진이 무엇을 하고 있는지만 말한다.
 *
 * 여기 있는 숫자는 전부 **집계된 스냅샷**에서 온다. 원시 줄은 워커 안에서 파싱되고
 * 메인 스레드는 ~10Hz 스냅샷과 저주파 콘솔 배치만 받는다(계획서 §3).
 *
 * 실시간으로 바뀌는 숫자(깊이·노드·속도)는 **보간하지 않는다.** 초당 몇 번씩
 * 바뀌는 값을 애니메이션하는 것은 이미 지나간 값에 대한 거짓말이다(`Motion.kt` 규칙).
 * 대신 `tnum` 으로 폭만 고정해 줄이 흔들리지 않게 한다.
 *
 * 수치는 `dl.kv` 안에 남긴다 — 엔진 스모크가 «상태 점을 가진 패널의 `.kv dd`»로
 * 스트림 도착을 보고, **마지막 `dd` 를 최선수**로 읽는다. 그래서 BEST 가 맨 끝이다.
 */
export function AnalysisPanel() {
  const status = useEngineStore((s) => s.status);
  const caps = useEngineStore((s) => s.capabilities);
  const snapshot = useEngineStore((s) => s.snapshot);
  const error = useEngineStore((s) => s.error);
  const start = useEngineStore((s) => s.start);
  const analyze = useEngineStore((s) => s.analyze);
  const stop = useEngineStore((s) => s.stop);
  const terminate = useEngineStore((s) => s.terminate);
  const multiPv = useEngineStore((s) => s.multiPv);
  const analysisMs = useEngineStore((s) => s.analysisMs);
  const analyzing = useEngineStore((s) => s.analyzing);
  const thinking = useGameStore((s) => s.thinking);
  const unlimitedGame = useGameStore((s) => !s.clock.limited);
  const moveNow = useGameStore((s) => s.moveNow);

  const render = useBoardStore((s) => s.render);
  const placements = useBoardStore((s) => s.placements);
  const size = render.size;

  const { stats, pvs, bestMove } = snapshot;
  const searching = status === "searching";

  if (!caps.variant) {
    return (
      <section className="panel">
        <h2 className="panel__title">엔진</h2>
        <p className="panel__hint">{caps.note}</p>
      </section>
    );
  }

  return (
    <section className="panel panel--engine">
      <h2 className="panel__title">
        엔진 <span className="panel__badge" data-status={status} />
        <span className="panel__status">{STATUS_TEXT[status]}</span>
      </h2>

      <div className="panel__actions">
        {status === "idle" || status === "error" ? (
          <button type="button" onClick={() => void start()}>
            엔진 시작
          </button>
        ) : null}
        <button
          type="button"
          className="button--tonal"
          onClick={() => void analyze(placements())}
          disabled={searching || status === "starting"}
        >
          분석
        </button>
        <button type="button" onClick={stop} disabled={!searching}>
          정지
        </button>
        <button type="button" onClick={terminate} disabled={status === "idle"}>
          종료
        </button>
      </div>

      {/* 무제한 대국: 엔진은 여기를 누를 때까지 생각한다(데스크톱·앱의 기본 레벨과 같다).
          보드의 ▶ 는 이때 잠기므로 엔진의 한 수를 끝내는 자리는 여기 하나다. */}
      {thinking && unlimitedGame && (
        <div className="panel__actions">
          <button type="button" className="button--primary" onClick={moveNow}>
            지금 두기
          </button>
          <span className="panel__hint panel__hint--inline">
            무제한 — 누를 때까지 엔진이 계속 읽습니다
          </span>
        </div>
      )}

      {error && <p className="panel__error">{error}</p>}

      <p className="engine-mode" data-on={analyzing || undefined}>
        <span className="engine-mode__dot" aria-hidden="true" />
        {analyzing ? "분석 중" : "분석 꺼짐"} ·{" "}
        {Number.isFinite(analysisMs) ? `${analysisMs / 1000}초` : "무제한"} · 후보 {multiPv}수
        <Link className="inline-link engine-mode__link" to="/settings">
          설정
        </Link>
      </p>

      <dl className="kv stats">
        <Stat k="DEPTH">
          {stats.depth || "—"}
          {stats.depth && stats.selDepth ? `-${stats.selDepth}` : ""}
        </Stat>
        <Stat k="EVAL">{formatEval(stats)}</Stat>
        <Stat k="WINRATE">{stats.winRatePct === null ? "—" : `${stats.winRatePct}%`}</Stat>
        <Stat k="TIME">{formatTime(stats.timeMs)}</Stat>
        <Stat k="NODE">{compact(stats.nodes)}</Stat>
        <Stat k="SPEED">{stats.speed === null ? "—" : `${compact(stats.speed)}/s`}</Stat>
        <Stat k="BEST" wide>
          {bestMove ? label(bestMove, size) : "—"}
        </Stat>
      </dl>

      {pvs.length > 0 && (
        <ol className="pvlist">
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

      <p className="panel__hint">
        분석을 켜 두면 수를 두거나 물러도 새 국면을 이어 읽습니다. 정지는 <strong>조각 경계</strong>
        에서 듣습니다 — 단일 스레드 빌드에서는 최대 한 조각(기본 500ms) 뒤에 멈춥니다.
      </p>
    </section>
  );
}

function Stat({ k, wide, children }: { k: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={"stat" + (wide ? " stat--wide" : "")}>
      <dt className="stat__key">{k}</dt>
      <dd className="stat__value tnum">{children}</dd>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  idle: "꺼짐",
  starting: "기동 중",
  ready: "대기",
  searching: "탐색 중",
  error: "오류",
};

function formatEval(stats: Pick<SearchStats, "evalCp" | "mate">): string {
  if (stats.mate !== null && stats.mate !== 0) {
    return stats.mate > 0 ? `+M${stats.mate}` : `-M${-stats.mate}`;
  }
  return stats.evalCp === null ? "—" : String(stats.evalCp);
}

/** 노드·속도는 자릿수만 읽히면 된다 — 1,234,567 보다 1.23M 이 흘깃 읽힌다. */
function compact(n: number | null): string {
  if (n === null) return "—";
  if (n < 1e3) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`;
  return `${(n / 1e9).toFixed(2)}G`;
}

function formatTime(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const pvRate = (winRate: number | null): string => {
  if (winRate === null) return "—";
  const v = winRate > 1 ? winRate : winRate * 100;
  return `${Math.round(v)}%`;
};
