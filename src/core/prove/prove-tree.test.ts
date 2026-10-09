import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVE_OPTIONS,
  DEFEND_KEEP,
  MAX_PENDING,
  MAX_PLIES,
  NBEST_MAX,
  ProveTree,
  VERIFY_DEPTH,
  VERIFY_MS,
  budgetText,
  sanitizeProveOptions,
  type ProveOptions,
  type ProvePv,
} from "./prove-tree";
import {
  IDLE_PROGRESS,
  badgeLines,
  isAttackPly,
  isBlackPly,
  outcomeMessage,
  type ProveOutcome,
} from "./prove-models";
import { fromLabel, move, sameMove, type Move } from "../model/move";

/**
 * AND/OR 증명 탐색을 main.c:8918-9979 에 — 앱 `ProveTreeTest` 의 이식. 여기의 모든 경우가
 * **무엇을 결론 내는가**나 **DB 에 무엇을 쓰는가**를 정하는 규칙을 고정한다 — 어긋나면 느린
 * 탐색이 아니라 틀린 판정이나 뒤집힌 메이트 기록으로 나타난다.
 */

const size = 15;
const tree = (o: Partial<ProveOptions> = {}, log: (s: string) => void = () => {}) =>
  new ProveTree(sanitizeProveOptions({ ...DEFAULT_PROVE_OPTIONS, ...o }), size, log);
const m = (l: string): Move => fromLabel(l, size)!;
const pv = (l: string, wr: number | null, mate = 0, depth = 10): ProvePv => ({
  move: m(l),
  winRate: wr,
  mate,
  depth,
});
const last = (t: ProveTree, i: number) => t.get(i).lastMove!;
const lastsOf = (t: ProveTree, is: number[]) => is.map((i) => last(t, i));

describe("모양", () => {
  it("뿌리는 공격 마디이고 아래로 번갈아 간다", () => {
    const t = tree();
    expect(t.root.isOr).toBe(true);
    const defense = t.addChild(0, m("H8"), 0.6, false, 0);
    const attack = t.addChild(defense, m("I9"), 0.6, false, 0);
    expect(t.get(defense).isOr).toBe(false);
    expect(t.get(attack).isOr).toBe(true);
    expect(t.path(attack)).toBe("h8 i9");
    expect(t.path(0)).toBe("(root)");
  });

  it("새 마디는 첫 예산, 검증 마디는 값싼 예산", () => {
    const t = tree({ budget0Sec: 5 });
    expect(t.get(t.addChild(0, m("H8"), 0.6, false, 0)).budget).toBe(5000);
    expect(t.get(t.addChild(0, m("I9"), 0.98, true, 0)).budget).toBe(VERIFY_MS);
  });

  it("깊이 방식이면 예산이 깊이이고 검증은 8 로 묶인다", () => {
    const t = tree({ byDepth: true, depth0: 12 });
    expect(t.get(t.addChild(0, m("H8"), 0.6, false, 0)).budget).toBe(12);
    expect(t.get(t.addChild(0, m("I9"), 0.98, true, 0)).budget).toBe(VERIFY_DEPTH);
  });

  it("수 한도를 넘어 자라지 않는다", () => {
    const t = tree();
    let parent = 0;
    let added = 0;
    for (let i = 0; i < MAX_PLIES + 4; i++) {
      const c = t.addChild(parent, move(i % size, Math.floor(i / size)), 0.5, false, 0);
      if (c < 0) break;
      parent = c;
      added++;
    }
    expect(added).toBe(MAX_PLIES - 1);
  });
});

