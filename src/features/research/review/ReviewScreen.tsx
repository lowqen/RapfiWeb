import { useEffect, useMemo, useRef, useState } from "react";
import { DurationField, Segmented, Switch } from "../../../components/controls";
import { Disclosure } from "../../../components/Disclosure";
import { REVIEW_TIME_SPEC } from "../../../core/settings/duration";
import { PRESET_LABEL, type GradingPreset } from "../../../core/review/move-quality";
import { budgetLabel, dateStamp, fixed } from "../../../core/review/report";
import { GAME_FILE_ACCEPT } from "../../../core/model/game-file";
import { reportOf, useReviewStore } from "./reviewStore";
import { ReportView } from "./ReportView";
import { ProveSection } from "../prove/ProveSection";
import { localized, msg, t } from "../../../i18n/i18n";
import type { JobStatus } from "../../../data/db";

/**
 * 연구 ▸ 리뷰·증명 — **리뷰**(W6b). 앱 `ReviewScreen` 의 설정 · 실행 · 큐 · 리포트.
 *
 * 리뷰는 국면마다 엔진에 `YXNBEST 2` 를 걸어 승률 · 최선수 · 최선과 차선의 차를 남기고,
 * 판정기가 그것으로 수마다 등급을 매긴다(데스크톱 4단계 분류기). 도는 동안 엔진은 리뷰의
 * 것이다 — 분석과 대국의 엔진 착수는 기다린다. 국면 하나를 끝낼 때마다 체크포인트를
 * 남기므로, 멈추거나 탭을 닫아도 다음에 그 자리부터 잇는다.
 *
 * 아래의 **증명**(W6d, `../prove/ProveSection`)은 같은 엔진 자물쇠를 쓴다 — 둘은 겹쳐 돌지 않는다.
 *
 * **배치(UI 개편).** 행동 카드(「지금 판 리뷰」)가 맨 위이고 예산 · 등급 기준은 그 안에 접혀 한 줄
 * 요약으로 남는다 — 예전에는 설정 카드가 맨 위라 처음 온 사람이 «무엇을 눌러야 하나»를 찾아 내려가야
 * 했다. 증명은 맨 아래의 접힌 카드다.
 */

const SECONDS = [1, 2, 3, 5, 10, 30] as const;
const DEPTHS = [10, 12, 14, 16, 18, 22] as const;
const SECONDS_MS = SECONDS.map((sec) => sec * 1000);

const STATUS_LABEL: Readonly<Record<JobStatus, string>> = localized({
  pending: msg("대기"),
  running: msg("진행 중"),
  paused: msg("중단"),
  done: msg("완료"),
  failed: msg("실패"),
});

