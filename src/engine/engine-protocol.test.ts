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
    // 줄여 쓴 수는 곱해서 읽는다 — 예전엔 250k 를 250 으로 읽었다.
    expect(p("INFO SPEED 250k")).toMatchObject({ kind: "infoStat", key: "SPEED", value: 250_000 });
  });

  it("Rapfi 의 실제 카운터 키 — TOTALNODES·TOTALTIME·SELDEPTH", () => {
    // 모두 엔진 출력 캡처(0.43.02, single-simd128)에서 옮긴 줄이다.
    expect(p("INFO TOTALNODES 16118")).toMatchObject({ key: "TOTALNODES", value: 16118 });
    expect(p("INFO TOTALTIME 618")).toMatchObject({ key: "TOTALTIME", value: 618 });
    expect(p("INFO NODES 8122")).toMatchObject({ key: "NODES", value: 8122 });
    expect(p("INFO SELDEPTH 20")).toMatchObject({ key: "SELDEPTH", value: 20 });
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
    expect(r.nodes).toBe(200_000); // 200K — 예전엔 200 으로 읽었다
    expect(r.timeMs).toBe(1469);
    // PV 는 문자 라벨이다: H8 = x 7, y 15-8 = 7
    expect(r.line[0]).toEqual({ x: 7, y: 7 });
  });

  it("탐색 끝 요약 줄(Speed 로 시작)도 읽는다 — 시간 단위와 K 를 살려서", () => {
    const r = p("MESSAGE Speed 53270 | Depth 15-26 | Eval -326 | Node 36K | Time 691ms");
    expect(r).toMatchObject({ kind: "thinking", speed: 53270, nodes: 36_000, timeMs: 691 });
    expect(p("MESSAGE Depth 20-31 | Eval 12 | Time 29s | H8")).toMatchObject({ timeMs: 29_000 });
    expect(p("MESSAGE Depth 22-40 | Eval 12 | Time 3min | H8")).toMatchObject({ timeMs: 180_000 });
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

  it("탐색 없는 즉답(빈 판의 7,7)도 최선수가 된다 — 스냅샷이 비지 않는다", () => {
    // 빈 판에서 Rapfi 는 PV · 카운터 없이 좌표 한 줄만 돌려준다(YXNBEST 1 · 5 모두).
    const agg = new SearchAggregator(15);
    expect(agg.consume(p("7,7"))).toBe(true);
    const s = agg.snapshot();
    expect(s.instant).toBe(true);
    expect(s.bestMove).toEqual({ x: 7, y: 7 });
    expect(s.bestLine).toEqual([{ x: 7, y: 7 }]);
    expect(s.pvs).toHaveLength(1);
    expect(s.pvs[0]).toMatchObject({ depth: 0, evalCp: null, winRate: null, mate: null });
    // 깊이 · 평가 · 카운터는 지어내지 않는다.
    expect(s.stats.depth).toBe(0); // 빈 깊이(화면은 «—»)
    expect(s.stats.nodes).toBeNull();
    // 즉답을 되묻는 다음 조각의 같은 좌표는 아무것도 바꾸지 않는다.
    expect(agg.consume(p("7,7"))).toBe(false);
  });

  it("탐색 끝의 좌표는 그 탐색의 결과를 덮지 않는다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, ["INFO PV 0", "INFO DEPTH 9", "INFO BESTLINE 7,7 8,8", "INFO PV DONE"]);
    expect(agg.consume(p("3,3"))).toBe(false);
    const s = agg.snapshot();
    expect(s.instant).toBe(false);
    expect(s.bestMove).toEqual({ x: 7, y: 7 });
  });

  it("카운터만 보인 탐색(요약 줄)의 좌표도 즉답이 아니다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, ["INFO TOTALNODES 1200"]);
    expect(agg.consume(p("7,7"))).toBe(false);
    expect(agg.snapshot().instant).toBe(false);
  });

  it("reset 이 즉답 표시도 지운다", () => {
    const agg = new SearchAggregator(15);
    agg.consume(p("7,7"));
    agg.reset();
    expect(agg.snapshot().instant).toBe(false);
    expect(agg.snapshot().bestMove).toBeNull();
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

// ── 오프닝 협상 (W4) ─────────────────────────────────────────────────

describe("협상 명령 직렬화", () => {
  it("스왑2 단계는 인자도 좌표도 없다", () => {
    expect(serialize({ kind: "yxswap2step", step: 2 }, coord)).toEqual(["yxswap2step2"]);
  });

  it("Soosorv 단계는 수 목록을 스스로 들고 간다", () => {
    expect(
      serialize(
        {
          kind: "yxsoosorvstep",
          step: 2,
          moves: [
            { x: 7, y: 7 },
            { x: 8, y: 7 },
          ],
        },
        coord,
      ),
    ).toEqual(["yxsoosorvstep2", "7,7", "7,8", "done"]);
  });

  it("N 은 머리줄에 붙는다", () => {
    expect(
      serialize({ kind: "yxsoosorvstep", step: 4, fifthCount: 3, moves: [{ x: 1, y: 2 }] }, coord),
    ).toEqual(["yxsoosorvstep4 3", "2,1", "done"]);
  });

  it("수가 없으면 done 도 없다 — 빈 목록에 done 만 보내면 국면이 비워진다", () => {
    expect(serialize({ kind: "yxsoosorvstep", step: 1 }, coord)).toEqual(["yxsoosorvstep1"]);
  });

  it("무승부·기권도 엔진에 알린다", () => {
    expect(serialize({ kind: "yxdraw" }, coord)).toEqual(["yxdraw"]);
    expect(serialize({ kind: "yxresign" }, coord)).toEqual(["yxresign"]);
  });
});

describe("협상 응답 해석", () => {
  it("SWAP2 MOVE1 은 판 위의 돌이다", () => {
    const r = p("MESSAGE SWAP2 MOVE1 7 8");
    expect(r).toMatchObject({ kind: "openingMove", swap2: true, index: 1, move: { x: 8, y: 7 } });
  });

  it("SWAP2 SWAP1 YES/NO", () => {
    expect(p("MESSAGE SWAP2 SWAP1 YES")).toMatchObject({
      kind: "openingSwap",
      swap2: true,
      which: 1,
      yes: true,
    });
    expect(p("MESSAGE SWAP2 SWAP1 NO")).toMatchObject({ kind: "openingSwap", yes: false });
  });

  it("Soosorv 는 Y/N 한 글자로 답한다", () => {
    expect(p("MESSAGE SOOSORV SWAP2 Y")).toMatchObject({
      kind: "openingSwap",
      swap2: false,
      which: 2,
      yes: true,
    });
    expect(p("MESSAGE SOOSORV SWAP1 N")).toMatchObject({ which: 1, yes: false });
  });

  it("SOOSORV MOVE4 는 좌표 뒤에 N 을 덧붙인다", () => {
    expect(p("MESSAGE SOOSORV MOVE4 6 7 3")).toMatchObject({
      kind: "openingMove",
      swap2: false,
      index: 4,
      move: { x: 7, y: 6 },
      fifthCount: 3,
    });
  });

  it("SOOSORV MOVE5 는 돌이 아니라 5수 단계다", () => {
    expect(p("MESSAGE SOOSORV MOVE5 C 6 7")).toMatchObject({
      kind: "soosorvFifth",
      stage: "choose",
      move: { x: 7, y: 6 },
    });
    expect(p("MESSAGE SOOSORV MOVE5 R")).toMatchObject({ stage: "refresh", move: null });
    expect(p("MESSAGE SOOSORV MOVE5 D")).toMatchObject({ stage: "done", move: null });
    expect(p("MESSAGE SOOSORV MOVE5 6 7")).toMatchObject({ stage: "offer", move: { x: 7, y: 6 } });
  });

  it("좌표는 여기서도 y,x 다 — 협상만 x,y 로 읽는 실수를 막는다", () => {
    const r = p("MESSAGE SWAP2 MOVE2 0 14");
    expect(r).toMatchObject({ move: { x: 14, y: 0 } });
  });

  it("모르는 협상 줄은 메시지로 남는다 — 조용히 삼키지 않는다", () => {
    expect(p("MESSAGE SOOSORV WHAT")).toMatchObject({
      kind: "message",
      text: "SOOSORV WHAT",
    });
  });

  it("본문이 없으면 좌표로 읽지 않는다", () => {
    // «MOVE1» 만 오면 머리말의 1 을 좌표로 삼아선 안 된다.
    expect(p("MESSAGE SWAP2 MOVE1")).toMatchObject({ kind: "message" });
  });
});

describe("집계 — 조각을 넘어도 화면이 덜컥거리지 않는다", () => {
  const feed = (agg: SearchAggregator, lines: string[]) => {
    for (const l of lines) agg.consume(parse(l, coord));
  };
  const pv = (depth: number, line: string, ev: number) => [
    "INFO PV 0",
    `INFO DEPTH ${depth}`,
    `INFO EVAL ${ev}`,
    `INFO BESTLINE ${line}`,
    "INFO PV DONE",
  ];

  it("새 조각의 얕은 결과는 앞 조각의 깊이를 따라잡을 때까지 보류한다", () => {
    // 분석은 500ms 조각으로 돌고, 조각마다 엔진은 반복 심화를 처음부터 연다.
    // 그 머리의 얕은 PV 가 화면을 덮으면 조각마다 최선수·평가가 튄다.
    const agg = new SearchAggregator(15);
    feed(agg, pv(12, "7,7 8,8", 300));
    expect(agg.snapshot().stats.depth).toBe(12);

    agg.beginSlice();
    feed(agg, pv(3, "1,1 2,2", -900)); // 얕은 머리 — 무시돼야 한다
    const mid = agg.snapshot();
    expect(mid.stats.depth).toBe(12);
    expect(mid.stats.evalCp).toBe(300);
    expect(mid.bestLine[0]).toEqual({ x: 7, y: 7 });

    feed(agg, pv(13, "7,8 8,8", 320)); // 따라잡았다 — 다시 화면을 맡긴다
    const after = agg.snapshot();
    expect(after.stats.depth).toBe(13);
    expect(after.bestLine[0]).toEqual({ x: 8, y: 7 });
  });

  it("얕은 머리의 REFRESH 가 후보를 지우지 않는다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, [...pv(10, "7,7", 100), "MESSAGE REALTIME POS 5,5"]);
    expect(agg.snapshot().candidates.size).toBe(1);
    agg.beginSlice();
    feed(agg, ["INFO DEPTH 2", "MESSAGE REALTIME REFRESH"]);
    expect(agg.snapshot().candidates.size).toBe(1);
  });

  it("새 세션(reset)은 바닥도 비운다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, pv(20, "7,7", 100));
    agg.reset();
    agg.beginSlice();
    feed(agg, pv(2, "3,3", 50));
    expect(agg.snapshot().stats.depth).toBe(2);
  });
});

