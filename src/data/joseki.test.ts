import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { RapfiDb } from "./db";
import { deleteJoseki, findByKey, listJoseki, putJoseki, searchText } from "./joseki";
import { addLine, newTree, setComment } from "../core/joseki/tree";
import { fromLabel } from "../core/model/move";
import { keyOf } from "../core/model/pos-key";

let opened: RapfiDb[] = [];
const fresh = () => {
  const d = new RapfiDb(`joseki-${opened.length}-${Math.random()}`);
  opened.push(d);
  return d;
};
afterEach(async () => {
  for (const d of opened) await d.delete();
  opened = [];
});

const line = (s: string) => s.split(" ").map((x) => fromLabel(x)!);

describe("정석 저장소", () => {
  it("저장하면 색인도 함께, 다시 저장하면 색인을 갈아 쓴다", async () => {
    const d = fresh();
    const t = newTree("화월", 1);
    t.root = addLine(t.root, line("H8 I9 J10")).root;
    await putJoseki(d, t);
    expect(await d.josekiIndex.count()).toBe(3);
    // 거울 국면으로 찾는다
    const hit = await findByKey(d, keyOf(line("H8 G9 F10")));
    expect(hit.map((h) => [h.tree.id, h.path])).toEqual([[t.id, [0, 0, 0]]]);
    t.root = addLine(t.root, line("H8 H9")).root;
    t.updatedAt = 2;
    await putJoseki(d, t);
    expect(await d.josekiIndex.count()).toBe(4);
    expect((await listJoseki(d)).map((x) => x.id)).toEqual([t.id]);
    await deleteJoseki(d, t.id);
    expect(await d.josekiIndex.count()).toBe(0);
    expect(await listJoseki(d)).toEqual([]);
  });

  it("목록은 최근에 고친 것부터", async () => {
    const d = fresh();
    const a = newTree("a", 1);
    const b = newTree("b", 5);
    await putJoseki(d, a);
    await putJoseki(d, b);
    expect((await listJoseki(d)).map((x) => x.title)).toEqual(["b", "a"]);
  });

  it("검색 글은 메모의 서식을 뗀다", () => {
    const t = newTree("제목", 1);
    t.tags = ["태그"];
    t.root = addLine(t.root, line("H8")).root;
    t.root = setComment(t.root, [0], "**강한** 수");
    expect(searchText(t)).toBe("제목  태그 강한 수");
  });
});
