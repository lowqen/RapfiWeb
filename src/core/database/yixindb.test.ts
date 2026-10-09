import { describe, expect, it } from "vitest";
import { CoordMapper, serialize } from "../../engine/engine-protocol";
import { fromLabel, moveKey, type Move } from "../model/move";
import {
  DbAggregator,
  EMPTY_DB_SNAPSHOT,
  decodeTag,
  deleteAll,
  deleteOne,
  deleteScopeTitle,
  editComment,
  editLabel,
  editRecord,
  parseDbLine,
  positionValue,
  proveVerdict,
  proveWriteTag,
  queryAll,
  queryOne,
  queryText,
  type DbCell,
  type DbSnapshot,
} from "./yixindb";

/** 앱 `DatabaseProtocolTest` 의 이식 — 원본은 Rapfi `dbcommand.cpp` 와 데스크톱 main.c. */

const coord = new CoordMapper(15);
const m = (s: string) => fromLabel(s)!;
const path = [m("H8"), m("I9")];
const pathWire = "7,7\n6,8";
const wire = (c: Parameters<typeof serialize>[0]) => serialize(c, coord).join("\n");
const pack = (t: string) => [...t].reduce((a, c) => a * 256 + c.charCodeAt(0), 0);

describe("명령", () => {
  it("국면 단위: 머리 · 수순 · done", () => {
    expect(wire(queryAll(path))).toBe(`yxquerydatabaseallt\n${pathWire}\ndone`);
    expect(wire(queryOne(path))).toBe(`yxquerydatabaseone\n${pathWire}\ndone`);
    expect(wire(queryText(path))).toBe(`yxquerydatabasetext\n${pathWire}\ndone`);
    expect(wire(queryAll([]))).toBe("yxquerydatabaseallt\ndone");
  });

  it('주석은 따옴표로 싸고 " · \\ 를 이스케이프한다', () => {
    expect(wire(editComment('say "hi" \\ ok\n둘째 줄', path))).toBe(
      `yxedittextdatabase "say \\"hi\\" \\\\ ok\n둘째 줄"\n${pathWire}\ndone`,
    );
  });

  it("칸 글자: 대상 칸 · 한 토큰 · 여섯 자 · 빈 글자는 뒤 공백", () => {
    const tw = (x: Move) => coord.toWire(x);
    expect(wire(editLabel(m("I8"), "A", path, tw))).toBe(
      `yxeditlabeldatabase 7,8 A\n${pathWire}\ndone`,
    );
    expect(wire(editLabel(m("H8"), "", [], tw))).toBe("yxeditlabeldatabase 7,7 \ndone");
    expect(wire(editLabel(m("H8"), " 1234567 two", [], tw))).toBe(
      "yxeditlabeldatabase 7,7 123456\ndone",
    );
  });

  it("기록 고치기의 마스크", () => {
    expect(wire(editRecord(1, { tag: "W" }, []))).toBe("yxedittvddatabase 1 87 0 0\ndone");
    expect(wire(editRecord(1, { tag: null }, []))).toBe("yxedittvddatabase 1 -1 0 0\ndone");
    expect(wire(editRecord(2, { value: 250 }, []))).toBe("yxedittvddatabase 2 -1 250 0\ndone");
    expect(wire(editRecord(7, { tag: "L", value: 29990, depth: 5 }, path))).toBe(
      `yxedittvddatabase 7 76 29990 5\n${pathWire}\ndone`,
    );
  });

  it("지우기", () => {
    expect(wire(deleteOne(path))).toBe(`yxdeletedatabaseone\n${pathWire}\ndone`);
    const head = (filter: Parameters<typeof deleteAll>[0]["filter"], recursive = false, step = 1) =>
      serialize(deleteAll({ filter, recursive, step }, []), coord)[0];
    expect(head("all")).toBe("yxdeletedatabaseall");
    expect(head("all", true)).toBe("yxdeletedatabaseall");
    expect(head("nonwl")).toBe("yxdeletedatabaseall nonwl");
    expect(head("nonwl", true)).toBe("yxdeletedatabaseall nonwlrecursive");
    expect(head("wlnostep")).toBe("yxdeletedatabaseall wlnostep");
    expect(head("wlinstep", false, 9)).toBe("yxdeletedatabaseall wlinstep 9");
    expect(head("wlinstep", true, 3)).toBe("yxdeletedatabaseall wlinsteprecursive 3");
    expect(deleteScopeTitle({ filter: "w", recursive: true, step: 1 })).toBe(
      "승 기록 (하위 분기까지)",
    );
    expect(deleteScopeTitle({ filter: "wlinstep", recursive: false, step: 7 })).toBe(
      "7수 이내 승/패",
    );
  });
});