describe("비용 · 일정", () => {
  it("만든 PV 에 보인 메이트가 무엇보다 앞", () => {
    const t = tree();
    const plain = t.addChild(0, m("H8"), 0.9, false, 0);
    const mating = t.addChild(0, m("I9"), 0.4, false, 7);
    expect(t.cost(t.get(mating))).toBeLessThan(t.cost(t.get(plain)));
    expect(t.pickNext()).toBe(mating);
  });

  it("쉬운 공격이 먼저", () => {
    const t = tree();
    const easy = t.addChild(0, m("H8"), 0.8, false, 0);
    const hard = t.addChild(0, m("I9"), 0.55, false, 0);
    expect(t.cost(t.get(easy))).toBeCloseTo(0.22 * 1.15, 9);
    expect(t.cost(t.get(hard))).toBeGreaterThan(t.cost(t.get(easy)));
  });

  it("버틸 것 같은 방어는 일찍 한 번 탐침한다", () => {
    const t = tree({ probe: true });
    const holding = t.addChild(0, m("H8"), 0.2, false, 0);
    expect(t.cost(t.get(holding))).toBeCloseTo(0.12 * 1.15, 9);
    t.get(holding).probed = true;
    expect(t.cost(t.get(holding))).toBeCloseTo(0.82 * 1.15, 9);
  });

  it("탐침을 끄면 가망 없어 보이는 방어는 끝에 남는다", () => {
    const t = tree({ probe: false });
    expect(t.cost(t.get(t.addChild(0, m("H8"), 0.2, false, 0)))).toBeCloseTo(0.82 * 1.15, 9);
  });

  it("올린 예산만큼 마디가 덜 매력적이다", () => {
    const t = tree();
    const node = t.addChild(0, m("H8"), 0.6, false, 0);
    const first = t.cost(t.get(node));
    t.get(node).budget *= 4;
    expect(t.cost(t.get(node))).toBeCloseTo(first * 4, 9);
  });

  it("검증 마디는 싸서 한 묶음이 빨리 끝난다", () => {
    const t = tree();
    const plain = t.addChild(0, m("H8"), 0.98, false, 0);
    const verify = t.addChild(0, m("I9"), 0.98, true, 0);
    expect(t.cost(t.get(verify))).toBeCloseTo(t.cost(t.get(plain)) * 0.3, 9);
  });

  it("정해진 조상 아래 마디는 줄 세우지 않는다", () => {
    const t = tree();
    const child = t.addChild(0, m("H8"), 0.6, false, 0);
    const grand = t.addChild(child, m("I9"), 0.6, false, 0);
    t.resolve(child, "nowin", "mate", -100, 3, "search");
    expect(t.ancestorResolved(grand)).toBe(true);
    expect(t.pickNext()).toBe(0);
    expect(t.openCount()).toBe(1);
  });
});

describe("펼치기", () => {
  it("공격 마디는 가장 좋은 후보만 세우고 나머지는 대기", () => {
    const t = tree({ bestFirst: true, nbest: 4 });
    t.expand(0, [pv("H8", 0.55), pv("I9", 0.72), pv("G7", 0.6)]);
    expect(t.children(0)).toHaveLength(1);
    expect(last(t, t.children(0)[0]!)).toEqual(m("I9"));
    expect(t.root.alt.map((a) => a.move)).toEqual([m("G7"), m("H8")]);
  });

  it("후보 PV 의 메이트가 더 좋은 승률보다 먼저 펼쳐진다", () => {
    const t = tree({ bestFirst: true });
    t.expand(0, [pv("H8", 0.95), pv("I9", 0.4, 5), pv("G7", 0.5, 3)]);
    expect(last(t, t.children(0)[0]!)).toEqual(m("G7"));
    expect(t.root.alt.map((a) => a.move)).toEqual([m("I9"), m("H8")]);
  });

  it("best-first 를 끄면 모든 후보가 마디가 된다", () => {
    const t = tree({ bestFirst: false, nbest: 4 });
    t.expand(0, [pv("H8", 0.55), pv("I9", 0.72), pv("G7", 0.6)]);
    expect(t.children(0)).toHaveLength(3);
    expect(t.root.alt).toEqual([]);
  });

  it("처음 k 개 후보만 본다", () => {
    const t = tree({ bestFirst: false, nbest: 2 });
    t.expand(0, [pv("H8", 0.55), pv("I9", 0.72), pv("G7", 0.99)]);
    expect(lastsOf(t, t.children(0))).toEqual([m("I9"), m("H8")]);
  });

  it("공격 마디를 다시 펼쳐도 아는 것을 겹치지 않는다", () => {
    const t = tree({ bestFirst: true });
    t.expand(0, [pv("H8", 0.55), pv("I9", 0.72)]);
    t.expand(0, [pv("I9", 0.74), pv("H8", 0.56), pv("G7", 0.5)]);
    expect(t.children(0)).toHaveLength(1);
    expect(t.root.alt.map((a) => a.move)).toEqual([m("H8"), m("G7")]);
  });

  it("방어 마디는 해 볼 만한 방어를 펼치고 가망 없는 것은 미룬다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    t.expand(and, [pv("I9", 0.3), pv("G7", 0.001), pv("J10", 0.45), pv("F6", 0)]);
    expect(lastsOf(t, t.children(and))).toEqual([m("J10"), m("I9")]);
    expect(t.get(and).pending).toEqual([m("G7"), m("F6")]);
    expect(t.get(t.children(and)[0]!).wratt).toBeCloseTo(0.55, 9);
  });

  it("PV 의 방어자 메이트는 그 갈래의 공격 메이트가 된다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    t.expand(and, [pv("I9", 0.3, -4)]);
    expect(t.get(t.children(and)[0]!).pvMate).toBe(4);
  });

  it("해 볼 만한 것이 없는 방어 마디는 미룬 수를 곧바로 검증한다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    t.expand(and, [pv("I9", 0), pv("G7", 0.01)]);
    expect(t.get(and).pending).toEqual([]);
    expect(t.children(and).map((c) => t.get(c).verify)).toEqual([true, true]);
  });

  it("방어는 많아야 열여섯을 펼치고 나머지는 기다린다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    const pvs = Array.from({ length: 20 }, (_, i) => ({
      move: move(i % 15, 3 + Math.floor(i / 15)),
      winRate: 0.5,
      mate: 0,
      depth: 0,
    }));
    t.expand(and, pvs);
    expect(t.children(and)).toHaveLength(DEFEND_KEEP);
    expect(t.get(and).pending).toHaveLength(4);
  });
});

