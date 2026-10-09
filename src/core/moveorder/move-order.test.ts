import { describe, expect, it } from "vitest";
import {
  MO_MAX_STONES,
  MoveOrderSet,
  cellName,
  formatCount,
  formatPlies,
  opening26Of,
  rule2Cells,
  xform,
  xformName,
  type MoveOrderOptions,
} from "./move-order";
import { fromLabel } from "../model/move";

/**
 * 수순 핵심 — 앱 `MoveOrderTest` 의 이식(원본은 `Yixin-Board/tests/test_moveorder.c`).
 * **경로 수는 눈으로 확인할 수 없으므로** 모든 수를 규칙을 따로 다시 적용하는 무차별 순열
 * 걷기와 대조한다(개발_핸드북 §8.4). 무차별 쪽은 일부러 두 번째 구현이다 — 규칙을 같은 식으로
 * 잘못 읽어도 둘 다 통과하지 못하게.
 */

const size = 15;
const cell = (l: string) => {
  const m = fromLabel(l, size)!;
  return m.y * size + m.x;
};
const cells = (...ls: string[]) => ls.map(cell);

// ── 독립된 무차별 대입 ──────────────────────────────────────────────

function orderLegal(
  order: readonly number[],
  rule: number,
  openingRule: boolean,
  noFive: boolean,
  move2Fix: boolean,
): boolean {
  const occ = new Uint8Array(size * size);
  const ctr = Math.floor(size / 2);
  const dy = [1, 0, 1, 1];
  const dx = [0, 1, 1, -1];
  for (let p = 0; p < order.length; p++) {
    const y = Math.floor(order[p]! / size);
    const x = order[p]! % size;
    const col = p % 2 === 0 ? 1 : 2;
    if (openingRule && p <= 3 && size % 2 === 1) {
      if (move2Fix && p === 1) {
        const h9 = (ctr - 1) * size + ctr;
        if (order[p] !== h9 && order[p] !== h9 + 1) return false;
      } else if (Math.max(Math.abs(y - ctr), Math.abs(x - ctr)) > p) return false;
    }
    occ[order[p]!] = col;
    if (noFive && p + 1 < order.length) {
      for (let d = 0; d < 4; d++) {
        let k = 1;
        for (const s of [1, -1]) {
          let ny = y;
          let nx = x;
          for (let j = 1; j < 6; j++) {
            ny += s * dy[d]!;
            nx += s * dx[d]!;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) break;
            if (occ[ny * size + nx] !== col) break;
            k++;
          }
        }
        if (k === 5 || (k > 5 && rule !== 1)) return false;
      }
    }
  }
  return true;
}

function bruteCount(
  pts: readonly number[],
  o: { rule?: number; openingRule?: boolean; noFive?: boolean; move2Fix?: boolean } = {},
  plies?: Map<number, bigint>,
): number {
  const { rule = 2, openingRule = true, noFive = true, move2Fix = false } = o;
  const black = pts.filter((_, i) => i % 2 === 0);
  const white = pts.filter((_, i) => i % 2 === 1);
  const bUsed = black.map(() => false);
  const wUsed = white.map(() => false);
  const order: number[] = new Array(pts.length).fill(0);
  let total = 0;
  const rec = (p: number) => {
    if (p === pts.length) {
      if (!orderLegal(order, rule, openingRule, noFive, move2Fix)) return;
      total++;
      if (plies) order.forEach((c, q) => plies.set(c, (plies.get(c) ?? 0n) | (1n << BigInt(q))));
      return;
    }
    const [list, used] = p % 2 === 0 ? [black, bUsed] : [white, wUsed];
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      order[p] = list[i]!;
      rec(p + 1);
      used[i] = false;
    }
  };
  rec(0);
  return total;
}

/** 독립된 대칭 기준: 제 식으로 변환하고, 같은 국면을 걷어내고, 변형별 무차별 수를 더한다. */
function bruteVariantCount(
  pts: readonly number[],
  o: { openingRule?: boolean; move2Fix?: boolean } = {},
) {
  const kept: string[] = [];
  let total = 0;
  for (let t = 0; t < 8; t++) {
    const tc = pts.map((c) => xform(t, size, c));
    const key = tc
      .map((c, i) => c * 2 + (i % 2))
      .sort((a, b) => a - b)
      .join(",");
    if (kept.includes(key)) continue;
    kept.push(key);
    total += bruteCount(tc, { openingRule: o.openingRule ?? true, move2Fix: o.move2Fix ?? true });
  }
  return { total, variants: kept.length };
}

const set = (pts: readonly number[], o: MoveOrderOptions = {}) =>
  MoveOrderSet.create(pts, size, o)!;
const noRules = { openingRule: false, move2Fix: false } as const;

