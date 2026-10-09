import { DEFAULT_SIZE } from "../model/move";

/**
 * RenjuNet `.rif`(XML) **스트리밍** 파서 — W7 변환기의 첫 단계. 앱 `RifParser` · `XmlLite` 와 데스크톱
 * `rifdb/rif_import.py` 가 받는 판을 같은 규칙으로 받는다.
 *
 * **문서 전체를 들지 않는다.** 43MB 를 한 문자열로 읽고 DOM 을 세우면 그것만으로 수백 MB 이고
 * 저사양 폰의 탭이 죽는다. 여기서는 바이트 조각(`pushBytes`)마다 **끝난 요소만** 소화하고 남은
 * 꼬리만 작업 버퍼에 남긴다 — 들고 있는 것은 조각 하나 남짓이다. 대국은 열 개의 정수와 수순 바이트로
 * 곧장 열(column) 배열에 쌓인다(`GameColumns`).
 *
 * 받는 판(앱 · 데스크톱과 같다): id 가 처음 나오고, 수순이 비어 있지 않고 모든 수가 판 안이며
 * **같은 칸이 반복되지 않고**(정규 해시가 XOR 이라 반복은 다른 국면으로 둔갑한다), 흑 결과가
 * 0 · 0.5 · 1 중 하나. 나머지는 까닭별로 센다(`skipped`).
 *
 * 결과 부호는 `freq35` 의 것: 2 흑승 · 1 무 · 0 백승(3 은 «모름» — 로컬 기보에서만 나온다).
 */

export const RES_WHITE = 0;
export const RES_DRAW = 1;
export const RES_BLACK = 2;
export const RES_UNKNOWN = 3;

export interface RifPlayer {
  readonly name: string;
  readonly surname: string;
  readonly country: number;
}

export interface RifTournament {
  readonly name: string;
  readonly year: number;
  readonly rated: boolean;
}

/** 대국 열 — 한 판이 한 칸(인덱스). 수순은 `moves[moveStart[i] .. + moveLen[i]]`(보드 인덱스). */
export class GameColumns {
  count = 0;
  id: Int32Array;
  tournament: Int32Array;
  rule: Int32Array;
  black: Int32Array;
  white: Int32Array;
  res: Uint8Array;
  moveStart: Uint32Array;
  moveLen: Uint8Array;
  moves: Uint8Array;
  movesUsed = 0;

  /**
   * `rows` · `moveBytes` 는 처음 잡을 용량 — 모자라면 두 배로 늘린다. 늘릴 때마다 옛 배열이 쓰레기가
   * 되므로 파일 크기로 미리 짐작해 주면 좋다(`RifStreamParser` 의 `expectedBytes`).
   */
  constructor(rows = 1024, moveBytes = 1 << 16) {
    this.id = new Int32Array(rows);
    this.tournament = new Int32Array(rows);
    this.rule = new Int32Array(rows);
    this.black = new Int32Array(rows);
    this.white = new Int32Array(rows);
    this.res = new Uint8Array(rows);
    this.moveStart = new Uint32Array(rows);
    this.moveLen = new Uint8Array(rows);
    this.moves = new Uint8Array(moveBytes);
  }

