import { msg } from "../../i18n/i18n";
import type { JosekiTree } from "../joseki/tree";
import { emptyNode } from "../joseki/tree";
import {
  CURRICULUM_FORMAT,
  fromJoseki,
  textOf,
  type Course,
  type CurriculumFile,
  type CurriculumNode,
  type Lesson,
} from "./schema";

/**
 * 커리큘럼 스튜디오의 고치기(관리자 도구, docs/공식-정석-관리.md) — 코스 · 레슨을 더하고 빼고 옮긴다.
 *
 * 모두 순수 함수이고 **새 파일을 돌려준다**(원본은 그대로). 스튜디오는 그 파일들을 되돌리기 칸에 쌓는다.
 * 레슨 안의 트리 고치기는 «내 정석»과 같은 `core/joseki/tree.ts` 의 함수를 쓴다(`TreeNode`).
 */

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** 글에서 id 후보 — 영문 소문자 · 숫자 · `-` 만 남긴다. 남는 것이 없으면 `fallback`. */
export function slug(s: string, fallback: string): string {
  const x = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return x || fallback;
}

/** `base` 가 이미 쓰였으면 `base-2`, `base-3` … */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  const b = ID_RE.test(base) ? base : "item";
  if (!taken.has(b)) return b;
  for (let i = 2; ; i++) {
    const c = `${b.slice(0, 60)}-${i}`;
    if (!taken.has(c)) return c;
  }
}

export const courseIds = (f: CurriculumFile) => new Set(f.courses.map((c) => c.id));
export const lessonIds = (f: CurriculumFile) =>
  new Set(f.courses.flatMap((c) => c.lessons.map((l) => l.id)));

/** 판 이름 · 버전 — 지역 날짜 «2026.10.11». */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** 다음 버전 — 오늘 처음이면 «2026.10.11», 같은 날 또 내면 «2026.10.11.2», «.3» … */
export function nextVersion(prev: string, day = today()): string {
  if (prev === day) return `${day}.2`;
  const m = prev.match(/^(\d{4}\.\d{2}\.\d{2})\.(\d+)$/);
  if (m && m[1] === day) return `${day}.${Number(m[2]) + 1}`;
  return day;
}

const swap = <T>(xs: readonly T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= xs.length) return xs.slice();
  const out = xs.slice();
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

// ── 코스 ─────────────────────────────────────────────────────────────

export function addCourse(
  f: CurriculumFile,
  title = "새 코스",
): { file: CurriculumFile; id: string } {
  const id = uniqueId("new-course", courseIds(f));
  const course: Course = { id, title, level: "beginner", summary: "", lessons: [] };
  return { file: { ...f, courses: [...f.courses, course] }, id };
}