describe("응답 한 줄", () => {
  it("칸: 좌표 · 꾸린 태그 · 값 · 칸 글자", () => {
    const r = parseDbLine(`DATABASE 7 8 ${pack("w39")} -12 20 3 1 note`);
    expect(r).toEqual({
      kind: "cell",
      row: 7,
      col: 8,
      tag: pack("w39"),
      value: -12,
      depth: 20,
      bound: "exact",
      hasComment: true,
      text: "note",
    });
    expect(parseDbLine("DATABASE 0 0 -1 0 0 0 0")).toMatchObject({
      kind: "cell",
      tag: -1,
      text: "",
    });
  });

  it("REFRESH · DONE · ONE · 파일 작업 · 오류", () => {
    expect(parseDbLine("DATABASE REFRESH").kind).toBe("refresh");
    expect(parseDbLine("DATABASE DONE").kind).toBe("done");
    expect(parseDbLine("DATABASE ONE 87 250 18 3 W13")).toEqual({
      kind: "one",
      label: 87,
      value: 250,
      depth: 18,
      bound: "exact",
      display: "W13",
    });
    expect(parseDbLine("DATABASE ONE 0 0 0 0")).toMatchObject({
      kind: "one",
      label: 0,
      display: "",
    });
    expect(parseDbLine("Saved database file using 12 ms.")).toEqual({ kind: "saved", ms: 12 });
    expect(parseDbLine("Wrote (all) database to csv-format text file rapfi.csv")).toEqual({
      kind: "wrote",
    });
    expect(parseDbLine("Done deleting 4 records using 1 ms.")).toEqual({
      kind: "deleted",
      count: 4,
    });
    expect(parseDbLine("ERROR No game has been started.")).toEqual({
      kind: "error",
      text: "No game has been started.",
    });
  });

  it("꾸린 태그는 빅엔디언으로 풀린다", () => {
    expect(decodeTag(0)).toBe("");
    expect(decodeTag(-1)).toBe("");
    expect(decodeTag(0x77)).toBe("W");
    expect(decodeTag(0x64)).toBe("D");
    expect(decodeTag(pack("w39"))).toBe("W39");
    expect(decodeTag(pack("l5"))).toBe("L5");
    expect(decodeTag(pack("39%"))).toBe("39%");
    expect(decodeTag(pack("100%"))).toBe("100%");
    expect(decodeTag(pack("w0"))).toBe("W*");
  });
});

