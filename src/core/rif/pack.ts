import { DEFAULT_SIZE, label, move, type Move } from "../model/move";
import { classify } from "../opening/opening26";
import { GameColumns, RES_BLACK, RES_DRAW, RES_WHITE, type RifParseResult } from "./rif-parse";
import { ZobristScanner, foldCell } from "./zobrist";

/**
 * W7 팩 — `.rif`(또는 내 기보)에서 만든, **이 브라우저에만 남는** 오프닝 통계 한 벌.
 *
 * 데스크톱 `renju_stats.pack`(20MB) + `renju_games.pack`(12.8MB) + `freq_data.json` 의 웹판이다.
 * 같은 국면 집합을 세되(접두 ≤ `maxPlies` 수, `minGames` 판 이상 — 데스크톱 기본 20 · 2) 모양이
 * 다르다:
 *
 *   - 국면 키는 64비트 정규 해시(`zobrist.ts`)이고 (hi, lo) 순으로 **정렬된 열**이다 — 조회는 이진
 *     탐색. 문자열 키 · 해시 슬롯이 없어 국면 11만 개가 2MB 남짓이다.
 *   - 국면마다 대국 id 목록을 들지 않는다(데스크톱 팩 20MB 의 대부분이 그것이다). 대국 목록은
 *     필요할 때 수순 열(4.4MB)을 훑어 다시 센다(`query.ts gamesThrough`) — 수십 ms.
 *   - 랭킹 행(`freq35` 의 `[black, white, rule, o3, k5, res]`)은 대국 열 자체다.
 *
 * **RenjuNet 파생물이다** — 서버로 보내지도, 번들에 싣지도 않는다(라이선스: 오프라인 · 비상업 전용).
 */

export const PACK_VERSION = 1;
/** 데스크톱 `rif_aggregate.py` 의 기본값과 같다 — 그래야 국면 수가 데스크톱 팩과 맞는다. */
export const DEFAULT_MAX_PLIES = 20;
export const DEFAULT_MIN_GAMES = 2;
/** 랭킹의 «5수 모양»(앱 `FreqBuilder.SHAPE_PLIES`). */
export const SHAPE_PLIES = 5;
const NO_NEXT = 255;

export type PackSource = "renjunet" | "local";

export interface PackGames {
  readonly id: Int32Array;
  /** 선수 · 규칙 · 대회는 아래 표의 **조밀한 번호**(파일의 id 가 아니다). */
  readonly black: Int32Array;
  readonly white: Int32Array;
  readonly rule: Int32Array;
  readonly tour: Int32Array;
  /** 2 흑승 · 1 무 · 0 백승 · 3 모름. */
  readonly res: Uint8Array;
  /** 첫 세 수의 26주형(0..25, 26 = 규칙 밖). */
  readonly o3: Uint8Array;
  /** 첫 다섯 수의 모양 번호(`shapes`), 다섯 수가 안 되면 -1. */
  readonly k5: Int32Array;
  readonly moveStart: Uint32Array;
  readonly moveLen: Uint8Array;
  /** 보드 인덱스(`y * size + x`) — 모든 판의 수순을 이어 붙인 것. */
  readonly moves: Uint8Array;
}

export interface PackPositions {
  /** (hi, lo) 오름차순. */
  readonly hi: Uint32Array;
  readonly lo: Uint32Array;
  /** 이 국면을 지난 판 수와 그 결과. */
  readonly n: Uint32Array;
  readonly b: Uint32Array;
  readonly d: Uint32Array;
  readonly w: Uint32Array;
  /** 다음 수 열의 시작(길이 = 국면 수 + 1). */
  readonly edgeStart: Uint32Array;
}

/** 국면의 다음 수 — **정규 프레임**의 칸(조회가 판 위로 되돌린다), 국면 안에서 판 수 내림차순. */
export interface PackEdges {
  readonly cell: Uint8Array;
  readonly n: Uint32Array;
  readonly b: Uint32Array;
  readonly d: Uint32Array;
  readonly w: Uint32Array;
}

export interface BuildStats {
  readonly parseMs: number;
  readonly buildMs: number;
  /** 변환 동안 한꺼번에 쥔 타입드 배열의 가장 큰 합(바이트) — 메모리 상한의 근거. */
  readonly peakBytes: number;
  readonly skipped: Readonly<Record<string, number>>;
}

