import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { RapfiDb } from "./db";
import { readAutosave, writeAutosave } from "./games";
import { move } from "../core/model/move";

/**
 * 자동 저장 — 브라우저 없이 `fake-indexeddb` 위에서. 시험마다 새 이름의 DB 를 연다.
 */

let opened: RapfiDb[] = [];
const fresh = () => {
  const d = new RapfiDb(`test-${opened.length}-${Math.random()}`);
  opened.push(d);
  return d;
};

afterEach(async () => {
  for (const d of opened) await d.delete();
  opened = [];
});

const state = {
  name: "final",
  size: 15,
  moves: [move(7, 7), move(8, 6)],
  future: [move(6, 8)],
};

describe("자동 저장", () => {
  it("처음에는 없다", async () => {
    expect(await readAutosave(fresh())).toBeNull();
  });

  it("쓴 것을 그대로 읽는다 — 무른 수까지", async () => {
    const d = fresh();
    await writeAutosave(d, state);
    expect(await readAutosave(d)).toEqual(state);
  });

  it("몇 번을 써도 줄은 하나다", async () => {
    const d = fresh();
    await writeAutosave(d, state);
    await writeAutosave(d, { ...state, moves: [move(1, 1)], future: [] });
    await writeAutosave(d, { ...state, name: "game", moves: [], future: [] });
    expect(await d.games.count()).toBe(1);
    expect(await readAutosave(d)).toEqual({ name: "game", size: 15, moves: [], future: [] });
  });

  it("동시에 써도 줄은 하나다", async () => {
    const d = fresh();
    await Promise.all([1, 2, 3, 4].map((n) => writeAutosave(d, { ...state, moves: [move(n, n)] })));
    expect(await d.games.count()).toBe(1);
  });

  it("사용자 기보는 자동 저장 자리와 섞이지 않는다", async () => {
    const d = fresh();
    await d.games.add({ name: "a", size: 15, moves: [], future: [], savedAt: 1 });
    await d.games.add({ name: "b", size: 15, moves: [], future: [], savedAt: 2 });
    await writeAutosave(d, state);
    expect(await d.games.count()).toBe(3);
    expect((await readAutosave(d))?.name).toBe("final");
  });

  it("다시 연 DB 에서도 남아 있다", async () => {
    const d = fresh();
    await writeAutosave(d, state);
    d.close();
    const again = new RapfiDb(d.name);
    expect(await readAutosave(again)).toEqual(state);
    again.close();
  });
});
