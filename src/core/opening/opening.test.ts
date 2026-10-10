import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SIZE, fromLabel, label, move, sameMove, type Move } from "../model/move";
import { keyOf as posKeyOf } from "../model/pos-key";
import { frameOf, keyOf, move2Kind, MAX_PLY, transpositions } from "./frame";
import { tf } from "../model/pos-key";
import * as O26 from "./opening26";
import { chain, gradeAt, nameAt } from "./opening-name";
import { theoryNext } from "./explore";
import {
  EMPTY_TABLES,
  LADDER,
  gradeOf,
  parseEvals,
  parseMoves,
  parseNames,
  type OpeningTables,
} from "./tables";

/**
 * 오프닝 명칭 · 26주형 · 흑 5수 유불리 — 앱 `OpeningNameTest` · `Opening26Test` ·
 * `OpeningEvalTest` 의 이식, 그리고 웹이 싣는 두 자료 파일의 검사.
 *
 * 골든 둘은 앱 시험 자원의 사본이다:
 *   `openname_golden.txt` — `rif_crosscheck.py` 가 `rifkey.framekey` 와 `test_openname.exe`
 *     (= openname.h)의 합의만 싣는다
 *   `openeval_golden.txt` — `rifdb/` 가 대표 수순 + 환원된 다른 수순을 싣는다
 */

const size = DEFAULT_SIZE;
const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const cell = (s: string): Move => {
  const m = fromLabel(s, size);
  if (!m) throw new Error(`bad label ${s}`);
  return m;
};
const line = (s: string) => s.split(" ").map(cell);
const text = (moves: readonly Move[]) => moves.map((m) => label(m, size).toLowerCase()).join(" ");
const rows = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t"));

interface NameGolden {
  text: string;
  moves: Move[];
  key: string;
  transform: number;
  kind: number;
}
const nameGolden: NameGolden[] = rows(here("./testdata/openname_golden.txt")).map((f) => {
  if (f.length !== 4) throw new Error(`bad golden line: ${f.join("\t")}`);
  return {
    text: f[0]!,
    moves: line(f[0]!),
    key: f[1]!,
    transform: Number(f[2]),
    kind: Number(f[3]),
  };
});

interface EvalRow {
  text: string;
  moves: Move[];
  grade: number;
}
const evalGolden: EvalRow[] = rows(here("./testdata/openeval_golden.txt")).map((f) => {
  if (f.length !== 2) throw new Error(`bad golden line: ${f.join("\t")}`);
  return { text: f[0]!, moves: line(f[0]!), grade: Number(f[1]!.replace(/^\+/, "")) };
});

const kindOf = (k: string) => (k === "none" ? -1 : k === "direct" ? 0 : 1);

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

const tables = (t: Partial<OpeningTables>): OpeningTables => ({ ...EMPTY_TABLES, ...t });

// ── 26주형 ────────────────────────────────────────────────────────────

describe("26주형", () => {
  it("이름과 개수가 다 있다", () => {
    expect(O26.ABBR).toHaveLength(26);
    expect(O26.KOREAN).toHaveLength(26);
    expect(O26.ROMAJI).toHaveLength(26);
    expect(O26.ABBR[0]).toBe("D1");
    expect(O26.ABBR[13]).toBe("I1");
    expect(O26.ROMAJI[0]).toBe("Kansei");
  });

  it("D1 은 h8 h9 h10", () => {
    expect(O26.classify(line("h8 h9 h10"))).toBe(0);
    expect(O26.representative(0)).toEqual(line("h8 h9 h10"));
    expect(O26.isDirect(0)).toBe(true);
  });

  it("간접 주형의 2수는 I9", () => {
    expect(O26.isDirect(13)).toBe(false);
    expect(O26.representative(13)[1]).toEqual(cell("i9"));
  });

  it("모든 대표가 제 번호로 돌아온다", () => {
    for (let i = 0; i < O26.COUNT; i++) expect(O26.classify(O26.representative(i))).toBe(i);
  });

  it("돌려 놓아도 같은 주형이다", () => {
    expect(O26.classify(line("h8 i8 j8"))).toBe(0);
  });

  it("1수가 천원이 아니면 규칙외", () => {
    expect(O26.classify(line("a1 b2 c3"))).toBe(O26.NONSTD);
    expect(O26.labelOf(O26.NONSTD)).toBe("기타 (규칙외)");
    expect(O26.indexOfAbbr("I13")).toBe(25);
    expect(O26.indexOfAbbr("X1")).toBe(O26.NONSTD);
  });
});

