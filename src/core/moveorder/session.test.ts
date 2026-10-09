import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  MoveOrderSession,
  TOO_BIG,
  actualNext,
  breadcrumb,
  headline,
  note,
  openingLabel,
  orientation,
  type MoveOrderView,
} from "./session";
import { MO_MAX_STONES } from "./move-order";
import { fromLabel, type Move } from "../model/move";

const size = 15;
const line = (...ls: string[]): Move[] => ls.map((l) => fromLabel(l, size)!);
const cellsOf = (ms: Move[]) => ms.map((m) => m.y * size + m.x);

function build(ms: Move[], rules = DEFAULT_RULES) {
  const s = new MoveOrderSession();
  const r = s.build(cellsOf(ms), size, rules);
  if (r.kind !== "ok") throw new Error(r.kind);
  return { s, v: r.view };
}

describe("세션", () => {
  it("빈 판 · 너무 큰 판", () => {
    const s = new MoveOrderSession();
    expect(s.build([], size, DEFAULT_RULES).kind).toBe("empty");
    const many = Array.from({ length: 2 * MO_MAX_STONES + 2 }, (_, i) => i);
    expect(s.build(many, size, DEFAULT_RULES).kind).toBe("tooBig");
    expect(TOO_BIG).toContain(String(MO_MAX_STONES));
  });

  it("파고들기 · 되짚기 · 처음이 스냅샷으로 답한다", () => {
    const { s, v } = build(line("h8", "i9", "j10", "k11", "g7", "f6"));
    expect(v.prefix).toEqual([]);
    expect(v.children.reduce((a, c) => a + c.count, 0)).toBe(v.branch);
    const first = v.children[0]!.cell;
    const d = s.drill(first)!;
    expect(d.prefix).toEqual([first]);
    expect(s.drill(0)).toBeNull(); // a15 은 이 판의 돌이 아니다
    expect(s.back()!.prefix).toEqual([]);
    expect(s.back()).toBeNull();
    s.drill(first);
    expect(s.root()!.prefix).toEqual([]);
  });

  it("완성은 같은 돌의 합법 수순", () => {
    const ms = line("h8", "i9", "j10", "k11");
    const { s } = build(ms);
    const done = s.complete()!;
    expect(new Set(done.order)).toEqual(new Set(cellsOf(ms)));
  });

  it("2수 고정은 오프닝 규칙을 끄면 같이 꺼진다", () => {
    const ms = line("h8", "g9", "j10");
    expect(build(ms, { ...DEFAULT_RULES, symmetry: false }).v.total).toBe(0);
    expect(
      build(ms, { ...DEFAULT_RULES, symmetry: false, openingRule: false }).v.total,
    ).toBeGreaterThan(0);
  });
});

describe("문구", () => {
  it("머리줄 — 수 · 배치 · 넘침 · 불가", () => {
    expect(
      headline(build(line("h8", "i9", "j10", "k11"), { ...DEFAULT_RULES, symmetry: false }).v),
    ).toBe("흑 2 · 백 2 — 수순 1가지");
    expect(
      headline(build(line("h8", "i9", "j10", "k11"), { ...DEFAULT_RULES, move2Fix: false }).v),
    ).toBe("흑 2 · 백 2 — 수순 4가지 (배치 4종)");
    expect(
      headline(build(line("h8", "i9", "k11"), { ...DEFAULT_RULES, symmetry: false }).v),
    ).toMatch(/만들 수 없는 배치$/);
    const over: MoveOrderView = { ...build(line("h8")).v, overflow: true, total: 0 };
    expect(headline(over)).toMatch(/정확한 집계 생략$/);
  });

  it("이유 — 어느 규칙이 물었나", () => {
    const rules = { ...DEFAULT_RULES, symmetry: false };
    const noTengen = line("a1", "b2");
    expect(note(build(noTengen, rules).v, noTengen, size, rules)).toMatch(/천원에 흑돌이 없습니다/);
    const noH9 = line("h8", "g6", "j10"); // 천원 고리에 백돌이 없다 — 어떤 대칭도 H9/I9 에 못 놓는다
    expect(note(build(noH9, rules).v, noH9, size, rules)).toMatch(/H9\/I9에 백돌이 없습니다/);
    const box = line("h8", "i9", "k11");
    expect(note(build(box, rules).v, box, size, rules)).toMatch(/상자를 만족하는 수순이 없습니다/);
    const merged = line("h8", "i9", "j10", "k11");
    const mr = { ...DEFAULT_RULES, move2Fix: false };
    expect(note(build(merged, mr).v, merged, size, mr)).toBe(
      "(회전·반전 4종을 같은 모양으로 합산)",
    );
  });

  it("주형은 파고든 수순을 따른다", () => {
    const ms = line("h8", "h9", "h10");
    const { s, v } = build(ms, {
      ...DEFAULT_RULES,
      openingRule: false,
      move2Fix: false,
      symmetry: false,
    });
    expect(openingLabel(v, ms, size)).toBe("주형: 한성 (D1)");
    // h10 → h9 → h8 로 파고들어도 3수가 천원이라 같은 주형
    s.drill(ms[2]!.y * size + ms[2]!.x);
    s.drill(ms[1]!.y * size + ms[1]!.x);
    const deep = s.drill(ms[0]!.y * size + ms[0]!.x)!;
    expect(openingLabel(deep, ms, size)).toBe("주형: 한성 (D1)");
    expect(openingLabel(null, line("h8"), size)).toBeNull();
  });

  it("길 · 방향 · 실제 대국의 다음 수", () => {
    const ms = line("h8", "i9", "j10", "k11", "g7", "f6");
    const { s, v } = build(ms);
    expect(breadcrumb(v, size)).toBe("처음부터");
    expect(orientation(v, DEFAULT_RULES)).toMatch(/배치 \d종 진행 중|원래 방향/);
    expect(actualNext(v, ms, size)).toBe(ms[0]!.y * size + ms[0]!.x);
    const d = s.drill(ms[0]!.y * size + ms[0]!.x)!;
    expect(breadcrumb(d, size)).toBe("수순: h8");
    expect(actualNext(d, ms, size)).toBe(ms[1]!.y * size + ms[1]!.x);
  });
});