export interface RenjuPack {
  readonly version: number;
  readonly source: PackSource;
  readonly size: number;
  /** RenjuNet 이 그 파일을 만든 날(`<database date>`), 내 기보면 만든 날. */
  readonly date: string;
  readonly builtAt: number;
  readonly fileName: string;
  readonly fileSize: number;
  readonly maxPlies: number;
  readonly minGames: number;
  readonly players: readonly string[];
  readonly playerCountry: readonly string[];
  readonly rules: readonly string[];
  readonly tournaments: readonly string[];
  readonly tourYear: Uint16Array;
  readonly games: PackGames;
  /** 5수 모양의 대표 수순(`"h8 h9 …"` — 그 모양에 처음 이른 판의 것). */
  readonly shapes: readonly string[];
  readonly pos: PackPositions;
  readonly edges: PackEdges;
  readonly stats: BuildStats;
}

/** 변환 입력 — `.rif` 파싱 결과든 내 기보든 같은 모양으로 넘긴다. */
export interface PackInput {
  readonly source: PackSource;
  readonly date: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly games: GameColumns;
  /** 파일 id → 이름 · 나라(내 기보면 비어 있다). */
  readonly playerName: (id: number) => { name: string; country: string };
  readonly ruleName: (id: number) => string;
  readonly tournament: (id: number) => { name: string; year: number };
  readonly skipped: Readonly<Record<string, number>>;
  readonly parseMs: number;
}

/** `.rif` 파싱 결과를 변환 입력으로. 선수 이름은 앱과 같이 «이름 성», 없으면 «?». */
export function rifInput(
  r: RifParseResult,
  file: { name: string; size: number },
  parseMs: number,
): PackInput {
  return {
    source: "renjunet",
    date: r.date,
    fileName: file.name,
    fileSize: file.size,
    games: r.games,
    playerName: (id) => {
      const p = r.players.get(id);
      const name = p ? [p.name, p.surname].filter(Boolean).join(" ") || "?" : "?";
      return { name, country: p ? (r.countries.get(p.country) ?? "") : "" };
    },
    ruleName: (id) => r.rules.get(id) ?? "?",
    tournament: (id) => {
      const t = r.tournaments.get(id);
      return { name: t?.name ?? "", year: t?.year ?? 0 };
    },
    skipped: r.skipped,
    parseMs,
  };
}

export interface BuildOptions {
  maxPlies?: number;
  minGames?: number;
  size?: number;
  /** 접두 국면을 몇 개의 수 구간으로 나눠 셀까(메모리 ↔ 시간). 기본 2. */
  partitions?: number;
  /**
   * 진행 — 수 구간 `part`(0..parts-1) 안의 그 단계가 `fraction`(0..1)만큼. 구간마다 색인 → 정렬 →
   * 세기를 되풀이하므로 전체 막대는 부르는 쪽이 (구간, 단계)로 셈한다(워커 `overallFraction`).
   */
  onProgress?: (
    phase: "index" | "sort" | "count",
    fraction: number,
    part: number,
    parts: number,
  ) => void;
  now?: () => number;
}

/**
 * 변환 입력 → 팩. 정렬 기반이라 해시 표 없이 타입드 배열만 쓴다:
 *
 *   1. 접두 국면마다 (해시 hi, lo, 접은 다음 수, 결과) 한 줄 — 15만 판 × ≤21 = ~250만 줄, 줄당 10바이트
 *   2. 줄 번호를 (hi, lo, 다음 수) 순으로 정렬
 *   3. 한 번 훑으며 국면 · 다음 수를 센다 — `minGames` 판 미만 국면은 버린다
 */