describe("전파", () => {
  it("이기는 공격 하나가 공격 마디를 정한다", () => {
    const t = tree();
    const a = t.addChild(0, m("H8"), 0.6, false, 0);
    t.resolve(a, "win", "mate", -29996, 5, "search");
    expect(t.root.state).toBe("resolved");
    expect(t.root.result).toBe("win");
    expect(t.root.value).toBe(29995);
    expect(t.root.recDepth).toBe(6);
  });

  it("버티는 방어 하나가 그 위의 방어 마디를 반증한다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    const d1 = t.addChild(and, m("I9"), 0.4, false, 0);
    const d2 = t.addChild(and, m("G7"), 0.4, false, 0);
    t.resolve(d1, "win", "mate", 29990, 4, "search");
    expect(t.get(and).state).toBe("open");
    t.resolve(d2, "nowin", "mate", -20, 4, "search");
    expect(t.get(and).result).toBe("nowin");
  });

  it("모든 방어가 지면 이기는데, 가장 약한 고리의 종류로", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    const d1 = t.addChild(and, m("I9"), 0.4, false, 0);
    const d2 = t.addChild(and, m("G7"), 0.4, false, 0);
    t.resolve(d1, "win", "mate", 29990, 4, "search");
    t.resolve(d2, "win", "db", 29800, 6, "db");
    expect(t.get(and).result).toBe("win");
    expect(t.get(and).kind).toBe("db");
    expect(t.get(and).value).toBe(t.negamaxUp(29800));
  });

  it("모든 방어가 지면 결론 전에 미룬 묶음을 먼저 검증한다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    t.expand(and, [pv("I9", 0.3), pv("G7", 0.001)]);
    t.resolve(t.children(and)[0]!, "win", "mate", 29990, 4, "search");
    expect(t.get(and).state).toBe("open");
    expect(t.get(and).pending).toEqual([]);
    const verifier = t.children(and).at(-1)!;
    expect(t.get(verifier).verify).toBe(true);
    t.resolve(verifier, "win", "mate", 29990, 4, "search");
    expect(t.get(and).result).toBe("win");
  });

  it("실패한 공격 후보는 다음 대안을 불러낸다", () => {
    const t = tree({ bestFirst: true });
    t.expand(0, [pv("I9", 0.72), pv("H8", 0.55)]);
    t.resolve(t.children(0)[0]!, "nowin", "mate", -30, 4, "search");
    expect(lastsOf(t, t.children(0))).toEqual([m("I9"), m("H8")]);
    expect(t.root.altNext).toBe(1);
  });

  it("같은 마디의 다른 후보가 열려 있는 동안 넓히기는 기다린다", () => {
    const t = tree({ bestFirst: false, nbest: 3 });
    t.expand(0, [pv("I9", 0.72), pv("H8", 0.55)]);
    t.root.alt.push({ move: m("G7"), winRate: 0.5, mate: 0, depth: 0 });
    t.resolve(t.children(0)[0]!, "nowin", "mate", -30, 4, "search");
    expect(t.root.altNext).toBe(0);
    t.resolve(t.children(0)[1]!, "nowin", "mate", -30, 4, "search");
    expect(t.root.altNext).toBe(1);
  });
});

