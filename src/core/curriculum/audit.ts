import { msg } from "../../i18n/i18n";
import { NODE_WARN, countNodes } from "../joseki/tree";
import type { Move } from "../model/move";
import { ABBR, classify } from "../opening/opening26";
import { ID_RE } from "./edit";
import {
  cleanCurriculum,
  hasEnglish,
  learnerMoves,
  textOf,
  type CurriculumFile,
  type CurriculumNode,
} from "./schema";

/**
 * 커리큘럼 검사 — 스튜디오의 «검사» 칸, `pnpm curriculum:publish`, 배포 파일 단위 시험이 **같은 함수**를 쓴다.
 * 그래서 스튜디오에서 오류가 0 이면 시험도 통과한다.
 *
 *   - 오류(error): 배포를 막는 것. 시험이 실패하거나(26주형 이름 · 영어 누락 · 빈 코스), 앱이 그 레슨을
 *     버리는 것(학습자가 둘 수가 없음 · 잘못된 id).
 *   - 경고(warn): 내도 되지만 알아야 하는 것. 배포본에 있던 레슨 · 코스가 사라지면 그 링크와 사용자의
 *     진도가 끊긴다(id 를 바꾼 것도 같다).
 *
 * 글은 사전 열쇠(`msg`)와 끼울 값이다 — 화면이 `t(text, vars)` 로 그린다.
 */

export interface Issue {
  level: "error" | "warn";
  text: string;
  vars?: Record<string, string | number>;
  /** 누르면 갈 곳. */
  course?: string;
  lesson?: string;
  path?: number[];
}

/** 해설이 말하는 26주형 약칭(D1..I13)과 그 마디까지의 수순이 다른 곳. `checked` 는 대조한 마디 수. */
export function nameMismatches(file: CurriculumFile): { checked: number; issues: Issue[] } {
  let checked = 0;
  const issues: Issue[] = [];
  for (const c of file.courses)
    for (const l of c.lessons) {
      const visit = (n: CurriculumNode, line: Move[], path: number[]) => {
        const ko = textOf(n.comment, "ko");
        const claimed = ko.match(/\b([DI]\d{1,2})\b/);
        // 이름은 3수부터 정해진다 — 그 앞의 해설이 «만들어 볼 주형»을 말하는 것은 대조하지 않는다.
        if (claimed && n.mark !== "??" && line.length >= 3) {
          checked++;
          const real = ABBR[classify(line)] ?? "?";
          if (real !== claimed[1])
            issues.push({
              level: "error",
              text: msg("해설은 {a} 라고 하지만 이 수순은 {b} 입니다"),
              vars: { a: claimed[1]!, b: real },
              course: c.id,
              lesson: l.id,
              path,
            });
        }
        n.children.forEach((k, i) => visit(k, [...line, k.move!], [...path, i]));
      };
      visit(l.root, [], []);
    }
  return { checked, issues };
}

/** 영어가 없는 글 — 영어 화면에 한글이 샌다. */
export function missingEnglish(file: CurriculumFile): Issue[] {
  const out: Issue[] = [];
  const need = (x: unknown, where: Omit<Issue, "level" | "text">, what: string) => {
    const missing = typeof x === "string" ? x.length > 0 : !hasEnglish(x as never);
    if (missing)
      out.push({ level: "error", text: msg("영어 없음: {what}"), vars: { what }, ...where });
  };
  for (const c of file.courses) {
    need(c.title, { course: c.id }, msg("코스 제목"));
    need(c.summary, { course: c.id }, msg("코스 설명"));
    for (const l of c.lessons) {
      const at = { course: c.id, lesson: l.id };
      need(l.title, at, msg("레슨 제목"));
      need(l.summary, at, msg("레슨 요약"));
      const visit = (n: CurriculumNode, path: number[]) => {
        if (textOf(n.comment, "ko"))
          need(n.comment, { ...at, path }, path.length ? msg("해설") : msg("첫 해설"));
        n.children.forEach((k, i) => visit(k, [...path, i]));
      };
      visit(l.root, []);
    }
  }
  return out;
}

