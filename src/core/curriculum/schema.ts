import { DEFAULT_SIZE, inBoard, moveKey, type Move } from "../model/move";
import {
  MARKS,
  ROLES,
  type JosekiMark,
  type JosekiNode,
  type JosekiRole,
  type TreeNode,
} from "../joseki/tree";

/**
 * 공식 정석 커리큘럼 — 관리자가 만들어 저장소의 정적 자산(`public/joseki/curriculum.json`)으로 싣고,
 * 모든 사용자가 읽기 전용으로 배운다. 설계는 `docs/공식-정석-설계.md`.
 *
 * 마디는 «내 정석»의 `JosekiNode` 와 같은 모양이다 — 다른 것은 해설이 두 언어를 받을 수 있다는 것뿐
 * (`Text`). 그래서 화면은 언어를 고른 뒤 `JosekiNode` 로 바꿔(`resolveNode`) 트리 · 판 · 마크다운을 그대로 쓴다.
 *
 * 검증은 «내 정석» 가져오기와 같은 규칙이다: 판 밖 · 겹친 수 · 모르는 기호는 그 가지째 버리고, 글은
 * 문자열만 길이 상한까지. 배포 파일은 단위 시험이 매번 검증한다(`curriculum.test.ts`).
 */

export const CURRICULUM_FORMAT = "rapfiweb-curriculum";

/** 두 언어 글 — 영어가 없으면 한국어로 보인다. */
export type Text = string | { ko: string; en?: string };

export type Level = "beginner" | "intermediate" | "advanced";
export const LEVELS: readonly Level[] = ["beginner", "intermediate", "advanced"];

/** 마디 — 읽기 · 고치기는 «내 정석»과 같은 함수를 쓴다(`TreeNode`). */
export interface CurriculumNode extends TreeNode<CurriculumNode> {
  comment: Text;
}

export interface Lesson {
  id: string;
  title: Text;
  summary: Text;
  /** 학습 모드에서 학습자가 맡는 색. */
  quiz: { side: "black" | "white" };
  root: CurriculumNode;
}

export interface Course {
  id: string;
  title: Text;
  level: Level;
  summary: Text;
  lessons: Lesson[];
}

export interface CurriculumFile {
  format: typeof CURRICULUM_FORMAT;
  schema: 1;
  version: string;
  courses: Course[];
}

export const MAX_COMMENT = 20_000;
const MAX_TITLE = 200;
const MAX_SUMMARY = 4_000;
const MAX_COURSES = 100;
const MAX_LESSONS = 200;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * 한 언어의 글만 바꾼 새 글. 영어가 비면 한국어 글 하나(`string`)로 접는다 — 파일이 «영어 없음»을 그대로
 * 말하게(시험과 스튜디오의 검사가 그것을 짚는다).
 */
export function withLang(x: Text | undefined, lang: "ko" | "en", value: string): Text {
  const ko = lang === "ko" ? value : textOf(x, "ko");
  const en = lang === "en" ? value : typeof x === "object" ? (x.en ?? "") : "";
  return en ? { ko, en } : ko;
}

/** 영어 글이 따로 있는가(한국어가 비었으면 물을 것이 없다 — 참). */
export function hasEnglish(x: Text | undefined): boolean {
  if (!textOf(x, "ko")) return true;
  return typeof x === "object" && !!x.en;
}

/** 지금 언어의 글. */
export function textOf(x: Text | undefined, lang: "ko" | "en"): string {
  if (x === undefined) return "";
  if (typeof x === "string") return x;
  return (lang === "en" ? x.en : undefined) || x.ko;
}

/** 주 변화(맨 앞 자식만 따라간 수순) — 코스 · 레슨 카드의 썸네일이 이 국면을 그린다. */
export function mainLine(root: CurriculumNode): Move[] {
  const out: Move[] = [];
  for (let n = root.children[0]; n; n = n.children[0]) if (n.move) out.push(n.move);
  return out;
}

/** 언어를 고른 `JosekiNode` — 트리 · 판 · 마크다운 화면이 그대로 받는다. */
export function resolveNode(n: CurriculumNode, lang: "ko" | "en"): JosekiNode {
  const out: JosekiNode = {
    move: n.move,
    comment: textOf(n.comment, lang),
    children: n.children.map((c) => resolveNode(c, lang)),
  };
  if (n.mark) out.mark = n.mark;
  if (n.role) out.role = n.role;
  return out;
}

// ── 검증 ─────────────────────────────────────────────────────────────

