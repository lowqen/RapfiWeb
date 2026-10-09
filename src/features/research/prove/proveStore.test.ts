import { beforeEach, describe, expect, it } from "vitest";
import { setProvePortForTest, useProveStore } from "./proveStore";
import type { ProvePort } from "./proveRunner";
import { useBoardStore } from "../../board/boardStore";
import { useGameStore } from "../../board/gameStore";
import { useEngineStore } from "../../../engine/engine-state";
import { EMPTY_SNAPSHOT, type AnalysisSnapshot } from "../../../engine/engine-types";
import { fromLabel, move } from "../../../core/model/move";

/** 증명 스토어 — 가짜 엔진 포트, 진짜 자물쇠(`owner`). */

const m = (l: string) => fromLabel(l, 15)!;
const st = () => useProveStore.getState();
const mate: AnalysisSnapshot = {
  ...EMPTY_SNAPSHOT,
  pvs: [{ index: 0, depth: 9, winRate: 0.99, mate: 3, evalCp: null, line: [m("k11")], round: 1 }],
};

let seenOwner: string | null = null;
const port = (answer: AnalysisSnapshot | null): ProvePort => ({
  search: async () => {
    seenOwner = useEngineStore.getState().owner;
    return answer;
  },
  stop: () => {},
});

beforeEach(() => {
  seenOwner = null;
  useEngineStore.setState({ owner: null, send: () => {}, stop: () => {} });
  useGameStore.setState({ thinking: false, result: null, prompt: null });
  const b = useBoardStore.getState();
  b.clear();
  for (const l of ["h8", "i9", "j10"]) b.place(m(l));
});

describe("증명 스토어", () => {
  it("지금 판을 증명하고, 도는 동안만 엔진을 쥔다", async () => {
    setProvePortForTest(port(mate));
    expect(await st().start()).toBeNull();
    expect(seenOwner).toBe("prove");
    expect(useEngineStore.getState().owner).toBeNull();
    expect(st().outcome).toMatchObject({ resolved: true, win: true, kind: "mate", dbWrites: null });
    expect(st().root).toEqual([m("h8"), m("i9"), m("j10")]);
    expect(st().running).toBe(false);
    expect(st().log.at(-1)).toMatch(/^증명 완료: 백 \(차례\): 승리 증명됨 \(메이트\)/);
  });

  it("리뷰가 엔진을 쥐고 있으면 거절", async () => {
    setProvePortForTest(port(mate));
    useEngineStore.setState({ owner: "review" });
    expect(await st().start()).toMatch(/게임 리뷰가 진행 중/);
  });

  it("대국 엔진이 생각 중이거나 승부가 난 판이면 거절", async () => {
    setProvePortForTest(port(mate));
    useGameStore.setState({ thinking: true });
    expect(await st().start()).toMatch(/진행 중인 계산/);
    useGameStore.setState({ thinking: false });
    const b = useBoardStore.getState();
    b.clear();
    for (const x of [7, 8, 9, 10]) {
      b.place(move(x, 7));
      b.place(move(x, 9));
    }
    b.place(move(11, 7));
    expect(await st().start()).toMatch(/이미 승부가 결정된/);
  });

  it("엔진이 사라지면 실패를 기록하고 취소로 끝난다", async () => {
    setProvePortForTest(port(null));
    await st().start();
    expect(st().outcome?.cancelled).toBe(true);
    expect(st().log.some((l) => /엔진이 내려가/.test(l))).toBe(true);
    expect(useEngineStore.getState().owner).toBeNull();
  });

  it("설정은 범위로 묶여 저장된다", () => {
    setProvePortForTest(port(mate));
    st().setOptions({ nbest: 99, budget0Sec: 30, budgetMaxSec: 10 });
    expect(st().options.nbest).toBe(8);
    expect(st().options.budgetMaxSec).toBe(30);
  });
});
