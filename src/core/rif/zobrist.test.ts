import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonNext, canonical as posCanonical, tf } from "../model/pos-key";
import { DEFAULT_SIZE, fromLabel, move, type Move } from "../model/move";
import { ZobristScanner, canonicalHash, compare64, foldCell } from "./zobrist";

/**
 * 64비트 정규 해시 ↔ `pos-key.ts`(국면 키 5중 구현의 다섯 번째) 대조.
 *
 * 팩은 국면을 해시로 세고, 나머지 앱(정석 색인 · 수순 · 오프닝 이름)은 문자열 키로 센다. 둘이
 * **같은 동치류**를 만들어야 W7 의 빈도가 데스크톱 팩 · 앱 팩과 같은 국면을 말한다. 그래서:
 *
 *   1. 해시가 같다 ⇔ 키가 같다(골든 벡터 · 무작위 접두 국면 · 전치 · 8대칭 상)
 *   2. 안정자의 크기가 같다(대칭 국면에서 몇 개의 변환이 같은 상을 내는가)
 *   3. 다음 수 접기 — 두 다음 수가 해시 쪽에서 같은 칸으로 접히면 키 쪽에서도 그렇다
 *
 * 대표 대칭(`transform`)은 일부러 견주지 않는다 — 가장 작은 해시와 가장 작은 문자열은 다른
 * 상일 수 있고, 팩 안에서는 해시의 프레임으로 일관되면 된다(zobrist.ts 머리 주석).
 */

const size = DEFAULT_SIZE;
const cell = (s: string): Move => {
  const m = fromLabel(s, size);
  if (!m) throw new Error(`bad label ${s}`);
  return m;
};
const hashOf = (moves: readonly Move[]) => {
  const c = canonicalHash(moves, size);
  return `${c.hi.toString(16)}:${c.lo.toString(16)}`;
};
const keyOf = (moves: readonly Move[]) => posCanonical(moves, size).key;
const popcount = (n: number) => {
  let c = 0;
  for (; n; n &= n - 1) c++;
  return c;
};

/** 결정적 난수 — 시험이 돌 때마다 같은 국면을 본다. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 서로 다른 칸 `n` 개 — `spread` 가 작으면 천원 둘레에 몰려 전치 · 대칭이 잦다. */
function randomLine(r: () => number, n: number, spread: number): Move[] {
  const out: Move[] = [];
  const used = new Set<number>();
  const c = size >> 1;
  while (out.length < n) {
    // -spread..+spread 균등 — (2·spread+1)² 칸 전부에 닿아야 아래의 «다 찼다» 검사가 맞는다.
    const x = Math.min(size - 1, Math.max(0, c + Math.floor(r() * (2 * spread + 1)) - spread));
    const y = Math.min(size - 1, Math.max(0, c + Math.floor(r() * (2 * spread + 1)) - spread));
    if (used.has(y * size + x)) {
      if (used.size >= (2 * spread + 1) ** 2) break;
      continue;
    }
    used.add(y * size + x);
    out.push(move(x, y));
  }
  return out;
}

/** 같은 색끼리 순서를 섞는다 — 같은 돌 집합에 이르는 다른 수순(전치). */
function shuffleSameColour(r: () => number, line: readonly Move[]): Move[] {
  const black = line.filter((_, i) => i % 2 === 0);
  const white = line.filter((_, i) => i % 2 === 1);
  for (const a of [black, white]) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
  }
  return line.map((_, i) => (i % 2 === 0 ? black[i >> 1]! : white[i >> 1]!));
}

/**
 * 국면 묶음에서 «해시가 같다 ⇔ 키가 같다» — 키 → 해시, 해시 → 키가 둘 다 함수(일대일)여야 한다.
 * 어긋난 쌍을 돌려준다(비어 있어야 한다).
 */
