import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startAutosave, type Autosave } from "./autosave";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { RapfiDb } from "../../data/db";
import { readAutosave, readSlot, writeAutosave, writeSlot } from "../../data/games";
import { useLinkBackup } from "./linkBackup";
import { useEngineStore } from "../../engine/engine-state";
import { move } from "../../core/model/move";

/**
 * 판 자동 저장 — 스토어와 `fake-indexeddb` 사이. 엔진은 idle 로 두어 아무 명령도
 * 나가지 않게 한다(금수 조회가 엔진이 준비됐을 때만 나가는 것을 이용한다).
 */

let d: RapfiDb;
let a: Autosave | null = null;
const board = () => useBoardStore.getState();
const game = () => useGameStore.getState();

beforeEach(() => {
  d = new RapfiDb(`autosave-${Math.random()}`);
  useLinkBackup.setState({ backup: null });
  useEngineStore.setState({ status: "idle", send: () => {} });
  board().clear();
  // 아래 시험의 대부분은 [대국] 판(`"autosave"` 자리)의 것이다 — 분석 판은 «두 탭의 판» 묶음이 본다.
  useGameStore.setState({
    result: null,
    thinking: false,
    prompt: null,
    gameName: null,
    mode: "game",
    parkedGame: null,
    parkedAnalysis: null,
    analysisBase: [],
  });
});

afterEach(async () => {
  a?.stop();
  a = null;
  await d.delete();
});

describe("되살리기", () => {
  it("저장된 판을 무른 수와 이름까지 되살린다", async () => {
    await writeAutosave(d, {
      name: "final",
      size: 15,
      moves: [move(7, 7), move(8, 6)],
      future: [move(6, 8)],
    });
    a = startAutosave(d, 0);
    await a.ready;
    expect(board().render.stones).toEqual([move(7, 7), move(8, 6)]);
    expect(board().future).toEqual([move(6, 8)]);
    expect(board().render.lastMove).toEqual(move(8, 6));
    expect(game().gameName).toBe("final");
  });

  it("끝난 판이면 결과도 판에서 다시 본다", async () => {
    // 흑 다섯(H8..L8)과 백 넷
    const moves = [7, 8, 9, 10, 11].flatMap((x, i) =>
      i < 4 ? [move(x, 7), move(x, 9)] : [move(x, 7)],
    );
    await writeAutosave(d, { name: "", size: 15, moves, future: [] });
    a = startAutosave(d, 0);
    await a.ready;
    expect(game().result?.winner).toBe("black");
  });

  it("그사이 사용자가 먼저 두었으면 되살리지 않는다", async () => {
    await writeAutosave(d, { name: "", size: 15, moves: [move(1, 1)], future: [] });
    board().place(move(7, 7));
    a = startAutosave(d, 0);
    await a.ready;
    expect(board().render.stones).toEqual([move(7, 7)]);
  });

  it("저장된 것이 없으면 빈 판 그대로다", async () => {
    a = startAutosave(d, 0);
    await a.ready;
    expect(board().render.stones).toEqual([]);
  });
});

describe("두 탭의 판", () => {
  it("대국 판과 분석 판을 따로 저장한다", async () => {
    a = startAutosave(d, 0);
    await a.ready;
    game().tap(move(7, 7));
    game().setMode("analysis");
    game().tap(move(8, 8));
    await a.flush();
    expect((await readAutosave(d))?.moves).toEqual([move(7, 7)]);
    const an = await readSlot(d, "analysis");
    expect(an?.moves).toEqual([move(7, 7), move(8, 8)]);
    expect(an?.base).toEqual([move(7, 7)]);
  });

  it("탭 전환은 쉼을 기다리지 않고 곧바로 쓴다 — 두 판이 제 자리에", async () => {
    // 쉼(debounce)을 길게 — 탭 전환의 즉시 쓰기만 남게. 예전에는 모드가 바뀌는 순간(보드를 갈아
    // 끼우기 전) 쓰여 분석 판이 대국 기보 자리에 들어갔다.
    a = startAutosave(d, 60_000);
    await a.ready;
    for (const m of [move(7, 7), move(8, 8), move(6, 8)]) game().tap(m);
    game().setMode("analysis");
    game().tap(move(5, 5));
    game().tap(move(9, 9));
    game().setMode("game");
    await new Promise((r) => setTimeout(r, 50));
    expect((await readAutosave(d))?.moves).toEqual([move(7, 7), move(8, 8), move(6, 8)]);
    expect((await readSlot(d, "analysis"))?.moves).toHaveLength(5);
  });

  it("분석 탭으로 열면 저장된 분석 판이 보이고 대국 판은 접혀 있다", async () => {
    await writeAutosave(d, { name: "", size: 15, moves: [move(7, 7)], future: [] });
    await writeSlot(d, "analysis", {
      name: "",
      size: 15,
      moves: [move(7, 7), move(8, 8), move(9, 9)],
      future: [],
      base: [move(7, 7)],
    });
    useGameStore.setState({ mode: "analysis" });
    a = startAutosave(d, 0);
    await a.ready;
    expect(board().render.stones).toHaveLength(3);
    game().setMode("game");
    expect(board().render.stones).toEqual([move(7, 7)]);
  });

  it("분석 판이 다른 대국에서 갈라졌으면 지금 대국에서 다시 갈라진다", async () => {
    await writeAutosave(d, { name: "", size: 15, moves: [move(7, 7), move(6, 6)], future: [] });
    await writeSlot(d, "analysis", {
      name: "",
      size: 15,
      moves: [move(1, 1)],
      future: [],
      base: [move(3, 3)],
    });
    useGameStore.setState({ mode: "analysis" });
    a = startAutosave(d, 0);
    await a.ready;
    expect(board().render.stones).toEqual([move(7, 7), move(6, 6)]);
  });

  it("예전 판본의 자동 저장(대국 판 하나)만 있으면 분석 판은 거기서 갈라진다", async () => {
    await writeAutosave(d, { name: "", size: 15, moves: [move(7, 7)], future: [move(8, 8)] });
    useGameStore.setState({ mode: "analysis" });
    a = startAutosave(d, 0);
    await a.ready;
    expect(board().render.stones).toEqual([move(7, 7)]);
    expect(board().future).toEqual([move(8, 8)]);
  });

  it("분석 탭에서 링크로 열면 링크는 분석 판에, 대국 판은 저장된 그대로", async () => {
    await writeAutosave(d, { name: "", size: 15, moves: [move(1, 1)], future: [] });
    useGameStore.setState({ mode: "analysis" });
    a = startAutosave(d, 10_000, [move(7, 7)]);
    await a.ready;
    expect(board().render.stones).toEqual([move(7, 7)]);
    await a.flush();
    expect((await readAutosave(d))?.moves).toEqual([move(1, 1)]);
    game().setMode("game");
    expect(board().render.stones).toEqual([move(1, 1)]);
  });
});

