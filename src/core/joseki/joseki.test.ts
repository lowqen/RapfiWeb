import { describe, expect, it } from "vitest";
import { fromLabel, type Move } from "../model/move";
import { keyOf as posKeyOf } from "../model/pos-key";
import { EMPTY_TABLES } from "../opening/tables";
import { UNCLASSIFIED, classifyMoves, classifyTree, mainLine } from "./classify";
import { exportJson, exportPsq, importJson, indexKeys } from "./io";
import { parseInline, parseMarkdown, plainText } from "./markdown";
import { movesText, parseMoveText } from "./parse";
import {
  addLine,
  addMove,
  countNodes,
  illegal,
  mainLineFrom,
  moveSibling,
  movesTo,
  newTree,
  nodeAt,
  promoteLine,
  removeAt,
  setComment,
  setMark,
  stepForward,
} from "./tree";

const m = (s: string): Move => fromLabel(s)!;
const line = (s: string) => s.split(" ").map(m);

describe("트리", () => {
  it("수를 더하고, 이미 있는 수는 더하지 않고 그 자식으로 간다", () => {
    const t = newTree("t", 0);
    const a = addMove(t.root, [], m("H8"))!;
    expect(a.path).toEqual([0]);
    expect(a.added).toBe(true);
    const b = addMove(a.root, [], m("H8"))!;
    expect(b.added).toBe(false);
    expect(b.root).toBe(a.root);
    const c = addMove(b.root, [], m("I9"))!;
    expect(c.path).toEqual([1]);
    expect(countNodes(c.root)).toBe(2);
    // 원래 뿌리는 그대로(새 뿌리를 돌려준다)
    expect(t.root.children).toHaveLength(0);
  });

  it("판 밖 · 이미 둔 자리는 거절", () => {
    const r = addLine(newTree().root, line("H8 I9")).root;
    expect(addMove(r, [0, 0], m("H8"))).toBeNull();
    expect(illegal(r, [0, 0], m("H8"))).toMatch(/이미 돌/);
    expect(illegal(r, [0, 0], { x: 15, y: 0 })).toMatch(/판 밖/);
  });

  it("줄 잇기는 있는 마디를 따라간다", () => {
    let r = addLine(newTree().root, line("H8 I9 J10")).root;
    const res = addLine(r, line("H8 I9 G10 G9"));
    r = res.root;
    expect(res.added).toBe(2);
    expect(res.path).toEqual([0, 0, 1, 0]);
    expect(movesText(movesTo(r, res.path))).toBe("h8 i9 g10 g9");
    expect(addLine(r, line("H8 I9 H8")).stoppedAt).toBe(2);
  });

  it("주 변화로 올리기 · 형제 순서 · 지우기", () => {
    let r = addLine(newTree().root, line("H8 I9 J10")).root;
    r = addLine(r, line("H8 I9 G10")).root;
    r = addLine(r, line("H8 H9")).root;
    expect(movesText(movesTo(r, mainLineFrom(r)))).toBe("h8 i9 j10");
    const p = promoteLine(r, [0, 1]);
    expect(p.path).toEqual([0, 0]);
    expect(movesText(movesTo(p.root, mainLineFrom(p.root)))).toBe("h8 h9");
    const s = moveSibling(p.root, [0, 0], 1);
    expect(s.path).toEqual([0, 1]);
    expect(movesText(movesTo(s.root, mainLineFrom(s.root)))).toBe("h8 i9 j10");
    expect(moveSibling(s.root, [0, 1], 1).path).toEqual([0, 1]); // 끝에서는 그대로
    const d = removeAt(s.root, [0, 0, 0])!;
    expect(d.path).toEqual([0, 0]);
    expect(nodeAt(d.root, [0, 0])!.children.map((c) => c.move)).toEqual([m("G10")]);
    expect(removeAt(d.root, [])).toBeNull();
  });

  it("메모 · 기호", () => {
    let r = addLine(newTree().root, line("H8 I9")).root;
    r = setComment(r, [0, 0], "**좋다**");
    r = setMark(r, [0, 0], "!?");
    expect(nodeAt(r, [0, 0])).toMatchObject({ comment: "**좋다**", mark: "!?" });
    r = setMark(r, [0, 0], null);
    expect(nodeAt(r, [0, 0])!.mark).toBeUndefined();
    expect(stepForward(r, [0])).toEqual([0, 0]);
    expect(stepForward(r, [0, 0])).toEqual([0, 0]);
  });
});