// ── 프레임 키 (오프닝 명칭) ──────────────────────────────────────────

describe("프레임 키 골든", () => {
  it("골든이 작업지 전체를 덮는다", () => {
    // 천원 1 + 2수 8 + 주형 26 + 4수 모양 1070(7×7) + 5수 모양 1077 + 프레임 없는 5
    expect(nameGolden).toHaveLength(2187);
    expect(nameGolden.filter((g) => g.transform < 0)).toHaveLength(5);
    expect(nameGolden.filter((g) => g.moves.length === 4)).toHaveLength(1070);
    expect(nameGolden.filter((g) => g.moves.length === 5)).toHaveLength(1077);
  });

  it("모든 골든 줄이 데스크톱과 같다", () => {
    const wrong = nameGolden.filter((g) => {
      const f = frameOf(g.moves, size);
      return g.transform < 0
        ? f !== null
        : f === null || f.key !== g.key || f.transform !== g.transform;
    });
    expect(wrong.map((g) => g.text)).toEqual([]);
  });

  it("2수가 어떻게 막는지도 같다", () => {
    const wrong = nameGolden.filter((g) => kindOf(move2Kind(g.moves, size)) !== g.kind);
    expect(wrong.map((g) => g.text)).toEqual([]);
  });

  it("한 수순의 여덟 배치가 한 키를 공유한다", () => {
    for (const g of nameGolden) {
      if (g.transform < 0) continue;
      for (let t = 0; t < 8; t++) {
        expect(
          keyOf(
            g.moves.map((m) => tf(t, size, m)),
            size,
          ),
        ).toBe(g.key);
      }
    }
  });

  /** 거울 대칭인 주형은 4수 22자리를 12모양으로 접고, 비대칭은 22를 그대로 둔다. */
  it("대칭 주형은 4수를 반으로 접는다", () => {
    const shapes = (l: string, r: number) => {
      const base = line(l);
      const keys = new Set<string>();
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const m = move(7 + dx, 7 + dy);
          if (base.some((b) => sameMove(b, m))) continue;
          const k = keyOf([...base, m], size);
          if (k) keys.add(k);
        }
      }
      return keys.size;
    };
    expect(shapes("h8 h9 h10", 2)).toBe(12); // 한성 — 3수가 축 위
    expect(shapes("h8 h9 g9", 2)).toBe(22); // 화월 — 남는 거울이 없다
    // 작업지는 7×7 로 묻는다 — 5×5 는 *3수*의 규칙이지 4수를 묶지 않는다
    expect(shapes("h8 h9 h10", 3)).toBe(25);
    expect(shapes("h8 h9 g9", 3)).toBe(46);
  });

  it("프레임의 3수 머리는 26주형 분류와 어긋나지 않는다", () => {
    const byKey = new Map<string, number>();
    for (const g of nameGolden) {
      if (g.moves.length < 3) continue;
      const head = g.moves.slice(0, 3);
      const id = O26.classify(head);
      if (id === O26.NONSTD) continue;
      const key = keyOf(head, size)!;
      expect(byKey.get(key) ?? id).toBe(id);
      byKey.set(key, id);
    }
    expect(new Set(byKey.values()).size).toBe(26);
    expect(byKey.size).toBe(26);
  });

  it("프레임이 없는 수순은 이름이 없다", () => {
    expect(keyOf(line("a1"), size)).toBeNull();
    expect(keyOf([], size)).toBeNull();
    const six = line("h8 h9 g9 g8 f7 j10");
    expect(keyOf(six, size)).toBeNull(); // 프레임은 5수에서 멈춘다
    expect(keyOf(six.slice(0, MAX_PLY), size)).toBe("h8 h9 g9 g8");
    expect(nameAt(5, six, EMPTY_TABLES, size)).toBeNull(); // 이름은 4수에서 멈춘다
  });

  it("5수 키는 4수 키를 잇는다", () => {
    for (const g of nameGolden) {
      if (g.moves.length !== 5 || g.transform < 0) continue;
      expect(g.key.startsWith(`${keyOf(g.moves.slice(0, 4), size)} `)).toBe(true);
    }
    expect(keyOf(line("h8 h9 h10 h11 g9"), size)).toBe("h8 h9 h10 h11 g9");
  });

  /** 2026-08-14 사용자: 한성의 4수 h11 과 h7 은 다른 주형이다(칸수 차이). */
  it("축 위아래의 4수는 따로다", () => {
    const k = (s: string) => keyOf(line(s), size);
    expect(k("h8 h9 h10 h11")).not.toBe(k("h8 h9 h10 h7"));
    expect(k("h8 h9 h10 h12")).not.toBe(k("h8 h9 h10 h6"));
    expect(k("h8 h9 h10 h11")).toBe("h8 h9 h10 h11");
    expect(k("h8 h9 h10 g9")).toBe(k("h8 h9 h10 i9")); // 좌우 거울은 한 모양
  });
});

