import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonNext, canonical, inverse, keyOf, of, tf, toBoard } from "./pos-key";
import { DEFAULT_SIZE, fromLabel, label, move, type Move } from "./move";

/**
 * 국면 키 교차검증의 **다섯 번째 축** — 앱 `PosKeyTest` · `PosKeyStabiliserTest` 의 이식.
 *
 * `rifdb/rif_crosscheck.py` 가 `rifkey.py` 와 `test_webkey.exe`(= main.c web_poskey)가
 * 합의한 국면만 `testdata/poskey_golden.txt` 에 쓴다(합성 국면뿐 — RenjuNet 기보는
 * 들어 있지 않다). 이 시험이 그 파일을 읽으므로 이식이 다른 구현과 갈라지면 조용히
 * 틀린 통계 대신 시험이 깨진다. 다시 만들려면 `python rif_crosscheck.py --emit`.
 */

const size = DEFAULT_SIZE;
const cell = (s: string): Move => {
  const m = fromLabel(s, size);
  if (!m) throw new Error(`bad label ${s}`);
  return m;
};
const line = (...labels: string[]) => labels.map(cell);

interface Golden {
  moves: Move[];
  text: string;
  key: string;
  transform: number;
  probe: string;
}

/** `rif_crosscheck.py` 의 프로브 칸 — 여덟 상이 모두 달라 상이 곧 변환을 정한다. */
const probeCell = cell("b3");

const golden: Golden[] = readFileSync(
  new URL("./testdata/poskey_golden.txt", import.meta.url),
  "utf8",
)
  .split(/\r?\n/)
  .filter((l) => l.trim() !== "" && !l.startsWith("#"))
  .map((l) => {
    const f = l.split("\t");
    if (f.length !== 4) throw new Error(`bad golden line: ${l}`);
    return {
      moves: f[0]!.split(" ").map(cell),
      text: f[0]!,
      key: f[1]!,
      transform: Number(f[2]),
      probe: f[3]!,
    };
  });

describe("골든 벡터", () => {
  it("파일이 있고 충분히 크다", () => {
    expect(golden.length).toBeGreaterThanOrEqual(200);
  });

  it("모든 키가 맞는다", () => {
    expect(golden.filter((g) => keyOf(g.moves, size) !== g.key).map((g) => g.text)).toEqual([]);
  });

  it("모든 채택 대칭이 맞는다", () => {
    expect(
      golden.filter((g) => of(g.moves, size).transform !== g.transform).map((g) => g.text),
    ).toEqual([]);
  });

  /**
   * 변환은 저장된 다음 수를 판에 되돌리는 데 쓰이므로 번호만이 아니라 **프로브 칸의 상**을
   * 맞춘다 — 키는 같고 변환이 틀리면 추천 수가 엉뚱한 자리에 그려진다.
   */
  it("모든 프로브 상이 맞는다", () => {
    const bad = golden.filter((g) => {
      const t = of(g.moves, size).transform;
      return label(tf(t, size, probeCell), size).toLowerCase() !== g.probe;
    });
    expect(bad.map((g) => g.text)).toEqual([]);
  });
});

