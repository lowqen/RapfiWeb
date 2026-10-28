import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auditCurriculum, errorsOf, type Issue } from "../../../core/curriculum/audit";
import { lessonOf, nameOf } from "../../../core/curriculum/edit";
import { formatCurriculum } from "../../../core/curriculum/format";
import { t } from "../../../i18n/i18n";
import { useAdminTools } from "../admin";
import { useJosekiStore } from "../josekiStore";
import { CourseEditor, LessonEditor } from "./StudioEditors";
import { IssueList } from "./StudioParts";
import { contentOf, useStudio } from "./studioStore";

/**
 * 커리큘럼 스튜디오(`/joseki/studio`) — 관리자가 공식 정석 커리큘럼 **전체**를 한 화면에서 만든다.
 *
 *   왼쪽: 코스 › 레슨 목록(차례 바꾸기 · 더하기, 오류가 있는 곳에 빨간 점).
 *   오른쪽: 고른 것의 편집기 — 코스(id · 두 언어 제목 · 수준 · 설명), 레슨(id · 제목 · 요약 · 학습자 색 · 코스
 *   옮기기 · 미리 보기)과 그 트리(판 · 갈래 · 평가 기호 · 쓰임 · 두 언어 해설). 아무것도 고르지 않으면 개요와
 *   검사 전체.
 *
 * 검사는 배포 시험과 같은 함수(`auditCurriculum`)라 여기서 오류가 0 이면 `pnpm test` 도 통과한다. 고친 것은 이
 * 브라우저에 초안으로 저절로 남고, 내보내기는 파일 내려받기 또는 (개발 서버면) 저장소에 바로 쓰기다. 배포 절차는
 * docs/공식-정석-관리.md.
 *
 * `?import=<내 정석 id>` 로 열면(정석 편집기의 «레슨으로 보내기») 어느 코스에 넣을지 묻는다.
 */
export function CurriculumStudio() {
  const admin = useAdminTools((a) => a.on);
  const setAdmin = useAdminTools((a) => a.set);
  const navigate = useNavigate();
  if (!admin) {
    return (
      <div className="studio">
        <section className="panel" data-k="studio-gate">
          <h2 className="panel__title">{t("커리큘럼 스튜디오")}</h2>
          <p className="panel__hint">
            {t(
              "공식 정석 커리큘럼을 만드는 관리자 도구입니다. 배포는 저장소에 쓸 권한이 있어야 합니다",
            )}
          </p>
          <div className="panel__actions">
            <button type="button" className="button--tonal" onClick={() => setAdmin(true)}>
              {t("관리자 도구 켜기")}
            </button>
            <button type="button" onClick={() => navigate("/joseki")}>
              {t("정석으로")}
            </button>
          </div>
        </section>
      </div>
    );
  }
  return <Studio />;
}