describe("수순 글", () => {
  it("여러 모양을 받는다", () => {
    const want = "h8 i9 j10";
    for (const s of [
      "h8 i9 j10",
      "h8,i9,j10",
      "H8I9J10",
      "1. h8 2. i9 3. j10",
      "h8\ni9;\tj10",
      "1)h8 2)i9 3)J10",
    ]) {
      const r = parseMoveText(s);
      expect(r.ok && movesText(r.moves)).toBe(want);
    }
    const r = parseMoveText("a15b1o1");
    expect(r.ok && movesText(r.moves)).toBe("a15 b1 o1");
  });

  it("읽지 못한 토큰 · 판 밖 · 겹친 수는 그 자리를 말하며 실패", () => {
    expect(parseMoveText("h8 xx i9")).toEqual({
      ok: false,
      error: "«xx» 를 좌표로 읽지 못했습니다",
    });
    expect(parseMoveText("h8 p3")).toMatchObject({ ok: false });
    expect(parseMoveText("h8 i9 h8")).toEqual({ ok: false, error: "3수 H8 는 이미 둔 자리입니다" });
    expect(parseMoveText("  ")).toEqual({ ok: true, moves: [] });
  });
});

describe("분류", () => {
  it("이름 사슬 · 26주형 · 사용자 분류가 이긴다", () => {
    const c = classifyMoves(line("H8 I9 J10"), EMPTY_TABLES);
    expect(c.chain[0]).toBe("천원");
    expect(c.chain[1]).toBe("간접막기");
    expect(c.chain).toHaveLength(3);
    expect(c.group).toMatch(/^I\d+ /);
    expect(c.category).toBe(c.chain[2]);
    expect(classifyMoves(line("H8 I9 J10"), EMPTY_TABLES, "내 분류").category).toBe("내 분류");
    expect(classifyMoves([], EMPTY_TABLES).category).toBe(UNCLASSIFIED);
    expect(classifyMoves(line("A1 B2 C3"), EMPTY_TABLES).group).toBeNull();
  });

  it("문서는 주 변화로 분류한다", () => {
    const t = newTree();
    t.root = addLine(addLine(t.root, line("H8 H9 H10")).root, line("H8 I9 J10")).root;
    expect(movesText(mainLine(t))).toBe("h8 h9 h10");
    expect(classifyTree(t, EMPTY_TABLES).chain[1]).toBe("직접막기");
  });
});

