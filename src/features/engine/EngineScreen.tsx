import { useEffect, useRef, useState } from "react";
import { useEngineStore } from "../../engine/engine-state";
import { useSettingsStore } from "../settings/settingsStore";
import { localized, msg, t } from "../../i18n/i18n";

/**
 * 엔진 화면 — 엔진 상태와 piskvork 콘솔.
 *
 * 콘솔이 보드 옆 칸에 있을 때는 늘 접혀 있었다. 늘 보는 것이 아니라 이상할 때
 * 여는 창이라서다. 여기서는 화면 하나를 다 쓴다 — 엔진이 무엇을 받고 무엇을
 * 말했는지 좇으려고 온 사람에게 40줄은 모자라다.
 */

/** 화면에 그리는 줄 수. 전체(최대 5,000줄)는 `__rapfiConsole()` 로 꺼낸다. */
const VISIBLE_LINES = 400;

/** 가중치를 어디서 얻었나 — 캐시면 이번 기동에 20MB 를 받지 않았다. */
const WEIGHTS_SOURCE: Readonly<Record<"cache" | "network" | "glue", string>> = localized({
  cache: msg("캐시(해시 확인)"),
  network: msg("내려받음(해시 확인)"),
  glue: msg("글루가 받음"),
});

const STATUS_TEXT: Readonly<Record<string, string>> = localized({
  idle: msg("꺼짐"),
  starting: msg("기동 중"),
  ready: msg("대기"),
  searching: msg("탐색 중"),
  error: msg("오류"),
});

export function EngineScreen() {
  const status = useEngineStore((s) => s.status);
  const caps = useEngineStore((s) => s.capabilities);
  const error = useEngineStore((s) => s.error);
  const analyzing = useEngineStore((s) => s.analyzing);
  const start = useEngineStore((s) => s.start);
  const terminate = useEngineStore((s) => s.terminate);
  const send = useEngineStore((s) => s.send);
  const lines = useEngineStore((s) => s.console);
  const clearConsole = useEngineStore((s) => s.clearConsole);
  const engine = useEngineStore((s) => s.engine);
  const applied = useEngineStore((s) => s.appliedThreads);
  const hashMb = useSettingsStore((s) => s.hashMb);
  const style = useSettingsStore((s) => s.style);

  return (
    <div className="enginescreen">
      <section className="panel" aria-busy={status === "starting"}>
        <h2 className="panel__title">
          {t("엔진")} <span className="panel__badge" data-status={status} />
          <span className="panel__status">{STATUS_TEXT[status]}</span>
        </h2>
        <dl className="kv">
          <dt>{t("변형")}</dt>
          <dd className="tnum" data-k="variant">
            {engine.variant ??
              (caps.variant ? t("{v} (뜨기 전)", { v: caps.variant }) : t("실행 불가"))}
          </dd>
          <dt>{t("스레드")}</dt>
          <dd className="tnum" data-k="threads">
            {applied ?? t("없음")}
            {engine.variant ? ` · ${engine.threaded ? t("멀티스레드") : t("단일 스레드")}` : ""}
          </dd>
          <dt>{t("가중치")}</dt>
          <dd className="tnum" data-k="weights">
            {engine.weightsSource === null
              ? t("없음")
              : `${WEIGHTS_SOURCE[engine.weightsSource]} · ${engine.weightsMs ?? 0}ms`}
          </dd>
          <dt>{t("예열")}</dt>
          <dd className="tnum" data-k="warmup">
            {engine.warmupMs === null ? t("없음") : `${engine.warmupMs}ms`}
          </dd>
          <dt>{t("해시")}</dt>
          <dd className="tnum">{hashMb} MB</dd>
          <dt>{t("스타일")}</dt>
          <dd className="tnum">{style}</dd>
          <dt>{t("분석")}</dt>
          <dd>{analyzing ? t("켜짐: 국면을 따라 읽는 중") : t("꺼짐")}</dd>
        </dl>
        {!caps.variant && caps.note && <p className="panel__hint">{caps.note}</p>}
        {engine.fallbackReason && (
          <p className="panel__hint">{t("물러섬: {why}", { why: engine.fallbackReason })}</p>
        )}
        {!engine.variant && caps.threadsNote && caps.variant && (
          <p className="panel__hint">{caps.threadsNote}</p>
        )}
        {error && <p className="panel__error">{error}</p>}
        <div className="panel__actions">
          {status === "idle" || status === "error" ? (
            <button type="button" onClick={() => void start()} disabled={!caps.variant}>
              {t("엔진 시작")}
            </button>
          ) : null}
          <button type="button" onClick={terminate} disabled={status === "idle"}>
            {t("종료")}
          </button>
          {/* 한 번 쓰는 동작이라 설정 목록이 아니라 엔진 곁에 둔다. 탐색 중에 보내면
              읽던 표를 발밑에서 비우게 되므로 대기 중일 때만. */}
          <button
            type="button"
            onClick={() => send({ kind: "raw", line: "YXHASHCLEAR" })}
            disabled={status !== "ready"}
            title={t("YXHASHCLEAR: 치환표를 지금 한 번 비웁니다")}
          >
            {t("해시 비우기")}
          </button>
        </div>
      </section>

      <section className="panel enginescreen__console">
        <h2 className="panel__title">
          {t("콘솔")}
          <span className="panel__status tnum">
            {t("{n}줄", { n: lines.length.toLocaleString() })}
          </span>
          <button
            type="button"
            className="panel__link"
            onClick={clearConsole}
            disabled={lines.length === 0}
          >
            {t("지우기")}
          </button>
        </h2>
        <ConsoleView lines={lines} />
      </section>
    </div>
  );
}

/**
 * 원시 줄 그대로. 줄바꿈하지 않고 가로로 스크롤한다 — 접히면 프로토콜을 눈으로
 * 좇을 수 없게 된다. 맨 아래를 보고 있을 때만 새 줄을 따라 내려간다 — 위로 올려
 * 읽는 중에 끌려 내려가면 읽을 수가 없다.
 */
function ConsoleView({ lines }: { lines: readonly string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);

  if (lines.length === 0) {
    return <p className="panel__hint">{t("엔진이 아직 아무 말도 하지 않았습니다.")}</p>;
  }
  return (
    <pre
      ref={ref}
      className="console console--full"
      onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
      }}
    >
      {lines.slice(-VISIBLE_LINES).join("\n")}
    </pre>
  );
}
