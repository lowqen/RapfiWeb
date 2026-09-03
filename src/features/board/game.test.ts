import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGameStore } from "./gameStore";
import { useBoardStore } from "./boardStore";
import { getGameHandlers, useEngineStore } from "../../engine/engine-state";
import { move, type Move } from "../../core/model/move";
import type { ComputerSide, OpeningProtocol } from "../../core/model/game";
import type { EngineCommand, EngineStatus, Placement } from "../../engine/engine-types";
import type { OpeningResponse } from "../../engine/engine-client";

/**
 * 협상 상태 기계 — 엔진 없이 돌린다.
 *
 * 엔진 스토어의 `send`/`play` 를 기록기로 갈아 끼우고, 엔진의 답은
 * `getGameHandlers()` 로 직접 밀어 넣는다. 그래야 협상 **전체 수순**을
 * 워커·wasm 없이 한 시험 안에서 볼 수 있다. 확인하는 것은 두 가지뿐이다:
 * 어떤 명령이 어떤 순서로 나갔는가, 그리고 판과 상태가 어떻게 되었는가.
 */

const sent: EngineCommand[] = [];
const plays: { stones: readonly Placement[]; empty: boolean }[] = [];

const g = () => useGameStore.getState();
const stones = () => useBoardStore.getState().render.stones;
const kinds = () => sent.map((c) => c.kind);

/** 특정 종류의 명령만 골라 본다 — 순서 검사가 다른 명령에 흔들리지 않게. */
function only<K extends EngineCommand["kind"]>(k: K): Extract<EngineCommand, { kind: K }>[] {
  return sent.filter((c): c is Extract<EngineCommand, { kind: K }> => c.kind === k);
}

const reply = (r: OpeningResponse) => getGameHandlers().onOpening?.(r);
const engineMoves = (...ms: Move[]) => getGameHandlers().onEngineMove?.(ms);

/** `MESSAGE SWAP2 MOVE<i>` / `MESSAGE SOOSORV MOVE<i>` 하나. */
const openingMove = (swap2: boolean, index: number, m: Move, fifthCount: number | null = null) =>
  reply({ kind: "openingMove", swap2, index, move: m, fifthCount, raw: "" });

/** `SWAP<which> YES|NO`. */
const openingSwap = (swap2: boolean, which: number, yes: boolean) =>
  reply({ kind: "openingSwap", swap2, which, yes, raw: "" });

const resetSpies = () => {
  sent.length = 0;
  plays.length = 0;
};

function fresh(
  opts: {
    computerSide?: ComputerSide;
    opening?: OpeningProtocol;
    status?: EngineStatus;
    showForbidden?: boolean;
  } = {},
) {
  useEngineStore.setState({
    // 기본은 idle 이다 — 그래야 금수 조회가 나가지 않아 `sent` 가 협상만 담는다.
    status: opts.status ?? "idle",
    send: (...cmds: EngineCommand[]) => {
      sent.push(...cmds);
    },
    play: async (s, empty) => {
      plays.push({ stones: s, empty });
    },
  });
  useGameStore.setState({
    computerSide: opts.computerSide ?? "none",
    opening: opts.opening ?? "none",
    showForbidden: opts.showForbidden ?? false,
  });
  g().newGame();
  resetSpies();
}