describe("주고받기", () => {
  const sample = () => {
    const t = newTree("화월 연구", 5);
    t.tags = ["연습"];
    let r = addLine(t.root, line("H8 I9 J10 I10")).root;
    r = addLine(r, line("H8 I9 J8")).root;
    r = setComment(r, [0, 0, 0], "주석 `코드`");
    t.root = setMark(r, [0, 0], "!");
    return t;
  };

  it("JSON 왕복", () => {
    const t = sample();
    const r = importJson(exportJson([t], 9));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.trees).toEqual([t]);
      expect(r.dropped).toBe(0);
    }
  });

  it("정석 하나 · 배열도 받고, 둘 수 없는 수는 가지째 버린다", () => {
    const t = sample();
    const bad = JSON.parse(JSON.stringify(t));
    bad.root.children[0].children.push({
      move: { x: 7, y: 7 },
      comment: "",
      children: [{ move: { x: 1, y: 1 }, comment: "", children: [] }],
    }); // H8 위에 또 H8
    bad.root.children.push({ move: { x: 99, y: 0 }, comment: "", children: [] });
    bad.root.children[0].mark = "<script>";
    bad.root.children[0].comment = 42;
    const r = importJson(JSON.stringify(bad));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dropped).toBe(2);
      expect(countNodes(r.trees[0]!.root)).toBe(countNodes(t.root));
      expect(r.trees[0]!.root.children[0]!.mark).toBeUndefined();
      expect(r.trees[0]!.root.children[0]!.comment).toBe("");
    }
    expect(importJson(JSON.stringify([t, t])).ok).toBe(true);
    expect(importJson("nope")).toEqual({ ok: false, error: "JSON 이 아닙니다" });
    expect(importJson("{}")).toEqual({ ok: false, error: "정석이 들어 있지 않습니다" });
    expect(importJson(JSON.stringify({ ...t, boardSize: 19 }))).toMatchObject({ ok: false });
  });

  it(".psq 는 그 변화 하나", () => {
    const text = new TextDecoder().decode(exportPsq(sample(), [0, 0, 1]));
    // H8 I9 J8 — psq 는 «열+1, 행+1»(위에서부터)
    expect(text).toBe("Piskvorky 15x15, 0:0, 0\n8,8,0\n9,7,0\n10,8,0\n-1\n");
  });

  it("국면 색인은 대칭을 접는다", () => {
    const t = sample();
    const keys = indexKeys(t);
    expect(keys).toHaveLength(countNodes(t.root));
    // 뒤집은 판(H8 G9 F10)도 같은 키 — I9 J10 의 거울
    const mirrored = posKeyOf(line("H8 G9 F10"));
    expect(keys.find((k) => k.ply === 3 && k.key === mirrored)?.path).toEqual([0, 0, 0]);
  });
});

describe("마크다운", () => {
  it("굵게 · 기울임 · 코드 · 링크 · 좌표", () => {
    expect(parseInline("**굵게** *기울임* `h8` [링크](https://a.b) h8 로")).toEqual([
      { t: "b", c: [{ t: "text", v: "굵게" }] },
      { t: "text", v: " " },
      { t: "i", c: [{ t: "text", v: "기울임" }] },
      { t: "text", v: " " },
      { t: "code", v: "h8" },
      { t: "text", v: " " },
      { t: "link", href: "https://a.b", c: [{ t: "text", v: "링크" }] },
      { t: "text", v: " " },
      { t: "coord", label: "h8", move: m("H8") },
      { t: "text", v: " 로" },
    ]);
  });

  it("위험한 링크와 HTML 은 글자로 남는다", () => {
    const r = parseInline('[x](javascript:alert(1)) <img src=x onerror="y">');
    expect(r.every((n) => n.t === "text")).toBe(true);
    expect(r.map((n) => (n.t === "text" ? n.v : "")).join("")).toContain("<img");
  });

  it("좌표는 단어 안에서는 링크가 아니다", () => {
    expect(
      parseInline("abc8 p3 h16 a1")
        .filter((n) => n.t === "coord")
        .map((n) => n.t === "coord" && n.label),
    ).toEqual(["a1"]);
  });

  it("문단 · 목록 · 줄바꿈", () => {
    const b = parseMarkdown("첫 줄\n둘째 줄\n\n- 하나\n- 둘\n  이어짐\n1. 가\n2. 나");
    expect(b.map((x) => x.t)).toEqual(["p", "ul", "ol"]);
    expect(b[0]).toEqual({
      t: "p",
      c: [{ t: "text", v: "첫 줄" }, { t: "br" }, { t: "text", v: "둘째 줄" }],
    });
    expect(b[1]!.t === "ul" && b[1]!.items).toHaveLength(2);
  });

  it("검색용 맨글", () => {
    expect(plainText("**굵게** [링크](https://x)\n- 항목")).toBe("굵게 링크 항목");
  });
});
