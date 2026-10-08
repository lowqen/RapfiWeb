import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startAutosave, type Autosave } from "./autosave";
import { useBoardStore } from "./boardStore";
import { useGameStore } from "./gameStore";
import { RapfiDb } from "../../data/db";
import { readAutosave, writeAutosave } from "../../data/games";
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
  useEngineStore.setState({ status: "idle", send: () => {} });
  board().clear();
  useGameStore.setState({ result: null, thinking: false, prompt: null, gameName: null });
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
