import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  findLesson,
  mainLine,
  textOf,
  type Course,
  type Level,
} from "../../../core/curriculum/schema";
import { useCurriculum } from "../../../data/curriculum";
import { msg, t, useLang } from "../../../i18n/i18n";
import { MiniBoard } from "../../../components/MiniBoard";
import { Icon } from "../../../components/icons";
import { ICON } from "../../../components/icon-paths";
import { JosekiComment } from "../JosekiComment";
import { LessonView } from "./LessonView";

/**
 * 공식 정석 커리큘럼 — 코스 목록 · 코스 · 레슨 세 층(docs/공식-정석-설계.md §4). 모든 사용자에게 읽기
 * 전용이다. 고치는 길은 관리자의 내보내기(정석 편집기)와 저장소 커밋뿐이다.
 *
 * **배치는 체스닷컴 레슨을 따른다**(UI 개편): 맨 위는 그림 · 제목 · 한 줄의 머리와 썸네일 카드 목록,
 * 코스를 누르면 큰 썸네일 · 제목 · 설명 · 「시작」 단추의 머리와 레슨 카드 목록, 레슨은 판 + 오른쪽
 * 칸(`LessonView`). 글의 내용은 관리자가 채우므로 화면은 «구조»만 정한다 — 제목 · 요약 · 레벨 · 수순이
 * 비어 있어도 무너지지 않는다.
 *
 * **열린 층은 주소가 정한다** — 코스 `/joseki?course=<id>`, 레슨 `/joseki?lesson=<id>`(학습으로 바로
 * 열려면 `&mode=learn`). 링크로 주고받을 수 있고, 새로고침해도 그 자리이며, 브라우저 «뒤로»가 한 층
 * 위로 간다. 레슨의 ← 는 그 레슨의 코스로, 코스의 ← 는 목록으로.
 */

const LEVEL_LABEL: Record<Level, string> = {
  beginner: msg("입문"),
  intermediate: msg("중급"),
  advanced: msg("고급"),
};

