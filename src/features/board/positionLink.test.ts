import { describe, expect, it } from "vitest";
import { positionUrl, readPositionLink, withoutPositionParam } from "./positionLink";
import { useBoardStore } from "./boardStore";
import { move } from "../../core/model/move";

describe("국면 딥링크 — 주소", () => {
  it("p 가 없으면 아무것도 아니다", () => {
    expect(readPositionLink("?autoboot=0", 15)).toEqual({ kind: "none" });
    expect(readPositionLink("", 15)).toEqual({ kind: "none" });
  });

  it("p 를 수순으로 읽는다 — 다른 쿼리와 함께여도", () => {
    expect(readPositionLink("?autoboot=0&p=h8i9", 15)).toEqual({
      kind: "ok",
      moves: [move(7, 7), move(8, 6)],
    });
    expect(readPositionLink("?p=", 15)).toEqual({ kind: "ok", moves: [] });
  });

  it("읽을 수 없는 p 는 그렇다고 말한다", () => {
    expect(readPositionLink("?p=h8h8", 15)).toEqual({ kind: "invalid" });
  });

  it("p 만 걷어내고 나머지 쿼리는 남긴다", () => {
    expect(withoutPositionParam("?p=h8&autoboot=0")).toBe("?autoboot=0");
    expect(withoutPositionParam("?p=h8")).toBe("");
  });

  it("지금 판의 링크는 보드 화면을 가리키고 다시 읽으면 같은 판이다", () => {
    const b = useBoardStore.getState();
    b.clear();
    b.place(move(7, 7));
    b.place(move(8, 6));
    const url = new URL(positionUrl("https://example.test", "/RapfiWeb/"));
    expect(url.pathname).toBe("/RapfiWeb/board");
    expect(url.searchParams.get("p")).toBe("h8i9");
    expect(readPositionLink(url.search, 15)).toEqual({
      kind: "ok",
      moves: [move(7, 7), move(8, 6)],
    });
    expect(new URL(positionUrl("https://example.test", "/")).pathname).toBe("/board");
  });
});
