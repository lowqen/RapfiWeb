import { describe, expect, it } from "vitest";
import { toEvalView, winRateFromEval } from "./eval-view";
import { EMPTY_STATS, type SearchStats } from "./engine-types";

const stats = (p: Partial<SearchStats>): SearchStats => ({ ...EMPTY_STATS, ...p });

describe("평가 바 — 흑의 관점", () => {
  it("흑 차례 국면(돌 짝수)이면 엔진 값이 곧 흑의 값이다", () => {
    const v = toEvalView(stats({ winRatePct: 70, evalCp: 170 }), 2);
    expect(v).toMatchObject({ blackPct: 70, blackEval: 170, mate: null });
  });

  it("백 차례 국면(돌 홀수)이면 뒤집는다 — 안 그러면 수마다 바가 널뛴다", () => {
    const v = toEvalView(stats({ winRatePct: 70, evalCp: 170 }), 3);
    expect(v).toMatchObject({ blackPct: 30, blackEval: -170 });
  });

  it("외통은 이기는 쪽으로 가득 찬다", () => {
    expect(toEvalView(stats({ mate: 5 }), 4)).toMatchObject({
      blackPct: 100,
      mate: { winner: "black", plies: 5 },
    });
    // 백 차례에서 둘 차례(백)가 진다 → 흑 승
    expect(toEvalView(stats({ mate: -3 }), 5)).toMatchObject({
      blackPct: 100,
      mate: { winner: "black", plies: 3 },
    });
    expect(toEvalView(stats({ mate: 2 }), 5)).toMatchObject({
      blackPct: 0,
      mate: { winner: "white", plies: 2 },
    });
  });

  it("승률이 아직 없으면 평가값에서 채운다 — Rapfi 의 척도(200)로", () => {
    // 엔진 출력 캡처: EVAL −223 ↔ WINRATE 0.24694
    expect(winRateFromEval(-223) / 100).toBeCloseTo(0.24694, 4);
    expect(winRateFromEval(-338) / 100).toBeCloseTo(0.155776, 4);
    const v = toEvalView(stats({ evalCp: -223 }), 0);
    expect(v!.blackPct).toBeCloseTo(24.694, 2);
  });

  it("아무것도 모르면 null — 바는 앞 값을 지킨다", () => {
    expect(toEvalView(EMPTY_STATS, 0)).toBeNull();
  });
});