  private growRows(): void {
    const n = this.id.length * 2;
    const grow = <T extends Int32Array | Uint32Array | Uint8Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(n);
      b.set(a);
      return b;
    };
    this.id = grow(this.id);
    this.tournament = grow(this.tournament);
    this.rule = grow(this.rule);
    this.black = grow(this.black);
    this.white = grow(this.white);
    this.res = grow(this.res);
    this.moveStart = grow(this.moveStart);
    this.moveLen = grow(this.moveLen);
  }

  /** 한 판을 더한다. `cells` 는 이미 검사를 마친 보드 인덱스. */
  add(
    row: {
      id: number;
      tournament: number;
      rule: number;
      black: number;
      white: number;
      res: number;
    },
    cells: ArrayLike<number>,
    ncells: number,
  ): void {
    if (this.count === this.id.length) this.growRows();
    if (this.movesUsed + ncells > this.moves.length) {
      const b = new Uint8Array(Math.max(this.moves.length * 2, this.movesUsed + ncells));
      b.set(this.moves);
      this.moves = b;
    }
    const i = this.count++;
    this.id[i] = row.id;
    this.tournament[i] = row.tournament;
    this.rule[i] = row.rule;
    this.black[i] = row.black;
    this.white[i] = row.white;
    this.res[i] = row.res;
    this.moveStart[i] = this.movesUsed;
    this.moveLen[i] = ncells;
    for (let k = 0; k < ncells; k++) this.moves[this.movesUsed + k] = cells[k]!;
    this.movesUsed += ncells;
  }

  /** 남는 자리를 잘라 낸다 — 저장 · 전송 전에. */
  trim(): this {
    const n = this.count;
    this.id = this.id.slice(0, n);
    this.tournament = this.tournament.slice(0, n);
    this.rule = this.rule.slice(0, n);
    this.black = this.black.slice(0, n);
    this.white = this.white.slice(0, n);
    this.res = this.res.slice(0, n);
    this.moveStart = this.moveStart.slice(0, n);
    this.moveLen = this.moveLen.slice(0, n);
    this.moves = this.moves.slice(0, this.movesUsed);
    return this;
  }

  /** 들고 있는 바이트(메모리 회계용). */
  bytes(): number {
    return (
      this.id.byteLength * 5 +
      this.res.byteLength +
      this.moveStart.byteLength +
      this.moveLen.byteLength +
      this.moves.byteLength
    );
  }
}

export interface RifParseResult {
  /** `<database date="…">` — RenjuNet 이 그 파일을 만든 날. */
  readonly date: string;
  readonly countries: ReadonlyMap<number, string>;
  readonly rules: ReadonlyMap<number, string>;
  readonly openings: ReadonlyMap<number, string>;
  readonly players: ReadonlyMap<number, RifPlayer>;
  readonly tournaments: ReadonlyMap<number, RifTournament>;
  readonly games: GameColumns;
  /** 까닭별로 버린 판 수 — `empty_moves` · `bad_moves` · `dup_or_bad_id` · `bad_bresult`. */
  readonly skipped: Readonly<Record<string, number>>;
}

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
  quot: '"',
  copy: "©",
};
const decode = (s: string): string =>
  s.indexOf("&") < 0 ? s : s.replace(/&(\w+);/g, (m, e: string) => ENTITY[e] ?? m);

const ATTR = /([\w:-]+)="([^"]*)"/g;
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(tag))) out[m[1]!] = decode(m[2]!);
  return out;
}
const int = (v: string | undefined, def = -1): number => {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isInteger(n) ? n : def;
};

/** 표 요소 — 여는 태그 하나에 필요한 것이 다 있다. */
const TABLE_TAGS = new Set(["database", "country", "rule", "opening", "player", "tournament"]);

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const LT = 60; // <
const GT = 62; // >
const QUOTE = 34; // "
const P_GAME = ascii("<game ");
const P_GAME_END = ascii("</game>");
const P_COMMENT = ascii("<!--");
const P_COMMENT_END = ascii("-->");
const P_MOVE = ascii("<move>");
const P_MOVE_END = ascii("</move>");
const A_ID = ascii(' id="');
const A_TOURNAMENT = ascii(' tournament="');
const A_RULE = ascii(' rule="');
const A_BLACK = ascii(' black="');
const A_WHITE = ascii(' white="');
const A_BRESULT = ascii(' bresult="');
/** 여는 태그를 가를 만큼(`<game ` · `<!--`)은 모여야 판단한다. */
const LOOKAHEAD = 8;