// ── 흑 5수 유불리 ────────────────────────────────────────────────────

/** 골든의 대표 수순으로 다시 만든 평가 파일 — 실린 파일과 같은 모양. */
function rebuiltFile(): string {
  const seen = new Map<string, EvalRow>();
  for (const r of evalGolden) {
    const k = posKeyOf(r.moves, size);
    if (!seen.has(k)) seen.set(k, r);
  }
  let out = "# rebuilt from the golden by opening.test.ts\n";
  for (const r of seen.values()) out += `${r.moves.length}\t${r.text}\t${r.grade}\t\n`;
  return out;
}

describe("흑 5수 유불리", () => {
  it("골든이 환원을 국면 하나씩으로 접는다", () => {
    const byKey = groupBy(evalGolden, (r) => posKeyOf(r.moves, size));
    expect(evalGolden).toHaveLength(4013);
    expect(byKey.size).toBe(1889);
    for (const [, rs] of byKey) expect(new Set(rs.map((r) => r.grade)).size).toBe(1);
    expect([...byKey.values()].filter((rs) => rs.length > 1).length).toBeGreaterThan(1000);
  });

  it("모든 골든 줄이 읽은 파일로 등급을 찾는다", () => {
    const load = parseEvals(rebuiltFile(), size);
    expect(load.bad).toBe(0);
    expect(load.rows.size).toBe(1889);
    const t = tables({ evals: load.rows });
    const wrong = evalGolden.filter((r) => gradeAt(r.moves, t, size)?.code !== r.grade);
    expect(wrong.map((r) => r.text)).toEqual([]);
  });

  it("파일이 적지 않은 수순도 그 줄을 찾는다", () => {
    const file = rebuiltFile();
    const t = tables({ evals: parseEvals(file, size).rows });
    const written = new Set(
      file
        .split("\n")
        .filter((l) => !l.startsWith("#"))
        .map((l) => l.split("\t")[1]),
    );
    const unwritten = evalGolden.filter((r) => !written.has(r.text));
    expect(unwritten.length).toBeGreaterThan(0);
    for (const r of unwritten.slice(0, 200)) expect(gradeAt(r.moves, t, size)?.code).toBe(r.grade);
  });

  it("사다리는 열한 등급, 다섯 모양", () => {
    expect(LADDER.map((g) => g.code)).toEqual([5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5]);
    expect(new Set(LADDER.map((g) => g.ko)).size).toBe(11);
    expect(new Set(LADDER.map((g) => g.en)).size).toBe(11);
    expect(new Set(LADDER.map((g) => g.fill)).size).toBe(11);
    const count = (m: string) => LADDER.filter((g) => g.mark === m).length;
    expect([count("circle"), count("pentagon"), count("square"), count("triangle")]).toEqual([
      1, 3, 3, 3,
    ]);
    expect(count("cross")).toBe(1);
    expect(gradeOf(6)).toBeNull();
    expect(gradeOf(-6)).toBeNull();
    expect(gradeOf(null)).toBeNull();
    expect(gradeOf(0)?.ko).toBe("동등");
  });

  it("손으로 고치다 틀린 줄을 거른다", () => {
    const load = parseEvals(
      "﻿# grades\r\n" +
        "\r\n" +
        "5\th8 h9 h10 h11 g9\t+5\t책 12쪽\r\n" +
        "5\th8 h9 h10 h7 g8\t-5\t\n" +
        "4\th8 h9 h10 h11\t+0\t\n" +
        "5\th8 h9 h10 h11 g8\t+6\t\n" + // 범위 밖
        "5\th8 h9 h10 h11 f8\t-6\t\n" + // 범위 밖
        "5\th8 h9 h10 h11 e8\tzero\t\n" + // 숫자 아님
        "5\th8 h9 h10 h11 d8\t\t\n" + // 빈 등급
        "5\th8 h9 h10 h11\t+1\t\n" + // 수 수가 좌표와 다름
        "5\th8 h9 h10 h11 zz\t+1\t\n" + // 읽을 수 없는 좌표
        "3\th8 h9 h10\t+1\t\n" + // 등급은 4수부터
        "5\th8 h9 h10 h11 g9\t-3\t\n", // 중복: 첫 줄이 이긴다
      size,
    );
    expect(load.rows.size).toBe(3);
    expect(load.bad).toBe(7);
    const t = tables({ evals: load.rows });
    expect(gradeAt(parseMoves("h8 h9 h10 h11 g9", size)!, t, size)?.code).toBe(5);
  });

  it("이름과 등급은 같은 파일 모양, 다른 키", () => {
    // 같은 네 돌 같은 색을 두 길로: 한성이 g9 를 4수로, 간접 주형이 h9 를 4수로.
    const direct = parseMoves("h8 h9 h10 g9", size)!;
    const indirect = parseMoves("h8 g9 h10 h9", size)!;
    expect(keyOf(direct, size)).not.toBe(keyOf(indirect, size));
    expect(posKeyOf(direct, size)).toBe(posKeyOf(indirect, size));
    const t = tables({
      names: parseNames(
        `4\t${keyOf(direct, size)}\t한교\t\n4\t${keyOf(indirect, size)}\t간접쪽\t\n`,
        size,
      ).rows,
      evals: parseEvals("4\th8 h9 h10 g9\t-2\t\n", size).rows,
    });
    expect(nameAt(4, direct, t, size)).toBe("한교");
    expect(nameAt(4, indirect, t, size)).toBe("간접쪽");
    expect(gradeAt(direct, t, size)?.code).toBe(-2);
    expect(gradeAt(indirect, t, size)?.code).toBe(-2);
  });

  it("빈 표는 이름도 등급도 없다 — 계산하는 수는 그대로", () => {
    const moves = parseMoves("h8 h9 h10 h11 g9", size)!;
    expect(nameAt(4, moves.slice(0, 4), EMPTY_TABLES, size)).toBeNull();
    expect(gradeAt(moves, EMPTY_TABLES, size)).toBeNull();
    expect(nameAt(1, moves.slice(0, 1), EMPTY_TABLES, size)).toBe("천원");
    expect(nameAt(3, moves.slice(0, 3), EMPTY_TABLES, size)).toBe("한성");
    expect(chain(moves, EMPTY_TABLES, size)).toEqual(["천원", "직접막기", "한성"]);
  });

  it("등급은 4수 · 5수 국면에만 붙는다", () => {
    const t = tables({ evals: parseEvals("5\th8 h9 h10 h11 g9\t+5\t\n", size).rows });
    const moves = parseMoves("h8 h9 h10 h11 g9 f8", size)!;
    expect(gradeAt(moves.slice(0, 5), t, size)).not.toBeNull();
    expect(gradeAt(moves.slice(0, 3), t, size)).toBeNull();
    expect(gradeAt(moves, t, size)).toBeNull();
  });

  /** 골든은 환원을 열거해 만들어졌으므로, 같은 PosKey 를 나눈 줄들이 곧 정답이다. */
  it("환원이 골든의 묶음과 같다", () => {
    const byKey = groupBy(evalGolden, (r) => posKeyOf(r.moves, size));
    let checked = 0;
    for (const [, rs] of byKey) {
      const expected = rs.map((r) => r.text).sort();
      for (const r of rs) {
        expect(transpositions(r.moves, size).map(text).sort()).toEqual(expected);
        checked++;
      }
    }
    expect(checked).toBe(4013);
  });

  it("환원 목록에는 언제나 자기 자신이 있다", () => {
    for (const r of evalGolden.slice(0, 500)) {
      expect(transpositions(r.moves, size).map(text)).toContain(r.text);
    }
  });

  it("같은 돌을 두 길로 — 이름 둘, 등급 하나", () => {
    const direct = parseMoves("h8 h9 h10 g9", size)!;
    expect(transpositions(direct, size).map(text)).toEqual(["h8 h9 h10 g9", "h8 i9 h10 h9"]);
    const other = parseMoves("h8 i9 h10 h9", size)!;
    expect(O26.classify(direct.slice(0, 3))).not.toBe(O26.classify(other.slice(0, 3)));
    expect(posKeyOf(direct, size)).toBe(posKeyOf(other, size));
  });

  it("닿을 수 없는 수순은 내놓지 않는다", () => {
    const got = transpositions(parseMoves("h8 i9 j10 i12", size)!, size);
    expect(got.map(text)).toEqual(["h8 i9 j10 i12"]);
  });

  it("좌표를 데스크톱이 쓰는 대로 읽는다", () => {
    expect(parseMoves("h8", size)).toEqual([move(7, 7)]);
    expect(parseMoves("a1", size)).toEqual([move(0, 14)]);
    expect(parseMoves("o15", size)).toEqual([move(14, 0)]);
    expect(parseMoves("", size)).toEqual([]);
    for (const bad of ["p8", "h16", "h0", "h", "h8x"]) expect(parseMoves(bad, size)).toBeNull();
  });
});