describe("국면 딥링크", () => {
  it("링크의 국면이 저장된 판을 이기고 자동 저장 자리를 덮는다", async () => {
    await writeAutosave(d, { name: "old", size: 15, moves: [move(1, 1)], future: [] });
    a = startAutosave(d, 10_000, [move(7, 7), move(8, 6)]);
    await a.ready;
    expect(board().render.stones).toEqual([move(7, 7), move(8, 6)]);
    expect(game().gameName).toBeNull();
    await a.flush();
    expect(await readAutosave(d)).toEqual({
      name: "",
      size: 15,
      moves: [move(7, 7), move(8, 6)],
      future: [],
    });
  });

  it("덮이기 전에 두던 판을 보관하고, 돌아가면 그 판이 다시 올라온다", async () => {
    const old = { name: "mine", size: 15, moves: [move(1, 1), move(2, 2)], future: [move(3, 3)] };
    await writeAutosave(d, old);
    a = startAutosave(d, 10_000, [move(7, 7)]);
    await a.ready;
    expect(useLinkBackup.getState().backup).toEqual(old);
    expect(await readSlot(d, "beforeLink")).toEqual(old);
    await useLinkBackup.getState().restore();
    expect(board().render.stones).toEqual(old.moves);
    expect(board().future).toEqual(old.future);
    expect(game().gameName).toBe("mine");
    expect(useLinkBackup.getState().backup).toBeNull();
    expect(await readSlot(d, "beforeLink")).toBeNull();
  });

  it("버리면 보관판이 사라진다", async () => {
    await writeAutosave(d, { name: "", size: 15, moves: [move(1, 1)], future: [] });
    a = startAutosave(d, 10_000, [move(7, 7)]);
    await a.ready;
    await useLinkBackup.getState().discard();
    expect(useLinkBackup.getState().backup).toBeNull();
    expect(await readSlot(d, "beforeLink")).toBeNull();
    expect(board().render.stones).toEqual([move(7, 7)]);
  });

  it("두던 판이 비었거나 링크와 같으면 보관하지 않는다", async () => {
    await writeAutosave(d, { name: "", size: 15, moves: [move(7, 7)], future: [] });
    a = startAutosave(d, 10_000, [move(7, 7)]);
    await a.ready;
    expect(useLinkBackup.getState().backup).toBeNull();
  });

  it("고르지 않고 떠난 보관판은 다음에 다시 묻는다", async () => {
    const kept = { name: "", size: 15, moves: [move(4, 4)], future: [] };
    await writeSlot(d, "beforeLink", kept);
    a = startAutosave(d, 10_000);
    await a.ready;
    expect(useLinkBackup.getState().backup).toEqual(kept);
  });

  it("빈 링크는 빈 판이다", async () => {
    await writeAutosave(d, { name: "", size: 15, moves: [move(1, 1)], future: [] });
    a = startAutosave(d, 0, []);
    await a.ready;
    expect(board().render.stones).toEqual([]);
  });
});

describe("저장", () => {
  it("되살리기 전의 빈 판으로 저장된 판을 덮어쓰지 않는다", async () => {
    await writeAutosave(d, { name: "", size: 15, moves: [move(1, 1)], future: [] });
    a = startAutosave(d, 0);
    await a.flush(); // 되살리기 전 — 쓸 것이 없다
    await a.ready;
    expect((await readAutosave(d))?.moves).toEqual([move(1, 1)]);
  });

  it("두고 무른 판이 그대로 남는다", async () => {
    a = startAutosave(d, 10_000);
    await a.ready;
    board().place(move(7, 7));
    board().place(move(8, 8));
    board().undo();
    await a.flush();
    expect(await readAutosave(d)).toEqual({
      name: "",
      size: 15,
      moves: [move(7, 7)],
      future: [move(8, 8)],
    });
  });

  it("새 판은 빈 판과 빈 이름으로 저장된다", async () => {
    a = startAutosave(d, 10_000);
    await a.ready;
    game().loadMoves([move(7, 7)], { name: "opened" });
    await a.flush();
    expect((await readAutosave(d))?.name).toBe("opened");
    game().newGame();
    await a.flush();
    expect(await readAutosave(d)).toEqual({ name: "", size: 15, moves: [], future: [] });
  });

  it("멈춘 뒤에는 쓰지 않는다", async () => {
    a = startAutosave(d, 10_000);
    await a.ready;
    a.stop();
    board().place(move(7, 7));
    await a.flush();
    expect(await readAutosave(d)).toBeNull();
  });
});