function Studio() {
  const s = useStudio();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    void useStudio.getState().load();
  }, []);

  // 되돌리기 · 다시 하기 단축키(입력칸 밖에서).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) useStudio.getState().redoEdit();
      else useStudio.getState().undoEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 창을 닫으려 할 때 초안이 아직 안 남았으면 묻는다.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (useStudio.getState().undo.length > 0 && useStudio.getState().draftAt === null)
        e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const issues = useMemo(() => auditCurriculum(s.file, s.published), [s.file, s.published]);
  const errors = errorsOf(issues).length;
  const warns = issues.length - errors;
  const changed = useMemo(
    () => !s.published || contentOf(s.published) !== contentOf(s.file),
    [s.file, s.published],
  );

  if (s.status !== "ready") {
    return (
      <div className="studio">
        <section className="panel" aria-busy="true">
          <p className="panel__hint">{t("커리큘럼을 받는 중입니다…")}</p>
        </section>
      </div>
    );
  }

  const sel = s.sel;
  const lessonSel = sel.kind === "lesson" ? lessonOf(s.file, sel.id) : null;
  const courseSel = sel.kind === "course" ? s.file.courses.find((c) => c.id === sel.id) : undefined;
  const lessonCount = s.file.courses.reduce((n, c) => n + c.lessons.length, 0);

  const openFile = async (f: File | undefined) => {
    if (!f) return;
    s.importFile(await f.text());
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <div className="studio" data-k="studio">
      <header className="panel studio__head">
        <div className="panel__actions">
          <button type="button" onClick={() => navigate("/joseki")}>
            ← {t("정석")}
          </button>
          <h1 className="studio__title">{t("커리큘럼 스튜디오")}</h1>
          <span className="panel__status tnum" data-k="studio-state">
            {changed ? t("배포본과 다름") : t("배포본과 같음")}
            {s.draftAt ? ` · ${t("초안 저장됨")}` : ""}
            {s.published ? ` · ${t("배포본 {v}", { v: s.published.version })}` : ""}
          </span>
        </div>
        <div className="panel__actions">
          <button type="button" onClick={s.undoEdit} disabled={s.undo.length === 0} title="Ctrl+Z">
            {t("되돌리기")}
          </button>
          <button
            type="button"
            onClick={s.redoEdit}
            disabled={s.redo.length === 0}
            title="Ctrl+Shift+Z"
          >
            {t("다시 하기")}
          </button>
          <button
            type="button"
            className={errors ? "studio__check is-bad" : "studio__check"}
            data-k="studio-check"
            onClick={() => s.select({ kind: "home" })}
          >
            {errors
              ? t("오류 {e} · 경고 {w}", { e: errors, w: warns })
              : warns
                ? t("오류 없음 · 경고 {w}", { w: warns })
                : t("오류 없음")}
          </button>
          {s.repo === "yes" && (
            <button
              type="button"
              className="button--primary"
              data-k="studio-save"
              disabled={!changed}
              onClick={() => void s.saveToRepo()}
              title={t("public/joseki/curriculum.json 에 씁니다(개발 서버)")}
            >
              {t("저장소에 저장")}
            </button>
          )}
          <button
            type="button"
            className={s.repo === "yes" ? undefined : "button--primary"}
            data-k="studio-download"
            onClick={s.download}
          >
            {t("curriculum.json 내려받기")}
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            {t("파일 열기")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => void openFile(e.target.files?.[0])}
          />
          {asking ? (
            <>
              <button
                type="button"
                className="btn--danger"
                onClick={() => {
                  setAsking(false);
                  s.resetToPublished();
                }}
              >
                {t("초안 버리기")}
              </button>
              <button type="button" autoFocus onClick={() => setAsking(false)}>
                {t("취소")}
              </button>
            </>
          ) : (
            <button type="button" disabled={!changed} onClick={() => setAsking(true)}>
              {t("배포본으로 되돌리기")}
            </button>
          )}
        </div>
        {s.notice && (
          <p className="panel__hint jnotice" role="status" data-k="studio-notice">
            {s.notice}{" "}
            <button type="button" className="linkish" onClick={() => s.tell(null)}>
              {t("닫기")}
            </button>
          </p>
        )}
        <ImportPrompt />
      </header>

      <div className="studio__body">
        <nav className="panel studio__outline" aria-label={t("코스와 레슨")}>
          <button
            type="button"
            className={`sout__home${sel.kind === "home" ? " is-sel" : ""}`}
            onClick={() => s.select({ kind: "home" })}
          >
            {t("개요")}{" "}
            <span className="tnum">
              {t("코스 {c} · 레슨 {l}", { c: s.file.courses.length, l: lessonCount })}
            </span>
          </button>
          <Outline issues={issues} />
          <div className="panel__actions">
            <button
              type="button"
              className="button--tonal"
              data-k="studio-new-course"
              onClick={s.newCourse}
            >
              {t("코스 추가")}
            </button>
          </div>
        </nav>

        <main className="studio__main">
          {lessonSel ? (
            <LessonEditor
              key={lessonSel.lesson.id}
              lesson={lessonSel.lesson}
              issues={issues.filter((i) => i.lesson === lessonSel.lesson.id)}
            />
          ) : courseSel ? (
            <CourseEditor
              key={courseSel.id}
              course={courseSel}
              issues={issues.filter((i) => i.course === courseSel.id && !i.lesson)}
            />
          ) : (
            <Overview issues={issues} repo={s.repo === "yes"} />
          )}
        </main>
      </div>
    </div>
  );
}

