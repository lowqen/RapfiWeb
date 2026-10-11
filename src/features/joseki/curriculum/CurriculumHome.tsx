import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { findLesson, textOf, type Level } from "../../../core/curriculum/schema";
import { useCurriculum } from "../../../data/curriculum";
import { msg, t, useLang } from "../../../i18n/i18n";
import { JosekiComment } from "../JosekiComment";
import { LessonView } from "./LessonView";

/**
 * 공식 정석 커리큘럼 — 코스 목록과 레슨(docs/공식-정석-설계.md §4). 모든 사용자에게 읽기 전용이다. 고치는
 * 길은 관리자의 내보내기(정석 편집기)와 저장소 커밋뿐이다.
 *
 * **열린 레슨은 주소가 정한다** — `/joseki?lesson=<id>`(학습으로 바로 열려면 `&mode=learn`). 그래서 레슨을
 * 링크로 주고받을 수 있고, 새로고침해도 그 레슨이며, 브라우저의 «뒤로»가 코스 목록으로 돌아간다.
 */

const LEVEL_LABEL: Record<Level, string> = {
  beginner: msg("입문"),
  intermediate: msg("중급"),
  advanced: msg("고급"),
};

export function CurriculumHome() {
  const lang = useLang((s) => s.lang);
  const status = useCurriculum((s) => s.status);
  const file = useCurriculum((s) => s.file);
  const error = useCurriculum((s) => s.error);
  const progress = useCurriculum((s) => s.progress);
  const [params, setParams] = useSearchParams();
  const open = params.get("lesson");
  const mode = params.get("mode") === "learn" ? "learn" : "browse";
  /** 레슨 열기 · 닫기는 기록에 남긴다(뒤로 = 목록). 모드 바꾸기는 기록을 늘리지 않는다. */
  const setOpen = (id: string | null) => setParams(id ? { lesson: id } : {});
  const setMode = (m: "browse" | "learn") =>
    open &&
    setParams(m === "learn" ? { lesson: open, mode: m } : { lesson: open }, { replace: true });

  useEffect(() => {
    void useCurriculum.getState().load();
  }, []);

  if (status !== "ready" || !file) {
    return (
      <div className="review joseki">
        <section className="panel" aria-busy={status === "loading" || undefined}>
          <h2 className="panel__title">{t("공식 커리큘럼")}</h2>
          <p className="panel__hint" role={error ? "alert" : undefined}>
            {error ? t(error) : t("커리큘럼을 받는 중입니다…")}
          </p>
          {error && (
            <div className="panel__actions">
              <button
                type="button"
                onClick={() => {
                  useCurriculum.setState({ status: "idle" });
                  void useCurriculum.getState().load();
                }}
              >
                {t("다시 시도")}
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  const found = open ? findLesson(file, open) : null;
  if (found) {
    const list = found.course.lessons;
    const at = list.findIndex((l) => l.id === found.lesson.id);
    const next = list[at + 1] ?? null;
    return (
      <LessonView
        key={found.lesson.id}
        course={found.course}
        lesson={found.lesson}
        next={next}
        mode={mode}
        onMode={setMode}
        onBack={() => setOpen(null)}
        onNext={() => next && setOpen(next.id)}
      />
    );
  }

  return (
    <div className="review joseki curriculum" data-k="curriculum">
      <section className="panel">
        <h2 className="panel__title">
          {t("공식 커리큘럼")}{" "}
          {file.version && <span className="panel__status tnum">{file.version}</span>}
        </h2>
        {open && (
          <p className="panel__hint" role="alert" data-k="lesson-missing">
            {t("레슨 «{id}» 을(를) 찾지 못했습니다. 아래 목록에서 고르세요.", { id: open })}
          </p>
        )}
        <p className="panel__hint">
          {t(
            "전문가가 차례를 정해 만든 오프닝 정석입니다. 살펴보기로 수순마다의 해설과 나쁜 수 · 함정의 갈래를 읽고, 학습으로 수순을 직접 맞히며 따라 둡니다. 진도는 이 브라우저에 남습니다.",
          )}
        </p>
      </section>
      {file.courses.length === 0 && (
        <section className="panel">
          <p className="panel__hint">{t("아직 실린 코스가 없습니다.")}</p>
        </section>
      )}
      {file.courses.map((c) => {
        const done = c.lessons.filter((l) => progress[l.id]).length;
        return (
          <section key={c.id} className="panel course" data-course={c.id}>
            <h3 className="panel__title">
              {textOf(c.title, lang)}{" "}
              <span className="course__level" data-level={c.level}>
                {t(LEVEL_LABEL[c.level])}
              </span>
              <span className="panel__status tnum">
                {t("{a}/{b} 레슨", { a: done, b: c.lessons.length })}
              </span>
            </h3>
            <JosekiComment text={textOf(c.summary, lang)} />
            <ol className="lessonlist">
              {c.lessons.map((l) => {
                const p = progress[l.id];
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      className="lessonlist__item"
                      data-lesson={l.id}
                      data-done={p ? "" : undefined}
                      onClick={() => setOpen(l.id)}
                    >
                      <span className="lessonlist__title">{textOf(l.title, lang)}</span>
                      <span className="lessonlist__meta">
                        {textOf(l.summary, lang)}
                        {p ? ` · ${t("최고 {n}점", { n: p.best })}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
