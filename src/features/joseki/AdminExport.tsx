import { useEffect, useState } from "react";
import { downloadBlob } from "../../app/download";
import {
  LEVELS,
  cleanCurriculum,
  emptyCurriculum,
  fromJoseki,
  textOf,
  upsertLesson,
  type Level,
} from "../../core/curriculum/schema";
import type { JosekiTree } from "../../core/joseki/tree";
import { useCurriculum } from "../../data/curriculum";
import { msg, t } from "../../i18n/i18n";

/**
 * 관리자 도구 — 열린 «내 정석»을 공식 커리큘럼의 레슨으로 넣은 `curriculum.json` 을 내려받는다.
 *
 * 지금 배포된 커리큘럼(앱이 받은 것)에 레슨을 넣거나 바꾼 **새 파일 전체**를 만든다. 관리자는 그 파일을
 * `public/joseki/curriculum.json` 에 두고 `pnpm test`(검증) 뒤 커밋한다(docs/공식-정석-관리.md).
 * 이 화면에서 배포되는 것은 없다.
 */

const LEVEL_LABEL: Record<Level, string> = {
  beginner: msg("입문"),
  intermediate: msg("중급"),
  advanced: msg("고급"),
};

/** 제목에서 id 후보 — 영문 · 숫자만 남기고, 없으면 정석 id 의 앞부분. */
function slug(s: string, fallback: string): string {
  const x = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return (
    x ||
    `lesson-${fallback
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 8)
      .toLowerCase()}`
  );
}

/** 판 이름 — 지금 지역 날짜(«2026.10.11»). */
const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
};

export function AdminExport({ tree, onClose }: { tree: JosekiTree; onClose: () => void }) {
  const file = useCurriculum((s) => s.file);
  useEffect(() => {
    void useCurriculum.getState().load();
  }, []);
  const courses = file?.courses ?? [];
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "new-course");
  const existing = courses.find((c) => c.id === courseId);
  const [courseTitle, setCourseTitle] = useState(existing ? textOf(existing.title, "ko") : "");
  const [level, setLevel] = useState<Level>(existing?.level ?? "beginner");
  const [lessonId, setLessonId] = useState(slug(tree.title, tree.id));
  const [title, setTitle] = useState(tree.title);
  const [summary, setSummary] = useState("");
  const [side, setSide] = useState<"black" | "white">("black");
  const [result, setResult] = useState<string | null>(null);

  const pickCourse = (id: string) => {
    setCourseId(id);
    const c = courses.find((x) => x.id === id);
    if (c) {
      setCourseTitle(textOf(c.title, "ko"));
      setLevel(c.level);
    }
  };

  // 커리큘럼이 이 화면보다 늦게 오면(처음 연 경우) 첫 코스를 고른다 — 빈 «새 코스»에 머물면 단추가 잠긴다.
  const firstCourse = courses[0]?.id;
  const [picked, setPicked] = useState(firstCourse !== undefined);
  useEffect(() => {
    if (picked || firstCourse === undefined) return;
    setPicked(true);
    pickCourse(firstCourse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstCourse, picked]);

  const build = () => {
    const base = file ?? emptyCurriculum();
    const meta = existing
      ? { id: existing.id, title: existing.title, level, summary: existing.summary }
      : { id: courseId, title: courseTitle, level, summary: "" };
    const lesson = { id: lessonId, title, summary, quiz: { side }, root: fromJoseki(tree.root) };
    const out = upsertLesson(base, meta, lesson, today());
    // 내려받기 전에 앱과 같은 검증을 거친다 — 배포 시험에서 걸릴 것을 여기서 미리 본다.
    const check = cleanCurriculum(JSON.parse(JSON.stringify(out)));
    if (!check) {
      setResult(t("검증 실패: 형식이 맞지 않습니다"));
      return;
    }
    downloadBlob("curriculum.json", JSON.stringify(out, null, 1), "application/json");
    setResult(
      check.problems.length === 0
        ? t("curriculum.json 을 내려받았습니다. public/joseki/ 에 두고 pnpm test 뒤 커밋하세요.")
        : t("내려받았지만 검증 경고가 {n}개 있습니다: {first}", {
            n: check.problems.length,
            first: check.problems[0] ?? "",
          }),
    );
  };

  const idOk = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const valid =
    idOk.test(courseId) && idOk.test(lessonId) && title.trim() && (existing || courseTitle.trim());

  return (
    <section
      className="panel adminexport"
      aria-labelledby="adminexport-title"
      data-k="admin-export"
    >
      <h3 id="adminexport-title" className="panel__title">
        {t("공식 커리큘럼으로 내보내기")}
      </h3>
      <p className="panel__hint">
        {t("이 정석을 레슨으로 넣은 커리큘럼 파일을 만듭니다. 배포는 저장소 커밋으로만 됩니다.")}
      </p>
      <label className="jfield">
        <span>{t("코스")}</span>
        <select
          value={existing ? courseId : "__new"}
          onChange={(e) => pickCourse(e.target.value === "__new" ? "new-course" : e.target.value)}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {textOf(c.title, "ko")} ({c.id})
            </option>
          ))}
          <option value="__new">{t("새 코스")}</option>
        </select>
      </label>
      {!existing && (
        <>
          <label className="jfield">
            <span>{t("코스 id")}</span>
            <input value={courseId} onChange={(e) => setCourseId(e.target.value.trim())} />
          </label>
          <label className="jfield">
            <span>{t("코스 제목")}</span>
            <input value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} />
          </label>
        </>
      )}
      <label className="jfield">
        <span>{t("수준")}</span>
        <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {t(LEVEL_LABEL[l])}
            </option>
          ))}
        </select>
      </label>
      <label className="jfield">
        <span>{t("레슨 id")}</span>
        <input value={lessonId} onChange={(e) => setLessonId(e.target.value.trim())} />
      </label>
      <label className="jfield">
        <span>{t("레슨 제목")}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="jfield">
        <span>{t("요약")}</span>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <label className="jfield">
        <span>{t("학습자")}</span>
        <select value={side} onChange={(e) => setSide(e.target.value as "black" | "white")}>
          <option value="black">{t("흑")}</option>
          <option value="white">{t("백")}</option>
        </select>
      </label>
      <div className="panel__actions">
        <button type="button" className="button--tonal" onClick={build} disabled={!valid}>
          {t("curriculum.json 내려받기")}
        </button>
        <button type="button" onClick={onClose}>
          {t("닫기")}
        </button>
      </div>
      {result && (
        <p className="panel__hint" role="status" data-k="admin-export-result">
          {result}
        </p>
      )}
    </section>
  );
}