/** 카드에 쓸 한 줄 — 마크다운 기호를 걷고 줄을 잇는다(두 줄 넘으면 CSS 가 자른다). */
const plain = (md: string) =>
  md
    .replace(/[*_`#>]/g, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();

export function CurriculumHome() {
  const lang = useLang((s) => s.lang);
  const status = useCurriculum((s) => s.status);
  const file = useCurriculum((s) => s.file);
  const error = useCurriculum((s) => s.error);
  const progress = useCurriculum((s) => s.progress);
  const [params, setParams] = useSearchParams();
  const open = params.get("lesson");
  const courseId = params.get("course");
  const mode = params.get("mode") === "learn" ? "learn" : "browse";
  /** 층을 옮기는 것은 기록에 남긴다(뒤로 = 한 층 위). 모드 바꾸기는 기록을 늘리지 않는다. */
  const openLesson = (id: string) => setParams({ lesson: id });
  const openCourse = (id: string | null) => setParams(id ? { course: id } : {});
  const setMode = (m: "browse" | "learn") =>
    open &&
    setParams(m === "learn" ? { lesson: open, mode: m } : { lesson: open }, { replace: true });

  useEffect(() => {
    void useCurriculum.getState().load();
  }, []);

  if (status !== "ready" || !file) {
    return (
      <div className="cur">
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
        index={at}
        next={next}
        mode={mode}
        onMode={setMode}
        onBack={() => openCourse(found.course.id)}
        onNext={() => next && openLesson(next.id)}
      />
    );
  }

  const course = courseId ? file.courses.find((c) => c.id === courseId) : undefined;
  if (course) {
    return (
      <CoursePage
        course={course}
        lang={lang}
        progress={progress}
        onBack={() => openCourse(null)}
        onLesson={openLesson}
      />
    );
  }

  return (
    <div className="cur" data-k="curriculum">
      <header className="cur__hero">
        <BooksArt />
        <h2 className="cur__title">{t("공식 커리큘럼")}</h2>
        <p className="cur__lead">{t("정해진 차례대로 오프닝 정석을 배웁니다")}</p>
      </header>
      {(open || courseId) && (
        <p className="cur__notice" role="alert" data-k="lesson-missing">
          {t("레슨 «{id}» 을(를) 찾지 못했습니다. 아래 목록에서 고르세요.", {
            id: open ?? courseId ?? "",
          })}
        </p>
      )}
      {file.courses.length === 0 ? (
        <p className="cur__empty">{t("아직 실린 코스가 없습니다.")}</p>
      ) : (
        <ul className="cards" aria-label={t("코스")}>
          {file.courses.map((c) => {
            const done = c.lessons.filter((l) => progress[l.id]).length;
            const first = c.lessons[0];
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className="card"
                  data-course={c.id}
                  onClick={() => openCourse(c.id)}
                >
                  <MiniBoard className="card__thumb" moves={first ? mainLine(first.root) : []} />
                  <span className="card__body">
                    <span className="card__title">{textOf(c.title, lang)}</span>
                    <span className="card__meta">
                      <span className="course__level" data-level={c.level}>
                        {t(LEVEL_LABEL[c.level])}
                      </span>
                      <span className="tnum">
                        {t("{a}/{b} 레슨", { a: done, b: c.lessons.length })}
                      </span>
                    </span>
                    <span className="card__text">{plain(textOf(c.summary, lang))}</span>
                  </span>
                  <Icon d={ICON.next} className="icon card__chev" />
                  <Meter done={done} total={c.lessons.length} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 코스 한 장 — 체스닷컴의 코스 머리(큰 그림 · 제목 · 설명 · 「시작」)와 레슨 카드 목록. */
function CoursePage({
  course,
  lang,
  progress,
  onBack,
  onLesson,
}: {
  course: Course;
  lang: "ko" | "en";
  progress: Readonly<Record<string, { best: number } | undefined>>;
  onBack: () => void;
  onLesson: (id: string) => void;
}) {
  const lessons = course.lessons;
  const done = lessons.filter((l) => progress[l.id]).length;
  // 「시작」은 아직 안 한 첫 레슨으로 — 다 했으면 첫 레슨부터 다시.
  const target = lessons.find((l) => !progress[l.id]) ?? lessons[0];
  const cta =
    done === 0 ? t("시작") : done < lessons.length ? t("이어서 배우기") : t("처음부터 다시");
  return (
    <div className="cur cur--course" data-k="course" data-course={course.id}>
      <nav className="cur__bar">
        <button
          type="button"
          className="iconbtn"
          aria-label={t("커리큘럼으로 돌아가기")}
          onClick={onBack}
        >
          <Icon d={ICON.back} />
        </button>
        <span className="cur__crumb">{t("공식 커리큘럼")}</span>
      </nav>

      <header className="coursehero">
        <div className="coursehero__art">
          <MiniBoard moves={target ? mainLine(target.root) : []} />
        </div>
        <div className="coursehero__text">
          <div className="coursehero__top">
            <h2 className="coursehero__title">{textOf(course.title, lang)}</h2>
            {target && (
              <button
                type="button"
                className="cta"
                data-k="course-start"
                onClick={() => onLesson(target.id)}
              >
                {cta}
              </button>
            )}
          </div>
          <p className="card__meta">
            <span className="course__level" data-level={course.level}>
              {t(LEVEL_LABEL[course.level])}
            </span>
            <span className="tnum">{t("{a}/{b} 레슨", { a: done, b: lessons.length })}</span>
          </p>
          <div className="coursehero__summary">
            <JosekiComment text={textOf(course.summary, lang)} />
          </div>
        </div>
      </header>

      <ol className="cards lessonlist" aria-label={t("레슨")}>
        {lessons.map((l, i) => {
          const p = progress[l.id];
          return (
            <li key={l.id}>
              <button
                type="button"
                className="card lessonlist__item"
                data-lesson={l.id}
                data-done={p ? "" : undefined}
                onClick={() => onLesson(l.id)}
              >
                <MiniBoard className="card__thumb" moves={mainLine(l.root)} />
                <span className="card__body">
                  <span className="card__title">
                    <span className="card__num tnum">{i + 1}.</span> {textOf(l.title, lang)}
                  </span>
                  <span className="card__text">{plain(textOf(l.summary, lang))}</span>
                  {p && (
                    <span className="card__done tnum">
                      <Icon d={ICON.check} className="icon card__check" />
                      {t("최고 {n}점", { n: p.best })}
                    </span>
                  )}
                </span>
                <Icon d={ICON.next} className="icon card__chev" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** 코스 진도 — 카드 밑의 가는 막대. 시작 전에는 그리지 않는다. */
function Meter({ done, total }: { done: number; total: number }) {
  if (done === 0 || total === 0) return null;
  return (
    <span className="card__meter" aria-hidden="true">
      <span style={{ width: `${(100 * done) / total}%` }} />
    </span>
  );
}

/**
 * 목록 머리의 그림 — 쌓인 책 세 권과 그 위의 흑백 돌(체스닷컴 오프닝 화면의 책 더미 자리). 색은 판 · 돌
 * 토큰이라 다크에서도 같은 결로 바뀐다. 장식이라 낭독기에는 숨긴다.
 */
function BooksArt() {
  return (
    <svg className="cur__art" viewBox="0 0 96 80" aria-hidden="true">
      <rect className="books__c" x="14" y="58" width="68" height="14" rx="3" />
      <rect className="books__page" x="18" y="62" width="60" height="3" rx="1" />
      <rect className="books__b" x="9" y="44" width="72" height="14" rx="3" />
      <rect className="books__page" x="13" y="48" width="64" height="3" rx="1" />
      <rect className="books__a" x="17" y="30" width="64" height="14" rx="3" />
      <rect className="books__page" x="21" y="34" width="56" height="3" rx="1" />
      <circle className="books__black" cx="40" cy="20" r="9" />
      <circle className="books__white" cx="59" cy="21" r="9" />
    </svg>
  );
}