describe("DB 쓰기 큐", () => {
  it("증명된 메이트만 기록 대기", () => {
    const t = tree();
    t.resolve(t.addChild(0, m("H8"), 0.6, false, 0), "win", "wr", 900, 4, "wr");
    expect(t.hasWrites).toBe(false);
    const b = t.addChild(0, m("I9"), 0.6, false, 0);
    t.resolve(b, "win", "mate", 29990, 4, "search");
    expect(t.popWrite()).toBe(b);
  });

  it("DB 에서 읽은 결론은 다시 쓰지 않는다", () => {
    const t = tree();
    t.resolve(t.addChild(0, m("H8"), 0.6, false, 0), "win", "db", 29990, 4, "db");
    expect(t.hasWrites).toBe(false);
  });
});

describe("탐색 결과", () => {
  it("공격 마디의 메이트는 승리를 증명한다", () => {
    const t = tree();
    expect(t.onSearchResult(0, [pv("H8", 0.99, 4, 21)])).toBe("resolved");
    expect(t.root.result).toBe("win");
    expect(t.root.kind).toBe("mate");
    expect(t.root.value).toBe(30000 - 4);
    expect(t.root.recDepth).toBe(21);
  });

  it("방어 마디의 같은 메이트는 공격을 반증한다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    t.onSearchResult(and, [pv("I9", 0.99, 4, 18)]);
    expect(t.get(and).result).toBe("nowin");
    expect(t.root.state).toBe("open");
  });

  it("반증된 방어 하나는 공격을 증명하지 않는다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    expect(t.onSearchResult(and, [pv("I9", 0, -5, 20), pv("G7", 0.42, 0, 20)])).not.toBe(
      "resolved",
    );
    expect(t.get(and).state).toBe("open");
    expect(t.get(and).result).toBe("none");
  });

  it("모든 방어가 반증되면 공격이 증명된다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    expect(t.onSearchResult(and, [pv("I9", 0, -5, 20), pv("G7", 0, -7, 20)])).toBe("resolved");
    expect(t.get(and).result).toBe("win");
    expect(t.get(and).kind).toBe("mate");
  });

  it("엔진이 보낸 순서와 무관하게 가장 좋은 줄이 정한다", () => {
    const t = tree();
    expect(t.onSearchResult(0, [pv("G7", 0.1, 0, 9), pv("H8", 0.99, 3, 21)])).toBe("resolved");
    expect(t.root.result).toBe("win");
    expect(t.root.value).toBe(30000 - 3);
    expect(t.root.recDepth).toBe(21);
  });

  it("공격 마디에서 메이트 당하면 그 갈래는 끝", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    const or = t.addChild(and, m("I9"), 0.6, false, 0);
    t.onSearchResult(or, [pv("G7", 0.01, -6, 12)]);
    expect(t.get(or).result).toBe("nowin");
    expect(t.get(or).value).toBe(-30000 + 6);
    expect(t.get(and).result).toBe("nowin");
  });

  it("높은 승률은 증명이 아니라 증거 — 예산을 올린다", () => {
    const t = tree({ budget0Sec: 5, budgetMaxSec: 320, nbest: 4 });
    expect(t.onSearchResult(0, [pv("H8", 0.97), pv("I9", 0.6)])).toBe("continue");
    expect(t.root.state).toBe("open");
    expect(t.root.budget).toBe(10000);
    expect(t.root.k).toBe(5);
    expect(t.root.probed).toBe(true);
    expect(t.root.wratt).toBeCloseTo(0.97, 9);
    expect(t.children(0)).toHaveLength(1);
  });

  it("약속한 메이트가 나타나지 않으면 우선순위를 잃는다", () => {
    const t = tree();
    const a = t.addChild(0, m("H8"), 0.6, false, 5);
    t.onSearchResult(a, [pv("I9", 0.6)]);
    expect(t.get(a).pvMate).toBe(0);
  });

  it("깊이 방식의 올림은 두 수", () => {
    const t = tree({ byDepth: true, depth0: 12, depthMax: 30 });
    t.onSearchResult(0, [pv("H8", 0.8)]);
    expect(t.root.budget).toBe(14);
  });

  it("예산 상한의 마디는 포기하고 다음 후보로", () => {
    const t = tree({ budget0Sec: 5, budgetMaxSec: 5, bestFirst: true });
    t.expand(0, [pv("I9", 0.72), pv("H8", 0.55)]);
    const first = t.children(0)[0]!;
    expect(t.onSearchResult(first, [pv("G7", 0.4)])).toBe("continue");
    expect(t.get(first).state).toBe("exhausted");
    expect(lastsOf(t, t.children(0))).toEqual([m("I9"), m("H8")]);
  });

  it("빈 답은 세 번까지 다시, 그다음 포기", () => {
    const t = tree();
    const a = t.addChild(0, m("H8"), 0.6, false, 0);
    expect(t.onSearchResult(a, [])).toBe("retry");
    expect(t.onTimeout(a)).toBe("retry");
    expect(t.onTimeout(a)).toBe("continue");
    expect(t.get(a).state).toBe("exhausted");
  });

  it("쓸 만한 답은 재시도 수를 지운다", () => {
    const t = tree();
    const a = t.addChild(0, m("H8"), 0.6, false, 0);
    t.onTimeout(a);
    t.onSearchResult(a, [pv("I9", 0.5)]);
    expect(t.get(a).retries).toBe(0);
  });
});

