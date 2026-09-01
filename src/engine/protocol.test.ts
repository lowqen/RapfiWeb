import { describe, it, expect } from "vitest";
import { serialize, classify } from "./protocol";

describe("직렬화", () => {
  it("BOARD 는 여러 줄이고 DONE 으로 닫는다", () => {
    expect(
      serialize({
        kind: "board",
        stones: [
          { x: 7, y: 7, own: true },
          { x: 8, y: 8, own: false },
        ],
      }),
    ).toEqual(["BOARD", "7,7,1", "8,8,2", "DONE"]);
  });

  it("START 와 INFO", () => {
    expect(serialize({ kind: "start", size: 15 })).toEqual(["START 15"]);
    expect(serialize({ kind: "info", key: "timeout_turn", value: 500 })).toEqual([
      "INFO timeout_turn 500",
    ]);
  });

  it("정지는 YXSTOP 이다 — STOP 이 아니라", () => {
    // 앱이 쓰는 것과 같은 줄이어야 한다. 엔진은 둘 다 받지만 하나로 통일해 둔다.
    expect(serialize({ kind: "stop" })).toEqual(["YXSTOP"]);
  });
});

describe("응답 분류", () => {
  it("좌표 한 줄이 수다", () => {
    expect(classify("7,7")).toEqual({ kind: "move", x: 7, y: 7 });
  });

  it("MESSAGE 와 ERROR 는 접두사를 떼고 본문만 남긴다", () => {
    expect(classify("MESSAGE Evaluator set to mix9svq.")).toEqual({
      kind: "message",
      text: "Evaluator set to mix9svq.",
    });
    expect(classify("ERROR unknown command")).toEqual({
      kind: "error",
      text: "unknown command",
    });
  });

  it("빈 응답이 정상인 줄도 있다 — 모르는 줄은 버리지 않고 unknown 으로 남긴다", () => {
    expect(classify("무언가 새로운 줄")).toEqual({ kind: "unknown", text: "무언가 새로운 줄" });
  });
});
