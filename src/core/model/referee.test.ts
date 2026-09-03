import { describe, it, expect } from "vitest";
import { openingAreaOk, result, swapAfterFirstMove, winningLine } from "./referee";
import { move, type Move } from "./move";

const SIZE = 15;

/**
 * 흑·백을 번갈아 놓되 흑만 의미가 있게. 백이 모자라면 맨 아랫줄에 **두 칸씩
 * 띄어** 버리는 수를 채운다 — 붙여 놓으면 백이 먼저 다섯을 만들어 버려서,
 * 시험하려던 것이 아닌 이유로 판정이 바뀐다.
 */
function alternate(black: readonly Move[]): Move[] {
  const out: Move[] = [];
  let filler = 0;
  for (let i = 0; i < black.length; i++) {
    out.push(black[i]!);
    if (i === black.length - 1) break;
    out.push(move(filler++ * 2, 14));
  }
  return out;
}

describe("승패 — 다섯", () => {
  it("가로 5목이면 방금 둔 쪽이 이긴다", () => {
    const moves = alternate([move(3, 7), move(4, 7), move(5, 7), move(6, 7), move(7, 7)]);
    expect(result(moves, SIZE, true)).toEqual({ end: "five", winner: "black" });
  });

  it("넷은 아직 아무 일도 아니다", () => {
    const moves = alternate([move(3, 7), move(4, 7), move(5, 7), move(6, 7)]);
    expect(result(moves, SIZE, true)).toBeNull();
  });

  it("대각선도 같다", () => {
    const moves = alternate([move(2, 2), move(3, 3), move(4, 4), move(5, 5), move(6, 6)]);
    expect(result(moves, SIZE, true)?.winner).toBe("black");
  });

  it("백도 이긴다 — 색이 아니라 «방금 둔 쪽»이다", () => {
    // 백이 (3..7, 7) 다섯을, 흑은 넷까지만. 마지막 수가 백이라 백 승이다.
    const moves = [
      move(0, 0), // 흑
      move(3, 7), // 백
      move(1, 0),
      move(4, 7),
      move(2, 0),
      move(5, 7),
      move(3, 0), // 흑 넷 — 아직 아니다
      move(6, 7),
      move(0, 12), // 흑 다섯째를 다른 줄로
      move(7, 7), // 백 다섯째
    ];
    expect(result(moves, SIZE, true)).toEqual({ end: "five", winner: "white" });
  });
});

describe("승패 — 장목", () => {
  const six = alternate([move(3, 7), move(4, 7), move(5, 7), move(6, 7), move(7, 7), move(8, 7)]);

  it("렌주에서는 장목도 이긴 것으로 센다", () => {
    // 렌주의 장목 금지는 흑의 **금수**이고 엔진의 FORBID 가 막는다. 여기까지
    // 왔다는 것은 이미 놓였다는 뜻이므로 데스크톱과 같이 승리로 친다.
    expect(result(six, SIZE, true)?.end).toBe("five");
  });

  it("표준 오목(allowOverline=false)에서는 아니다", () => {
    expect(result(six, SIZE, false)).toBeNull();
  });
});

describe("승패 — 판이 다 참", () => {
  it("빈 칸이 없으면 무승부다", () => {
    // 5목이 서지 않게 3×3 판을 다 채운다.
    const moves: Move[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) moves.push(move(x, y));
    expect(result(moves, 3, true)).toEqual({ end: "boardFull", winner: null });
  });
});

describe("이긴 줄", () => {
  it("다섯 점을 순서대로 돌려준다", () => {
    const moves = alternate([move(3, 7), move(4, 7), move(5, 7), move(6, 7), move(7, 7)]);
    expect(winningLine(moves, SIZE, true)).toEqual([
      move(3, 7),
      move(4, 7),
      move(5, 7),
      move(6, 7),
      move(7, 7),
    ]);
  });

  it("이기지 않았으면 빈 배열", () => {
    expect(winningLine([move(7, 7)], SIZE, true)).toEqual([]);
  });
});

describe("개시 영역 (손으로 놓는 첫 세 수)", () => {
  const c = 7;

  it("세 수가 차기 전에는 검사하지 않는다", () => {
    expect(openingAreaOk([], SIZE)).toBe(true);
    expect(openingAreaOk([move(0, 0), move(1, 1)], SIZE)).toBe(true);
  });

  it("천원 · 한 점 이내 · 두 점 이내면 통과", () => {
    expect(openingAreaOk([move(c, c), move(c + 1, c), move(c + 2, c - 2)], SIZE)).toBe(true);
  });

  it("1수가 천원이 아니면 실패", () => {
    expect(openingAreaOk([move(c + 1, c), move(c, c), move(c, c + 1)], SIZE)).toBe(false);
  });

  it("2수가 한 점을 벗어나면 실패", () => {
    expect(openingAreaOk([move(c, c), move(c + 2, c), move(c, c + 1)], SIZE)).toBe(false);
  });

  it("3수가 두 점을 벗어나면 실패", () => {
    expect(openingAreaOk([move(c, c), move(c + 1, c), move(c + 3, c)], SIZE)).toBe(false);
  });
});

describe("첫 수 이후 교환", () => {
  // 앱의 RefereeTest 와 같은 네 자리를 그대로 지킨다.
  it("먼 개시에서는 교환한다", () => {
    expect(swapAfterFirstMove(move(7, 7), SIZE, false)).toBe(true);
    expect(swapAfterFirstMove(move(3, 4), SIZE, false)).toBe(true);
  });

  it("가장자리에서는 교환하지 않는다", () => {
    expect(swapAfterFirstMove(move(0, 0), SIZE, false)).toBe(false);
    expect(swapAfterFirstMove(move(1, 9), SIZE, false)).toBe(false);
  });

  it("경계에 걸친 둘은 동전이 정한다", () => {
    // 접었을 때 (2,3)/(3,2) 인 자리. x+y = 5 라 두 번째 항이 걸리지 않는다.
    expect(swapAfterFirstMove(move(2, 3), SIZE, false)).toBe(false);
    expect(swapAfterFirstMove(move(2, 3), SIZE, true)).toBe(true);
    expect(swapAfterFirstMove(move(3, 2), SIZE, false)).toBe(false);
    expect(swapAfterFirstMove(move(3, 2), SIZE, true)).toBe(true);
  });

  it("판을 접어서 본다 — 반대편 구석도 같은 답이다", () => {
    expect(swapAfterFirstMove(move(SIZE - 1 - 3, SIZE - 1 - 4), SIZE, false)).toBe(true);
    expect(swapAfterFirstMove(move(SIZE - 1, SIZE - 1), SIZE, false)).toBe(false);
  });
});