// ── 웹이 싣는 자료 파일 ──────────────────────────────────────────────

describe("실린 자료", () => {
  const names = parseNames(here("./data/opening_names.txt"), size);
  const evals = parseEvals(here("./data/opening_evals.txt"), size);
  const shipped = tables({ names: names.rows, evals: evals.rows });

  it("두 파일 모두 버리는 줄 없이 읽힌다", () => {
    expect(names.bad).toBe(0);
    expect(names.rows.size).toBe(249);
    expect(evals.bad).toBe(0);
    expect(evals.rows.size).toBe(1889);
  });

  /** 사본이 골든과 어긋나면(한쪽만 갱신) 여기서 잡힌다. */
  it("실린 평가 파일이 골든의 모든 줄에 같은 등급을 준다", () => {
    const wrong = evalGolden.filter((r) => gradeAt(r.moves, shipped, size)?.code !== r.grade);
    expect(wrong.map((r) => r.text)).toEqual([]);
  });

  it("4수 이름이 실제로 사슬을 잇는다", () => {
    expect(chain(line("h8 h9 f10 f8"), shipped, size)).toEqual([
      "천원",
      "직접막기",
      O26.nameOf(O26.classify(line("h8 h9 f10"))),
      "소절",
    ]);
  });
});

// ── 팩 없는 탐색 ─────────────────────────────────────────────────────