describe("거짓 메이트", () => {
  it("후보 몇이 졌다고 공격 마디가 지지 않는다", () => {
    const t = tree();
    expect(
      t.onSearchResult(0, [pv("H8", 0.1, 0, 20), pv("I9", 0, -20, 20), pv("G7", 0, -40, 20)]),
    ).not.toBe("resolved");
    expect(t.root.state).toBe("open");
    expect(t.root.result).toBe("none");
    expect(t.hasWrites).toBe(false);
  });

  it("승률이 하나도 없는 국면이 엔진이 보낸 순서로 정해지지 않는다", () => {
    const t = tree();
    expect(
      t.onSearchResult(0, [
        pv("G7", null, -40, 20),
        pv("I9", null, -20, 20),
        pv("H8", null, 0, 20),
      ]),
    ).not.toBe("resolved");
    expect(t.root.result).toBe("none");
    expect(t.hasWrites).toBe(false);
  });

  it("첫 줄에 승률이 없는 공격 마디는 결론 내지 않는다", () => {
    const t = tree();
    expect(t.onSearchResult(0, [pv("H8", null, -40), pv("I9", null, -5)])).not.toBe("resolved");
    expect(t.root.result).toBe("none");
  });

  it("제 첫 줄과 맞지 않는 패배는 거절한다", () => {
    const t = tree();
    expect(t.onSearchResult(0, [pv("H8", 0, -5, 20), pv("I9", 0, -40, 20)])).not.toBe("resolved");
    expect(t.root.result).toBe("none");
  });

  it("모든 줄이 지고 순서가 맞으면 반증된다", () => {
    const t = tree();
    expect(t.onSearchResult(0, [pv("H8", 0, -40, 20), pv("I9", 0, -5, 20)])).toBe("resolved");
    expect(t.root.result).toBe("nowin");
    expect(t.root.value).toBe(-30000 + 40);
  });

  it("읽지 못한 PV 는 결론을 막는다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    expect(t.onSearchResult(and, [pv("I9", 0, -5), pv("G7", 0, -7)], false)).not.toBe("resolved");
    expect(t.get(and).result).toBe("none");
    expect(t.get(and).incomplete).toBe(true);
  });

  it("방어를 잃은 마디는 전파로도 증명되지 않는다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    t.onSearchResult(and, [pv("I9", 0.3), pv("G7", 0.4)], false);
    for (const c of t.children(and)) t.resolve(c, "win", "mate", 29990, 4, "search");
    expect(t.get(and).state).toBe("open");
    expect(t.get(and).result).toBe("none");
  });

  it("모든 방어를 담지 못한 마디는 스스로 불완전하다고 표시한다", () => {
    const big = new ProveTree(sanitizeProveOptions(DEFAULT_PROVE_OPTIONS), 20);
    const and = big.addChild(0, move(0, 0), 0.6, false, 0);
    const total = DEFEND_KEEP + MAX_PENDING + 5;
    const pvs = Array.from({ length: total }, (_, i) => ({
      move: move(i % 20, 1 + Math.floor(i / 20)),
      winRate: 0.5,
      mate: 0,
      depth: 0,
    }));
    big.expand(and, pvs);
    expect(big.get(and).incomplete).toBe(true);
    expect(big.children(and)).toHaveLength(DEFEND_KEEP);
    expect(big.get(and).pending).toHaveLength(MAX_PENDING);
  });

  it("방어 마디는 나중 탐색이 찾은 방어를 받아들인다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    t.onSearchResult(and, [pv("I9", 0.3), pv("G7", 0.4)]);
    expect(t.children(and)).toHaveLength(2);
    t.onSearchResult(and, [pv("I9", 0.3), pv("G7", 0.4), pv("J10", 0.35)]);
    const got = lastsOf(t, t.children(and));
    for (const want of [m("I9"), m("G7"), m("J10")])
      expect(got.some((g) => sameMove(g, want))).toBe(true);
    expect(got).toHaveLength(3);
  });

  it("방어 마디를 다시 펼쳐도 아는 것을 겹치지 않는다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    t.expand(and, [pv("I9", 0.3), pv("G7", 0.001)]);
    const before = t.children(and).length + t.get(and).pending.length;
    t.expand(and, [pv("I9", 0.31), pv("G7", 0.002)]);
    expect(t.children(and).length + t.get(and).pending.length).toBe(before);
  });

  it("승률 없는 방어는 펼친다 — 가망 없음으로 지우지 않는다", () => {
    const t = tree();
    const and = t.addChild(0, m("H8"), 0.6, false, 0);
    t.expand(and, [pv("I9", null), pv("G7", 0.001)]);
    expect(lastsOf(t, t.children(and))).toEqual([m("I9")]);
    expect(t.get(and).pending).toEqual([m("G7")]);
  });

  it("모르는 승률은 아는 승률을 앞지르지 않는다", () => {
    const t = tree({ bestFirst: true });
    t.expand(0, [pv("H8", null), pv("I9", 0.1)]);
    expect(last(t, t.children(0)[0]!)).toEqual(m("I9"));
  });

  it("모르는 승률은 마디의 추정이 되지 않는다", () => {
    const t = tree();
    const a = t.addChild(0, m("H8"), 0.62, false, 0);
    t.onSearchResult(a, [pv("I9", null), pv("G7", null)]);
    expect(t.get(a).wratt).toBeCloseTo(0.62, 9);
  });

  it("메이트와 백분율을 한 눈금에", () => {
    const t = tree({ bestFirst: false, nbest: 4 });
    t.expand(0, [pv("H8", 0.01, -3), pv("I9", 0.99, 0), pv("G7", 0.2, 5), pv("F6", 0.01, -30)]);
    expect(lastsOf(t, t.children(0))).toEqual([m("G7"), m("I9"), m("F6"), m("H8")]);
  });
});

