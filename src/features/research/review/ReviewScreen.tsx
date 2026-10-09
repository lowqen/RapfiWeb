import { useEffect, useMemo, useRef, useState } from "react";
import { DurationField, Segmented, Switch } from "../../../components/controls";
import { REVIEW_TIME_SPEC } from "../../../core/settings/duration";
import { PRESET_LABEL, type GradingPreset } from "../../../core/review/move-quality";
import { budgetLabel, dateStamp, fixed } from "../../../core/review/report";
import { GAME_FILE_ACCEPT } from "../../../core/model/game-file";
import { reportOf, useReviewStore } from "./reviewStore";
import { ReportView } from "./ReportView";
import { ProveSection } from "../prove/ProveSection";
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
 */

const SECONDS = [1, 2, 3, 5, 10, 30] as const;
const DEPTHS = [10, 12, 14, 16, 18, 22] as const;
const SECONDS_MS = SECONDS.map((sec) => sec * 1000);

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "대기",
  running: "진행 중",
  paused: "중단",
  done: "완료",
  failed: "실패",
};

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
      <section className="panel">
        <h2 className="panel__title">리뷰 설정</h2>
        <div className="review__row">
          <span className="review__label">예산</span>
          <Segmented
            label="리뷰 예산의 종류"
            value={budget.byDepth ? "depth" : "time"}
            options={[
              { value: "time", label: "시간" },
              { value: "depth", label: "깊이" },
            ]}
            onChange={(v) => s.setBudget({ byDepth: v === "depth" })}
            disabled={s.running}
          />
        </div>
        <div className="review__row">
          <span className="review__label">{budget.byDepth ? "국면당 깊이" : "국면당 시간"}</span>
          {budget.byDepth ? (
            <Segmented
              label="국면당 깊이"
              value={budget.depth}
              options={DEPTHS.map((d) => ({ value: d, label: String(d) }))}
              onChange={(depth) => s.setBudget({ depth })}
              disabled={s.running}
            />
          ) : (
            <div className="timepick">
              <Segmented
                label="국면당 시간(초)"
                value={budget.seconds}
                options={SECONDS.map((sec) => ({ value: sec, label: `${sec}초` }))}
                onChange={(seconds) => s.setBudget({ seconds })}
                disabled={s.running}
              />
              <DurationField
                label="국면당 시간"
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
          <span className="review__label">첫 5수 건너뛰기</span>
          <Switch
            label="첫 5수 건너뛰기"
            on={s.settings.skipOpening}
            onChange={s.setSkipOpening}
            disabled={s.running}
          />
        </div>
        <div className="review__row">
          <span className="review__label">등급 기준</span>
          <Segmented<GradingPreset>
            label="등급 기준"
            value={s.settings.preset}
            options={(["strict", "default", "lenient"] as const).map((v) => ({
              value: v,
              label: PRESET_LABEL[v],
            }))}
            onChange={s.setPreset}
          />
        </div>
        <p className="panel__hint">
          등급 기준은 언제든 바꿀 수 있습니다 — 저장된 리포트도 엔진 없이 다시 매깁니다.
          {budget.byDepth
            ? " 깊이 예산은 시간 한도가 없어 국면마다 오래 걸릴 수 있습니다."
            : ` ${budget.seconds}초 × 국면 수만큼 걸립니다.`}
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">
          실행
          <span className="panel__status">
            {s.running ? "리뷰 중 — 엔진을 리뷰가 쓰고 있습니다" : ""}
          </span>
        </h2>
        <div className="panel__actions">
          <button
            type="button"
            className="button--primary"
            disabled={s.running}
            onClick={() => void s.reviewBoard().then(say)}
          >
            지금 판 리뷰
          </button>
          <button type="button" disabled={s.running} onClick={() => fileInput.current?.click()}>
            기보 파일 추가
          </button>
          <button
            type="button"
            disabled={s.running || runnable === 0}
            onClick={() => void s.start().then(say)}
          >
            큐 시작{runnable ? ` (${runnable})` : ""}
          </button>
          {/* 리뷰 중에만 — 꺼진 위험 버튼이 늘 붙어 있으면 다크 테마에서 눌러야 할 것처럼 보인다. */}
          {s.running && (
            <button type="button" className="btn--danger" onClick={s.cancel}>
              멈추기
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
              {p.queueTotal > 1 ? `큐 ${p.queueIndex}/${p.queueTotal} · ` : ""}
              {p.name} · 국면 {Math.min(p.index, p.total)}/{p.total} · 수당 {budgetLabel(budget)}
            </p>
          </div>
        )}
        {s.log.length > 0 && (
          <details className="review__log">
            <summary>기록 ({s.log.length})</summary>
            <pre>{s.log.join("\n")}</pre>
          </details>
        )}
      </section>

      {s.jobs.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">
            분석 큐 <span className="panel__status">{s.jobs.length}개</span>
          </h2>
          <ul className="queue" aria-label="분석 큐">
            {s.jobs.map((j) => (
              <li key={j.id} className="queue__row" data-status={j.status}>
                <span className="queue__status">{STATUS_LABEL[j.status]}</span>
                <span className="queue__name">
                  {j.name} <span className="queue__meta tnum">{j.moves.length}수</span>
                </span>
                <span className="queue__result">{j.result}</span>
                {j.reviewId !== undefined && (
                  <button type="button" className="btn" onClick={() => s.select(j.reviewId!)}>
                    리포트
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  aria-label={`${j.name} 빼기`}
                  disabled={s.progress?.jobId === j.id}
                  onClick={() => void s.removeJob(j.id!)}
                >
                  빼기
                </button>
              </li>
            ))}
          </ul>
          {finished > 0 && (
            <div className="panel__actions">
              <button type="button" disabled={s.running} onClick={() => void s.clearFinished()}>
                끝난 것 걷어내기 ({finished})
              </button>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">
          리포트{" "}
          <span className="panel__status">{s.reviews.length ? `${s.reviews.length}건` : ""}</span>
        </h2>
        {s.reviews.length === 0 ? (
          <p className="panel__hint">
            아직 리포트가 없습니다. 「지금 판 리뷰」나 기보 파일로 큐를 돌리면 여기에 쌓입니다.
          </p>
        ) : (
          <>
            <ul className="reports" aria-label="리포트 목록">
              {s.reviews.map((r) => {
                const t = reportOf(r, s.settings.preset).tally;
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
                        {dateStamp(r.createdAt)} · {r.moves.length}수 · 흑{" "}
                        {t.blackAccuracy === null ? "—" : `${fixed(t.blackAccuracy, 1)}%`} / 백{" "}
                        {t.whiteAccuracy === null ? "—" : `${fixed(t.whiteAccuracy, 1)}%`}
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