export function buildPack(input: PackInput, opts: BuildOptions = {}): RenjuPack {
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  const size = opts.size ?? DEFAULT_SIZE;
  const maxPlies = opts.maxPlies ?? DEFAULT_MAX_PLIES;
  const minGames = opts.minGames ?? DEFAULT_MIN_GAMES;
  const G = input.games;
  const count = G.count;
  let liveBytes = G.bytes();
  let peak = liveBytes;
  const hold = (b: number) => {
    liveBytes += b;
    if (liveBytes > peak) peak = liveBytes;
  };

  // ── 표 · 조밀한 번호 · 26주형 · 5수 모양 ──────────────────────────────
  const players: string[] = [];
  const playerCountry: string[] = [];
  const playerIdx = new Map<number, number>();
  const pidx = (id: number) => {
    let i = playerIdx.get(id);
    if (i === undefined) {
      const p = input.playerName(id);
      i = players.length;
      players.push(p.name);
      playerCountry.push(p.country);
      playerIdx.set(id, i);
    }
    return i;
  };
  const rules: string[] = [];
  const ruleIdx = new Map<number, number>();
  const ridx = (id: number) => {
    let i = ruleIdx.get(id);
    if (i === undefined) {
      i = rules.length;
      rules.push(input.ruleName(id));
      ruleIdx.set(id, i);
    }
    return i;
  };
  const tournaments: string[] = [];
  const years: number[] = [];
  const tourIdx = new Map<number, number>();
  const tidx = (id: number) => {
    let i = tourIdx.get(id);
    if (i === undefined) {
      const t = input.tournament(id);
      i = tournaments.length;
      tournaments.push(t.name);
      years.push(t.year);
      tourIdx.set(id, i);
    }
    return i;
  };

  const black = new Int32Array(count);
  const white = new Int32Array(count);
  const rule = new Int32Array(count);
  const tour = new Int32Array(count);
  const o3 = new Uint8Array(count);
  const k5 = new Int32Array(count);
  hold(count * 21);
  const shapes: string[] = [];
  const shapeIdx = new Map<string, number>();
  const z = new ZobristScanner(size);
  const first: Move[] = [];

  for (let g = 0; g < count; g++) {
    black[g] = pidx(G.black[g]!);
    white[g] = pidx(G.white[g]!);
    rule[g] = ridx(G.rule[g]!);
    tour[g] = tidx(G.tournament[g]!);
    const start = G.moveStart[g]!;
    const len = G.moveLen[g]!;
    first.length = 0;
    for (let i = 0; i < Math.min(len, SHAPE_PLIES); i++) {
      const c = G.moves[start + i]!;
      first.push(move(c % size, Math.floor(c / size)));
    }
    o3[g] = classify(first.slice(0, 3));
    if (len >= SHAPE_PLIES) {
      z.reset();
      for (const m of first) z.push(m.y * size + m.x);
      z.canonical();
      const key = `${z.hi}:${z.lo}`;
      let s = shapeIdx.get(key);
      if (s === undefined) {
        s = shapes.length;
        shapes.push(first.map((m) => label(m, size).toLowerCase()).join(" "));
        shapeIdx.set(key, s);
      }
      k5[g] = s;
    } else k5[g] = -1;
  }

  // ── 수 구간마다: 접두 줄 → 정렬 → 세기 ───────────────────────────────
  //
  // 돌 수가 다른 국면은 결코 같은 국면이 아니다 — 그래서 접두 국면을 **수 구간**으로 나눠 따로
  // 세고 마지막에 (hi, lo) 순으로 병합한다. 접두 줄 배열(줄당 18바이트: 해시 8 · 다음 수 1 · 결과 1 ·
  // 정렬 번호 4+4)이 구간 수만큼 작아진다. 값은 구간마다 처음부터 다시 해시하는 시간(구간이 둘이면
  // 해시 ~1.5배)이다. 실측: 한 번에 세면 살아 있는 양이 58.7MB 로 목표(60MB)에 붙었다.
  //
  // **작업 배열은 한 번만 잡고 구간끼리 돌려 쓴다.** 구간마다 새로 잡으면 앞 구간의 배열(25MB 남짓)이
  // 수거되기 전에 다음 구간이 또 잡는다 — 타입드 배열의 저장소는 V8 이 늦게 회수해서, 브라우저
  // 워커 실측 피크가 세기 단계에서 74MB 였다.
  const ranges = plyRanges(maxPlies, Math.max(1, opts.partitions ?? 2));
  const P = ranges.length;
  const sizes = ranges.map(([a, b]) => {
    let entries = 0;
    for (let g = 0; g < count; g++) {
      const Lg = Math.min(G.moveLen[g]!, maxPlies);
      if (Lg >= a) entries += Math.min(Lg, b) - a + 1;
    }
    return entries;
  });
  const cap = Math.max(...sizes);
  // 작업 배열은 이 함수 안에서만 산다 — 병합 전에 놓아야 병합(결과 두 벌 + 합친 것)과 겹치지 않는다.
  const outs = ((): PartOut[] => {
    const eHi = new Uint32Array(cap);
    const eLo = new Uint32Array(cap);
    const eNext = new Uint8Array(cap);
    const eRes = new Uint8Array(cap);
    const scratch = { a: new Uint32Array(cap), b: new Uint32Array(cap) };
    hold(cap * 18);
    const parts: PartOut[] = [];
    ranges.forEach(([a, b], pi) => {
      const entries = sizes[pi]!;
      let e = 0;
      const tick = Math.max(1, Math.floor(count / 50));
      for (let g = 0; g < count; g++) {
        const start = G.moveStart[g]!;
        const Lg = Math.min(G.moveLen[g]!, maxPlies);
        if (Lg < a) continue;
        const top = Math.min(Lg, b);
        const res = G.res[g]!;
        z.reset();
        for (let i = 0; i <= top; i++) {
          const c = i < Lg ? G.moves[start + i]! : -1;
          if (i >= a) {
            z.canonical();
            eHi[e] = z.hi;
            eLo[e] = z.lo;
            eRes[e] = res;
            eNext[e] = c >= 0 ? foldCell(z.stabiliser, c, size) : NO_NEXT;
            e++;
          }
          if (c >= 0 && i < top) z.push(c);
        }
        if (g % tick === 0) opts.onProgress?.("index", g / count, pi, P);
      }

      // 비교 함수 정렬(`order.sort((a, b) => …)`)은 V8 이 원소를 내부 배열로 복사해 250만 줄에서
      // 수십 MB 를 더 쥐었다(실측 정렬 단계 피크 106MB). 기수 정렬은 줄 번호 배열 둘이면 된다.
      opts.onProgress?.("sort", 0, pi, P);
      const order = radixOrder(
        eHi,
        eLo,
        eNext,
        entries,
        (f) => opts.onProgress?.("sort", f, pi, P),
        scratch,
      );

      const part = countSorted(eHi, eLo, eNext, eRes, order, entries, minGames, (f) =>
        opts.onProgress?.("count", f, pi, P),
      );
      hold(part.bytes);
      parts.push(part);
    });
    liveBytes -= cap * 18; // 작업 배열은 이제 버린다
    return parts;
  })();
  const merged = mergeParts(outs);
  if (outs.length > 1) outs.length = 0; // 구간 결과는 합쳤다 — 놓는다
  if (P > 1) hold(merged.bytes);
  const { pos, edges } = merged;
  opts.onProgress?.("count", 1, P - 1, P);

  return {
    version: PACK_VERSION,
    source: input.source,
    size,
    date: input.date,
    builtAt: Date.now(),
    fileName: input.fileName,
    fileSize: input.fileSize,
    maxPlies,
    minGames,
    players,
    playerCountry,
    rules,
    tournaments,
    tourYear: Uint16Array.from(years),
    games: {
      id: G.id,
      black,
      white,
      rule,
      tour,
      res: G.res,
      o3,
      k5,
      moveStart: G.moveStart,
      moveLen: G.moveLen,
      moves: G.moves,
    },
    shapes,
    pos,
    edges,
    stats: {
      parseMs: input.parseMs,
      buildMs: now() - t0,
      peakBytes: peak,
      skipped: input.skipped,
    },
  };
}