export function ReviewScreen() {
  const s = useReviewStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void s.init();
    // init 은 한 번만 — 스토어가 스스로 막는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = s.reviews.find((r) => r.id === s.selectedId) ?? null;
  const report = useMemo(
    () => (selected ? reportOf(selected, s.settings.preset) : null),
    [selected, s.settings.preset],
  );
  const runnable = s.jobs.filter((j) => j.status === "pending" || j.status === "paused").length;
  const finished = s.jobs.filter((j) => j.status === "done" || j.status === "failed").length;
  const p = s.progress;
  const say = (why: string | null) => setNotice(why);

  const { budget } = s.settings;
  return (
    <div className="review">
      {/* 할 일이 맨 위 — 「지금 판 리뷰」 하나면 된다. 예산 · 등급 기준은 그 밑에 접혀 있다. */}
      <section className="panel" aria-busy={s.running} aria-labelledby="review-title">
        <h2 id="review-title" className="panel__title">
          {t("대국 리뷰")}
          <span className="panel__status">{s.running ? t("리뷰 중") : ""}</span>
        </h2>
        <p className="panel__lead">{t("엔진이 수마다 좋은 수와 실수를 가려 정확도를 매깁니다.")}</p>
        <div className="panel__actions">
          <button
            type="button"
            className="button--primary"
            disabled={s.running}
            onClick={() => void s.reviewBoard().then(say)}
          >
            {t("지금 판 리뷰")}
          </button>
          <button type="button" disabled={s.running} onClick={() => fileInput.current?.click()}>
            {t("기보 파일 추가")}
          </button>
          {/* 큐에 돌릴 것이 있을 때만 — 꺼진 단추가 늘 붙어 있으면 무엇을 먼저 해야 하는지 흐려진다. */}
          {runnable > 0 && (
            <button type="button" disabled={s.running} onClick={() => void s.start().then(say)}>
              {t("큐 시작")} ({runnable})
            </button>
          )}
          {/* 리뷰 중에만 — 꺼진 위험 버튼이 늘 붙어 있으면 다크 테마에서 눌러야 할 것처럼 보인다. */}
          {s.running && (
            <button type="button" className="btn--danger" onClick={s.cancel}>
              {t("멈추기")}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={GAME_FILE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = "";
              if (files.length) void s.addFiles(files);
            }}
          />
        </div>
        {notice && (
          <p className="panel__hint" role="status">
            {notice}
          </p>
        )}
        {p && (
          <div className="review__progress" role="status" aria-live="polite">
            <div className="review__bar">
              <span style={{ width: `${Math.min(100, (100 * p.index) / (p.total + 1))}%` }} />
            </div>
            <p className="tnum" data-k="review-progress">
              {p.queueTotal > 1
                ? `${t("큐 {i}/{n}", { i: p.queueIndex, n: p.queueTotal })} · `
                : ""}
              {p.name} · {t("국면 {i}/{n}", { i: Math.min(p.index, p.total), n: p.total })} ·{" "}
              {t("수당 {b}", { b: budgetLabel(budget) })}
            </p>
          </div>
        )}
        {s.log.length > 0 && (
          <details className="review__log">
            <summary>{t("기록 ({n})", { n: s.log.length })}</summary>
            <pre>{s.log.join("\n")}</pre>
          </details>
        )}
        <div className="panel__fold">
          <Disclosure
            id="review-settings"
            level={3}
            title={t("리뷰 설정")}
            summary={[
              budget.byDepth
                ? t("깊이 {n}", { n: budget.depth })
                : t("{n}초", { n: budget.seconds }),
              PRESET_LABEL[s.settings.preset],
              s.settings.skipOpening ? t("첫 5수 건너뜀") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <div className="review__row">
              <span className="review__label">{t("예산")}</span>
              <Segmented
                label={t("리뷰 예산의 종류")}
                value={budget.byDepth ? "depth" : "time"}
                options={[
                  { value: "time", label: t("시간") },
                  { value: "depth", label: t("깊이") },
                ]}
                onChange={(v) => s.setBudget({ byDepth: v === "depth" })}
                disabled={s.running}
              />
            </div>
            <div className="review__row">
              <span className="review__label">
                {budget.byDepth ? t("국면당 깊이") : t("국면당 시간")}
              </span>
              {budget.byDepth ? (
                <Segmented
                  label={t("국면당 깊이")}
                  value={budget.depth}
                  options={DEPTHS.map((d) => ({ value: d, label: String(d) }))}
                  onChange={(depth) => s.setBudget({ depth })}
                  disabled={s.running}
                />
              ) : (
                <div className="timepick">
                  <Segmented
                    label={t("국면당 시간(초)")}
                    value={budget.seconds}
                    options={SECONDS.map((sec) => ({ value: sec, label: t("{n}초", { n: sec }) }))}
                    onChange={(seconds) => s.setBudget({ seconds })}
                    disabled={s.running}
                  />
                  <DurationField
                    label={t("국면당 시간")}
                    valueMs={budget.seconds * 1000}
                    spec={REVIEW_TIME_SPEC}
                    presetsMs={SECONDS_MS}
                    onCommit={(ms) => s.setBudget({ seconds: ms / 1000 })}
                    disabled={s.running}
                  />
                </div>
              )}
            </div>
            <div className="review__row">
              <span className="review__label">{t("첫 5수 건너뛰기")}</span>
              <Switch
                label={t("첫 5수 건너뛰기")}
                on={s.settings.skipOpening}
                onChange={s.setSkipOpening}
                disabled={s.running}
              />
            </div>
            <div className="review__row">
              <span className="review__label">{t("등급 기준")}</span>
              <Segmented<GradingPreset>
                label={t("등급 기준")}
                value={s.settings.preset}
                options={(["strict", "default", "lenient"] as const).map((v) => ({
                  value: v,
                  label: PRESET_LABEL[v],
                }))}
                onChange={s.setPreset}
              />
            </div>
            <p className="panel__hint">
              {t("등급 기준은 언제든 바꿀 수 있습니다. 저장된 리포트도 엔진 없이 다시 매깁니다.")}{" "}
              {budget.byDepth
                ? t("깊이 예산은 시간 한도가 없어 국면마다 오래 걸릴 수 있습니다.")
                : t("{n}초 × 국면 수만큼 걸립니다.", { n: budget.seconds })}
            </p>
          </Disclosure>
        </div>
      </section>

      {s.jobs.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">
            {t("분석 큐")} <span className="panel__status">{t("{n}개", { n: s.jobs.length })}</span>
          </h2>
          <ul className="queue" aria-label={t("분석 큐")}>
            {s.jobs.map((j) => (
              <li key={j.id} className="queue__row" data-status={j.status}>
                <span className="queue__status">{STATUS_LABEL[j.status]}</span>
                <span className="queue__name">
                  {j.name}{" "}
                  <span className="queue__meta tnum">{t("{n}수", { n: j.moves.length })}</span>
                </span>
                <span className="queue__result">{j.result}</span>
                {j.reviewId !== undefined && (
                  <button type="button" className="btn" onClick={() => s.select(j.reviewId!)}>
                    {t("리포트")}
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  aria-label={t("{name} 빼기", { name: j.name })}
                  disabled={s.progress?.jobId === j.id}
                  onClick={() => void s.removeJob(j.id!)}
                >
                  {t("빼기")}
                </button>
              </li>
            ))}
          </ul>
          {finished > 0 && (
            <div className="panel__actions">
              <button type="button" disabled={s.running} onClick={() => void s.clearFinished()}>
                {t("끝난 것 걷어내기 ({n})", { n: finished })}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">
          {t("리포트")}{" "}
          <span className="panel__status">
            {s.reviews.length ? t("{n}건", { n: s.reviews.length }) : ""}
          </span>
        </h2>
        {s.reviews.length === 0 ? (
          <p className="panel__hint">{t("리뷰한 대국이 여기에 쌓입니다.")}</p>
        ) : (
          <>
            <ul className="reports" aria-label={t("리포트 목록")}>
              {s.reviews.map((r) => {
                const tally = reportOf(r, s.settings.preset).tally;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="reports__row"
                      aria-pressed={r.id === s.selectedId}
                      onClick={() => s.select(r.id!)}
                    >
                      <span className="reports__title">{r.title}</span>
                      <span className="reports__meta tnum">
                        {dateStamp(r.createdAt)} · {t("{n}수", { n: r.moves.length })} ·{" "}
                        {t("흑 {b} / 백 {w}", {
                          b:
                            tally.blackAccuracy === null
                              ? t("없음")
                              : `${fixed(tally.blackAccuracy, 1)}%`,
                          w:
                            tally.whiteAccuracy === null
                              ? t("없음")
                              : `${fixed(tally.whiteAccuracy, 1)}%`,
                        })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {report && selected && (
              <ReportView
                report={report}
                log={selected.log ?? []}
                onOpenOnBoard={s.openOnBoard}
                onDelete={() => void s.removeReview(selected.id!)}
              />
            )}
          </>
        )}
      </section>

      <ProveSection />
    </div>
  );
}