describe("덧그림", () => {
  it("탐색 중인 줄과 뿌리 후보마다의 상태", () => {
    const t = tree({ bestFirst: true, budget0Sec: 7 });
    t.expand(0, [pv("H8", 0.72), pv("I9", 0.6), pv("G7", 0.5)]);
    const open = t.children(0)[0]!;
    const defense = t.addChild(open, m("J10"), 0.4, false, 0);
    const o = t.overlay(defense, 3);
    expect(o.line).toEqual([m("H8"), m("J10")]);
    expect(isAttackPly(1)).toBe(true);
    expect(isAttackPly(2)).toBe(false);
    // 1수째가 대국의 4수째라 백
    expect(isBlackPly(o, 1)).toBe(false);
    const h8 = o.marks.get("7,7")!;
    expect(h8.mark).toBe("open");
    expect(budgetText(h8.budget, o.byDepth)).toBe("7초");
    expect(o.marks.get(`${m("I9").x},${m("I9").y}`)!.mark).toBe("latent");
    expect(o.marks.get(`${m("G7").x},${m("G7").y}`)!.mark).toBe("latent");
  });

  it("정해진 · 소진된 후보는 제 표식", () => {
    const t = tree({ bestFirst: false, nbest: 3 });
    t.expand(0, [pv("H8", 0.7), pv("I9", 0.6), pv("G7", 0.5)]);
    const [a, b, c] = t.children(0) as [number, number, number];
    t.resolve(b, "nowin", "mate", -30, 3, "search");
    t.get(c).state = "exhausted";
    const o = t.overlay(null, 0);
    const k = (i: number) => `${last(t, i).x},${last(t, i).y}`;
    expect(o.marks.get(k(a))!.mark).toBe("open");
    expect(o.marks.get(k(b))!.mark).toBe("loss");
    expect(o.marks.get(k(c))!.mark).toBe("exh");
    expect(o.line).toEqual([]);
  });

  it("깊이 예산은 깊이로 적는다", () => {
    const t = tree({ byDepth: true, depth0: 12 });
    t.expand(0, [pv("H8", 0.7)]);
    const o = t.overlay(null, 0);
    expect(budgetText(o.marks.get("7,7")!.budget, o.byDepth)).toBe("d12");
    expect(budgetText(150, false)).toBe("99+");
  });
});