/**
 * (hi, lo, 다음 수) 오름차순의 줄 번호 — LSD 기수 정렬(안정): 다음 수 8비트, lo 16비트 둘, hi
 * 16비트 둘. 패스마다 선형이고 줄 번호 배열 두 벌(+ 64K 칸의 셈판)만 쓴다.
 */
export function radixOrder(
  hi: Uint32Array,
  lo: Uint32Array,
  next: Uint8Array,
  n: number,
  onPass?: (fraction: number) => void,
  /** 돌려 쓸 줄 번호 배열 둘(길이 ≥ n) — 없으면 새로 잡는다. */
  scratch?: { a: Uint32Array; b: Uint32Array },
): Uint32Array {
  let src = scratch ? scratch.a : new Uint32Array(n);
  let dst = scratch ? scratch.b : new Uint32Array(n);
  for (let i = 0; i < n; i++) src[i] = i;
  const count = new Uint32Array(65536);
  const passes: [Uint32Array | Uint8Array, number, number][] = [
    [next, 0, 0xff],
    [lo, 0, 0xffff],
    [lo, 16, 0xffff],
    [hi, 0, 0xffff],
    [hi, 16, 0xffff],
  ];
  passes.forEach(([key, shift, mask], p) => {
    count.fill(0);
    for (let i = 0; i < n; i++) count[(key[src[i]!]! >>> shift) & mask]!++;
    let sum = 0;
    for (let b = 0; b <= mask; b++) {
      const c = count[b]!;
      count[b] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const idx = src[i]!;
      dst[count[(key[idx]! >>> shift) & mask]!++] = idx;
    }
    [src, dst] = [dst, src];
    onPass?.((p + 1) / passes.length);
  });
  return src;
}