describe("집계", () => {
  const agg = () => new DbAggregator(15, (r, c) => coord.fromWire(r, c));

  it("칸을 모으고 REFRESH 에 비운다", () => {
    const a = agg();
    a.consume("DATABASE REFRESH");
    a.consume(`DATABASE 7 7 ${pack("w39")} 0 0 0 0`);
    a.consume(`DATABASE 6 8 ${pack("63%")} 0 0 0 0 x`);
    a.consume("DATABASE 5 5 -1 0 0 0 1");
    expect(a.consume("DATABASE DONE")?.kind).toBe("done");
    const s = a.snapshot();
    expect(s.cells.size).toBe(2);
    expect(s.cells.get(moveKey(m("H8")))?.tag).toBe("W39");
    expect(s.cells.get(moveKey(m("I9")))?.text).toBe("x");
    a.consume("DATABASE REFRESH");
    expect(a.snapshot().cells.size).toBe(0);
  });

  it("한 줄 주석은 이스케이프를 푼다", () => {
    const a = agg();
    expect(a.consume('DATABASE TEXT "say \\"hi\\" \\\\ ok"')).toEqual({
      kind: "text",
      body: 'say "hi" \\ ok',
    });
    expect(a.snapshot().comment).toBe('say "hi" \\ ok');
  });

  it("여러 줄 주석은 닫는 따옴표까지 읽는다", () => {
    const a = agg();
    expect(a.consume('DATABASE TEXT "line one')).toBeNull();
    expect(a.consume("line two")).toBeNull();
    expect(a.consume('line three"')?.kind).toBe("text");
    expect(a.snapshot().comment).toBe("line one\nline two\nline three");
  });

  it("빈 주석은 지운다", () => {
    const a = agg();
    a.consume('DATABASE TEXT "old"');
    a.consume('DATABASE TEXT ""');
    expect(a.snapshot().comment).toBe("");
  });

  it("ONE 은 기록이 된다", () => {
    const a = agg();
    a.consume("DATABASE ONE 108 -300 12 1 L7");
    expect(a.snapshot().entry).toEqual({
      label: "l",
      value: -300,
      depth: 12,
      bound: "upper",
      display: "L7",
    });
  });
});

describe("국면 값(evalbar_update_from_db)", () => {
  const snap = (...labels: string[]): DbSnapshot => {
    const cells = new Map<number, DbCell>();
    labels.forEach((tag, i) =>
      cells.set(i, {
        move: { x: i, y: 0 },
        tag,
        text: "",
        value: 0,
        depth: 0,
        bound: "none",
        hasComment: false,
      }),
    );
    return { ...EMPTY_DB_SNAPSHOT, cells };
  };

  it("가장 좋은 승률이 둘 차례의 값", () => {
    const v = positionValue(snap("40%", "63%", "12%"), true, 3)!;
    expect(v.stmWinRate).toBeCloseTo(0.63);
    expect(v.blackWinRate).toBeCloseTo(0.63);
    expect(positionValue(snap("40%", "63%"), false, 2)!.blackWinRate).toBeCloseTo(0.37);
  });

  it("승 하나면 승, 가장 짧은 수로", () => {
    const v = positionValue(snap("10%", "W13", "W7"), false, 99)!;
    expect(v.stmMate).toBe(7);
    expect(v.blackMate).toBe(-7);
    expect(v.blackWinRate).toBe(0);
  });

  it("패는 둘 수 있는 칸이 모두 덮였을 때만", () => {
    expect(positionValue(snap("L5", "L9"), true, 200)).toBeNull();
    expect(positionValue(snap("L5", "L9"), true, 0)).toBeNull();
    const v = positionValue(snap("L5", "L9"), true, 2)!;
    expect(v.stmMate).toBe(-9);
    expect(v.blackWinRate).toBe(0);
  });

  it("무승부는 50%", () => {
    expect(positionValue(snap("D", "30%"), true, 2)!.stmWinRate).toBeCloseTo(0.5);
  });
});

describe("증명과 DB", () => {
  it("소문자 라벨만 결론이다", () => {
    expect(proveVerdict(0x77, true)).toBe("nowin");
    expect(proveVerdict(0x77, false)).toBe("win");
    expect(proveVerdict(0x6c, true)).toBe("win");
    expect(proveVerdict(0x6c, false)).toBe("nowin");
    expect(proveVerdict(0x64, true)).toBe("nowin");
    expect(proveVerdict(0x57, true)).toBeNull();
    expect(proveVerdict(0, true)).toBeNull();
  });

  it("둘 차례의 승은 L 로 적는다(둔 쪽 관점)", () => {
    expect(proveWriteTag(true)).toBe("L");
    expect(proveWriteTag(false)).toBe("W");
  });
});
