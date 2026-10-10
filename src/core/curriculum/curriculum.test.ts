import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { move, type Move } from "../model/move";
import { ABBR, classify } from "../opening/opening26";
import {
  CURRICULUM_FORMAT,
  cleanCurriculum,
  emptyCurriculum,
  findLesson,
  fromJoseki,
  resolveNode,
  textOf,
  upsertLesson,
  type CurriculumNode,
  type Lesson,
} from "./schema";
import { answer, expected, learnerCount, scoreOf, showHint, startQuiz } from "./quiz";
import type { JosekiNode } from "../joseki/tree";

/** 공식 정석 커리큘럼 — 스키마 · 검증 · 퀴즈 판정 · 관리자 내보내기, 그리고 **배포 파일 그 자체**. */

const shipped = JSON.parse(
  readFileSync(new URL("../../../public/joseki/curriculum.json", import.meta.url), "utf8"),
) as unknown;

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
    const r = cleanCurriculum(shipped)!;
    let checked = 0;
    const visit = (n: CurriculumNode, line: Move[]) => {
      const ko = textOf(n.comment, "ko");
      const claimed = ko.match(/\b([DI]\d{1,2})\b/);
      // 이름은 3수부터 정해진다 — 그 앞의 해설이 «만들어 볼 주형»을 말하는 것은 대조하지 않는다.
      if (claimed && n.mark !== "??" && line.length >= 3) {
        expect(ABBR[classify(line)], `${line.length}수 «${ko.slice(0, 40)}»`).toBe(claimed[1]);
        checked++;
      }
      for (const c of n.children) visit(c, [...line, c.move!]);
    };
    for (const c of r.file.courses) for (const l of c.lessons) visit(l.root, []);
    expect(checked).toBeGreaterThan(0);
  });

  it("모든 해설에 영어가 있다(영어 화면에 한글이 새지 않게)", () => {
    const r = cleanCurriculum(shipped)!;
    const missing: string[] = [];
    const need = (x: unknown, where: string) => {
      if (typeof x === "string" ? x.length > 0 : !(x as { en?: string }).en) missing.push(where);
    };
    const visit = (n: CurriculumNode, where: string) => {
      if (textOf(n.comment, "ko")) need(n.comment, where);
      n.children.forEach((c, i) => visit(c, `${where}.${i}`));
    };
    for (const c of r.file.courses) {
      need(c.title, c.id);
      need(c.summary, `${c.id} summary`);
      for (const l of c.lessons) {
        need(l.title, l.id);
        need(l.summary, `${l.id} summary`);
        visit(l.root, l.id);
      }
    }
    expect(missing).toEqual([]);
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

describe("관리자 내보내기", () => {
  const lesson = (id: string): Lesson => ({
    id,
    title: id,
    summary: "",
    quiz: { side: "black" },
    root: fromJoseki(tree),
  });
  const meta = { id: "c", title: "C", level: "beginner" as const, summary: "" };

  it("레슨을 넣고, 같은 id 면 바꾸고, 다른 코스로 옮긴다", () => {
    let f = upsertLesson(emptyCurriculum(), meta, lesson("a"), "v1");
    f = upsertLesson(f, meta, lesson("b"), "v2");
    expect(f.courses[0]!.lessons.map((l) => l.id)).toEqual(["a", "b"]);
    f = upsertLesson(f, meta, { ...lesson("a"), title: "A2" }, "v3");
    expect(findLesson(f, "a")!.lesson.title).toBe("A2");
    f = upsertLesson(f, { ...meta, id: "d" }, lesson("a"), "v4");
    expect(findLesson(f, "a")!.course.id).toBe("d");
    expect(f.courses[0]!.lessons.map((l) => l.id)).toEqual(["b"]);
    expect(f.version).toBe("v4");
  });

  it("내보낸 파일은 검증을 문제 없이 통과한다(함정 · 기호 보존)", () => {
    const f = upsertLesson(emptyCurriculum(), meta, lesson("a"), "v");
    const r = cleanCurriculum(JSON.parse(JSON.stringify(f)))!;
    expect(r.problems).toEqual([]);
    const kids = r.file.courses[0]!.lessons[0]!.root.children[0]!.children[0]!.children;
    expect(kids.map((k) => k.role ?? k.mark ?? "")).toEqual(["", "!?", "??", "trap"]);
  });
});
