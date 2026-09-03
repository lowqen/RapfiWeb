import { describe, it, expect } from "vitest";
import { CoordMapper, labelToMove, parse, serialize } from "./engine-protocol";
import { SearchAggregator } from "./engine-aggregator";
import { moveKey } from "../core/model/move";
import type { EngineResponse } from "./engine-types";

const coord = new CoordMapper(15);
const p = (line: string) => parse(line, coord);

describe("좌표 — 전선은 y,x 다", () => {
  it("toWire 는 row,col 순서다", () => {
    // 앱의 CoordMapper 가 «flip-Y 함정»이라고 못 박아 둔 자리. x,y 로 쓰면
    // 대칭 국면에서는 드러나지 않고 실전에서 90도 돌아간 판이 나온다.
    expect(coord.toWire({ x: 3, y: 9 })).toBe("9,3");
  });

  it("fromWire 는 그 역이다", () => {
    expect(coord.fromWire(9, 3)).toEqual({ x: 3, y: 9 });
  });

  it("왕복이 항등이다", () => {
    for (const m of [
      { x: 0, y: 0 },
      { x: 14, y: 0 },
      { x: 0, y: 14 },
      { x: 7, y: 8 },
    ]) {
      expect(coord.parsePair(coord.toWire(m))).toEqual(m);
    }
  });

  it("flipY 는 행을 뒤집는다 (서버의 --flip-y)", () => {
    const f = new CoordMapper(15, true);
    expect(f.toWire({ x: 3, y: 0 })).toBe("14,3");
    expect(f.parsePair("14,3")).toEqual({ x: 3, y: 0 });
  });

  it("형식이 아니면 null — 조용히 0,0 으로 떨어지지 않는다", () => {
    expect(coord.parsePair("7")).toBeNull();
    expect(coord.parsePair("a,b")).toBeNull();
    expect(coord.parsePair("")).toBeNull();
  });
});

describe("직렬화", () => {
  it("BOARD 는 여러 줄이고 DONE 으로 닫는다 — 좌표는 y,x", () => {
    expect(
      serialize(
        {
          kind: "board",
          stones: [
            { move: { x: 7, y: 7 }, own: true },
            { move: { x: 8, y: 6 }, own: false },
          ],
        },
        coord,
      ),
    ).toEqual(["BOARD", "7,7,1", "6,8,2", "DONE"]);
  });

  it("YXBOARD 는 같은 모양이되 착수가 아니다", () => {
    const lines = serialize(
      { kind: "yxboard", stones: [{ move: { x: 1, y: 2 }, own: true }] },
      coord,
    );
    expect(lines[0]).toBe("YXBOARD");
    expect(lines).toContain("2,1,1");
  });

  it("START / TURN / BEGIN / RESTART", () => {
    expect(serialize({ kind: "start", size: 15 }, coord)).toEqual(["START 15"]);
    expect(serialize({ kind: "turn", move: { x: 6, y: 6 } }, coord)).toEqual(["TURN 6,6"]);
    expect(serialize({ kind: "begin" }, coord)).toEqual(["BEGIN"]);
    expect(serialize({ kind: "restart" }, coord)).toEqual(["RESTART"]);
  });

  it("show_detail 은 소문자 info 다 — 데스크톱 철자 그대로", () => {
    // 이걸 보내지 않으면 INFO PV/DEPTH/EVAL/WINRATE 가 한 줄도 오지 않는다.
    expect(serialize({ kind: "showDetail", level: 3 }, coord)).toEqual(["info show_detail 3"]);
  });

  it("규칙은 INFO RULE — 렌주는 4 다", () => {
    // id 는 엔진이 정한다(command/gomocup.cpp 의 RULE 처리):
    // 0 프리스타일 · 1 스탠다드 · 4 렌주 · 5 swap1 · 6 swap2.
    expect(serialize({ kind: "rule", id: 4 }, coord)).toEqual(["INFO RULE 4"]);
    expect(serialize({ kind: "rule", id: 0 }, coord)).toEqual(["INFO RULE 0"]);
  });

  it("정지는 YXSTOP 이다", () => {
    expect(serialize({ kind: "stop" }, coord)).toEqual(["YXSTOP"]);
  });

  it("YXNBEST 와 INFO", () => {
    expect(serialize({ kind: "yxnbest", n: 5 }, coord)).toEqual(["YXNBEST 5"]);
    expect(serialize({ kind: "info", key: "timeout_turn", value: 500 }, coord)).toEqual([
      "INFO timeout_turn 500",
    ]);
  });
});

