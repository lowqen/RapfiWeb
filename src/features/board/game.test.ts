import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGameStore } from "./gameStore";
import { useBoardStore } from "./boardStore";
import { getGameHandlers, useEngineStore } from "../../engine/engine-state";
import { move, type Move } from "../../core/model/move";
import { OPENING_LABEL, type ComputerSide, type OpeningProtocol } from "../../core/model/game";
import type { EngineCommand, EngineStatus, Placement } from "../../engine/engine-types";
import type { OpeningResponse } from "../../engine/engine-client";

/**
 * 대국 상태 기계 — 엔진 없이 돌린다.
 *
 * 엔진 스토어의 `send`/`play` 를 기록기로 갈아 끼우고, 엔진의 답은
 * `getGameHandlers()` 로 직접 밀어 넣는다. 확인하는 것은 두 가지뿐이다:
 * 어떤 명령이 어떤 순서로 나갔는가, 그리고 판과 상태가 어떻게 되었는가.
 *
 * **여기서 만든 답만으로는 부족하다.** 우리가 엔진의 답을 지어내므로 「우리가
 * 상상한 프로토콜」만 검증된다 — 실제로 W4 에서 이 맹점 때문에 엔진이 협상
 * 명령을 모른다는 사실이 오래 숨어 있었다. 진짜 엔진을 붙이는 쪽은
 * `scripts/game-smoke.ts` 다.
 */

const sent: EngineCommand[] = [];
const plays: {
  stones: readonly Placement[];
  empty: boolean;
  budget: { turnMs?: number; matchMs?: number; matchLeftMs?: number } | undefined;
}[] = [];

const g = () => useGameStore.getState();
const stones = () => useBoardStore.getState().render.stones;
const kinds = () => sent.map((c) => c.kind);

const reply = (r: OpeningResponse) => getGameHandlers().onOpening?.(r);
const engineMoves = (...ms: Move[]) => getGameHandlers().onEngineMove?.(ms);

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
    play: async (s, empty, budget) => {
      plays.push({ stones: s, empty, budget });
    },
  });
  useGameStore.setState({
    computerSide: opts.computerSide ?? "none",
    opening: opts.opening ?? "none",
    showForbidden: opts.showForbidden ?? false,
    // 착수 시간은 새 대국이 **일부러** 이어받는다 — 앞 시험의 값이 새어 들지 않게 비운다.
    moveTimeMs: 0,
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

  it("개시 영역을 벗어나면 판을 되돌리고 알린다", () => {
    // 앱은 이 검사를 Soosorv 에만 걸었지만, Soosorv 가 빠진 지금은 **손으로
    // 놓는 개시**(= RIF)에 건다. 화면이 「천원 둘레에」라고 안내하므로
    // 검사가 없으면 화면이 지키지 않는 약속을 하게 된다.
    fresh({ computerSide: "white", opening: "rif" });
    g().tap(move(0, 0));
    g().tap(move(1, 1));
    g().tap(move(2, 2));
    expect(stones()).toHaveLength(0);
    expect(g().prompt).toEqual({ kind: "illegalOpening" });
    // 되돌렸으니 엔진에게 두라고 하지도 않았다.
    expect(plays).toHaveLength(0);
  });

  it("개시 영역 안이면 통과한다", () => {
    fresh({ computerSide: "white", opening: "rif" });
    g().tap(move(7, 7));
    g().tap(move(8, 7));
    g().tap(move(9, 5));
    expect(g().prompt).toBeNull();
    expect(stones()).toHaveLength(3);
  });
});

// ── 빠진 두 개시 ──────────────────────────────────────────────────────

