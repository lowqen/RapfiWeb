import { describe, expect, it } from "vitest";
import { encodePosition, parsePosition } from "./position-link";
import { move } from "./move";

describe("국면 딥링크 문자열", () => {
  const line = [move(7, 7), move(8, 6), move(9, 5), move(7, 0)];

  it("좌표를 구분자 없이 소문자로 잇는다", () => {
    expect(encodePosition(line)).toBe("h8i9j10h15");
    expect(encodePosition([])).toBe("");
  });

  it("쓴 것을 그대로 읽는다", () => {
    expect(parsePosition(encodePosition(line))).toEqual(line);
  });

  it("대소문자 · 공백 · 쉼표를 가리지 않는다", () => {
    expect(parsePosition("H8 I9, j10 h15")).toEqual(line);
  });

  it("빈 문자열은 빈 판이다", () => {
    expect(parsePosition("")).toEqual([]);
  });

  it("두 자리 행을 먼저 읽는다 — 다음 토큰은 언제나 글자로 시작한다", () => {
    expect(parsePosition("a15b1")).toEqual([move(0, 0), move(1, 14)]);
  });

  it("판 밖 · 겹친 자리 · 읽을 수 없는 글자가 하나라도 있으면 통째로 거절한다", () => {
    for (const bad of ["h8p9", "h8h16", "h8h0", "h8h8", "h8i", "8h", "h8;i9", "h151"]) {
      expect(parsePosition(bad)).toBeNull();
    }
  });
});