describe("파싱 — 기본", () => {
  it("좌표 한 줄이 확정 착수다 (y,x 로 읽는다)", () => {
    const r = p("9,3");
    expect(r.kind).toBe("bestMove");
    expect((r as Extract<EngineResponse, { kind: "bestMove" }>).moves).toEqual([{ x: 3, y: 9 }]);
  });

  it("한 줄에 두 수도 온다 (오프닝 협상)", () => {
    const r = p("7,7 8,8") as Extract<EngineResponse, { kind: "bestMove" }>;
    expect(r.moves).toHaveLength(2);
    expect(r.moves[1]).toEqual({ x: 8, y: 8 });
  });

  it("OK / ERROR / DEBUG", () => {
    expect(p("OK").kind).toBe("ok");
    expect(p("ERROR unknown command")).toMatchObject({ kind: "error", text: "unknown command" });
    expect(p("DEBUG hello")).toMatchObject({ kind: "debug", text: "hello" });
  });

  it("ABOUT 필드를 따온다", () => {
    const r = p('name="Rapfi", version="0.43.02", author="Rapfi developers"') as Extract<
      EngineResponse,
      { kind: "about" }
    >;
    expect(r.kind).toBe("about");
    expect(r.fields["name"]).toBe("Rapfi");
    expect(r.fields["version"]).toBe("0.43.02");
  });

  it("모르는 줄도 버리지 않는다 — raw 가 남는다", () => {
    const r = p("무언가 새로운 줄");
    expect(r.kind).toBe("unknown");
    expect(r.raw).toBe("무언가 새로운 줄");
  });

  it("빈 줄은 unknown", () => {
    expect(p("   ").kind).toBe("unknown");
  });
});

describe("파싱 — INFO 스트림", () => {
  it("PV 시작과 끝", () => {
    expect(p("INFO PV 0")).toMatchObject({ kind: "infoPvStart", index: 0 });
    expect(p("INFO PV DONE").kind).toBe("infoPvDone");
  });

  it("DEPTH 는 심화-선택 중 앞쪽만", () => {
    expect(p("INFO DEPTH 12-34")).toMatchObject({ kind: "infoDepth", depth: 12 });
  });

  it("BESTLINE 은 y,x 토큰 목록", () => {
    const r = p("INFO BESTLINE 7,7 8,8 6,9") as Extract<EngineResponse, { kind: "infoBestline" }>;
    expect(r.line).toEqual([
      { x: 7, y: 7 },
      { x: 8, y: 8 },
      { x: 9, y: 6 },
    ]);
  });

  it("EVAL 은 외통과 숫자를 가른다", () => {
    expect(p("INFO EVAL +M5")).toMatchObject({ kind: "infoEval", mate: 5, cp: null });
    expect(p("INFO EVAL -M3")).toMatchObject({ kind: "infoEval", mate: -3, cp: null });
    expect(p("INFO EVAL 814")).toMatchObject({ kind: "infoEval", mate: null, cp: 814 });
    expect(p("INFO EVAL -120")).toMatchObject({ kind: "infoEval", mate: null, cp: -120 });
  });

  it("WINRATE 와 카운터", () => {
    expect(p("INFO WINRATE 0.63")).toMatchObject({ kind: "infoWinRate", winRate: 0.63 });
    expect(p("INFO NODE 123456")).toMatchObject({ kind: "infoStat", key: "NODE", value: 123456 });
    expect(p("INFO SPEED 250k")).toMatchObject({ kind: "infoStat", key: "SPEED", value: 250 });
  });

  it("모르는 INFO 키는 메시지로 남는다", () => {
    expect(p("INFO SOMETHING 1")).toMatchObject({ kind: "message", text: "INFO SOMETHING 1" });
  });
});