/**
 * **바이트**로 읽는 스트리밍 파서. 받은 조각을 문자열로 바꾸지 않고 고정 작업 버퍼(조각 하나 남짓)
 * 안에서 곧장 읽는다 — 대국 태그 · 수순은 ASCII 라 해독할 것이 없다. 이름이 든 표 요소(선수 ·
 * 대회 · 규칙 …, 2만 개 남짓)만 그 태그 하나를 UTF-8 로 해독한다.
 *
 * 왜 바이트인가: 문자열로 받으면 조각마다 «남은 꼬리 + 새 조각» 문자열과 대국마다 잘라 낸 태그 ·
 * 수순 문자열이 생긴다 — 파일 크기(43MB)의 두 배 남짓의 쓰레기다. 브라우저 워커의 V8 은 그것을
 * 늦게 치워 실측 피크가 95~130MB 였다(Node 의 살아 있는 양은 45MB). 바이트로 읽으면 쓰레기가
 * 거의 없다.
 */
export class RifStreamParser {
  private buf = new Uint8Array(1 << 20);
  private len = 0;
  private readonly dec = new TextDecoder("utf-8");
  private readonly enc = new TextEncoder();
  private date = "";
  private readonly countries = new Map<number, string>();
  private readonly rules = new Map<number, string>();
  private readonly openings = new Map<number, string>();
  private readonly players = new Map<number, RifPlayer>();
  private readonly tournaments = new Map<number, RifTournament>();
  private readonly games: GameColumns;
  /** 받은 판의 id — 비트 하나씩(15만 개면 수십 KB). `Set` 은 같은 일에 몇 MB 를 쓴다. */
  private seen = new Uint8Array(1 << 15);
  private readonly skipped: Record<string, number> = {};
  private readonly cells: Uint8Array;
  private readonly taken: Uint8Array;
  private readonly size: number;

  /**
   * `expectedBytes` — 파일 크기를 주면 대국 열의 용량을 미리 잡는다. RenjuNet `.rif` 는 판 하나에
   * ~275바이트, 수순은 파일의 ~10% 다(2026-07-31 판 실측: 43.6MB → 158,245판 · 수 4,426,757).
   */
  constructor(size = DEFAULT_SIZE, expectedBytes = 0) {
    this.size = size;
    this.cells = new Uint8Array(size * size);
    this.taken = new Uint8Array(size * size);
    this.games = expectedBytes
      ? new GameColumns(Math.ceil(expectedBytes / 260), Math.ceil(expectedBytes * 0.105))
      : new GameColumns();
  }

  private hasSeen(id: number): boolean {
    return id >> 3 < this.seen.length && (this.seen[id >> 3]! & (1 << (id & 7))) !== 0;
  }

  private markSeen(id: number): void {
    if (id >> 3 >= this.seen.length) {
      const b = new Uint8Array(Math.max(this.seen.length * 2, (id >> 3) + 1));
      b.set(this.seen);
      this.seen = b;
    }
    this.seen[id >> 3]! |= 1 << (id & 7);
  }

  /** 지금까지 받은 판 수 — 진행 표시용. */
  get gameCount(): number {
    return this.games.count;
  }

