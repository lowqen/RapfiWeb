import { beforeEach, describe, expect, it } from "vitest";
import { setMoveOrderServiceForTest, useSequenceStore } from "./sequenceStore";
import { inlineService, type MoveOrderService } from "./moveOrderService";
import { useBoardStore } from "../../board/boardStore";
import { useGameStore } from "../../board/gameStore";
import { useEngineStore } from "../../../engine/engine-state";
import { DEFAULT_RULES } from "../../../core/moveorder/session";
import { fromLabel, type Move } from "../../../core/model/move";

/**
 * 수순 탐색기의 상태 — 워커 대신 같은 세션을 그 자리에서 돌린다(`inlineService`). 낡은 답
 * 거르기는 답을 늦게 돌려주는 창구로 본다.
 */

const size = 15;
const line = (...ls: string[]): Move[] => ls.map((l) => fromLabel(l, size)!);
const st = () => useSequenceStore.getState();
const cell = (m: Move) => m.y * size + m.x;

function place(ms: Move[]) {
  const b = useBoardStore.getState();
  b.clear();
  for (const m of ms) b.place(m);
}

beforeEach(() => {
  setMoveOrderServiceForTest(inlineService());
  useSequenceStore.setState({
    rules: DEFAULT_RULES,
    view: null,
    status: "empty",
    applyPrompt: null,
    notice: null,
  });
  useEngineStore.setState({ owner: null, send: () => {} });
  useGameStore.setState({ gameName: null, result: null, prompt: null, thinking: false });
});

describe("세우기", () => {
  it("빈 판은 빈 상태", async () => {
    place([]);
    await st().rebuild();
    expect(st().status).toBe("empty");
    expect(st().view).toBeNull();
  });

  it("지금 판(무른 수 제외)으로 센다", async () => {
    place(line("h8", "i9", "j10", "k11", "g7"));
    useBoardStore.getState().undo();
    await st().rebuild();
    expect(st().status).toBe("ready");
    expect(st().view!.blackCount + st().view!.whiteCount).toBe(4);
    expect(st().line).toHaveLength(4);
  });

  it("규칙을 바꾸면 다시 센다", async () => {
    place(line("h8", "i9", "j10", "k11"));
    st().setRules({ symmetry: false });
    await st().rebuild();
    expect(st().view!.variantCount).toBe(1);
    st().setRules({ symmetry: true, move2Fix: false });
    await st().rebuild();
    expect(st().view!.variantCount).toBe(4);
  });

  it("늦게 온 앞 판의 답은 버린다", async () => {
    const inner = inlineService();
    const gate: (() => void)[] = [];
    const slow: MoveOrderService = {
      call: (req) =>
        new Promise((resolve) => {
          gate.push(() => void inner.call(req as never).then(resolve as never));
        }),
      dispose: () => {},
    };
    setMoveOrderServiceForTest(slow);
    place(line("h8"));
    const first = st().rebuild();
    place(line("h8", "i9", "j10", "k11"));
    const second = st().rebuild();
    gate[1]!(); // 뒤의 것이 먼저 온다
    await second;
    gate[0]!();
    await first;
    expect(st().view!.blackCount + st().view!.whiteCount).toBe(4);
  });
});

describe("파고들기 · 보드에 놓기", () => {
  it("파고들고 되짚는다", async () => {
    const ms = line("h8", "i9", "j10", "k11", "g7", "f6");
    place(ms);
    await st().rebuild();
    await st().drill(cell(ms[0]!));
    expect(st().view!.prefix).toEqual([cell(ms[0]!)]);
    await st().back();
    expect(st().view!.prefix).toEqual([]);
  });

  it("원래 방향이면 바로 보드를 그 수순으로 다시 놓는다", async () => {
    const ms = line("h8", "i9", "j10", "k11");
    place(ms);
    await st().rebuild();
    await st().apply();
    expect(st().applyPrompt).toBeNull();
    expect(st().notice).toMatch(/다시 놓았습니다/);
    expect(new Set(useBoardStore.getState().render.stones.map(cell))).toEqual(
      new Set(ms.map(cell)),
    );
  });

  it("거울 배치만 남으면 먼저 묻고, 받아들이면 놓는다", async () => {
    place(line("h8", "h7", "j10", "k11"));
    await st().rebuild();
    await st().apply();
    expect(st().applyPrompt?.text).toMatch(/돌 위치가 지금 보드와 달라집니다/);
    const order = st().applyPrompt!.order;
    await st().apply(true);
    expect(useBoardStore.getState().render.stones.map(cell)).toEqual(order);
    expect(st().applyPrompt).toBeNull();
  });

  it("리뷰가 엔진을 쥐고 있으면 판을 바꾸지 않는다", async () => {
    place(line("h8", "i9", "j10", "k11"));
    await st().rebuild();
    useEngineStore.setState({ owner: "review" });
    const before = useBoardStore.getState().render.stones;
    await st().apply();
    expect(st().notice).toMatch(/리뷰가 진행 중/);
    expect(useBoardStore.getState().render.stones).toBe(before);
  });
});