/** 0..maxPlies 를 `P` 개의 수 구간으로 나눈다(양 끝 포함). */
export function plyRanges(maxPlies: number, P: number): [number, number][] {
  const n = Math.min(P, maxPlies + 1);
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = Math.round((k * (maxPlies + 1)) / n);
    const b = Math.round(((k + 1) * (maxPlies + 1)) / n) - 1;
    out.push([a, b]);
  }
  return out;
}

interface PartOut {
  pos: MutablePos;
  edges: MutableEdges;
  bytes: number;
}

/** 정렬된 줄을 훑어 국면 · 다음 수를 센다 — 두 번(크기를 세고, 채운다). */
function countSorted(
  eHi: Uint32Array,
  eLo: Uint32Array,
  eNext: Uint8Array,
  eRes: Uint8Array,
  order: Uint32Array,
  entries: number,
  minGames: number,
  onProgress: (f: number) => void,
): PartOut {
  const scan = (fill: null | PartOut) => {
    let nPos = 0;
    let nEdge = 0;
    let i = 0;
    while (i < entries) {
      const hi = eHi[order[i]!]!;
      const lo = eLo[order[i]!]!;
      let j = i;
      while (j < entries && eHi[order[j]!] === hi && eLo[order[j]!] === lo) j++;
      if (j - i >= minGames) {
        if (fill) {
          const { pos, edges } = fill;
          pos.hi[nPos] = hi;
          pos.lo[nPos] = lo;
          pos.edgeStart[nPos] = nEdge;
          let pb = 0;
          let pd = 0;
          let pw = 0;
          let k = i;
          const edgeFrom = nEdge;
          while (k < j) {
            const nx = eNext[order[k]!]!;
            let kb = 0;
            let kd = 0;
            let kw = 0;
            let m = k;
            while (m < j && eNext[order[m]!] === nx) {
              const r = eRes[order[m]!]!;
              if (r === RES_BLACK) kb++;
              else if (r === RES_DRAW) kd++;
              else if (r === RES_WHITE) kw++;
              m++;
            }
            pb += kb;
            pd += kd;
            pw += kw;
            if (nx !== NO_NEXT) {
              edges.cell[nEdge] = nx;
              edges.n[nEdge] = m - k;
              edges.b[nEdge] = kb;
              edges.d[nEdge] = kd;
              edges.w[nEdge] = kw;
              nEdge++;
            }
            k = m;
          }
          sortEdgesByCount(edges, edgeFrom, nEdge);
          pos.n[nPos] = j - i;
          pos.b[nPos] = pb;
          pos.d[nPos] = pd;
          pos.w[nPos] = pw;
        } else {
          let k = i;
          while (k < j) {
            const nx = eNext[order[k]!]!;
            while (k < j && eNext[order[k]!] === nx) k++;
            if (nx !== NO_NEXT) nEdge++;
          }
        }
        nPos++;
      }
      i = j;
      if (fill && (nPos & 0x3fff) === 0) onProgress(i / entries);
    }
    if (fill) fill.pos.edgeStart[nPos] = nEdge;
    return { nPos, nEdge };
  };
  const sized = scan(null);
  const out = allocOut(sized.nPos, sized.nEdge);
  scan(out);
  onProgress(1);
  return out;
}