  /**
   * 바이트 조각 하나(파일 스트림의 것 그대로). 요소가 조각 경계에 걸쳐도 된다 — 끝나지 않은 꼬리는
   * 작업 버퍼 앞으로 당겨 두고 다음 조각을 기다린다. UTF-8 글자가 경계에서 잘려도 된다(표 태그는
   * 끝난 뒤에만 해독한다).
   */
  pushBytes(chunk: Uint8Array): void {
    if (this.len + chunk.length > this.buf.length) {
      const b = new Uint8Array(Math.max(this.buf.length * 2, this.len + chunk.length));
      b.set(this.buf.subarray(0, this.len));
      this.buf = b;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.length;
    const used = this.process(false);
    this.buf.copyWithin(0, used, this.len);
    this.len -= used;
  }

  /** 글 조각 — 시험 · 편의용(UTF-8 로 바꿔 `pushBytes`). */
  push(text: string): void {
    this.pushBytes(this.enc.encode(text));
  }

  finish(): RifParseResult {
    this.process(true);
    this.len = 0;
    return {
      date: this.date,
      countries: this.countries,
      rules: this.rules,
      openings: this.openings,
      players: this.players,
      tournaments: this.tournaments,
      games: this.games.trim(),
      skipped: { ...this.skipped },
    };
  }

  /** 작업 버퍼에서 [from, len) 안의 첫 `p`, 없거나 끝까지 다 오지 않았으면 -1. */
  private find(p: Uint8Array, from: number, to = this.len): number {
    const b = this.buf;
    const first = p[0]!;
    for (
      let i = b.indexOf(first, from);
      i >= 0 && i + p.length <= to;
      i = b.indexOf(first, i + 1)
    ) {
      let k = 1;
      while (k < p.length && b[i + k] === p[k]) k++;
      if (k === p.length) return i;
    }
    return -1;
  }

  private startsAt(p: Uint8Array, i: number): boolean {
    if (i + p.length > this.len) return false;
    for (let k = 0; k < p.length; k++) if (this.buf[i + k] !== p[k]) return false;
    return true;
  }

  /** 끝난 요소를 모두 소화하고, 소화한 바이트 수를 돌려준다. `final` 이면 남은 것은 버린다. */
  private process(final: boolean): number {
    const b = this.buf;
    const len = this.len;
    let pos = 0;
    for (;;) {
      const lt = b.indexOf(LT, pos);
      if (lt < 0 || lt >= len) return len;
      if (!final && lt + LOOKAHEAD > len) return lt;
      if (this.startsAt(P_GAME, lt)) {
        const end = this.find(P_GAME_END, lt);
        if (end < 0) return final ? len : lt;
        this.game(lt, end);
        pos = end + P_GAME_END.length;
        continue;
      }
      if (this.startsAt(P_COMMENT, lt)) {
        const end = this.find(P_COMMENT_END, lt);
        if (end < 0) return final ? len : lt;
        pos = end + P_COMMENT_END.length;
        continue;
      }
      const gt = b.indexOf(GT, lt);
      if (gt < 0 || gt >= len) return final ? len : lt;
      // 태그 이름 — 짧은 ASCII. 표 요소만 해독해 속성을 읽는다.
      let k = lt + 1;
      while (k < gt && b[k] !== 32 && b[k] !== 47 /* / */ && b[k] !== 10 && b[k] !== 13) k++;
      if (k - lt - 1 <= 10) {
        const name = String.fromCharCode(...b.subarray(lt + 1, k));
        if (TABLE_TAGS.has(name)) this.table(name, this.dec.decode(b.subarray(lt, gt + 1)));
      }
      pos = gt + 1;
    }
  }

  private skip(reason: string): void {
    this.skipped[reason] = (this.skipped[reason] ?? 0) + 1;
  }

  private table(name: string, tag: string): void {
    const a = attrs(tag);
    const id = int(a.id);
    switch (name) {
      case "database":
        this.date = a.date ?? "";
        break;
      case "country":
        if (id >= 0) this.countries.set(id, a.abbr ?? a.name ?? "");
        break;
      case "rule":
        if (id >= 0) this.rules.set(id, a.name ?? "");
        break;
      case "opening":
        if (id >= 0) this.openings.set(id, a.abbr ?? "");
        break;
      case "player":
        if (id >= 0)
          this.players.set(id, {
            name: a.name ?? "",
            surname: a.surname ?? "",
            country: int(a.country),
          });
        break;
      case "tournament":
        if (id >= 0)
          this.tournaments.set(id, {
            name: a.name ?? "",
            year: int(a.year, 0),
            rated: a.rated === "1",
          });
        break;
    }
  }

  /** 여는 태그 [from, to) 의 정수 속성. 없거나 정수가 아니면 `def`. */
  private attrInt(p: Uint8Array, from: number, to: number, def = -1): number {
    const at = this.find(p, from, to);
    if (at < 0) return def;
    const b = this.buf;
    let i = at + p.length;
    let n = 0;
    let digits = 0;
    let neg = false;
    if (b[i] === 45 /* - */) {
      neg = true;
      i++;
    }
    while (i < to && b[i] !== QUOTE) {
      const d = b[i]! - 48;
      if (d < 0 || d > 9) return def;
      n = n * 10 + d;
      digits++;
      i++;
    }
    return digits ? (neg ? -n : n) : def;
  }

  /** `bresult` — "1" 흑승 · "0" 백승 · "0.5" 무, 그 밖은 -1. */
  private result(from: number, to: number): number {
    const at = this.find(A_BRESULT, from, to);
    if (at < 0) return -1;
    const b = this.buf;
    const i = at + A_BRESULT.length;
    if (b[i] === 49 && b[i + 1] === QUOTE) return RES_BLACK;
    if (b[i] === 48 && b[i + 1] === QUOTE) return RES_WHITE;
    if (b[i] === 48 && b[i + 1] === 46 && b[i + 2] === 53 && b[i + 3] === QUOTE) return RES_DRAW;
    return -1;
  }

  private game(start: number, end: number): void {
    const tagEnd = this.buf.indexOf(GT, start);
    const id = this.attrInt(A_ID, start, tagEnd);
    // 순서는 `rif_import.run` 의 것 — 버린 판은 id 를 차지하지 않는다.
    if (id < 0 || this.hasSeen(id)) return this.skip("dup_or_bad_id");
    const mOpen = this.find(P_MOVE, tagEnd, end);
    const mClose = mOpen >= 0 ? this.find(P_MOVE_END, mOpen, end) : -1;
    const n = mClose >= 0 ? this.moves(mOpen + P_MOVE.length, mClose) : 0;
    if (n <= 0) return this.skip(n === 0 ? "empty_moves" : "bad_moves");
    const res = this.result(start, tagEnd);
    if (res < 0) return this.skip("bad_bresult");
    this.markSeen(id);
    this.games.add(
      {
        id,
        tournament: this.attrInt(A_TOURNAMENT, start, tagEnd),
        rule: this.attrInt(A_RULE, start, tagEnd),
        black: this.attrInt(A_BLACK, start, tagEnd),
        white: this.attrInt(A_WHITE, start, tagEnd),
        res,
      },
      this.cells,
      n,
    );
  }

  /** 작업 버퍼 [from, to) 의 `"h8 h9 …"` → `this.cells`. 수 개수, 비었으면 0, 틀렸으면 -1. */
  private moves(from: number, to: number): number {
    const size = this.size;
    const taken = this.taken;
    const b = this.buf;
    let n = 0;
    let i = from;
    let ok = true;
    while (i < to) {
      const c = b[i]!;
      if (c <= 32) {
        i++;
        continue;
      }
      // 한 수: 열 글자 하나 + 행 숫자들
      const x = (c | 32) - 97;
      let j = i + 1;
      let row = 0;
      let digits = 0;
      while (j < to) {
        const d = b[j]! - 48;
        if (d < 0 || d > 9) break;
        row = row * 10 + d;
        digits++;
        j++;
      }
      if (j < to && b[j]! > 32) ok = false; // 수 뒤에 다른 글자
      if (x < 0 || x >= size || digits === 0 || row < 1 || row > size) ok = false;
      if (!ok) break;
      const cell = (size - row) * size + x;
      if (taken[cell]) {
        ok = false;
        break;
      }
      taken[cell] = 1;
      this.cells[n++] = cell;
      i = j;
    }
    for (let k = 0; k < n; k++) taken[this.cells[k]!] = 0;
    return ok ? n : -1;
  }
}