export function updateCourse(
  f: CurriculumFile,
  id: string,
  patch: Partial<Omit<Course, "lessons">>,
): CurriculumFile {
  return { ...f, courses: f.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function removeCourse(f: CurriculumFile, id: string): CurriculumFile {
  return { ...f, courses: f.courses.filter((c) => c.id !== id) };
}

export function moveCourse(f: CurriculumFile, id: string, dir: -1 | 1): CurriculumFile {
  return {
    ...f,
    courses: swap(
      f.courses,
      f.courses.findIndex((c) => c.id === id),
      dir,
    ),
  };
}

// ── 레슨 ─────────────────────────────────────────────────────────────

/** 레슨과 그 코스. */
export function lessonOf(
  f: CurriculumFile,
  id: string,
): { course: Course; lesson: Lesson; index: number } | null {
  for (const course of f.courses) {
    const index = course.lessons.findIndex((l) => l.id === id);
    if (index >= 0) return { course, lesson: course.lessons[index]!, index };
  }
  return null;
}

function mapLessons(f: CurriculumFile, fn: (c: Course) => Lesson[]): CurriculumFile {
  return { ...f, courses: f.courses.map((c) => ({ ...c, lessons: fn(c) })) };
}

export const blankLesson = (id: string, title = "새 레슨"): Lesson => ({
  id,
  title,
  summary: "",
  quiz: { side: "black" },
  root: emptyNode() as CurriculumNode,
});

/** 코스 끝(또는 `after` 레슨 뒤)에 레슨을 넣는다. id 가 겹치면 새 id 를 준다. */
export function addLesson(
  f: CurriculumFile,
  courseId: string,
  lesson?: Partial<Lesson>,
  after?: string,
): { file: CurriculumFile; id: string } {
  const id = uniqueId(lesson?.id ?? "new-lesson", lessonIds(f));
  const full: Lesson = { ...blankLesson(id), ...lesson, id };
  const file = mapLessons(f, (c) => {
    if (c.id !== courseId) return c.lessons;
    const at = after ? c.lessons.findIndex((l) => l.id === after) : -1;
    if (at < 0) return [...c.lessons, full];
    return [...c.lessons.slice(0, at + 1), full, ...c.lessons.slice(at + 1)];
  });
  return { file, id };
}

export function updateLesson(
  f: CurriculumFile,
  id: string,
  patch: Partial<Lesson>,
): CurriculumFile {
  return mapLessons(f, (c) => c.lessons.map((l) => (l.id === id ? { ...l, ...patch } : l)));
}

export function removeLesson(f: CurriculumFile, id: string): CurriculumFile {
  return mapLessons(f, (c) => c.lessons.filter((l) => l.id !== id));
}

/** 코스 안에서 한 칸. */
export function moveLesson(f: CurriculumFile, id: string, dir: -1 | 1): CurriculumFile {
  return mapLessons(f, (c) => {
    const i = c.lessons.findIndex((l) => l.id === id);
    return i < 0 ? c.lessons : swap(c.lessons, i, dir);
  });
}

/** 다른 코스의 끝으로. */
export function moveLessonTo(f: CurriculumFile, id: string, courseId: string): CurriculumFile {
  const found = lessonOf(f, id);
  if (!found || found.course.id === courseId || !f.courses.some((c) => c.id === courseId)) return f;
  return mapLessons(f, (c) => {
    if (c.id === found.course.id) return c.lessons.filter((l) => l.id !== id);
    if (c.id === courseId) return [...c.lessons, found.lesson];
    return c.lessons;
  });
}

/** 바로 뒤에 사본(새 id · 제목 끝에 «사본»). */
export function duplicateLesson(
  f: CurriculumFile,
  id: string,
): { file: CurriculumFile; id: string } | null {
  const found = lessonOf(f, id);
  if (!found) return null;
  const { lesson } = found;
  const title =
    typeof lesson.title === "string"
      ? `${lesson.title} 사본`
      : { ...lesson.title, ko: `${lesson.title.ko} 사본` };
  return addLesson(
    f,
    found.course.id,
    { ...structuredClone(lesson), id: `${lesson.id}-copy`, title },
    lesson.id,
  );
}

/** «내 정석» 한 벌을 레슨으로(해설은 한국어 글 그대로). id 는 제목에서. */
export function lessonFromTree(tree: JosekiTree, taken: ReadonlySet<string>): Lesson {
  const id = uniqueId(slug(tree.title, "lesson"), taken);
  return {
    id,
    title: tree.title,
    summary: "",
    quiz: { side: "black" },
    root: fromJoseki(tree.root),
  };
}

/** id 를 바꿀 수 있나 — 꼴 · 겹침. 바꿀 수 있으면 null, 아니면 까닭(사전 열쇠). */
export function idProblem(
  next: string,
  current: string,
  taken: ReadonlySet<string>,
): string | null {
  if (!ID_RE.test(next)) return msg("영문 소문자, 숫자, 하이픈만 씁니다(64자까지)");
  if (next !== current && taken.has(next)) return msg("이미 쓰는 id 입니다");
  return null;
}

export const emptyFile = (version = ""): CurriculumFile => ({
  format: CURRICULUM_FORMAT,
  schema: 1,
  version,
  courses: [],
});

/** 목록에 쓸 이름(한국어, 비었으면 id). */
export const nameOf = (x: { id: string; title: Course["title"] }) => textOf(x.title, "ko") || x.id;