function bijectionViolations(lines: readonly (readonly Move[])[]): string[] {
  const keyToHash = new Map<string, string>();
  const hashToKey = new Map<string, string>();
  const bad: string[] = [];
  for (const l of lines) {
    const k = keyOf(l);
    const h = hashOf(l);
    const h0 = keyToHash.get(k);
    const k0 = hashToKey.get(h);
    if (h0 !== undefined && h0 !== h) bad.push(`키 ${k} → 해시 ${h0} / ${h}`);
    if (k0 !== undefined && k0 !== k) bad.push(`해시 ${h} → 키 ${k0} / ${k}`);
    keyToHash.set(k, h);
    hashToKey.set(h, k);
  }
  return bad;
}

const golden: Move[][] = readFileSync(
  new URL("../model/testdata/poskey_golden.txt", import.meta.url),
  "utf8",
)
  .split(/\r?\n/)
  .filter((l) => l.trim() !== "" && !l.startsWith("#"))
  .map((l) => l.split("\t")[0]!.split(" ").map(cell));

describe("64비트 정규 해시 ↔ pos-key 대조", () => {
  it("골든 벡터 252줄과 그 8대칭 상 · 접두 국면 전부: 해시가 같다 ⇔ 키가 같다", () => {
    expect(golden.length).toBeGreaterThanOrEqual(200);
    const lines: Move[][] = [];
    for (const g of golden) {
      for (let n = 0; n <= g.length; n++) lines.push(g.slice(0, n));
      for (let t = 0; t < 8; t++) lines.push(g.map((m) => tf(t, size, m)));
    }
    expect(bijectionViolations(lines)).toEqual([]);
    // 골든에는 서로 다른 수순이 같은 키로 접히는 줄이 있다(l11 ↔ e4) — 실제로 묶는지도 본다.
    expect(hashOf([cell("l11")])).toBe(hashOf([cell("e4")]));
  });

  it("무작위 대국 3,000판의 접두 국면(천원 둘레 · 판 전체 · 전치 섞기)", () => {
    const r = rng(20261009);
    const lines: Move[][] = [];
    for (let g = 0; g < 3000; g++) {
      const spread = g % 3 === 0 ? 7 : g % 3 === 1 ? 2 : 3;
      const line = randomLine(r, 1 + Math.floor(r() * 24), spread);
      for (let n = 0; n <= line.length; n++) lines.push(line.slice(0, n));
      lines.push(shuffleSameColour(r, line));
      // 대칭은 판 전체에 **하나** — 수마다 고르면 같은 칸에 돌이 두 번 놓인 가짜 국면이 된다.
      const t = Math.floor(r() * 8);
      lines.push(line.map((m) => tf(t, size, m)));
    }
    const violations = bijectionViolations(lines);
    expect(violations.slice(0, 5)).toEqual([]);
    // 시험이 실제로 전치 · 동치를 만났는가(묶음이 의미가 있었는가).
    const distinct = new Set(lines.map(keyOf)).size;
    expect(distinct).toBeLessThan(lines.length * 0.8);
  }, 30_000);

  it("전치: 같은 색끼리 순서를 바꿔도 해시가 같고, 색을 바꾸면 다르다", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const line = randomLine(r, 4 + Math.floor(r() * 16), 4);
      expect(hashOf(shuffleSameColour(r, line))).toBe(hashOf(line));
      // 첫 두 수를 맞바꾸면 흑돌 하나와 백돌 하나가 색을 바꾼다 — 다른 국면이다.
      const swapped = [line[1]!, line[0]!, ...line.slice(2)];
      expect(hashOf(swapped) === hashOf(line)).toBe(keyOf(swapped) === keyOf(line));
    }
  });

  it("안정자: 대칭 국면에서 같은 상을 내는 변환의 수가 키와 같다", () => {
    const r = rng(11);
    const cases: Move[][] = [
      [],
      [cell("h8")],
      [cell("h8"), cell("i9")], // 대각선 대칭
      [cell("h8"), cell("h9")], // 세로축 대칭
      [cell("h8"), cell("h9"), cell("h7")],
      [cell("h8"), cell("i9"), cell("g7"), cell("j10")],
      ...Array.from({ length: 400 }, () => randomLine(r, 1 + Math.floor(r() * 10), 2)),
    ];
    for (const line of cases) {
      const z = canonicalHash(line, size);
      const p = posCanonical(line, size);
      expect(popcount(z.stabiliser), line.map((m) => `${m.x},${m.y}`).join(" ")).toBe(
        popcount(p.stabiliser),
      );
    }
  });

  it("다음 수 접기: 두 다음 수가 해시 프레임에서 같은 칸이면 키 프레임에서도 같은 칸", () => {
    const r = rng(23);
    let symmetricSeen = 0;
    for (let i = 0; i < 120; i++) {
      const line = i < 20 ? [cell("h8"), cell("i9")] : randomLine(r, Math.floor(r() * 8), 2);
      const z = canonicalHash(line, size);
      const p = posCanonical(line, size);
      if (popcount(z.stabiliser) > 1) symmetricSeen++;
      const taken = new Set(line.map((m) => m.y * size + m.x));
      const free: Move[] = [];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) if (!taken.has(y * size + x)) free.push(move(x, y));
      const zf = free.map((m) => {
        const c = canonNext(z.stabiliser, m, size);
        return c.y * size + c.x;
      });
      const pf = free.map((m) => {
        const c = canonNext(p.stabiliser, m, size);
        return c.y * size + c.x;
      });
      for (let a = 0; a < free.length; a += 7) {
        for (let b = a + 1; b < free.length; b += 5) {
          expect(zf[a] === zf[b]).toBe(pf[a] === pf[b]);
        }
      }
    }
    expect(symmetricSeen).toBeGreaterThan(20);
  }, 30_000);

  it("8대칭 상에서 다음 수를 접으면 같은 칸이 된다(팩의 이음수가 한 줄로 모인다)", () => {
    const r = rng(31);
    for (let i = 0; i < 200; i++) {
      const line = randomLine(r, 1 + Math.floor(r() * 8), 3);
      const taken = new Set(line.map((m) => m.y * size + m.x));
      let next: Move;
      do next = move(Math.floor(r() * size), Math.floor(r() * size));
      while (taken.has(next.y * size + next.x));
      const folds = new Set<number>();
      for (let t = 0; t < 8; t++) {
        const img = line.map((m) => tf(t, size, m));
        const z = canonicalHash(img, size);
        // 판 위의 다음 수를 그 상의 정규 프레임으로: 대표 대칭으로 옮기고 안정자로 접는다.
        const c = canonNext(z.stabiliser, tf(t, size, next), size);
        folds.add(c.y * size + c.x);
      }
      expect(folds.size).toBe(1);
    }
  });

  it("증분 스캐너와 한 번에 계산이 같고, compare64 는 부호 없는 순서다", () => {
    const r = rng(5);
    const z = new ZobristScanner(size);
    const line = randomLine(r, 30, 7);
    for (let n = 0; n < line.length; n++) {
      z.push(line[n]!.y * size + line[n]!.x);
      z.canonical();
      const once = canonicalHash(line.slice(0, n + 1), size);
      expect([z.hi, z.lo, z.stabiliser]).toEqual([once.hi, once.lo, once.stabiliser]);
    }
    // 할당 없는 접기가 canonNext 와 같다(모든 안정자 · 모든 칸).
    for (let stab = 1; stab < 256; stab += 3) {
      for (let c = 0; c < size * size; c += 4) {
        const m = canonNext(stab, move(c % size, Math.floor(c / size)), size);
        expect(foldCell(stab, c, size)).toBe(m.y * size + m.x);
      }
    }
    expect(compare64(0xffffffff, 0, 1, 0)).toBe(1);
    expect(compare64(1, 0xffffffff, 1, 2)).toBe(1);
    expect(compare64(3, 3, 3, 3)).toBe(0);
  });
});