export interface CleanResult {
  file: CurriculumFile;
  /** 버린 것들(가지 · 레슨 · 코스)의 까닭 — 시험과 관리자 내보내기가 보여 준다. */
  problems: string[];
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

function cleanText(v: unknown, max: number): Text {
  if (typeof v === "string") return v.slice(0, max);
  if (v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    const ko = str(r.ko, max);
    const en = str(r.en, max);
    return en ? { ko, en } : ko;
  }
  return "";
}

function cleanNode(
  raw: unknown,
  line: Set<number>,
  size: number,
  where: string,
  problems: string[],
  depth: number,
): CurriculumNode {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: CurriculumNode = {
    move: null,
    comment: cleanText(r.comment, MAX_COMMENT),
    children: [],
  };
  if (typeof r.mark === "string") {
    if ((MARKS as readonly string[]).includes(r.mark)) out.mark = r.mark as JosekiMark;
    else problems.push(`${where}: 모르는 평가 기호 «${r.mark}»`);
  }
  if (typeof r.role === "string") {
    if ((ROLES as readonly string[]).includes(r.role)) out.role = r.role as JosekiRole;
    else problems.push(`${where}: 모르는 갈래 쓰임 «${r.role}»`);
  }
  const kids = Array.isArray(r.children) ? r.children : [];
  if (depth >= size * size) return out;
  for (const k of kids) {
    const kr = (k ?? {}) as Record<string, unknown>;
    const mv = kr.move as { x?: unknown; y?: unknown } | null | undefined;
    const m: Move | null =
      mv && Number.isInteger(mv.x) && Number.isInteger(mv.y)
        ? { x: mv.x as number, y: mv.y as number }
        : null;
    if (!m || !inBoard(m, size)) {
      problems.push(`${where}: 판 밖이거나 좌표가 아닌 수 — 그 가지를 버림`);
      continue;
    }
    const key = moveKey(m, size);
    if (line.has(key) || out.children.some((c) => c.move!.x === m.x && c.move!.y === m.y)) {
      problems.push(`${where}: 겹친 수 (${m.x},${m.y}) — 그 가지를 버림`);
      continue;
    }
    line.add(key);
    const child = cleanNode(k, line, size, `${where}>${m.x},${m.y}`, problems, depth + 1);
    line.delete(key);
    out.children.push({ ...child, move: m });
  }
  return out;
}

/** 주 변화에서 학습자가 둘 수의 개수 — 0 이면 학습할 것이 없는 레슨이다. */
export function learnerMoves(root: CurriculumNode, side: "black" | "white"): number {
  let n = root;
  let ply = 0;
  let count = 0;
  while (n.children[0]) {
    if ((ply % 2 === 0) === (side === "black")) count++;
    n = n.children[0];
    ply++;
  }
  return count;
}

/** 받은 JSON 을 검증하며 옮긴다. 형식부터 아니면 null. */
export function cleanCurriculum(raw: unknown): CleanResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.format !== CURRICULUM_FORMAT || r.schema !== 1) return null;
  const problems: string[] = [];
  const seenCourse = new Set<string>();
  const seenLesson = new Set<string>();
  const courses: Course[] = [];
  const rawCourses = Array.isArray(r.courses) ? r.courses.slice(0, MAX_COURSES) : [];
  for (const rc of rawCourses) {
    const c = (rc ?? {}) as Record<string, unknown>;
    const id = str(c.id, 64);
    if (!ID.test(id) || seenCourse.has(id)) {
      problems.push(`코스 «${id}»: id 가 없거나 겹침 — 버림`);
      continue;
    }
    seenCourse.add(id);
    const level: Level = (LEVELS as readonly string[]).includes(c.level as string)
      ? (c.level as Level)
      : "beginner";
    const lessons: Lesson[] = [];
    const rawLessons = Array.isArray(c.lessons) ? c.lessons.slice(0, MAX_LESSONS) : [];
    for (const rl of rawLessons) {
      const l = (rl ?? {}) as Record<string, unknown>;
      const lid = str(l.id, 64);
      if (!ID.test(lid) || seenLesson.has(lid)) {
        problems.push(`레슨 «${lid}»(${id}): id 가 없거나 겹침 — 버림`);
        continue;
      }
      const q = (l.quiz ?? {}) as Record<string, unknown>;
      const side = q.side === "white" ? "white" : "black";
      const root = cleanNode(l.root, new Set(), DEFAULT_SIZE, lid, problems, 0);
      if (learnerMoves(root, side) === 0) {
        problems.push(`레슨 «${lid}»: 학습자(${side})가 둘 수가 주 변화에 없음 — 버림`);
        continue;
      }
      seenLesson.add(lid);
      lessons.push({
        id: lid,
        title: cleanText(l.title, MAX_TITLE),
        summary: cleanText(l.summary, MAX_SUMMARY),
        quiz: { side },
        root,
      });
    }
    courses.push({
      id,
      title: cleanText(c.title, MAX_TITLE),
      level,
      summary: cleanText(c.summary, MAX_SUMMARY),
      lessons,
    });
  }
  return {
    file: {
      format: CURRICULUM_FORMAT,
      schema: 1,
      version: str(r.version, 40),
      courses,
    },
    problems,
  };
}

/** 레슨 찾기. */
export function findLesson(
  file: CurriculumFile,
  lessonId: string,
): { course: Course; lesson: Lesson } | null {
  for (const course of file.courses) {
    const lesson = course.lessons.find((l) => l.id === lessonId);
    if (lesson) return { course, lesson };
  }
  return null;
}

// ── «내 정석»에서 ────────────────────────────────────────────────────

/** «내 정석»의 트리를 레슨 마디로(해설은 한국어 글 그대로). */
export function fromJoseki(n: JosekiNode): CurriculumNode {
  const out: CurriculumNode = {
    move: n.move,
    comment: n.comment,
    children: n.children.map(fromJoseki),
  };
  if (n.mark) out.mark = n.mark;
  if (n.role) out.role = n.role;
  return out;
}
