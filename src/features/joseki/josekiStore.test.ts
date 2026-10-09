import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { exportJson } from "../../core/joseki/io";
import { movesText } from "../../core/joseki/parse";
import { addLine, mainLineFrom, movesTo, newTree, nodeAt } from "../../core/joseki/tree";
import { fromLabel } from "../../core/model/move";
import { db } from "../../data/db";
import { listJoseki } from "../../data/joseki";
import { useBoardStore } from "../board/boardStore";
import { resetJosekiForTest, useJosekiStore } from "./josekiStore";

const m = (s: string) => fromLabel(s)!;
const st = () => useJosekiStore.getState();
const line = () => movesText(movesTo(st().current!.root, st().path));

beforeEach(async () => {
  resetJosekiForTest();
  await db()!.joseki.clear();
  await db()!.josekiIndex.clear();
  useBoardStore.getState().clear();
});

describe("정석 스토어", () => {
  it("판으로 두고, 글로 잇고, 이미 있는 수로는 따라간다", async () => {
    await st().create(false);
    st().play(m("H8"));
    st().play(m("I9"));
    expect(line()).toBe("h8 i9");
    expect(st().addText("j10 i10")).toBe(true);
    expect(line()).toBe("h8 i9 j10 i10");
    st().first();
    st().play(m("H8")); // 있는 수 — 새 마디가 아니다
    expect(st().path).toEqual([0]);
    st().play(m("H8")); // 이 줄에 이미 둔 자리
    expect(st().notice).toMatch(/이미 돌/);
  });

  it("갈래 · 주 변화로 · 지우기 · 되돌리기", async () => {
    await st().create(false);
    st().addText("h8 i9 j10");
    st().go([0, 0]);
    st().addText("g10");
    expect(st().path).toEqual([0, 0, 1]);
    st().promote();
    expect(st().path).toEqual([0, 0, 0]);
    expect(movesText(movesTo(st().current!.root, mainLineFrom(st().current!.root)))).toBe(
      "h8 i9 g10",
    );
    st().deleteNode();
    expect(st().path).toEqual([0, 0]);
    expect(nodeAt(st().current!.root, [0, 0])!.children).toHaveLength(1);
    st().undoEdit();
    expect(nodeAt(st().current!.root, [0, 0])!.children).toHaveLength(2);
  });

  it("메모 · 기호는 마디에, 닫으면 저장된다(색인까지)", async () => {
    await st().create(false);
    st().addText("h8 i9 j10");
    st().setNodeComment("**좋다** h8");
    st().setNodeMark("!");
    st().setInfo({ title: "화월 기본", tags: ["연습"] });
    await st().close();
    const saved = await listJoseki(db()!);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.title).toBe("화월 기본");
    expect(nodeAt(saved[0]!.root, [0, 0, 0])).toMatchObject({ comment: "**좋다** h8", mark: "!" });
    expect(await db()!.josekiIndex.count()).toBe(3);
  });

  it("좌표 링크는 줄 위의 수나 자식으로 간다", async () => {
    await st().create(false);
    st().addText("h8 i9 j10");
    expect(st().jumpTo(m("I9"))).toBe(true);
    expect(st().path).toEqual([0, 0]);
    expect(st().jumpTo(m("J10"))).toBe(true);
    expect(st().jumpTo(m("A1"))).toBe(false);
  });

  it("보드 국면으로 새 정석 · 보드 국면으로 찾기(뒤집힌 판도)", async () => {
    useBoardStore.getState().setStones([m("H8"), m("I9"), m("J10")]);
    await st().create(true);
    expect(line()).toBe("h8 i9 j10");
    await st().close();
    useBoardStore.getState().setStones([m("H8"), m("G9"), m("F10")]);
    await st().findBoard();
    expect(st().hits?.map((h) => h.path)).toEqual([[0, 0, 0]]);
    st().open(st().hits![0]!.tree.id, st().hits![0]!.path);
    expect(line()).toBe("h8 i9 j10");
  });

  it("가져오기: JSON 은 새 정석으로(같은 id 는 새 id), 기보는 열린 정석에 잇는다", async () => {
    const t = newTree("가져올 것", 1);
    t.root = addLine(t.root, [m("H8"), m("H9")]).root;
    const json = new File([exportJson([t])], "j.json", { type: "application/json" });
    await st().importFiles([json]);
    expect(st().list.map((x) => x.title)).toEqual(["가져올 것"]);
    await st().importFiles([json]);
    expect(new Set(st().list.map((x) => x.id)).size).toBe(2);

    st().open(st().list[0]!.id);
    const psq = new File(["Piskvorky 15x15, 0:0, 0\n8,8,0\n9,7,0\n-1\n"], "g.psq");
    await st().importFiles([psq]);
    expect(line()).toBe("h8 i9");
    expect(nodeAt(st().current!.root, [0])!.children).toHaveLength(2);
    await st().importFiles([new File(["nope"], "x.json")]);
    expect(st().notice).toMatch(/JSON 이 아닙니다/);
  });
});