describe("이론 다음 수", () => {
  const names = parseNames(here("./data/opening_names.txt"), size).rows;
  const evals = parseEvals(here("./data/opening_evals.txt"), size).rows;
  const shipped = tables({ names, evals });

  it("빈 판에서는 천원 하나", () => {
    expect(theoryNext([], shipped, size)).toEqual([
      { move: cell("h8"), name: "천원", grade: null },
    ]);
  });

  it("천원 뒤로는 직접 넷 · 간접 넷", () => {
    const rows = theoryNext(line("h8"), shipped, size);
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => r.name === "직접막기")).toHaveLength(4);
    expect(rows.filter((r) => r.name === "간접막기")).toHaveLength(4);
  });

  it("2수 뒤로는 5×5 의 빈 칸 모두가 주형이다", () => {
    const rows = theoryNext(line("h8 h9"), shipped, size);
    expect(rows).toHaveLength(23);
    for (const r of rows) expect(O26.KOREAN).toContain(r.name);
    // 직접 주형 13개가 모두 나온다(거울로 접힌 칸은 같은 이름)
    expect(new Set(rows.map((r) => r.name)).size).toBe(13);
  });

  it("3수 뒤로는 표에 있는 4수 이름만", () => {
    const rows = theoryNext(line("h8 h9 f10"), shipped, size);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.name).not.toBeNull();
      expect(names.get(keyOf([...line("h8 h9 f10"), r.move], size)!)?.ko).toBe(r.name);
    }
    expect(rows.map((r) => r.name)).toContain("소절");
  });

  it("4수 뒤로는 등급 붙은 5수가 흑에게 좋은 것부터", () => {
    const four = evalGolden.find((r) => r.moves.length === 5)!.moves.slice(0, 4);
    const rows = theoryNext(four, shipped, size);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.grade).not.toBeNull();
    const codes = rows.map((r) => r.grade!.code);
    expect(codes).toEqual([...codes].sort((a, b) => b - a));
  });

  it("빈 표에서는 계산하는 1~3수만", () => {
    expect(theoryNext(line("h8 h9 f10"), EMPTY_TABLES, size)).toEqual([]);
    expect(theoryNext(line("h8 h9"), EMPTY_TABLES, size)).toHaveLength(23);
  });
});
