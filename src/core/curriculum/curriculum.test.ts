import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { move, type Move } from "../model/move";
import { addMove, setMark, type JosekiNode, type JosekiTree } from "../joseki/tree";
import { auditCurriculum, errorsOf, missingEnglish, nameMismatches } from "./audit";
import {
  addCourse,
  addLesson,
  duplicateLesson,
  emptyFile,
  idProblem,
  lessonFromTree,
  lessonOf,
  moveCourse,
  moveLesson,
  moveLessonTo,
  nextVersion,
  removeLesson,
  updateLesson,
} from "./edit";
import { formatCurriculum } from "./format";
import {
  CURRICULUM_FORMAT,
  cleanCurriculum,
  findLesson,
  fromJoseki,
  hasEnglish,
  resolveNode,
  textOf,
  withLang,
  type CurriculumFile,
  type CurriculumNode,
  type Lesson,
} from "./schema";
import { lessonUrl } from "./link";
import { answer, expected, learnerCount, scoreOf, showHint, startQuiz } from "./quiz";

/** 공식 정석 커리큘럼 — 스키마 · 검증 · 퀴즈 판정 · 스튜디오 고치기 · 검사, 그리고 **배포 파일 그 자체**. */

const shippedText = readFileSync(
  new URL("../../../public/joseki/curriculum.json", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const shipped = JSON.parse(shippedText) as unknown;

const leaf = (m: Move, extra: Partial<JosekiNode> = {}): JosekiNode => ({
  move: m,
  comment: "",
  children: [],
  ...extra,
});

/** 흑 h8 → 백 h9 → 흑 g9 (주) / h10 (!? 다른 좋은 수) / l12 (?? 나쁜 수, 응징 m1) / j9 (함정). */
const tree: JosekiNode = {
  move: null,
  comment: "root",
  children: [
    {
      ...leaf(move(7, 7)),
      children: [
        {
          ...leaf(move(7, 6)),
          children: [
            leaf(move(6, 6), { comment: "main" }),
            leaf(move(7, 5), { mark: "!?", comment: "alt" }),
            { ...leaf(move(11, 3), { mark: "??", comment: "bad" }), children: [leaf(move(0, 0))] },
            leaf(move(8, 6), { role: "trap", comment: "trap" }),
          ],
        },
      ],
    },
  ],
};

describe("배포 파일 public/joseki/curriculum.json", () => {
  it("검증을 문제 없이 통과한다", () => {
    const r = cleanCurriculum(shipped);
    expect(r).not.toBeNull();
    expect(r!.problems).toEqual([]);
    expect(r!.file.courses.length).toBeGreaterThan(0);
    for (const c of r!.file.courses) expect(c.lessons.length).toBeGreaterThan(0);
  });

  it("해설이 말하는 26주형 이름(D1..I13)이 그 마디까지의 수순과 맞는다", () => {
    const r = nameMismatches(cleanCurriculum(shipped)!.file);
    expect(r.issues).toEqual([]);
    expect(r.checked).toBeGreaterThan(0);
  });

  it("모든 해설에 영어가 있다(영어 화면에 한글이 새지 않게)", () => {
    expect(missingEnglish(cleanCurriculum(shipped)!.file)).toEqual([]);
  });

  it("스튜디오 검사에 오류가 없다(스튜디오 · publish 와 같은 함수)", () => {
    expect(errorsOf(auditCurriculum(cleanCurriculum(shipped)!.file))).toEqual([]);
  });

  it("배포 글꼴 그대로다(스튜디오 · publish 가 쓴 것과 바이트가 같다)", () => {
    expect(formatCurriculum(shipped)).toBe(shippedText);
  });
});

describe("검증", () => {
  it("형식이 다르면 null", () => {
    expect(cleanCurriculum({ format: "x", schema: 1 })).toBeNull();
    expect(cleanCurriculum(null)).toBeNull();
  });

  it("판 밖 · 겹친 수 · 모르는 기호 · 겹친 id 는 버리고 까닭을 남긴다", () => {
    const r = cleanCurriculum({
      format: CURRICULUM_FORMAT,
      schema: 1,
      version: "t",
      courses: [
        {
          id: "c1",
          title: "c",
          level: "beginner",
          summary: "",
          lessons: [
            {
              id: "l1",
              title: "l",
              summary: "",
              quiz: { side: "black" },
              root: {
                comment: "",
                children: [
                  { move: { x: 7, y: 7 }, comment: "", mark: "!!!", children: [] },
                  { move: { x: 7, y: 7 }, comment: "", children: [] },
                  { move: { x: 99, y: 0 }, comment: "", children: [] },
                ],
              },
            },
            {
              id: "l1",
              title: "dup",
              summary: "",
              quiz: { side: "black" },
              root: { children: [] },
            },
          ],
        },
        { id: "Bad Id", title: "x", lessons: [] },
      ],
    })!;
    expect(r.file.courses).toHaveLength(1);
    expect(r.file.courses[0]!.lessons).toHaveLength(1);
    expect(r.file.courses[0]!.lessons[0]!.root.children).toHaveLength(1);
    expect(r.problems.length).toBeGreaterThanOrEqual(4);
  });

  it("학습자가 둘 수가 없는 레슨은 버린다", () => {
    const r = cleanCurriculum({
      format: CURRICULUM_FORMAT,
      schema: 1,
      courses: [
        {
          id: "c",
          lessons: [
            {
              id: "w",
              quiz: { side: "white" },
              root: { children: [{ move: { x: 7, y: 7 }, children: [] }] },
            },
          ],
        },
      ],
    })!;
    expect(r.file.courses[0]!.lessons).toHaveLength(0);
  });

  it("두 언어 글: 영어가 없으면 한국어", () => {
    expect(textOf({ ko: "가", en: "a" }, "en")).toBe("a");
    expect(textOf({ ko: "가" }, "en")).toBe("가");
    expect(textOf("x", "ko")).toBe("x");
    const n = resolveNode({ move: null, comment: { ko: "가", en: "a" }, children: [] }, "en");
    expect(n.comment).toBe("a");
  });
});

describe("퀴즈", () => {
  it("흑이면 뿌리에서 시작하고 상대 수는 저절로 둔다", () => {
    let s = startQuiz(tree, "black");
    expect(s.path).toEqual([]);
    expect(s.total).toBe(2);
    s = answer(tree, s, move(7, 7));
    expect(s.feedback.kind).toBe("correct");
    expect(s.path).toEqual([0, 0]); // 백 h9 를 저절로
    s = answer(tree, s, move(6, 6));
    expect(s.done).toBe(true);
    expect(scoreOf(s)).toBe(100);
  });

  it("백이면 흑의 첫 수를 저절로 두고 시작한다", () => {
    const s = startQuiz(tree, "white");
    expect(s.path).toEqual([0]);
    expect(learnerCount(tree, "white")).toBe(1);
  });

  it("나쁜 수는 오답 — 해설과 응징 수를 주고 같은 자리에서 다시", () => {
    let s = answer(tree, startQuiz(tree, "black"), move(7, 7));
    s = answer(tree, s, move(11, 3));
    expect(s.feedback).toMatchObject({ kind: "mistake", refute: move(0, 0) });
    expect(s.path).toEqual([0, 0]);
    expect(s.misses).toBe(1);
  });

  it("함정수도 오답이고, 트리에 없는 수는 «정석 밖»", () => {
    let s = answer(tree, startQuiz(tree, "black"), move(7, 7));
    s = answer(tree, s, move(8, 6));
    expect(s.feedback.kind).toBe("mistake");
    s = answer(tree, s, move(1, 1));
    expect(s.feedback.kind).toBe("outside");
  });

  it("두 번 틀리면 힌트가 열리고, 맞히면 첫 시도가 아니라 점수가 깎인다", () => {
    let s = answer(tree, startQuiz(tree, "black"), move(7, 7));
    s = answer(tree, s, move(1, 1));
    expect(s.hint).toBe(false);
    s = answer(tree, s, move(2, 2));
    expect(s.hint).toBe(true);
    expect(expected(tree, s)).toEqual(move(6, 6));
    s = answer(tree, s, move(6, 6));
    expect(s.done).toBe(true);
    expect(scoreOf(s)).toBe(50);
  });

  it("다른 좋은 수(!?)도 정답 — 그 갈래로 간다", () => {
    let s = answer(tree, startQuiz(tree, "black"), move(7, 7));
    s = answer(tree, s, move(7, 5));
    expect(s.feedback).toMatchObject({ kind: "correct", alternative: true });
    expect(s.done).toBe(true);
  });

  it("힌트 단추", () => {
    expect(showHint(startQuiz(tree, "black")).hint).toBe(true);
  });
});

describe("스튜디오 고치기(core/curriculum/edit.ts)", () => {
  const lesson = (id: string): Partial<Lesson> => ({ id, title: id, root: fromJoseki(tree) });
  const base = (): CurriculumFile => {
    let f = addCourse(emptyFile()).file;
    const c = f.courses[0]!.id;
    f = addLesson(f, c, lesson("a")).file;
    f = addLesson(f, c, lesson("b")).file;
    return f;
  };

  it("코스 · 레슨을 더하면 겹치지 않는 id 를 받는다", () => {
    let f = base();
    const c = f.courses[0]!.id;
    const r = addLesson(f, c, lesson("a"));
    expect(r.id).toBe("a-2");
    f = addCourse(r.file).file;
    expect(f.courses.map((x) => x.id)).toEqual(["new-course", "new-course-2"]);
  });

  it("레슨을 고른 레슨 뒤에 넣고, 차례를 바꾸고, 다른 코스로 옮긴다", () => {
    let f = base();
    const c = f.courses[0]!.id;
    f = addLesson(f, c, lesson("mid"), "a").file;
    expect(f.courses[0]!.lessons.map((l) => l.id)).toEqual(["a", "mid", "b"]);
    f = moveLesson(f, "b", -1);
    expect(f.courses[0]!.lessons.map((l) => l.id)).toEqual(["a", "b", "mid"]);
    const r = addCourse(f);
    f = moveLessonTo(r.file, "a", r.id);
    expect(lessonOf(f, "a")!.course.id).toBe(r.id);
    expect(f.courses[0]!.lessons.map((l) => l.id)).toEqual(["b", "mid"]);
    f = moveCourse(f, r.id, -1);
    expect(f.courses[0]!.id).toBe(r.id);
  });

  it("사본은 바로 뒤에, 새 id 로, 트리를 나눠 쓰지 않는다", () => {
    const r = duplicateLesson(base(), "a")!;
    expect(r.file.courses[0]!.lessons.map((l) => l.id)).toEqual(["a", "a-copy", "b"]);
    const copy = lessonOf(r.file, "a-copy")!.lesson;
    expect(copy.root).not.toBe(lessonOf(r.file, "a")!.lesson.root);
    expect(textOf(copy.title, "ko")).toBe("a 사본");
  });

  it("레슨 트리는 «내 정석»과 같은 함수로 고친다(두 언어 해설 마디)", () => {
    const f = base();
    const l = lessonOf(f, "a")!.lesson;
    const step = addMove(l.root, [0, 0], move(9, 9))!;
    const root = setMark(step.root, step.path, "?!");
    const g = updateLesson(f, "a", { root });
    const kids = lessonOf(g, "a")!.lesson.root.children[0]!.children[0]!.children;
    expect(kids.at(-1)).toMatchObject({ move: move(9, 9), mark: "?!", comment: "" });
    expect(lessonOf(f, "a")!.lesson.root).toBe(l.root); // 원본은 그대로
    expect(removeLesson(g, "a").courses[0]!.lessons.map((x) => x.id)).toEqual(["b"]);
  });

  it("두 언어 글: 한쪽만 바꾸고, 영어가 비면 한국어 글 하나로 접는다", () => {
    expect(withLang("가", "en", "a")).toEqual({ ko: "가", en: "a" });
    expect(withLang({ ko: "가", en: "a" }, "ko", "나")).toEqual({ ko: "나", en: "a" });
    expect(withLang({ ko: "가", en: "a" }, "en", "")).toBe("가");
    expect(hasEnglish("가")).toBe(false);
    expect(hasEnglish("")).toBe(true);
    expect(hasEnglish({ ko: "가", en: "a" })).toBe(true);
  });

  it("«내 정석»에서 레슨으로 — id 는 제목에서, 겹치면 번호", () => {
    const jt: JosekiTree = {
      id: "x",
      title: "Kagetsu basics",
      category: "",
      tags: [],
      boardSize: 15,
      rule: "renju",
      root: tree,
      createdAt: 0,
      updatedAt: 0,
      schema: 1,
    };
    expect(lessonFromTree(jt, new Set()).id).toBe("kagetsu-basics");
    expect(lessonFromTree(jt, new Set(["kagetsu-basics"])).id).toBe("kagetsu-basics-2");
    expect(lessonFromTree({ ...jt, title: "화월" }, new Set()).id).toBe("lesson");
  });

  it("id 규칙과 다음 버전", () => {
    expect(idProblem("Bad Id", "a", new Set())).not.toBeNull();
    expect(idProblem("b", "a", new Set(["a", "b"]))).not.toBeNull();
    expect(idProblem("a", "a", new Set(["a"]))).toBeNull();
    expect(nextVersion("2026.10.10", "2026.10.11")).toBe("2026.10.11");
    expect(nextVersion("2026.10.11", "2026.10.11")).toBe("2026.10.11.2");
    expect(nextVersion("2026.10.11.2", "2026.10.11")).toBe("2026.10.11.3");
    expect(nextVersion("2026.10.11-sample", "2026.10.11")).toBe("2026.10.11");
  });

  it("고친 파일은 검증을 문제 없이 통과한다(함정 · 기호 보존)", () => {
    const r = cleanCurriculum(JSON.parse(formatCurriculum(base())))!;
    expect(r.problems).toEqual([]);
    expect(findLesson(r.file, "b")).not.toBeNull();
    const kids = r.file.courses[0]!.lessons[0]!.root.children[0]!.children[0]!.children;
    expect(kids.map((k) => k.role ?? k.mark ?? "")).toEqual(["", "!?", "??", "trap"]);
  });
});

describe("검사(core/curriculum/audit.ts)", () => {
  const withLesson = (patch: Partial<Lesson>): CurriculumFile => {
    const c = addCourse(emptyFile());
    return addLesson(c.file, c.id, { id: "l", title: { ko: "레", en: "L" }, summary: "", ...patch })
      .file;
  };

  it("빈 커리큘럼 · 빈 코스 · 둘 수가 없는 레슨은 오류이고, 자리를 알려 준다", () => {
    expect(errorsOf(auditCurriculum(emptyFile()))).toHaveLength(1);
    const empty = addCourse(emptyFile()).file;
    expect(errorsOf(auditCurriculum(empty)).some((i) => i.course === "new-course")).toBe(true);
    const e = errorsOf(auditCurriculum(withLesson({})));
    expect(e.some((i) => i.lesson === "l" && /학습자/.test(i.text))).toBe(true);
  });

  it("26주형 이름이 틀리면 그 마디의 경로까지", () => {
    const wrong: CurriculumNode = {
      move: null,
      comment: "",
      children: [
        {
          move: move(7, 7),
          comment: "",
          children: [
            {
              move: move(7, 6),
              comment: "",
              children: [
                { move: move(6, 6), comment: { ko: "이것은 D1", en: "D1" }, children: [] },
              ],
            },
          ],
        },
      ],
    };
    const r = nameMismatches(withLesson({ root: wrong }));
    expect(r.checked).toBe(1);
    expect(r.issues[0]).toMatchObject({ lesson: "l", path: [0, 0, 0], vars: { a: "D1", b: "D4" } });
  });

  it("영어 없음은 오류, 배포본에서 사라지는 레슨은 경고", () => {
    const f = withLesson({ root: fromJoseki(tree) });
    const issues = auditCurriculum(f, cleanCurriculum(shipped)!.file);
    expect(errorsOf(issues).every((i) => /영어 없음/.test(i.text))).toBe(true);
    expect(missingEnglish(f).some((i) => i.path?.length === 0)).toBe(true); // 첫 해설 «root»
    const gone = issues.filter((i) => i.level === "warn" && i.vars?.id === "first-three-moves");
    expect(gone).toHaveLength(1);
  });

  it("주 변화에 나쁜 수가 있으면 경고", () => {
    const bad = setMark(fromJoseki(tree), [0], "??");
    const issues = auditCurriculum(withLesson({ root: bad }));
    expect(issues.some((i) => i.level === "warn" && i.path?.join(".") === "0")).toBe(true);
  });
});

describe("배포 글꼴(core/curriculum/format.ts)", () => {
  it("작은 객체는 한 줄, 열쇠 차례는 고정, 끝에 줄바꿈", () => {
    const out = formatCurriculum({
      courses: [],
      schema: 1,
      version: "v",
      format: CURRICULUM_FORMAT,
    });
    expect(out).toBe(
      '{\n  "format": "rapfiweb-curriculum",\n  "schema": 1,\n  "version": "v",\n  "courses": []\n}\n',
    );
    expect(formatCurriculum({ en: "a", ko: "가" })).toBe('{ "ko": "가", "en": "a" }\n');
    const node = formatCurriculum({ children: [], comment: "", move: { y: 1, x: 2 }, mark: "!" });
    expect(node.indexOf('"move"')).toBeLessThan(node.indexOf('"mark"'));
    expect(node).toContain('"move": { "x": 2, "y": 1 }');
  });
});

describe("레슨 링크", () => {
  it("배포 경로(base)와 학습 모드까지", () => {
    expect(lessonUrl("https://x.dev", "/", "first-three-moves", "browse")).toBe(
      "https://x.dev/joseki?lesson=first-three-moves",
    );
    expect(lessonUrl("https://x.dev", "/Zenyth-web/", "a-b", "learn")).toBe(
      "https://x.dev/Zenyth-web/joseki?lesson=a-b&mode=learn",
    );
  });
});