describe("골든이 말하지 못하는 성질", () => {
  it("한 수순의 여덟 대칭이 한 키를 공유한다", () => {
    // test_webkey.c 자체 시험 국면
    const l = line("h8", "i9", "j8", "g10", "k11");
    const keys = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7].map((t) =>
        keyOf(
          l.map((m) => tf(t, size, m)),
          size,
        ),
      ),
    );
    expect(keys.size).toBe(1);
  });

  it("다른 국면은 다른 키다", () => {
    expect(keyOf(line("h8", "i9"), size)).not.toBe(keyOf(line("h8", "i8"), size));
  });

  it("색은 칸이 아니라 수순에서 온다", () => {
    expect(keyOf(line("h8", "i9"), size)).not.toBe(keyOf(line("i9", "h8"), size));
  });

  it("빈 판은 판 크기뿐이다", () => {
    expect(keyOf([], size)).toBe("15");
    expect(of([], size).transform).toBe(0);
  });

  it("모든 변환은 역변환으로 되돌아온다", () => {
    for (let t = 0; t < 8; t++) {
      for (const c of ["a1", "b3", "h8", "o15", "c9"]) {
        const m = cell(c);
        expect(tf(inverse(t), size, tf(t, size, m))).toEqual(m);
      }
    }
  });

  /**
   * 후보는 보드 인덱스가 아니라 문자열로 비교한다. 15 판에서 행 "10".."15" 가
   * "2".."9" 보다 앞에 오고, 그래서 데스크톱이 직렬화를 비교한다.
   */
  it("후보는 문자열로 비교한다", () => {
    expect("15a10b" < "15a2b").toBe(true);
    // h8 혼자는 여덟 대칭 모두에 불변이다. i9 를 더하면 깨지고, rifkey · main.c 둘 다
    // t=1 · 키 15g9wh8b 에 선다.
    const r = of(line("h8", "i9"), size);
    expect(r.key).toBe("15g9wh8b");
    expect(r.transform).toBe(1);
  });

  it("동률이면 가장 작은 변환을 남긴다", () => {
    const r = of(line("h8"), size);
    expect(r.key).toBe("15h8b");
    expect(r.transform).toBe(0);
  });

  it("저장된 추천 수가 판 위로 되돌아온다", () => {
    const r = of(line("h8", "i9", "j10"), size);
    const onBoard = cell("k11");
    expect(toBoard(r, tf(r.transform, size, onBoard), size)).toEqual(onBoard);
  });
});

describe("안정자와 canonNext", () => {
  const centre = move(7, 7);

  /** 시드가 있는 작은 난수 — 시험이 돌 때마다 같은 국면을 본다. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return (n: number) => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s % n;
    };
  }

  it("채택 대칭은 언제나 안정자 안에 있고 안정자는 비지 않는다", () => {
    const next = rng(20260830);
    for (let i = 0; i < 200; i++) {
      const moves: Move[] = [];
      const n = next(8);
      for (let k = 0; k < n; k++) {
        const m = move(next(size), next(size));
        if (!moves.some((p) => p.x === m.x && p.y === m.y)) moves.push(m);
      }
      const c = canonical(moves, size);
      expect(c.key).toBe(keyOf(moves, size));
      expect(c.stabiliser & (1 << c.transform)).not.toBe(0);
      expect(c.stabiliser).not.toBe(0);
    }
  });

  it("빈 판은 모든 대칭에 불변이다", () => {
    expect(canonical([], size).stabiliser).toBe(0xff);
  });

  it("천원 한 점은 모든 대칭에 불변이다", () => {
    expect(canonical([centre], size).stabiliser).toBe(0xff);
  });

  it("비대칭 모양은 항등 변환에만 불변이다", () => {
    // (7,7) (8,6) (9,5) 가 아니다 — 그 셋은 천원을 지나는 반대각선 위라 그 거울이
    // 모두를 고정해 안정자가 둘이 된다. 마지막 돌을 그 선 밖으로 옮겨야 일반 모양이다.
    const c = canonical([centre, move(8, 6), move(9, 4)], size);
    expect(c.stabiliser).toBe(1 << c.transform);
  });

  it("안정자의 모든 대칭이 정말 같은 키를 낸다", () => {
    const moves = [centre, move(7, 6)]; // 거울 축 하나가 살아남는다
    const c = canonical(moves, size);
    expect(c.stabiliser & (c.stabiliser - 1)).not.toBe(0); // 비트가 둘 이상
    for (let t = 0; t < 8; t++) {
      if ((c.stabiliser & (1 << t)) === 0) continue;
      expect(
        keyOf(
          moves.map((m) => tf(t, size, m)),
          size,
        ),
      ).toBe(c.key);
    }
  });

  it("천원에 대한 거울 응수들은 한 대표를 공유한다", () => {
    const st = canonical([centre], size).stabiliser;
    const above = canonNext(st, move(7, 6), size);
    expect(canonNext(st, move(7, 8), size)).toEqual(above);
    expect(canonNext(st, move(6, 7), size)).toEqual(above);
    // 대표는 가장 작은 **보드 인덱스** — rifkey.canon_next 의 순서다.
    expect(above.y * size + above.x).toBe(6 * size + 7);
  });

  it("안정자가 항등뿐이면 수를 그대로 둔다", () => {
    expect(canonNext(1, move(9, 5), size)).toEqual(move(9, 5));
  });
});
