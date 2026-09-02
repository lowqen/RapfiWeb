import { useEngineStore } from "../../engine/engine-state";
import { useBoardStore } from "./boardStore";
import { label } from "../../core/model/move";
import { colorsForTag, DEFAULT_PALETTE } from "../../core/board/ladder";

/**
 * 분석 pane — W3 판.
 *
 * 여기 있는 숫자는 전부 **집계된 스냅샷**에서 온다. 원시 줄은 워커 안에서 파싱되고
 * 메인 스레드는 ~10Hz 스냅샷과 저주파 콘솔 배치만 받는다(계획서 §3).
 *
 * 실시간으로 바뀌는 숫자(깊이·노드·속도)는 **보간하지 않는다.** 초당 몇 번씩
 * 바뀌는 값을 애니메이션하는 것은 이미 지나간 값에 대한 거짓말이다(`Motion.kt` 규칙).
 * 대신 `tnum` 으로 폭만 고정해 줄이 흔들리지 않게 한다.
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

  const render = useBoardStore((s) => s.render);
  const placements = useBoardStore((s) => s.placements);
  const size = render.size;

  const { stats, pvs, bestMove } = snapshot;
  const searching = status === "searching";

  if (!caps.variant) {
    return (
      <section className="panel">
        <h2 className="panel__title">분석</h2>
        <p className="panel__hint">{caps.note}</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2 className="panel__title">
        분석 <span className="panel__badge" data-status={status} />
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

      {error && <p className="panel__error">{error}</p>}

      <dl className="kv">
        <dt>승률</dt>
        <dd className="tnum">{stats.winRatePct === null ? "—" : `${stats.winRatePct}%`}</dd>
        <dt>평가</dt>
        <dd className="tnum">{formatEval(stats)}</dd>
        <dt>깊이</dt>
        <dd className="tnum">
          {stats.depth || "—"}
          {stats.selDepth ? `-${stats.selDepth}` : ""}
        </dd>
        <dt>노드</dt>
        <dd className="tnum">{stats.nodes?.toLocaleString() ?? "—"}</dd>
        <dt>최선수</dt>
        <dd className="tnum">{bestMove ? label(bestMove, size) : "—"}</dd>
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
        정지는 <strong>조각 경계</strong>에서 듣습니다 — 단일 스레드 빌드에서는 탐색 중
        워커가 통째로 막히므로, 최대 한 조각(기본 500ms) 뒤에 멈춥니다.
      </p>
    </section>
  );
}

const STATUS_TEXT: Record<string, string> = {
  idle: "꺼짐",
  starting: "기동 중",
  ready: "대기",
  searching: "탐색 중",
  error: "오류",
};

function formatEval(stats: { evalCp: number | null; mate: number | null }): string {
  if (stats.mate !== null && stats.mate !== 0) {
    return stats.mate > 0 ? `+M${stats.mate}` : `-M${-stats.mate}`;
  }
  return stats.evalCp === null ? "—" : String(stats.evalCp);
}

const pvRate = (winRate: number | null): string => {
  if (winRate === null) return "—";
  const v = winRate > 1 ? winRate : winRate * 100;
  return `${Math.round(v)}%`;
};