describe("값 · 문구", () => {
  it("negamax 는 메이트를 이긴 쪽에서 한 수 멀리", () => {
    const t = tree();
    expect(t.negamaxUp(29996)).toBe(-29995);
    expect(t.negamaxUp(-29996)).toBe(29995);
    expect(t.negamaxUp(120)).toBe(-120);
  });

  it("배지 줄은 데스크톱처럼 읽힌다", () => {
    const running = {
      ...IDLE_PROGRESS,
      running: true,
      phase: "search" as const,
      resolved: 3,
      searches: 11,
      open: 4,
      attack: true,
      budget: 20000,
      depth: 17,
      winRatePct: 88,
      elapsedSec: 6,
      candIndex: 2,
      candTotal: 4,
    };
    const [first, second] = badgeLines(running);
    expect(first).toBe("증명: 해결 3 / 탐색 11 / 미결 4");
    expect(second).toBe("공격  d17 88%  6s/20s  후보 2/4");
    expect(
      badgeLines({ ...running, byDepth: true, budget: 24, mate: -9, attack: false })[1].startsWith(
        "방어  d17/24 M9  6s",
      ),
    ).toBe(true);
    expect(badgeLines({ ...running, phase: "query" })[1]).toBe("");
  });

  it("설정은 상한을 시작값 위로 묶는다", () => {
    const f = sanitizeProveOptions({
      ...DEFAULT_PROVE_OPTIONS,
      budget0Sec: 900,
      budgetMaxSec: 1,
      depth0: 200,
      depthMax: 2,
      nbest: 99,
    });
    expect(f.budget0Sec).toBe(600);
    expect(f.budgetMaxSec).toBe(600);
    expect(f.depth0).toBe(64);
    expect(f.depthMax).toBe(64);
    expect(f.nbest).toBe(NBEST_MAX);
  });

  it("결과 문구는 차례 · 판정 · 근거를 말한다", () => {
    const proven: ProveOutcome = {
      cancelled: false,
      resolved: true,
      win: true,
      kind: "mate",
      blackToMove: true,
      searches: 12,
      conclusions: 5,
      dbWrites: 3,
      attackerWinRatePct: 100,
    };
    expect(outcomeMessage(proven)).toBe(
      "흑 (차례): 승리 증명됨 (메이트)\n탐색 12회, 결론 5개, DB 기록 3개",
    );
    expect(
      outcomeMessage({ ...proven, win: false, kind: "db", blackToMove: false }).startsWith(
        "백 (차례): 승리 불가 (방어 성립/무승부) (데이터베이스)",
      ),
    ).toBe(true);
    expect(
      outcomeMessage({ ...proven, resolved: false, attackerWinRatePct: 71 }).startsWith(
        "미결 (예산 소진), 공격측 승률 ~71%",
      ),
    ).toBe(true);
    // DB 가 없는 웹 실행
    const web = outcomeMessage({ ...proven, dbWrites: null });
    expect(web).toBe("흑 (차례): 승리 증명됨 (메이트)\n탐색 12회, 결론 5개");
    expect(outcomeMessage({ ...proven, dbWrites: null, resolved: false })).toMatch(
      /DB 가 없어 결론이 남지 않습니다/,
    );
  });
});