function allocOut(nPos: number, nEdge: number): PartOut {
  return {
    pos: {
      hi: new Uint32Array(nPos),
      lo: new Uint32Array(nPos),
      n: new Uint32Array(nPos),
      b: new Uint32Array(nPos),
      d: new Uint32Array(nPos),
      w: new Uint32Array(nPos),
      edgeStart: new Uint32Array(nPos + 1),
    },
    edges: {
      cell: new Uint8Array(nEdge),
      n: new Uint32Array(nEdge),
      b: new Uint32Array(nEdge),
      d: new Uint32Array(nEdge),
      w: new Uint32Array(nEdge),
    },
    bytes: nPos * 28 + 4 + nEdge * 17,
  };
}

/** 수 구간들의 결과를 (hi, lo) 순으로 하나로 — 구간끼리 국면이 겹치지 않는다(돌 수가 다르다). */
function mergeParts(parts: PartOut[]): PartOut {
  if (parts.length === 1) return parts[0]!;
  const nPos = parts.reduce((a, p) => a + p.pos.hi.length, 0);
  const nEdge = parts.reduce((a, p) => a + p.edges.n.length, 0);
  const out = allocOut(nPos, nEdge);
  const head = parts.map(() => 0);
  let e = 0;
  for (let k = 0; k < nPos; k++) {
    let best = -1;
    for (let q = 0; q < parts.length; q++) {
      const i = head[q]!;
      const p = parts[q]!.pos;
      if (i >= p.hi.length) continue;
      if (best < 0) {
        best = q;
        continue;
      }
      const bp = parts[best]!.pos;
      const bi = head[best]!;
      if (p.hi[i]! < bp.hi[bi]! || (p.hi[i] === bp.hi[bi] && p.lo[i]! < bp.lo[bi]!)) best = q;
    }
    const src = parts[best]!;
    const i = head[best]!++;
    out.pos.hi[k] = src.pos.hi[i]!;
    out.pos.lo[k] = src.pos.lo[i]!;
    out.pos.n[k] = src.pos.n[i]!;
    out.pos.b[k] = src.pos.b[i]!;
    out.pos.d[k] = src.pos.d[i]!;
    out.pos.w[k] = src.pos.w[i]!;
    out.pos.edgeStart[k] = e;
    for (let t = src.pos.edgeStart[i]!; t < src.pos.edgeStart[i + 1]!; t++, e++) {
      out.edges.cell[e] = src.edges.cell[t]!;
      out.edges.n[e] = src.edges.n[t]!;
      out.edges.b[e] = src.edges.b[t]!;
      out.edges.d[e] = src.edges.d[t]!;
      out.edges.w[e] = src.edges.w[t]!;
    }
  }
  out.pos.edgeStart[nPos] = e;
  return out;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutablePos = Mutable<PackPositions>;
type MutableEdges = Mutable<PackEdges>;

/** 한 국면의 다음 수를 판 수 내림차순으로(같으면 칸 순) — 몇 줄뿐이라 삽입 정렬. */
function sortEdgesByCount(e: MutableEdges, from: number, to: number): void {
  for (let i = from + 1; i < to; i++) {
    const c = e.cell[i]!;
    const n = e.n[i]!;
    const b = e.b[i]!;
    const d = e.d[i]!;
    const w = e.w[i]!;
    let j = i - 1;
    while (j >= from && (e.n[j]! < n || (e.n[j] === n && e.cell[j]! > c))) {
      e.cell[j + 1] = e.cell[j]!;
      e.n[j + 1] = e.n[j]!;
      e.b[j + 1] = e.b[j]!;
      e.d[j + 1] = e.d[j]!;
      e.w[j + 1] = e.w[j]!;
      j--;
    }
    e.cell[j + 1] = c;
    e.n[j + 1] = n;
    e.b[j + 1] = b;
    e.d[j + 1] = d;
    e.w[j + 1] = w;
  }
}

/** 팩이 저장소에서 차지하는 바이트(대략 — 문자열은 UTF-16 길이로). */
export function packBytes(p: RenjuPack): number {
  const arrays = [
    ...Object.values(p.games),
    ...Object.values(p.pos),
    ...Object.values(p.edges),
    p.tourYear,
  ] as ArrayBufferView[];
  const strings = [...p.players, ...p.playerCountry, ...p.rules, ...p.tournaments, ...p.shapes];
  return (
    arrays.reduce((a, v) => a + v.byteLength, 0) + strings.reduce((a, s) => a + 2 * s.length, 0)
  );
}