describe("수 vs 무차별 대입", () => {
  it("규칙이 없으면 정확히 흑! × 백!", () => {
    const pts = cells("a1", "c3", "e5", "g7", "a3", "c5", "e7", "g9");
    const s = set(pts, { ...noRules, withSymmetry: false });
    expect(s.total).toBe(24 * 24);
    expect(s.total).toBe(bruteCount(pts, { openingRule: false }));
  });

  it("오프닝 규칙은 표준 시작을 한 수순으로 접는다", () => {
    const pts = cells("h8", "i9", "j10", "k11");
    expect(set(pts, { withSymmetry: false }).total).toBe(1);
    expect(set(pts, { ...noRules, withSymmetry: false }).total).toBe(4);
  });

  it("3수가 5×5 밖이면 거절", () => {
    expect(set(cells("h8", "i9", "k11"), { withSymmetry: false }).total).toBe(0);
    expect(set(cells("h8", "i9", "j10"), { withSymmetry: false }).total).toBe(1);
  });

  it("4수가 7×7 밖이면 거절", () => {
    expect(set(cells("h8", "i9", "j10", "l12"), { withSymmetry: false }).total).toBe(0);
    expect(set(cells("h8", "i9", "j10", "k11"), { withSymmetry: false }).total).toBe(1);
  });

  it("5수는 오프닝 규칙에 묶이지 않는다", () => {
    expect(
      set(cells("h8", "i9", "j10", "k11", "a1"), { withSymmetry: false }).total,
    ).toBeGreaterThan(0);
  });

  it("2수 고정은 고리의 다른 칸을 거절한다", () => {
    expect(set(cells("h8", "g9", "j10"), { move2Fix: true, withSymmetry: false }).total).toBe(0);
    expect(
      set(cells("h8", "g9", "j10"), { move2Fix: false, withSymmetry: false }).total,
    ).toBeGreaterThan(0);
  });

  it("오목 규칙이 수순을 가지친다", () => {
    const pts = cells("h8", "a1", "h9", "a2", "h10", "a3", "h11", "a4", "h12", "a5");
    const withRule = set(pts, { ...noRules, withSymmetry: false }).total;
    const without = set(pts, { ...noRules, noFive: false, withSymmetry: false }).total;
    expect(withRule).toBeLessThan(without);
    expect(withRule).toBe(bruteCount(pts, { openingRule: false }));
  });

  it("흩어진 국면에서도 무차별 대입과 같다", () => {
    const pts = cells("h8", "i9", "j10", "k11", "g7", "f6", "e5", "l12");
    expect(set(pts, { withSymmetry: false }).total).toBe(bruteCount(pts, { move2Fix: true }));
  });
});

describe("갈래 · 파고들기", () => {
  it("오프닝 규칙이면 뿌리의 갈래는 하나", () => {
    const ch = set(cells("h8", "i9", "j10", "k11"), { withSymmetry: false }).children();
    expect(ch).toHaveLength(1);
    expect(ch[0]!.cell).toBe(cell("h8"));
    expect(ch[0]!.color).toBe(1);
  });

  it("갈래는 큰 것부터", () => {
    const ch = set(cells("a1", "c3", "e5", "g7", "a3", "c5", "e7", "g9"), {
      ...noRules,
      withSymmetry: false,
    }).children();
    expect(ch.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < ch.length; i++)
      expect(ch[i - 1]!.count).toBeGreaterThanOrEqual(ch[i]!.count);
  });

  it("갈래 수의 합은 지나는 수순 수", () => {
    const s = set(cells("h8", "i9", "j10", "k11", "g7", "f6"), { withSymmetry: false });
    const sum = () => s.children().reduce((a, c) => a + c.count, 0);
    expect(sum()).toBe(s.branchCount());
    s.drill(s.children()[0]!.cell);
    expect(sum()).toBe(s.branchCount());
  });

  it("남의 칸으로는 파고들지 못한다", () => {
    const s = set(cells("h8", "i9", "j10", "k11"));
    expect(s.drill(cell("a1"))).toBe(false);
    expect(s.prefix).toEqual([]);
  });

  it("되짚으면 뿌리의 갈래가 그대로", () => {
    const s = set(cells("h8", "i9", "j10", "k11", "g7", "f6"));
    const before = s.children();
    expect(s.drill(before[0]!.cell)).toBe(true);
    expect(s.prefix).toHaveLength(1);
    expect(s.back()).toBe(true);
    expect(s.children()).toEqual(before);
  });

  it("처음으로는 길을 다 지운다", () => {
    const s = set(cells("h8", "i9", "j10", "k11", "g7", "f6"));
    s.drill(s.children()[0]!.cell);
    s.drill(s.children()[0]!.cell);
    expect(s.prefix).toHaveLength(2);
    s.root();
    expect(s.prefix).toEqual([]);
    expect(s.back()).toBe(false);
  });

  it("파고들수록 살아 있는 변형은 줄거나 그대로", () => {
    const s = set(cells("h8", "i9", "j10", "k11", "g7", "f6"));
    const before = s.aliveCount();
    s.drill(s.children()[0]!.cell);
    expect(s.aliveCount()).toBeLessThanOrEqual(before);
    expect(s.aliveCount()).toBeGreaterThanOrEqual(1);
  });
});