describe("파싱 — 사람이 읽는 한 줄", () => {
  it("Depth/Eval/Time/PV 를 한 번에 뜯는다", () => {
    const r = p("MESSAGE Depth 16-35 | Eval 777 | Node 200K | Time 1469ms | H8 I9") as Extract<
      EngineResponse,
      { kind: "thinking" }
    >;
    expect(r.kind).toBe("thinking");
    expect(r.depth).toBe(16);
    expect(r.selDepth).toBe(35);
    expect(r.evalCp).toBe(777);
    expect(r.nodes).toBe(200);
    expect(r.timeMs).toBe(1469);
    // PV 는 문자 라벨이다: H8 = x 7, y 15-8 = 7
    expect(r.line[0]).toEqual({ x: 7, y: 7 });
  });

  it("외통도 같은 줄에서 읽는다", () => {
    expect(p("MESSAGE Depth 9 | Eval +M4 | H8")).toMatchObject({ kind: "thinking", mate: 4 });
  });

  it("파이프 없는 MESSAGE 는 그냥 메시지다", () => {
    expect(p("MESSAGE Evaluator set to mix9svq.")).toMatchObject({
      kind: "message",
      text: "Evaluator set to mix9svq.",
    });
  });

  it("문자 라벨 변환 — 행은 아래에서 위로", () => {
    expect(labelToMove("A1")).toEqual({ x: 0, y: 14 });
    expect(labelToMove("H8")).toEqual({ x: 7, y: 7 });
    expect(labelToMove("O15")).toEqual({ x: 14, y: 0 });
    expect(labelToMove("Z9")).toBeNull();
    expect(labelToMove("H99")).toBeNull();
  });
});

describe("파싱 — REALTIME 오버레이", () => {
  it("BEST / POS / DONE / LOSE", () => {
    expect(p("MESSAGE REALTIME BEST 7,8")).toMatchObject({
      kind: "realtimeBest",
      move: { x: 8, y: 7 },
    });
    expect(p("MESSAGE REALTIME POS 3,4").kind).toBe("realtimePos");
    expect(p("MESSAGE REALTIME DONE 3,4").kind).toBe("realtimeDone");
    expect(p("MESSAGE REALTIME LOSE 3,4").kind).toBe("realtimeLose");
  });

  it("REFRESH / PV / VAL", () => {
    expect(p("MESSAGE REALTIME REFRESH").kind).toBe("realtimeRefresh");
    expect(p("MESSAGE REALTIME VAL -42")).toMatchObject({ kind: "realtimeVal", value: -42 });
    const pv = p("MESSAGE REALTIME PV 7,7 8,8") as Extract<EngineResponse, { kind: "realtimePv" }>;
    expect(pv.line).toHaveLength(2);
  });

  it("좌표가 깨지면 unknown — 0,0 으로 떨어뜨리지 않는다", () => {
    expect(p("MESSAGE REALTIME BEST oops").kind).toBe("unknown");
  });
});

describe("파싱 — FORBID", () => {
  it("네 자리씩 끊어 읽고 마침표에서 멈춘다", () => {
    const r = p("FORBID 07070808.") as Extract<EngineResponse, { kind: "forbid" }>;
    expect(r.cells).toEqual([
      { x: 7, y: 7 },
      { x: 8, y: 8 },
    ]);
  });

  it("빈 목록도 정상이다", () => {
    expect((p("FORBID .") as Extract<EngineResponse, { kind: "forbid" }>).cells).toEqual([]);
  });
});