describe("Soosorv-8 · 스왑2 는 없다", () => {
  it("개시 목록이 셋뿐이다", () => {
    // 엔진이 `yxsoosorvstep*` / `yxswap2step*` 를 모르기 때문이다
    // (docs/오프닝-협상-엔진-지원.md). 목록이 늘어나면 이 시험이 먼저 깨진다.
    expect(Object.keys(OPENING_LABEL).sort()).toEqual(["none", "rif", "swapFirst"]);
  });

  it("협상 응답이 와도 삼키지 않고 남긴다", () => {
    // 이 빌드는 협상을 걸지 않으므로 올 일이 없다. 그래도 오면 로그에 남아야
    // 한다 — 「모르는 줄도 버리지 않는다」가 이 저장소의 규칙이다.
    fresh();
    reply({ kind: "openingSwap", swap2: true, which: 1, yes: true, raw: "" });
    expect(g().log.some((l) => l.includes("예상치 못한 협상 응답"))).toBe(true);
    // 그리고 판은 그대로다.
    expect(stones()).toHaveLength(0);
    expect(g().result).toBeNull();
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

  it("새 대국은 판과 물음을 함께 비운다 — 엔진 착수 시간은 지킨다", () => {
    fresh({ computerSide: "white", opening: "rif" });
    g().setMoveTime(3_000);
    g().tap(move(7, 7));
    g().tap(move(8, 7));
    useGameStore.setState({ prompt: { kind: "swapInfo" } });
    g().newGame();
    expect(stones()).toHaveLength(0);
    expect(g().prompt).toBeNull();
    expect(g().thinking).toBe(false);
    expect(g().result).toBeNull();
    expect(g().moveTimeMs).toBe(3_000);
  });

  it("대국 시계는 없다 — 상태에도 명령에도", () => {
    fresh({ computerSide: "white" });
    expect("clock" in g()).toBe(false);
    g().setMoveTime(5_000);
    g().tap(move(7, 7));
    // 대국 예산(timeout_match)은 0, 남은 대국 시간(time_left)은 보내지 않는다.
    expect(plays[0]!.budget).toEqual({ turnMs: 5_000, matchMs: 0 });
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

// ── 착수 예산 ─────────────────────────────────────────────────────────

describe("착수 예산", () => {
  // 사용자 보고: 엔진이 `OptiTime 0ms | MaxTime 0ms` · `Depth 0-0` 으로 구석에
  // 즉시 두었다. 착수 요청은 **시간 설정 전체**를 스스로 들고 가야 한다 — 앞선
  // 명령(분석 조각 등)이 남긴 값이 새어 들 틈을 두지 않는다.

  it("무제한이면 시간 한도 없이 보낸다 — 「지금 두기」까지 읽는다", () => {
    // 데스크톱·앱의 기본 레벨(level 0)과 같다. 예전엔 5초를 줬다.
    fresh({ computerSide: "white" });
    g().tap(move(7, 7));
    expect(plays[0]!.budget).toEqual({ turnMs: Infinity });
  });

  it("「지금 두기」는 생각 중일 때 엔진을 멈춰 착수시킨다", () => {
    let stops = 0;
    fresh({ computerSide: "white" });
    useEngineStore.setState({ stop: () => void stops++ });
    g().moveNow(); // 생각 중이 아니면 아무 일도 없다
    expect(stops).toBe(0);
    g().tap(move(7, 7));
    g().moveNow();
    expect(stops).toBe(1);
  });

  it("무제한에서 생각 중에 누르면 「지금 두기」를 알려 준다", () => {
    fresh({ computerSide: "white" });
    g().tap(move(7, 7));
    const r = g().tap(move(3, 3));
    expect(r.kind === "rejected" && r.reason.includes("지금 두기")).toBe(true);
  });

  it("착수 시간을 정하면 그 시간을 차례 한도로 보낸다", () => {
    fresh({ computerSide: "white" });
    g().setMoveTime(30_000);
    g().tap(move(7, 7));
    expect(plays[0]!.budget).toEqual({ turnMs: 30_000, matchMs: 0 });
  });

  it("예산은 결코 0 이 아니다", () => {
    // 아주 짧게 정해도 최소 500ms 는 준다 — 0 을 넘기면 엔진은 읽지 않고 던진다.
    fresh({ computerSide: "white" });
    g().setMoveTime(100);
    g().tap(move(7, 7));
    expect(plays[0]!.budget!.turnMs).toBeGreaterThanOrEqual(500);
  });

  it("착수 시간이 있으면 생각 중 탭에 「지금 두기」를 권하지 않는다", () => {
    fresh({ computerSide: "white" });
    g().setMoveTime(3_000);
    g().tap(move(7, 7));
    const r = g().tap(move(3, 3));
    expect(r).toEqual({ kind: "rejected", reason: "엔진이 생각 중입니다" });
  });
});

describe("이동 바 — 처음·뒤로·앞으로·끝", () => {
  const future = () => useBoardStore.getState().future;
  const three = [move(7, 7), move(8, 7), move(7, 8)];
  const playThree = () => three.forEach((m) => g().tap(m));

  it("무른 수는 앞으로 가기로 그 순서 그대로 돌아온다", () => {
    fresh();
    playThree();
    g().undoMove();
    g().undoMove();
    expect(stones()).toEqual(three.slice(0, 1));
    expect(future()).toEqual(three.slice(1));
    g().redoMove();
    expect(stones()).toEqual(three.slice(0, 2));
    g().redoAll();
    expect(stones()).toEqual(three);
    expect(future()).toHaveLength(0);
  });

  it("처음으로는 빈 판까지, 끝으로는 마지막 수까지 간다", () => {
    fresh();
    playThree();
    g().undoAll();
    expect(stones()).toHaveLength(0);
    expect(future()).toEqual(three);
    g().redoAll();
    expect(stones()).toEqual(three);
  });

  it("무른 수와 다른 수를 두면 앞으로 갈 수들이 버려진다", () => {
    fresh();
    playThree();
    g().undoMove();
    g().tap(move(0, 0));
    expect(future()).toHaveLength(0);
    g().redoMove();
    expect(stones()).toEqual([...three.slice(0, 2), move(0, 0)]);
  });

  it("무른 수와 같은 수를 손으로 두면 나머지 앞으로 갈 수는 남는다", () => {
    fresh();
    playThree();
    g().undoAll();
    g().tap(three[0]!);
    expect(future()).toEqual(three.slice(1));
  });

  it("앞으로 가기는 착수가 아니다 — 엔진 차례여도 엔진에게 두라고 하지 않는다", () => {
    fresh({ computerSide: "white" });
    g().tap(move(7, 7));
    engineMoves(move(8, 7));
    g().undoMove();
    resetSpies();
    g().redoMove();
    expect(stones()).toEqual([move(7, 7), move(8, 7)]);
    expect(plays).toHaveLength(0);
  });

  it("물음이 떠 있거나 엔진이 생각 중이면 앞으로 가지 않는다", () => {
    fresh();
    playThree();
    g().undoMove();
    useGameStore.setState({ prompt: { kind: "swapInfo" } });
    g().redoMove();
    expect(stones()).toHaveLength(2);
    useGameStore.setState({ prompt: null, thinking: true });
    g().redoAll();
    expect(stones()).toHaveLength(2);
  });

  it("새 대국은 앞으로 갈 수도 비운다", () => {
    fresh();
    playThree();
    g().undoAll();
    g().newGame();
    expect(future()).toHaveLength(0);
  });

  it("끝으로는 대국이 끝나는 수에서 멈추고 결과를 다시 세운다", () => {
    fresh();
    const line = [move(3, 7), move(4, 7), move(5, 7), move(6, 7), move(7, 7)];
    const filler = [move(0, 14), move(2, 14), move(4, 14), move(6, 14)];
    for (let i = 0; i < line.length; i++) {
      g().tap(line[i]!);
      if (i < filler.length) g().tap(filler[i]!);
    }
    g().undoAll();
    expect(g().result).toBeNull();
    g().redoAll();
    expect(stones()).toHaveLength(9);
    expect(g().result?.end).toBe("five");
  });
});