/** 코스 › 레슨 목록. */
function Outline({ issues }: { issues: Issue[] }) {
  const s = useStudio();
  const bad = useMemo(() => {
    const m = new Set<string>();
    for (const i of issues)
      if (i.level === "error") {
        if (i.lesson) m.add(`l:${i.lesson}`);
        if (i.course) m.add(`c:${i.course}`);
      }
    return m;
  }, [issues]);
  const sel = s.sel;
  return (
    <ol className="sout" data-k="studio-outline">
      {s.file.courses.map((c) => (
        <li key={c.id} className="sout__course">
          <button
            type="button"
            className={`sout__row${sel.kind === "course" && sel.id === c.id ? " is-sel" : ""}`}
            data-course={c.id}
            data-bad={bad.has(`c:${c.id}`) || undefined}
            onClick={() => s.select({ kind: "course", id: c.id })}
          >
            <span className="sout__name">{nameOf(c)}</span>
            <span className="sout__meta tnum">{c.lessons.length}</span>
          </button>
          <ol className="sout__lessons">
            {c.lessons.map((l, i) => (
              <li key={l.id}>
                <button
                  type="button"
                  className={`sout__row sout__row--lesson${sel.kind === "lesson" && sel.id === l.id ? " is-sel" : ""}`}
                  data-lesson={l.id}
                  data-bad={bad.has(`l:${l.id}`) || undefined}
                  onClick={() => s.select({ kind: "lesson", id: l.id })}
                >
                  <span className="sout__num tnum">{i + 1}.</span>
                  <span className="sout__name">{nameOf(l)}</span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="textbtn" onClick={() => s.newLesson(c.id)}>
                + {t("레슨")}
              </button>
            </li>
          </ol>
        </li>
      ))}
    </ol>
  );
}

/** 개요 — 검사 전체와 배포 길잡이. */
function Overview({ issues, repo }: { issues: Issue[]; repo: boolean }) {
  const s = useStudio();
  const out = s.outgoing();
  const bytes = useMemo(() => new Blob([formatCurriculum(out)]).size, [out]);
  return (
    <div className="studio__editor" data-k="studio-home">
      <section className="panel">
        <h2 className="panel__title">{t("검사")}</h2>
        <IssueList issues={issues} empty={t("오류도 경고도 없습니다. 배포해도 됩니다")} />
      </section>
      <section className="panel">
        <h2 className="panel__title">{t("배포")}</h2>
        <p className="panel__hint tnum">
          {t("다음 버전 {v} · {kb}KB", {
            v: out.version,
            kb: Math.max(1, Math.round(bytes / 1024)),
          })}
        </p>
        <ol className="studio__steps">
          {repo ? (
            <li>{t("«저장소에 저장»을 누르면 public/joseki/curriculum.json 에 씁니다")}</li>
          ) : (
            <li>
              {t(
                "«curriculum.json 내려받기»로 파일을 받습니다(이 브라우저의 초안은 그대로 남습니다)",
              )}
            </li>
          )}
          <li>
            {repo
              ? t("터미널에서 pnpm curriculum:publish 를 실행합니다")
              : t("저장소에서 pnpm curriculum:publish <받은 파일> 을 실행합니다")}
          </li>
          <li>
            {t(
              "검사 · 시험을 통과하면 커밋 · push 되고, 몇 분 뒤 웹과 Zenyth 앱이 새 커리큘럼을 받습니다",
            )}
          </li>
        </ol>
        {!repo && (
          <p className="panel__hint">
            {t("pnpm studio 로 띄우면 이 화면에서 저장소 파일에 바로 씁니다")}
          </p>
        )}
      </section>
    </div>
  );
}

/** `?import=<내 정석 id>` — 그 정석을 어느 코스의 레슨으로 넣을지. */
function ImportPrompt() {
  const [params, setParams] = useSearchParams();
  const id = params.get("import");
  const list = useJosekiStore((x) => x.list);
  const loaded = useJosekiStore((x) => x.loaded);
  const courses = useStudio((x) => x.file.courses);
  const importTree = useStudio((x) => x.importTree);
  const newCourse = useStudio((x) => x.newCourse);
  const [course, setCourse] = useState("");
  useEffect(() => {
    if (id && !loaded) void useJosekiStore.getState().load();
  }, [id, loaded]);
  if (!id) return null;
  const tree = list.find((x) => x.id === id);
  const done = () => setParams({}, { replace: true });
  if (!tree) {
    return loaded ? (
      <p className="panel__hint" role="alert">
        {t("가져올 정석을 찾지 못했습니다")}{" "}
        <button type="button" className="linkish" onClick={done}>
          {t("닫기")}
        </button>
      </p>
    ) : null;
  }
  const target = course || courses[0]?.id || "";
  return (
    <div className="studio__import" data-k="studio-import">
      <span>{t("«{title}» 을(를) 레슨으로 넣을 코스", { title: tree.title })}</span>
      {courses.length ? (
        <select value={target} onChange={(e) => setCourse(e.target.value)} aria-label={t("코스")}>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {nameOf(c)}
            </option>
          ))}
        </select>
      ) : (
        <button type="button" onClick={newCourse}>
          {t("코스 추가")}
        </button>
      )}
      <button
        type="button"
        className="button--tonal"
        disabled={!target}
        onClick={() => {
          importTree(tree, target);
          done();
        }}
      >
        {t("넣기")}
      </button>
      <button type="button" onClick={done}>
        {t("취소")}
      </button>
    </div>
  );
}