describe("대칭(환원)", () => {
  it("제자리에서는 못 만드는 모양을 대칭이 살린다", () => {
    const pts = cells("h8", "h7", "j10", "k11");
    expect(set(pts, { withSymmetry: false }).total).toBe(0);
    expect(set(pts, { withSymmetry: true }).total).toBeGreaterThan(0);
    expect(set(pts, { move2Fix: false, withSymmetry: false }).total).toBe(1);
  });

  it("살린 모양의 합과 변형 수가 무차별 대입과 같다", () => {
    const pts = cells("h8", "h7", "j10", "k11");
    const s = set(pts);
    const b = bruteVariantCount(pts);
    expect(s.total).toBe(b.total);
    expect(s.variantCount).toBe(b.variants);
  });

  it("걷어내기는 변환이 아니라 배치를 센다", () => {
    expect(set(cells("h8"), noRules).variantCount).toBe(1);
    expect(set(cells("h8", "i9"), noRules).variantCount).toBe(4);
    expect(set(cells("h8", "i9", "j11", "l11"), noRules).variantCount).toBe(8);
    const plain = set(cells("h8", "i9", "j11", "l11"), { ...noRules, withSymmetry: false });
    expect(plain.variantCount).toBe(1);
    expect(plain.transforms).toEqual([0]);
  });

  it("합친 수는 배치들의 합", () => {
    const pts = cells("h8", "i9", "j10", "k11");
    const s = set(pts, { move2Fix: false });
    expect(s.variantCount).toBe(4);
    expect(s.total).toBe(4);
    expect(s.total).toBe(bruteVariantCount(pts, { move2Fix: false }).total);
  });

  it("합친 수는 여덟 변환 모두에서 같다", () => {
    const base = cells("h8", "i9", "j10", "k11", "g7", "f6");
    const want = set(base).total;
    expect(want).toBeGreaterThan(0);
    for (let t = 0; t < 8; t++) expect(set(base.map((c) => xform(t, size, c))).total).toBe(want);
  });

  it("합친 수는 걷어낸 변형들의 무차별 합", () => {
    const pts = cells("h8", "i9", "j10", "k11", "g7", "f6");
    const s = set(pts);
    const b = bruteVariantCount(pts);
    expect(s.total).toBe(b.total);
    expect(s.variantCount).toBe(b.variants);
  });

  it("스스로 대칭인 모양은 한 번만 센다", () => {
    const s = set(cells("h8"));
    expect(s.variantCount).toBe(1);
    expect(s.total).toBe(1);
  });

  it("원래 방향 변형이 맨 앞", () => {
    expect(set(cells("h8", "i9", "j10", "k11")).transforms[0]).toBe(0);
  });
});

describe("완성", () => {
  it("같은 돌의 합법 수순을 찾는다", () => {
    const pts = cells("h8", "i9", "j10", "k11", "g7", "f6");
    const done = set(pts, { withSymmetry: false }).complete()!;
    expect(done.transform).toBe(0);
    expect(new Set(done.order)).toEqual(new Set(pts));
    expect(orderLegal(done.order, 2, true, true, true)).toBe(true);
  });

  it("파고든 길을 지킨다", () => {
    const s = set(cells("h8", "i9", "j10", "k11", "g7", "f6"), { withSymmetry: false });
    s.drill(s.children()[0]!.cell);
    const prefix = [...s.prefix];
    expect(s.complete()!.order.slice(0, prefix.length)).toEqual(prefix);
  });

  it("거울 배치만 남으면 거기서 완성하고 그렇다고 말한다", () => {
    const pts = cells("h8", "h7", "j10", "k11");
    const done = set(pts).complete()!;
    expect(done.transform).not.toBe(0);
    expect(orderLegal(done.order, 2, true, true, true)).toBe(true);
    const variant = pts.map((c) => xform(done.transform, size, c));
    expect(new Set(done.order)).toEqual(new Set(variant));
    expect(new Set(done.order.filter((_, i) => i % 2 === 0))).toEqual(
      new Set(variant.filter((_, i) => i % 2 === 0)),
    );
  });
});