describe("집계 — 얕은 조각이 여럿 이어져도", () => {
  it("앞 조각의 깊은 PV 를 지우지 않는다", () => {
    const agg = new SearchAggregator(15);
    const block = (d: number, line: string) => [
      "INFO PV 0",
      `INFO DEPTH ${d}`,
      `INFO BESTLINE ${line}`,
      "INFO PV DONE",
    ];
    for (const l of block(14, "7,7")) agg.consume(parse(l, coord));
    agg.beginSlice();
    for (const d of [2, 3, 4, 5]) for (const l of block(d, "0,0")) agg.consume(parse(l, coord));
    expect(agg.snapshot().pvs).toHaveLength(1);
    expect(agg.snapshot().pvs[0]!.depth).toBe(14);
  });
});

describe("집계 — 노드·시간은 흔들리지 않는다", () => {
  const feed = (agg: SearchAggregator, lines: string[]) => {
    for (const l of lines) agg.consume(parse(l, coord));
  };

  /** 멀티 PV 두 줄짜리 한 깊이 — 캡처 그대로(PV 마다 NODES 가 따로 온다). */
  const depthBlock = (d: number, pv0: number[], pv1: number[]) => [
    "INFO PV 0",
    "INFO NUMPV 2",
    `INFO DEPTH ${d}`,
    `INFO NODES ${pv0[0]}`,
    `INFO TOTALNODES ${pv0[1]}`,
    `INFO TOTALTIME ${pv0[2]}`,
    "INFO BESTLINE 9,9 6,6",
    "INFO PV DONE",
    "INFO PV 1",
    "INFO NUMPV 2",
    `INFO DEPTH ${d}`,
    `INFO NODES ${pv1[0]}`,
    `INFO TOTALNODES ${pv1[1]}`,
    `INFO TOTALTIME ${pv1[2]}`,
    "INFO BESTLINE 6,6 9,9",
    "INFO PV DONE",
  ];

  it("PV 하나의 NODES 가 아니라 TOTALNODES 를 그린다 — 줄마다 늘기만 한다", () => {
    const agg = new SearchAggregator(15);
    const seen: number[] = [];
    const lines = [
      ...depthBlock(2, [3, 64, 30], [4, 127, 33]),
      ...depthBlock(3, [21, 206, 36], [10, 271, 36]),
      ...depthBlock(4, [27, 338, 37], [21, 408, 38]),
    ];
    for (const l of lines) {
      agg.consume(parse(l, coord));
      const n = agg.snapshot().stats.nodes;
      if (n !== null) seen.push(n);
    }
    // 예전: 3, 64, 4, 127, 21, 206, 10, 271 … — PV 마다 NODES 가 끼어들어 튀었다.
    expect(seen.every((n, i) => i === 0 || n >= seen[i - 1]!)).toBe(true);
    expect(agg.snapshot().stats.nodes).toBe(408);
    expect(agg.snapshot().stats.timeMs).toBe(38);
  });

  it("조각을 넘으면 앞 조각의 몫을 더한다 — 0 으로 돌아가지 않는다", () => {
    const agg = new SearchAggregator(15);
    agg.beginSlice();
    feed(agg, [
      ...depthBlock(11, [1968, 8325, 387], [8122, 16118, 618]),
      "MESSAGE Speed 26080 | Depth 11-15 | Eval -319 | Node 16K | Time 618ms",
    ]);
    expect(agg.snapshot().stats.nodes).toBe(16118);
    // 다음 조각 — 엔진은 0 부터 다시 센다(캡처: 65 · 1ms).
    agg.beginSlice();
    feed(agg, ["INFO PV 0", "INFO DEPTH 2", "INFO TOTALNODES 65", "INFO TOTALTIME 1"]);
    const s = agg.snapshot().stats;
    expect(s.nodes).toBe(16118 + 65);
    expect(s.timeMs).toBe(618 + 1);
    // 속도는 누적 평균 — 조각 머리의 엔진 SPEED(수천)로 떨어지지 않는다.
    expect(s.speed).toBe(Math.round(((16118 + 65) * 1000) / 619));
  });

  it("마지막 PV 뒤의 몫은 탐색 끝 요약 줄이 채운다 — 속도×시간으로 정확하게", () => {
    const agg = new SearchAggregator(15);
    agg.beginSlice();
    // 캡처: 마지막 TOTALNODES 22307 @ 431ms, 조각은 691ms 까지 읽고 끝 줄만 남겼다.
    feed(agg, ["INFO PV 0", "INFO DEPTH 15", "INFO TOTALNODES 22307", "INFO TOTALTIME 431"]);
    feed(agg, ["MESSAGE Speed 53270 | Depth 15-26 | Eval -326 | Node 36K | Time 691ms"]);
    const s = agg.snapshot().stats;
    expect(s.timeMs).toBe(691);
    expect(s.nodes).toBe(Math.floor((53270 * 691) / 1000)); // 36809 — 「36K」보다 정확
  });

  it("얕은 조각 머리에서도 시간은 흐른다 — 깊이·평가만 보류한다", () => {
    const agg = new SearchAggregator(15);
    agg.beginSlice();
    feed(agg, [...depthBlock(10, [1, 900, 200], [2, 1000, 300])]);
    agg.beginSlice(); // 이제 floor 10 — 얕은 줄은 깊이를 덮지 않는다
    feed(agg, ["INFO PV 0", "INFO DEPTH 3", "INFO TOTALNODES 50", "INFO TOTALTIME 5"]);
    const s = agg.snapshot().stats;
    expect(s.depth).toBe(10);
    expect(s.timeMs).toBe(305);
    expect(s.nodes).toBe(1050);
  });

  it("새 탐색(reset)은 누적을 비운다", () => {
    const agg = new SearchAggregator(15);
    feed(agg, ["INFO TOTALNODES 500", "INFO TOTALTIME 40"]);
    agg.reset();
    expect(agg.snapshot().stats.nodes).toBeNull();
    expect(agg.snapshot().stats.timeMs).toBeNull();
  });
});