beforeEach(() => {
  sent.length = 0;
  plays.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 평범한 대국 ───────────────────────────────────────────────────────

describe("자유 렌주", () => {
  it("사람이 두면 엔진에게 차례가 넘어간다", () => {
    fresh({ computerSide: "white" });
    expect(g().tap(move(7, 7))).toEqual({ kind: "placed" });
    expect(stones()).toHaveLength(1);
    expect(plays).toHaveLength(1);
    expect(g().thinking).toBe(true);

    engineMoves(move(8, 8));
    expect(stones()).toHaveLength(2);
    expect(g().thinking).toBe(false);
    // 다음은 사람 차례이므로 더 묻지 않는다.
    expect(plays).toHaveLength(1);
  });

  it("새 대국은 엔진이 흑이어도 스스로 시작하지 않는다", () => {
    // 데스크톱·앱과 같다 — 판을 한 번 눌러야 «두어라»가 된다.
    fresh({ computerSide: "black" });
    expect(plays).toHaveLength(0);
    expect(g().thinking).toBe(false);
  });

  it("엔진 차례에 누르면 «두어라»라는 뜻이다", () => {
    fresh({ computerSide: "black" });
    expect(g().tap(move(3, 3))).toEqual({ kind: "ignored" });
    // 누른 자리에 돌이 놓이지는 않는다.
    expect(stones()).toHaveLength(0);
    expect(plays).toHaveLength(1);
    expect(plays[0]!.empty).toBe(true);
  });

  it("탐색 중과 종국 뒤의 탭은 거절된다", () => {
    fresh({ computerSide: "white" });
    g().tap(move(7, 7));
    expect(g().tap(move(6, 6)).kind).toBe("rejected");

    engineMoves(move(8, 8));
    g().resign();
    expect(g().tap(move(5, 5)).kind).toBe("rejected");
  });

  it("양쪽을 다 잡으면 엔진이 이어서 둔다", () => {
    fresh({ computerSide: "both" });
    g().tap(move(7, 7)); // «두어라»
    expect(plays).toHaveLength(1);
    engineMoves(move(7, 7));
    // 다음 차례도 엔진 것이므로 곧바로 다시 묻는다.
    expect(plays).toHaveLength(2);
  });

  it("둘 수 없는 답은 대국의 끝이다", () => {
    fresh({ computerSide: "white" });
    g().tap(move(7, 7));
    engineMoves(move(7, 7)); // 이미 돌이 있는 자리
    expect(g().result).toEqual({ end: "resigned", winner: "black" });
  });
});

// ── 첫 수 이후 교환 ───────────────────────────────────────────────────

describe("첫 수 이후 교환", () => {
  it("먼 개시면 엔진이 색을 가져가고 알린다", () => {
    fresh({ computerSide: "white", opening: "swapFirst" });
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    g().tap(move(7, 7)); // 천원 — 접으면 (7,7) 이라 교환 조건에 걸린다
    expect(g().computerSide).toBe("black");
    expect(g().prompt).toEqual({ kind: "swapInfo" });
    expect(stones()).toHaveLength(1);
  });

  it("가장자리 개시면 그대로 두고 엔진이 이어 둔다", () => {
    fresh({ computerSide: "white", opening: "swapFirst" });
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    g().tap(move(1, 9));
    expect(g().computerSide).toBe("white");
    expect(g().prompt).toBeNull();
    expect(plays).toHaveLength(1);
  });

  it("빈 판을 누르면 정해진 개시를 두고 교환할지 묻는다", () => {
    fresh({ computerSide: "black", opening: "swapFirst" });
    expect(g().tap(move(0, 0))).toEqual({ kind: "placed" });
    // 데스크톱의 make_move(1, 7) — 누른 자리가 아니라 정해진 자리다.
    expect(stones()).toEqual([move(7, 1)]);
    expect(g().prompt).toEqual({ kind: "swap" });
  });

  it("교환을 받으면 정해진 답수를 두고 색이 넘어간다", () => {
    fresh({ computerSide: "black", opening: "swapFirst" });
    g().tap(move(0, 0));
    g().answerSwap(true);
    expect(stones()).toEqual([move(7, 1), move(5, 4)]);
    expect(g().computerSide).toBe("white");
    expect(g().prompt).toBeNull();
  });
});

// ── 스왑2 ─────────────────────────────────────────────────────────────

describe("스왑2", () => {
  it("개시 세 돌은 색과 무관하게 사람이 놓는다", () => {
    // 컴퓨터가 백이어도 백돌(2수)을 사람이 놓는다 — 색이 아직 정해지지 않았다.
    fresh({ computerSide: "white", opening: "swap2" });
    expect(g().tap(move(7, 7))).toEqual({ kind: "placed" });
    expect(g().tap(move(7, 8))).toEqual({ kind: "placed" });
    expect(g().tap(move(8, 8))).toEqual({ kind: "placed" });
    expect(stones()).toHaveLength(3);
    // 셋째 돌 뒤에 판정을 부탁한다: 분석 보드를 밀고 2단계.
    expect(kinds()).toEqual(["yxboard", "yxswap2step"]);
    expect(only("yxswap2step")[0]!.step).toBe(2);
    expect(g().thinking).toBe(true);
  });

  it("엔진이 백을 유지하면 그대로 이어 둔다", () => {
    fresh({ computerSide: "white", opening: "swap2" });
    g().tap(move(7, 7));
    g().tap(move(7, 8));
    g().tap(move(8, 8));
    openingSwap(true, 1, false);
    expect(g().swapDone).toBe(true);
    expect(g().computerSide).toBe("white");
    expect(plays).toHaveLength(1);
  });

  it("엔진이 흑을 가져가면 색이 바뀌고 알림이 뜬다", () => {
    fresh({ computerSide: "white", opening: "swap2" });
    g().tap(move(7, 7));
    g().tap(move(7, 8));
    g().tap(move(8, 8));
    openingSwap(true, 1, true);
    expect(g().computerSide).toBe("black");
    expect(g().prompt).toEqual({ kind: "swapInfo" });
    expect(g().thinking).toBe(false);
  });

  it("엔진이 흑이면 제 손으로 세 돌을 놓고 사람에게 고르게 한다", () => {
    fresh({ computerSide: "black", opening: "swap2" });
    // 협상을 여는 것은 newGame 이다 — 다시 한 번 열어 명령을 본다.
    resetSpies();
    g().newGame();
    expect(only("yxswap2step").at(-1)!.step).toBe(1);
    expect(g().thinking).toBe(true);

    openingMove(true, 1, move(7, 7), null);
    openingMove(true, 2, move(7, 8), null);
    expect(g().prompt).toBeNull();
    openingMove(true, 3, move(8, 8), null);

    expect(stones()).toHaveLength(3);
    expect(g().prompt).toEqual({ kind: "swap2" });
    expect(g().thinking).toBe(false);
  });

  it("«두 수 추가»를 고르면 사람이 두 돌을 놓고 다시 판정시킨다", () => {
    fresh({ computerSide: "black", opening: "swap2" });
    openingMove(true, 1, move(7, 7), null);
    openingMove(true, 2, move(7, 8), null);
    openingMove(true, 3, move(8, 8), null);
    resetSpies();

    g().answerSwap2("addTwo");
    expect(g().swapDone).toBe(false);
    expect(g().tap(move(9, 9))).toEqual({ kind: "placed" });
    expect(g().tap(move(9, 8))).toEqual({ kind: "placed" });
    expect(stones()).toHaveLength(5);
    expect(only("yxswap2step").at(-1)!.step).toBe(3);
  });

  it("«색 교환»을 고르면 색이 바뀌고 엔진이 둔다", () => {
    fresh({ computerSide: "black", opening: "swap2" });
    useGameStore.setState({ computerSide: "black", opening: "swap2", prompt: { kind: "swap2" } });
    g().answerSwap2("swap");
    expect(g().computerSide).toBe("white");
    expect(g().swapDone).toBe(true);
    expect(plays).toHaveLength(1);
  });

  it("«아니오»에도 색이 넘어간다 — 데스크톱이 그렇다", () => {
    fresh({ computerSide: "white", opening: "swap2" });
    useGameStore.setState({ prompt: { kind: "swap" } });
    g().answerSwap(false);
    expect(g().computerSide).toBe("black");
  });
});

// ── Soosorv-8 ─────────────────────────────────────────────────────────

/** 개시 영역을 지키는 세 수: 천원 · 한 점 이내 · 두 점 이내. */
const OPENING_THREE = [move(7, 7), move(8, 7), move(9, 5)] as const;

describe("Soosorv-8", () => {
  function openingByHand() {
    for (const m of OPENING_THREE) g().tap(m);
  }

  it("개시 세 수 안에서는 엔진에게 두라고 하지 않는다", () => {
    fresh({ computerSide: "white", opening: "soosorv" });
    g().tap(OPENING_THREE[0]);
    g().tap(OPENING_THREE[1]);
    expect(plays).toHaveLength(0);
  });

  it("세 수를 놓으면 2단계를 보낸다 — 판은 따로 밀지 않는다", () => {
    fresh({ computerSide: "white", opening: "soosorv" });
    openingByHand();
    // yxsoosorvstep 은 수 목록을 스스로 들고 간다.
    expect(kinds()).toEqual(["yxsoosorvstep"]);
    const step = only("yxsoosorvstep")[0]!;
    expect(step.step).toBe(2);
    expect(step.moves).toHaveLength(3);
  });

  it("개시 영역을 벗어나면 판을 되돌리고 알린다", () => {
    fresh({ computerSide: "white", opening: "soosorv" });
    g().tap(move(0, 0));
    g().tap(move(1, 1));
    g().tap(move(2, 2));
    expect(stones()).toHaveLength(0);
    expect(g().prompt).toEqual({ kind: "illegalOpening" });
  });

  it("교환하지 않으면 3단계로 이어진다", () => {
    fresh({ computerSide: "white", opening: "soosorv" });
    openingByHand();
    sent.length = 0;
    openingSwap(false, 1, false);
    expect(only("yxsoosorvstep").at(-1)!.step).toBe(3);
  });

  it("MOVE4 는 N 을 함께 알리고 후보 단계를 연다", () => {
    fresh({ computerSide: "white", opening: "soosorv" });
    openingByHand();
    openingMove(false, 4, move(6, 7), 3);
    expect(stones()).toHaveLength(4);
    expect(g().fifthCount).toBe(3);
    expect(g().offeringFifth).toBe(true);
    expect(g().prompt).toEqual({ kind: "swap", fifthCount: 3 });
  });

  it("후보를 N개 다 놓으면 6단계를 보낸다", () => {
    fresh({ computerSide: "white", opening: "soosorv" });
    openingByHand();
    openingMove(false, 4, move(6, 7), 2);
    g().answerSwap(false);
    sent.length = 0;

    g().tap(move(5, 5));
    expect(g().offeringFifth).toBe(true);
    expect(only("yxsoosorvstep")).toHaveLength(0); // 아직 하나 남았다
    g().tap(move(5, 6));
    expect(only("yxsoosorvstep").at(-1)!.step).toBe(6);
    expect(g().offeringFifth).toBe(false);
    expect(g().fifthStageDone).toBe(true);
  });

  it("엔진이 5수를 고르면 판이 넷으로 되감기고 그 하나만 남는다", () => {
    fresh({ computerSide: "white", opening: "soosorv" });
    openingByHand();
    openingMove(false, 4, move(6, 7), 2);
    g().answerSwap(false);
    g().tap(move(5, 5));
    g().tap(move(5, 6));

    reply({ kind: "soosorvFifth", stage: "choose", move: move(5, 6), raw: "" });
    expect(stones()).toHaveLength(5);
    expect(stones().at(-1)).toEqual(move(5, 6));
    expect(plays).toHaveLength(1);
  });

  it("사람이 후보 하나를 눌러 고를 수도 있다", () => {
    fresh({ computerSide: "white", opening: "soosorv" });
    openingByHand();
    openingMove(false, 4, move(6, 7), 2);
    g().answerSwap(false);
    g().tap(move(5, 5));
    // 아직 offeringFifth 인 동안 이미 놓인 후보를 누르면 그것이 5수가 된다.
    useGameStore.setState({ offeringFifth: true, computerSide: "none" });
    expect(g().tap(move(5, 5))).toEqual({ kind: "placed" });
    expect(stones()).toHaveLength(5);
    expect(stones().at(-1)).toEqual(move(5, 5));
    expect(g().offeringFifth).toBe(false);
  });

  it("N을 고르면 4단계가 그 수와 함께 나간다", () => {
    fresh({ computerSide: "black", opening: "soosorv" });
    useGameStore.setState({ prompt: { kind: "fifthCount" } });
    sent.length = 0;
    g().answerFifthCount(5);
    const step = only("yxsoosorvstep").at(-1)!;
    expect(step.step).toBe(4);
    expect(step.fifthCount).toBe(5);
    expect(g().fifthCount).toBe(5);
  });

  it("N은 1~8 로 잘린다", () => {
    fresh({ computerSide: "black", opening: "soosorv" });
    g().answerFifthCount(99);
    expect(g().fifthCount).toBe(8);
    g().answerFifthCount(0);
    expect(g().fifthCount).toBe(1);
  });
});

// ── RIF ───────────────────────────────────────────────────────────────

describe("RIF 오프닝", () => {
  it("첫 세 수는 손으로 놓고, 그 뒤에야 엔진이 움직인다", () => {
    fresh({ computerSide: "white", opening: "rif" });
    g().tap(move(7, 7));
    g().tap(move(8, 7));
    expect(plays).toHaveLength(0);
    g().tap(move(9, 5));
    // 세 수가 차면 평범한 대국이다 — 백 차례이므로 엔진이 받는다.
    expect(plays).toHaveLength(1);
    // 협상 명령은 오가지 않는다.
    expect(kinds()).not.toContain("yxsoosorvstep");
    expect(kinds()).not.toContain("yxswap2step");
  });
});

// ── 시계 · 종국 ───────────────────────────────────────────────────────

describe("대국 패널의 동작", () => {
  it("기권은 지금 둘 차례의 반대를 이기게 하고 엔진에도 알린다", () => {
    fresh({ computerSide: "white" });
    g().tap(move(7, 7));
    engineMoves(move(8, 8));
    sent.length = 0;
    g().resign(); // 흑 차례에서 기권
    expect(g().result).toEqual({ end: "resigned", winner: "white" });
    expect(kinds()).toContain("yxresign");
  });

  it("무승부 제안은 그 자리에서 무승부다", () => {
    fresh();
    g().tap(move(7, 7));
    sent.length = 0;
    g().offerDraw();
    expect(g().result).toEqual({ end: "drawAgreed", winner: null });
    expect(kinds()).toContain("yxdraw");
  });

  it("사람 시계가 다 되면 대국이 끝나고 한 번만 알린다", () => {
    fresh();
    g().setClockLimits({ limited: true, turnLimitMs: 1_000, matchLimitMs: 10_000 });
    useGameStore.setState({ clock: { ...g().clock, running: "human" } });
    g().advanceClock(1_500);
    expect(g().result).toEqual({ end: "timeout", winner: "white" });
    expect(g().prompt).toEqual({ kind: "timeout" });
    expect(g().clock.timedOutNotified).toBe(true);

    // 두 번째 틱은 아무 일도 하지 않는다.
    g().dismissPrompt();
    g().advanceClock(1_000);
    expect(g().prompt).toBeNull();
  });

  it("무르기는 결과를 되돌린다", () => {
    fresh();
    // 흑 5목을 만들고 무른다.
    const line = [move(3, 7), move(4, 7), move(5, 7), move(6, 7), move(7, 7)];
    const filler = [move(0, 14), move(2, 14), move(4, 14), move(6, 14)];
    for (let i = 0; i < line.length; i++) {
      g().tap(line[i]!);
      if (i < filler.length) g().tap(filler[i]!);
    }
    expect(g().result?.end).toBe("five");
    g().undoMove();
    expect(g().result).toBeNull();
    expect(stones()).toHaveLength(8);
  });

  it("새 대국은 판과 협상 상태를 함께 비운다", () => {
    fresh({ computerSide: "white", opening: "soosorv" });
    for (const m of OPENING_THREE) g().tap(m);
    useGameStore.setState({ offeringFifth: true, fifthCount: 4, swapDone: true });
    g().newGame();
    expect(stones()).toHaveLength(0);
    expect(g().offeringFifth).toBe(false);
    expect(g().fifthCount).toBe(1);
    expect(g().swapDone).toBe(false);
    expect(g().thinking).toBe(false);
  });
});

// ── 금수 ──────────────────────────────────────────────────────────────

describe("금수", () => {
  it("엔진이 놀고 있고 사람이 흑일 때만 묻는다", () => {
    fresh({ computerSide: "white", status: "ready", showForbidden: true });
    sent.length = 0;
    useGameStore.setState({ showForbidden: false });
    g().toggleForbidden(); // 다시 켠다
    expect(kinds()).toEqual(["yxboard", "yxshowforbid"]);

    // 엔진이 흑을 잡으면 물을 이유가 없다.
    sent.length = 0;
    g().setComputerSide("black");
    expect(kinds()).toHaveLength(0);
  });

  it("금수 자리는 거절하고 이유를 알린다", () => {
    fresh({ computerSide: "white", showForbidden: true });
    useBoardStore.getState().setForbidden([move(4, 4)]);
    const r = g().tap(move(4, 4));
    expect(r.kind).toBe("rejected");
    expect(g().prompt).toEqual({ kind: "forbidden", cell: move(4, 4) });
    expect(stones()).toHaveLength(0);
  });
});