describe("가능한 수 번호", () => {
  it("무차별 대입과 같다", () => {
    const pts = cells("h8", "i9", "j10", "k11", "g7", "f6");
    const s = set(pts, { withSymmetry: false });
    expect(s.plyOk).toBe(true);
    const brute = new Map<number, bigint>();
    bruteCount(pts, { move2Fix: true }, brute);
    const got = new Map(s.ghosts().map((g) => [g.cell, g.plies]));
    for (const c of pts) expect(got.get(c)).toBe(brute.get(c) ?? 0n);
  });

  it("1수만 될 수 있는 돌은 그렇게 말한다", () => {
    const g = set(cells("h8", "i9", "j10", "k11"), { withSymmetry: false })
      .ghosts()
      .find((x) => x.cell === cell("h8"))!;
    expect(formatPlies(g.plies)).toBe("1");
  });

  it("고스트는 길에 든 돌을 뺀다", () => {
    const s = set(cells("h8", "i9", "j10", "k11"), { withSymmetry: false });
    expect(s.ghosts()).toHaveLength(4);
    s.drill(cell("h8"));
    expect(s.ghosts().map((g) => g.cell)).not.toContain(cell("h8"));
    expect(s.ghosts()).toHaveLength(3);
  });
});

describe("예산의 정직함", () => {
  it("예산이 바닥나면 틀린 수 대신 «세지 않음»", () => {
    const pts = Array.from({ length: 12 }, (_, i) =>
      cell(`${String.fromCharCode(97 + (i % 6))}${i + 1}`),
    );
    const s = set(pts, { ...noRules, withSymmetry: false, maxNodes: 5 });
    expect(s.overflow).toBe(true);
    expect(s.total).toBe(0);
    expect(s.plyOk).toBe(false);
  });

  it("돌이 너무 많으면 자르지 않고 거절", () => {
    expect(
      MoveOrderSet.create(
        Array.from({ length: 2 * MO_MAX_STONES + 2 }, (_, i) => i),
        size,
      ),
    ).toBeNull();
    expect(MoveOrderSet.create([], size)).toBeNull();
    expect(MoveOrderSet.create([size * size], size)).toBeNull();
  });

  it("돌이 52개를 넘어도(문자열 메모 열쇠) 센다", () => {
    // 오목이 나지 않게 흩어 놓은 54돌 — 예산이 작아 넘치지만, 넘침이 정직하게 보고된다
    const pts: number[] = [];
    for (let y = 0; y < 15 && pts.length < 54; y += 2)
      for (let x = 0; x < 15 && pts.length < 54; x += 2) pts.push(y * size + x);
    const s = set(pts, { ...noRules, withSymmetry: false, maxNodes: 2000 });
    expect(s.overflow).toBe(true);
    expect(s.total).toBe(0);
  });
});

describe("규칙 · 표기", () => {
  it("정규 2수는 H9 와 I9", () => {
    const [a, b] = rule2Cells(size)!;
    expect(cellName(a, size)).toBe("h9");
    expect(cellName(b, size)).toBe("i9");
    expect(rule2Cells(14)).toBeNull();
  });

  it("방향 이름이 군 전체를 덮는다", () => {
    expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map(xformName)).size).toBe(8);
    expect(xformName(0)).toBe("원래 방향");
  });

  it("수는 자리를 묶고, 커지면 지수 표기", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(576)).toBe("576");
    expect(formatCount(14400)).toBe("14,400");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(1.3e13)).toBe("1.30e+13");
  });

  it("수 번호 집합은 길어지면 접는다", () => {
    expect(formatPlies(0n)).toBe("");
    expect(formatPlies(0b1n)).toBe("1");
    expect(formatPlies(0b10101n)).toBe("1·3·5");
    expect(formatPlies(0b1111n)).toBe("1~4");
  });

  it("칸 이름은 데스크톱과 같다", () => {
    expect(cellName(cell("h8"), size)).toBe("h8");
    expect(cellName(cell("a1"), size)).toBe("a1");
    expect(cellName(cell("o15"), size)).toBe("o15");
  });

  it("주형은 1수나 3수가 천원이면 된다", () => {
    const [h8, h9, h10] = cells("h8", "h9", "h10");
    expect(opening26Of(h8!, h9!, h10!, size)).toBe(0);
    expect(opening26Of(h10!, h9!, h8!, size)).toBe(0);
    expect(opening26Of(h9!, h8!, h10!, size)).toBeNull();
  });

  it("주형 분류는 여덟 변환에 불변", () => {
    const order = cells("h8", "i9", "j10");
    const want = opening26Of(order[0]!, order[1]!, order[2]!, size);
    expect(want).not.toBeNull();
    for (let t = 0; t < 8; t++) {
      const m = order.map((c) => xform(t, size, c));
      expect(opening26Of(m[0]!, m[1]!, m[2]!, size)).toBe(want);
    }
  });
});
