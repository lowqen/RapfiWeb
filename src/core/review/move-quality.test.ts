import { describe, expect, it } from "vitest";
import {
  coord,
  currentBadge,
  grade,
  ordinalOf,
  tally,
  winRateAt,
  winRateCell,
  worst,
  type GradingPreset,
  type PositionRecord,
  type ReviewData,
} from "./move-quality";
import { fromLabel, move, type Move } from "../model/move";

/**
 * 판정기를 데스크톱 `classify_moves` / `mq_tally`(main.c:1398 / 1585)에 — 앱
 * `MoveQualityTest` · `CurrentBadgeTest` 의 이식. 여기의 모든 경우가 데스크톱이 긋는
 * 문턱이라, 어긋나면 같은 리뷰 자료에 다른 등급이 나온다.
 */

const size = 15;
/** 해 없는 수 한 줄 — 등급에는 기록만 쓰인다. */
const line = (n: number): Move[] =>
  Array.from({ length: n }, (_, i) => move(i % size, Math.floor(i / size)));
const rec = (
  wr: number | null,
  mate = 0,
  best: Move | null = null,
  gap: number | null = null,
): PositionRecord => ({ blackWinRate: wr, blackMate: mate, best, gap });
const data = (...records: PositionRecord[]): ReviewData => ({
  moves: line(records.length - 1),
  size,
  records,
});
const gradeOf = (d: ReviewData, index: number, preset: GradingPreset = "default") =>
  grade(d, preset, false)[index - 1]!;

describe("dWR 문턱", () => {
  it("데스크톱 배율과 같다", () => {
    const cases: [number, string][] = [
      [0.6, "best"],
      [0.585, "excellent"],
      [0.55, "good"],
      [0.49, "inaccuracy"],
      [0.4, "mistake"],
      [0.2, "blunder"],
    ];
    for (const [after, expected] of cases) {
      expect(gradeOf(data(rec(0.6), rec(after)), 1).quality).toBe(expected);
    }
  });

  it("엄격한 기준은 같은 손실을 더 무겁게 매긴다", () => {
    const d = data(rec(0.6), rec(0.55));
    expect(gradeOf(d, 1, "default").quality).toBe("good");
    expect(gradeOf(d, 1, "strict").quality).toBe("inaccuracy");
    expect(gradeOf(d, 1, "lenient").quality).toBe("good");
  });

  it("이기던 판을 지는 판으로 만들면 언제나 대실수", () => {
    expect(gradeOf(data(rec(0.7), rec(0.34)), 1, "lenient").quality).toBe("blunder");
    expect(gradeOf(data(rec(0.6), rec(0.24)), 1, "lenient").quality).toBe("mistake");
  });

  it("엔진의 수는 손실이 있어도 최선", () => {
    const played = line(1)[0]!;
    expect(gradeOf(data(rec(0.6, 0, played), rec(0.4)), 1).quality).toBe("best");
  });
});

describe("특별 등급", () => {
  it("알려지지 않았던 필승을 세우면 명수", () => {
    expect(gradeOf(data(rec(0.5), rec(1, 3)), 1).quality).toBe("brilliant");
  });

  it("차선과 크게 벌어진 유일한 결정타는 명수", () => {
    const played = line(1)[0]!;
    expect(gradeOf(data(rec(0.65, 0, played, 0.3), rec(0.95)), 1).quality).toBe("brilliant");
  });

  it("판을 지키는 유일한 수는 훌륭한 수", () => {
    const played = line(1)[0]!;
    expect(gradeOf(data(rec(0.55, 0, played, 0.2), rec(0.6)), 1).quality).toBe("great");
  });

  it("다른 수가 가망 없을 만큼 진 판의 막기는 그냥 최선", () => {
    const played = line(1)[0]!;
    expect(gradeOf(data(rec(0.55, 0, played, 0.52), rec(0.6)), 1).quality).toBe("best");
  });

  it("필승을 잃으면 놓친 승리", () => {
    expect(gradeOf(data(rec(1, 4), rec(0.5)), 1).quality).toBe("missedWin");
  });

  it("메이트 자료 없이 이미 진 판은 강제", () => {
    expect(gradeOf(data(rec(0.03), rec(0.02)), 1).quality).toBe("forced");
  });

  it("양쪽 메이트 거리가 정확하면 버틴 정도를 매긴다", () => {
    const cases: [number, string][] = [
      [-9, "best"],
      [-8, "good"],
      [-6, "inaccuracy"],
      [-3, "mistake"],
    ];
    for (const [after, expected] of cases) {
      expect(gradeOf(data(rec(0, -10), rec(0, after)), 1).quality).toBe(expected);
    }
    expect(gradeOf(data(rec(0, -20), rec(0, -9)), 1).quality).toBe("blunder");
  });
});

describe("보간과 N", () => {
  it("빈 값은 그래프를 위해 보간한다", () => {
    const d = data(rec(0.2), rec(null), rec(null), rec(0.8));
    expect(winRateAt(d, 1, 3)).toBeCloseTo(0.4, 9);
    expect(winRateAt(d, 2, 3)).toBeCloseTo(0.6, 9);
  });

  it("빈 리뷰는 50% 에 앉는다", () => {
    expect(winRateAt(data(rec(null), rec(null)), 1, 1)).toBe(0.5);
  });

  it("건너뛴 첫 수들은 등급이 없다", () => {
    const d: ReviewData = {
      moves: line(6),
      size,
      records: Array.from({ length: 7 }, () => rec(0.5)),
    };
    const g = grade(d, "default", true);
    expect(g.slice(0, 5).map((m) => m.quality)).toEqual(Array(5).fill("none"));
    expect(g[5]!.quality).not.toBe("none");
  });
});