describe("집계 — INFO 블록이 스냅샷이 된다", () => {
  const feed = (agg: SearchAggregator, lines: string[]) => {
    for (const l of lines) agg.consume(parse(l, coord));
  };

  it("PV 한 블록이 태그 하나와 최선수를 만든다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, [
      "INFO NUMPV 1",
      "INFO PV 0",
      "INFO DEPTH 10-12",
      "INFO EVAL 120",
      "INFO WINRATE 0.63",
      "INFO BESTLINE 7,7 8,8",
      "INFO PV DONE",
    ]);
    const s = agg.snapshot();
    expect(s.stats.depth).toBe(10);
    expect(s.stats.winRatePct).toBe(63);
    expect(s.bestMove).toEqual({ x: 7, y: 7 });
    expect(s.bestLine).toHaveLength(2);
    expect(s.tags.get(moveKey({ x: 7, y: 7 }, 15))).toMatchObject({ label: "63%", kind: "rate" });
  });

  it("외통은 숫자가 아니라 사실로 표시된다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, ["INFO PV 0", "INFO EVAL +M5", "INFO BESTLINE 7,7", "INFO PV DONE"]);
    expect(agg.snapshot().tags.get(moveKey({ x: 7, y: 7 }, 15))).toMatchObject({
      label: "W5",
      kind: "win",
    });
  });

  it("새 라운드가 지지난 라운드의 태그를 걷어낸다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, ["INFO PV 0", "INFO BESTLINE 0,0", "INFO PV DONE"]);
    feed(agg, ["INFO PV 0", "INFO BESTLINE 1,1", "INFO PV DONE"]);
    feed(agg, ["INFO PV 0", "INFO BESTLINE 2,2", "INFO PV DONE"]);
    const tags = agg.snapshot().tags;
    expect(tags.has(moveKey({ x: 0, y: 0 }, 15))).toBe(false);
    expect(tags.has(moveKey({ x: 2, y: 2 }, 15))).toBe(true);
  });

  it("REALTIME 이 후보와 패배 칸을 채우고 REFRESH 가 비운다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, ["MESSAGE REALTIME POS 3,4", "MESSAGE REALTIME LOSE 5,6"]);
    let s = agg.snapshot();
    expect(s.candidates.get(moveKey({ x: 4, y: 3 }, 15))).toBe("live");
    expect(s.loseCells.has(moveKey({ x: 6, y: 5 }, 15))).toBe(true);
    feed(agg, ["MESSAGE REALTIME REFRESH"]);
    s = agg.snapshot();
    expect(s.candidates.size).toBe(0);
    expect(s.loseCells.size).toBe(0);
  });

  it("REALTIME BEST 가 PV 머리를 이긴다 — 더 최신이다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, ["INFO PV 0", "INFO BESTLINE 7,7", "INFO PV DONE", "MESSAGE REALTIME BEST 9,9"]);
    expect(agg.snapshot().bestMove).toEqual({ x: 9, y: 9 });
  });

  it("상세 모드가 살아 있으면 사람 줄은 PV 를 덮지 않는다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, ["INFO PV 0", "INFO BESTLINE 7,7", "INFO PV DONE"]);
    feed(agg, ["MESSAGE Depth 3 | Eval 10 | A1"]);
    // 카운터는 갱신되지만 PV 는 INFO 쪽이 권위다.
    expect(agg.snapshot().bestLine[0]).toEqual({ x: 7, y: 7 });
    expect(agg.snapshot().stats.depth).toBe(3);
  });

  it("상세 모드가 없으면 사람 줄이 유일한 PV 다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, ["MESSAGE Depth 3 | Eval 10 | H8 I9"]);
    expect(agg.snapshot().bestLine[0]).toEqual({ x: 7, y: 7 });
  });

  it("승률은 0..1 도 0..100 도 받는다", () => {
    const a = new SearchAggregator(15);
    a.consume(parse("INFO WINRATE 0.42", coord));
    expect(a.snapshot().stats.winRatePct).toBe(42);
    const b = new SearchAggregator(15);
    b.consume(parse("INFO WINRATE 42", coord));
    expect(b.snapshot().stats.winRatePct).toBe(42);
  });

  it("reset 이 오버레이를 비운다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, ["INFO PV 0", "INFO BESTLINE 7,7", "INFO PV DONE", "MESSAGE REALTIME POS 1,1"]);
    agg.reset();
    const s = agg.snapshot();
    expect(s.tags.size).toBe(0);
    expect(s.candidates.size).toBe(0);
    expect(s.bestMove).toBeNull();
  });
});