export function auditCurriculum(file: CurriculumFile, published?: CurriculumFile | null): Issue[] {
  const out: Issue[] = [];
  if (file.courses.length === 0) out.push({ level: "error", text: msg("코스가 하나도 없습니다") });

  const seenCourse = new Set<string>();
  const seenLesson = new Set<string>();
  for (const c of file.courses) {
    if (!ID_RE.test(c.id) || seenCourse.has(c.id))
      out.push({
        level: "error",
        text: msg("코스 id «{id}» 가 잘못되었거나 겹칩니다"),
        vars: { id: c.id },
        course: c.id,
      });
    seenCourse.add(c.id);
    if (c.lessons.length === 0)
      out.push({ level: "error", text: msg("레슨이 없는 코스입니다"), course: c.id });
    if (!textOf(c.title, "ko"))
      out.push({ level: "warn", text: msg("코스 제목이 비었습니다"), course: c.id });
    for (const l of c.lessons) {
      const at = { course: c.id, lesson: l.id };
      if (!ID_RE.test(l.id) || seenLesson.has(l.id))
        out.push({
          level: "error",
          text: msg("레슨 id «{id}» 가 잘못되었거나 겹칩니다"),
          vars: { id: l.id },
          ...at,
        });
      seenLesson.add(l.id);
      if (learnerMoves(l.root, l.quiz.side) === 0)
        out.push({
          level: "error",
          text: msg("학습자가 둘 수가 주 변화에 없습니다(앱이 이 레슨을 버립니다)"),
          ...at,
        });
      if (!textOf(l.title, "ko"))
        out.push({ level: "warn", text: msg("레슨 제목이 비었습니다"), ...at });
      const n = countNodes(l.root);
      if (n >= NODE_WARN)
        out.push({
          level: "warn",
          text: msg("수가 {n}개입니다. 레슨을 나누면 가볍습니다"),
          vars: { n },
          ...at,
        });
      // 주 변화는 «추천 수»다 — 거기에 나쁜 수 기호가 있으면 학습이 그 수를 정답으로 가르친다.
      const path: number[] = [];
      for (let k = l.root.children[0]; k; k = k.children[0]) {
        path.push(0);
        if (k.mark === "?" || k.mark === "??" || k.role === "trap") {
          out.push({
            level: "warn",
            text: msg("주 변화에 나쁜 수나 함정수가 있습니다(학습이 정답으로 가르칩니다)"),
            ...at,
            path: [...path],
          });
          break;
        }
      }
    }
  }

  // 검증(앱이 받을 때와 같은 규칙) — id · 학습자 문제는 위에서 자리와 함께 말했다.
  const clean = cleanCurriculum(JSON.parse(JSON.stringify(file)));
  if (!clean) out.push({ level: "error", text: msg("형식이 맞지 않습니다") });
  else
    for (const p of clean.problems)
      if (!/id 가 없거나 겹침|학습자\(/.test(p)) out.push({ level: "error", text: p });

  out.push(...nameMismatches(file).issues);
  out.push(...missingEnglish(file));

  if (published) {
    const now = new Set(file.courses.flatMap((c) => c.lessons.map((l) => l.id)));
    for (const c of published.courses) {
      if (!seenCourse.has(c.id))
        out.push({
          level: "warn",
          text: msg("배포본의 코스 «{id}» 가 사라집니다(그 코스 링크가 끊깁니다)"),
          vars: { id: c.id },
        });
      for (const l of c.lessons)
        if (!now.has(l.id))
          out.push({
            level: "warn",
            text: msg("배포본의 레슨 «{id}» 가 사라집니다(링크와 사용자의 진도가 끊깁니다)"),
            vars: { id: l.id },
          });
    }
  }
  return out;
}

export const errorsOf = (issues: readonly Issue[]) => issues.filter((i) => i.level === "error");