describe("집계", () => {
  it("정확도는 데스크톱의 지수 평균", () => {
    const t = tally(grade(data(rec(0.6), rec(0.5), rec(0.5)), "default", false));
    expect(t.blackAccuracy!).toBeCloseTo(100 * Math.exp((-0.1 * 100) / 40), 6);
    expect(t.whiteAccuracy!).toBeCloseTo(100, 6);
  });

  it("등급 매긴 수가 없는 쪽은 정확도가 없다", () => {
    const t = tally(grade(data(rec(0.5), rec(0.5)), "default", true));
    expect(t.blackAccuracy).toBeNull();
    expect(t.whiteAccuracy).toBeNull();
  });

  it("강제 수는 세지만 정확도에는 넣지 않는다", () => {
    const t = tally(grade(data(rec(0.02), rec(0.01)), "default", false));
    expect(t.counts.get("forced")).toEqual([1, 0]);
    expect(t.blackAccuracy).toBeNull();
  });
});

describe("최악의 수", () => {
  it("손실 순으로 줄 세운다", () => {
    const d = data(rec(0.5), rec(0.3), rec(0.35), rec(0.05));
    expect(worst(grade(d, "default", false)).map((m) => m.index)).toEqual([3, 1]);
  });

  it("놓친 승리는 더 큰 손실보다 위다", () => {
    const d = data(rec(1, 3), rec(0.75), rec(0.8), rec(0.1));
    const w = worst(grade(d, "default", false));
    expect(w.map((m) => m.index)).toEqual([1, 3]);
    expect(w[0]!.quality).toBe("missedWin");
    expect(w[1]!.delta).toBeGreaterThan(w[0]!.delta);
  });

  it("깔끔한 대국에는 최악의 수가 없다", () => {
    expect(worst(grade(data(rec(0.5), rec(0.5), rec(0.5)), "default", false))).toEqual([]);
  });
});

describe("칸", () => {
  it("좌표는 소문자, 행은 아래에서", () => {
    expect(coord(move(7, 7), size)).toBe("h8");
    expect(coord(move(0, 0), size)).toBe("a15");
    expect(coord(null, size)).toBe("-");
  });

  it("승률 칸은 메이트와 보간을 보여 준다", () => {
    const g = grade(data(rec(0.5), rec(1, 3), rec(null)), "default", false);
    expect(winRateCell(g[0]!)).toBe("B M3");
    expect(winRateCell(g[1]!).startsWith("(")).toBe(true);
  });

  it("서수는 데스크톱 순서", () => {
    expect(ordinalOf("brilliant")).toBe(1);
    expect(ordinalOf("forced")).toBe(10);
  });
});

// ── 판 배지 (CurrentBadgeTest) ───────────────────────────────────────

describe("판 배지", () => {
  const cell = (s: string) => fromLabel(s, size)!;
  /** 건너뛰는 첫 수(5)를 넘길 만큼 긴 수순. */
  const seven = ["h8", "i9", "j10", "k11", "g7", "f6", "e5"].map(cell);
  const records = (...rates: (number | null)[]) => rates.map((r) => rec(r));

  it("양쪽에 평가 하나씩이면 리뷰 없이도 매긴다", () => {
    expect(currentBadge(seven, size, records(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.2))).toBe(
      "blunder",
    );
  });

  it("좋은 수는 좋게 매긴다", () => {
    const q = currentBadge(seven, size, records(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.6));
    expect(q).not.toBeNull();
    expect(["blunder", "mistake"]).not.toContain(q);
  });

  it("양쪽 모두 실제 기록이 없으면 배지도 없다", () => {
    expect(
      currentBadge(seven, size, records(0.5, null, null, null, null, null, null, null)),
    ).toBeNull();
    expect(currentBadge(seven, size, [])).toBeNull();
  });

  it("새 값 하나로도 배지가 나온다", () => {
    expect(
      currentBadge(seven, size, records(0.5, null, null, null, null, null, null, 0.05)),
    ).not.toBeNull();
  });

  it("첫 수 건너뛰기를 켜면 개시는 매기지 않는다", () => {
    const short = seven.slice(0, 3);
    const r = records(0.5, 0.5, 0.6, 0.1);
    expect(currentBadge(short, size, r, "default", true)).toBeNull();
    expect(currentBadge(short, size, r, "default", false)).not.toBeNull();
  });

  it("빈 판은 매길 것이 없다", () => {
    expect(currentBadge([], size, records(0.5))).toBeNull();
  });

  it("배지는 언제나 판의 마지막 수다", () => {
    const r = records(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.2);
    expect(currentBadge(seven, size, r)).toBe("blunder");
    expect(currentBadge(seven.slice(0, -1), size, r)).not.toBe("blunder");
  });

  it("메이트 기록이 판정기까지 간다 — 필승을 버리면 놓친 승리", () => {
    const r = [...records(0.5, 0.5, 0.5, 0.5, 0.5, 0.5), rec(1, 5), rec(0, -4)];
    expect(currentBadge(seven, size, r)).toBe("missedWin");
  });

  it("엄격한 기준은 적어도 관대한 기준만큼 무겁다", () => {
    const r = records(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.47);
    const strict = currentBadge(seven, size, r, "strict")!;
    const lenient = currentBadge(seven, size, r, "lenient")!;
    expect(ordinalOf(strict)).toBeGreaterThanOrEqual(ordinalOf(lenient));
  });
});
