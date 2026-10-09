import type { Move } from "../model/move";
import { moveKey } from "../model/move";

/**
 * yixindb(엔진 쪽 정석 데이터베이스)의 전선 — 앱 `DatabaseCommand.kt` · `DatabaseAggregator.kt` ·
 * `Database.kt` 의 이식이고, 원본은 Rapfi `command/dbcommand.cpp`(3c94c2a9)와 데스크톱 main.c 다.
 *
 * 상태도 IO 도 없다(집계기 하나만 줄 사이의 상태를 든다). 엔진에 보내고 기다리는 일은
 * `features/database/dbClient.ts` 가 한다.
 *
 * ```
 * 국면 단위 명령 : <머리 줄> / y,x … / done            (getDatabasePosition)
 * 응답           : DATABASE REFRESH
 *                  DATABASE <y> <x> <tag> <value> <depth> <bound> <hasComment> <boardText>
 *                  DATABASE DONE
 *                  DATABASE TEXT "<주석 — \" · \\ 이스케이프, 줄바꿈은 그대로>"
 *                  DATABASE ONE <label> <value> <depth> <bound> [displayLabel]
 * ```
 *
 * **라벨은 둔 쪽 관점이다**(yixindb). 둘 차례가 이기는 국면은 `L`(그 국면으로 들어온 쪽이 졌다)로
 * 적는다 — 거꾸로 쓰면 공유 DB 가 뒤집힌 메이트로 찬다(증명 `sendEdit`).
 */

// ── 명령 ─────────────────────────────────────────────────────────────

/** `dbPosition` 엔진 명령의 모양 — 엔진 타입을 끌어오지 않으려고 여기서 다시 적는다. */
export interface DbPositionCommand {
  kind: "dbPosition";
  head: string;
  moves: readonly Move[];
}

const pos = (head: string, moves: readonly Move[]): DbPositionCommand => ({
  kind: "dbPosition",
  head,
  moves,
});

/** 자식 값 전부 + 국면 주석(`show_database`). */
export const queryAll = (moves: readonly Move[]) => pos("yxquerydatabaseallt", moves);
/** 이 국면에 적힌 기록 하나(`dbval`). */
export const queryOne = (moves: readonly Move[]) => pos("yxquerydatabaseone", moves);
/** 국면 주석만. */
export const queryText = (moves: readonly Move[]) => pos("yxquerydatabasetext", moves);

/** `yxedittvddatabase` 의 마스크 — 1 라벨 · 2 값 · 4 깊이, 7 이면 셋 다(증명). */
export const MASK_TAG = 1;
export const MASK_VALUE = 2;
export const MASK_DEPTH = 4;

/**
 * 기록 고치기: `yxedittvddatabase <mask> <tag> <value> <depth>`. 태그는 문자 코드이고
 * `W`·`L`·`D`·`X` 는 엔진이 승·패·무·금수 라벨로 바꾼다. -1 은 «지우기». 엔진은 저장한 뒤
 * `DATABASE ONE` 으로 답한다.
 */
export function editRecord(
  mask: number,
  rec: { tag?: string | null; value?: number; depth?: number },
  moves: readonly Move[],
): DbPositionCommand {
  const tag = rec.tag ? rec.tag.charCodeAt(0) : -1;
  const value = Math.round(rec.value ?? 0);
  const depth = Math.round(rec.depth ?? 0);
  return pos(`yxedittvddatabase ${mask} ${tag} ${value} ${depth}`, moves);
}

/** 주석의 `"` · `\` 를 이스케이프 — 엔진은 `std::quoted` 로 읽는다(줄바꿈은 그대로 둔다). */
export const escapeComment = (text: string): string => text.replace(/[\\"]/g, (c) => `\\${c}`);

/** 국면 주석. 빈 문자열이면 지운다. 엔진은 답하지 않는다 — 다시 물어 확인한다. */
export const editComment = (comment: string, moves: readonly Move[]) =>
  pos(`yxedittextdatabase "${escapeComment(comment)}"`, moves);

/** 데스크톱 칸 글자 입력의 최대 길이(`gtk_entry_set_max_length(entry, 6)`). */
export const LABEL_MAX = 6;

/** 칸 글자는 한 토큰 · 6자까지(데스크톱 입력과 같다). */
export const wireLabel = (label: string): string =>
  label.trim().split(/\s+/)[0]!.slice(0, LABEL_MAX);

/**
 * 칸 글자: `yxeditlabeldatabase <y,x> <label>`. `target` 은 **이 국면의** 빈 칸이고 수순에
 * 들어가지 않는다. 빈 글자면 지운다(뒤에 공백만 보낸다 — main.c:2618).
 */
export const editLabel = (
  target: Move,
  label: string,
  moves: readonly Move[],
  toWire: (m: Move) => string,
) => pos(`yxeditlabeldatabase ${toWire(target)} ${wireLabel(label)}`, moves);

/** 이 국면의 기록만 지운다. */
export const deleteOne = (moves: readonly Move[]) => pos("yxdeletedatabaseone", moves);

/** 일괄 삭제의 대상 — `yxdeletedatabaseall <filter>`(dbcommand.cpp `deleteDatabaseAll`). */
export type DbDeleteFilter = "all" | "nonwl" | "wl" | "w" | "l" | "wlnostep" | "wlinstep";

export const DELETE_FILTERS: readonly { id: DbDeleteFilter; title: string }[] = [
  { id: "all", title: "모든 분기" },
  { id: "nonwl", title: "승/패가 아닌 기록" },
  { id: "wl", title: "승/패 기록" },
  { id: "w", title: "승 기록" },
  { id: "l", title: "패 기록" },
  { id: "wlnostep", title: "수순 없는 승/패" },
  { id: "wlinstep", title: "N수 이내 승/패" },
];

export interface DbDeleteScope {
  filter: DbDeleteFilter;
  /** 하위 분기까지 — `all` 에는 없다(데스크톱과 같다). */
  recursive: boolean;
  /** `wlinstep` 의 수. */
  step: number;
}

export function deleteScopeWire(s: DbDeleteScope): string {
  if (s.filter === "all") return "";
  const base = s.filter + (s.recursive ? "recursive" : "");
  return s.filter === "wlinstep" ? `${base} ${Math.max(1, Math.round(s.step))}` : base;
}

export function deleteScopeTitle(s: DbDeleteScope): string {
  const t =
    s.filter === "wlinstep"
      ? `${Math.max(1, Math.round(s.step))}수 이내 승/패`
      : DELETE_FILTERS.find((f) => f.id === s.filter)!.title;
  return s.recursive && s.filter !== "all" ? `${t} (하위 분기까지)` : t;
}

/** 이 국면 아래 자식 분기를 거른 대로 지운다. 엔진은 지운 뒤 `queryAll` 처럼 다시 알린다. */
export const deleteAll = (scope: DbDeleteScope, moves: readonly Move[]) => {
  const w = deleteScopeWire(scope);
  return pos(w ? `yxdeletedatabaseall ${w}` : "yxdeletedatabaseall", moves);
};

// ── 응답 한 줄 ───────────────────────────────────────────────────────

export type DbBound = "none" | "upper" | "lower" | "exact";
const BOUNDS: readonly DbBound[] = ["none", "upper", "lower", "exact"];
export const boundOf = (code: number): DbBound => BOUNDS[code] ?? "none";

export type DbLine =
  | { kind: "refresh" }
  | { kind: "done" }
  | {
      kind: "one";
      /** 라벨의 문자 코드(`w`·`l`·`d`… 소문자로 온다). 0 이면 기록 없음. */
      label: number;
      value: number;
      depth: number;
      bound: DbBound;
      display: string;
    }
  | { kind: "text"; body: string }
  | {
      kind: "cell";
      row: number;
      col: number;
      /** 1..4 글자를 빅엔디언으로 꾸린 정수, -1 이면 없음. */
      tag: number;
      value: number;
      depth: number;
      bound: DbBound;
      hasComment: boolean;
      text: string;
    }
  | { kind: "saved"; ms: number }
  /** `YXDBTOTXT[ALL]` 의 맺음말 — 수를 세어 주지 않는다. */
  | { kind: "wrote" }
  | { kind: "deleted"; count: number }
  | { kind: "error"; text: string }
  | { kind: "other"; text: string };

const int = (s: string | undefined): number | null => {
  if (s === undefined || !/^-?\d+$/.test(s)) return null;
  return Number(s);
};

/**
 * 워커가 넘긴 한 줄(`MESSAGE` 머리를 뗀 본문, 또는 `ERROR …`). 주석의 이어지는 줄은 여기가
 * 아니라 집계기가 읽는다 — 그 줄은 어떤 모양이든 주석의 일부다.
 */
export function parseDbLine(text: string): DbLine {
  const t = text.trim();
  if (/^ERROR\b/i.test(t)) return { kind: "error", text: t.slice(5).trim() };
  let m = /^Saved database file using (\d+) ms/i.exec(t);
  if (m) return { kind: "saved", ms: Number(m[1]) };
  if (/^Wrote .*database to/i.test(t)) return { kind: "wrote" };
  m = /^Done deleting (\d+) records/i.exec(t);
  if (m) return { kind: "deleted", count: Number(m[1]) };
  if (!/^DATABASE\b/i.test(t)) return { kind: "other", text: t };
  const rest = t.slice(8).trim();
  const upper = rest.toUpperCase();
  if (upper.startsWith("REFRESH")) return { kind: "refresh" };
  if (upper.startsWith("DONE")) return { kind: "done" };
  if (upper.startsWith("TEXT")) return { kind: "text", body: rest.slice(4).trim() };
  if (upper.startsWith("ONE")) {
    const parts = rest.slice(3).trim().split(/\s+/);
    const [label, value, depth, bound] = parts.slice(0, 4).map(int);
    if (label == null || value == null || depth == null || bound == null)
      return { kind: "other", text: t };
    return {
      kind: "one",
      label,
      value,
      depth,
      bound: boundOf(bound),
      display: parts.slice(4).join(" "),
    };
  }
  // 칸: 수 일곱 개 뒤에 칸 글자(없을 수 있다). 데스크톱은 `%6s` 로 여섯 자만 쓴다.
  const parts = rest.split(/\s+/);
  const nums = parts.slice(0, 7).map(int);
  if (nums.slice(0, 3).some((n) => n == null)) return { kind: "other", text: t };
  return {
    kind: "cell",
    row: nums[0]!,
    col: nums[1]!,
    tag: nums[2]!,
    value: nums[3] ?? 0,
    depth: nums[4] ?? 0,
    bound: boundOf(nums[5] ?? 0),
    hasComment: (nums[6] ?? 0) !== 0,
    text: (parts[7] ?? "").slice(0, LABEL_MAX),
  };
}

/**
 * `boardtag` 풀기: 1..4 글자를 빅엔디언으로 꾸린 정수(main.c:1700-1719). `'w'<<16|'3'<<8|'9'`
 * → `"w39"`. 데스크톱처럼 앞의 w/l/d 는 대문자로 그리고, 수가 없거나 0 인 승/패는 `W*` 다
 * (main.c:1967-2011).
 */
export function decodeTag(tag: number): string {
  if (tag <= 0) return "";
  const bytes: number[] = [];
  for (let v = tag; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  const text = String.fromCharCode(...bytes);
  const first = text[0]!;
  const head = first === "w" ? "W" : first === "l" ? "L" : first === "d" ? "D" : first;
  const rest = text.slice(1);
  const step = Number(/^\s*(\d*)/.exec(rest)![1] || "0");
  if (rest.length > 0 && (head === "W" || head === "L") && step === 0) return `${head}*`;
  return head + rest;
}

// ── 국면 하나의 DB 모습 ───────────────────────────────────────────────

export type DbCellKind = "rate" | "win" | "loss" | "draw" | "note";

export interface DbCell {
  move: Move;
  /** 풀어 쓴 태그(`W13`, `57%` …), 없으면 "". */
  tag: string;
  /** 칸 글자, 없으면 "". */
  text: string;
  value: number;
  depth: number;
  bound: DbBound;
  hasComment: boolean;
}

/** 값 쪽이 읽는 글자 — 태그가 먼저, 없으면 칸 글자(main.c `evalbar_update_from_db`). */
export const valueLabel = (c: DbCell): string => c.tag || c.text;

export function kindOf(label: string): DbCellKind {
  if (!label) return "note";
  if (/^\d+%$/.test(label)) return "rate";
  const h = label[0]!.toUpperCase();
  return h === "W" ? "win" : h === "L" ? "loss" : h === "D" ? "draw" : "note";
}

export const winRatePct = (c: DbCell): number | null => {
  const l = valueLabel(c);
  if (kindOf(l) !== "rate") return null;
  const n = Number(l.slice(0, -1));
  return n >= 0 && n <= 100 ? n : null;
};

export const mateStep = (c: DbCell): number | null => {
  const l = valueLabel(c);
  const k = kindOf(l);
  return k === "win" || k === "loss" ? Number(/^\s*(\d*)/.exec(l.slice(1))![1] || "0") : null;
};

/** `DATABASE ONE` — 국면에 적힌 기록. */
export interface DbEntry {
  /** 라벨 글자(소문자 그대로), 없으면 null. */
  label: string | null;
  value: number;
  depth: number;
  bound: DbBound;
  display: string;
}

export const entrySummary = (e: DbEntry): string =>
  `${e.display ? `${e.display}: ` : ""}라벨=${e.label ?? "(없음)"}  값=${e.value}  깊이=${e.depth}  범위=${e.bound}`;

export interface DbSnapshot {
  /** `moveKey` → 칸. */
  cells: ReadonlyMap<number, DbCell>;
  comment: string;
  entry: DbEntry | null;
}

export const EMPTY_DB_SNAPSHOT: DbSnapshot = { cells: new Map(), comment: "", entry: null };

/**
 * `DATABASE …` 줄을 국면 하나의 모습으로 모은다 — 앱 `DatabaseAggregator`. `REFRESH` 는 칸을
 * 비우고, `TEXT "…` 가 닫히지 않으면 다음 줄들을 주석으로 삼킨다. 바뀌었으면 `consume` 이
 * 그 줄의 뜻을 돌려준다(이어지는 주석 줄은 닫힐 때 `text` 로).
 */
export class DbAggregator {
  private cells = new Map<number, DbCell>();
  private comment = "";
  private entry: DbEntry | null = null;
  private pending: string | null = null;

  constructor(
    private readonly size: number,
    private readonly fromWire: (row: number, col: number) => Move,
  ) {}

  snapshot(): DbSnapshot {
    return { cells: new Map(this.cells), comment: this.comment, entry: this.entry };
  }

  reset(): void {
    this.cells.clear();
    this.comment = "";
    this.entry = null;
    this.pending = null;
  }

  /** 한 줄. 주석이 아직 열려 있으면 그 일부로 먹고, 닫히지 않았으면 null. */
  consume(line: string): DbLine | null {
    if (this.pending !== null) return this.appendComment(line, false);
    const r = parseDbLine(line);
    switch (r.kind) {
      case "refresh":
        this.cells.clear();
        break;
      case "cell": {
        const move = this.fromWire(r.row, r.col);
        const tag = decodeTag(r.tag);
        const k = moveKey(move, this.size);
        if (!tag && !r.text) this.cells.delete(k);
        else
          this.cells.set(k, {
            move,
            tag,
            text: r.text,
            value: r.value,
            depth: r.depth,
            bound: r.bound,
            hasComment: r.hasComment,
          });
        break;
      }
      case "one":
        this.entry = {
          label: r.label > 0 ? String.fromCharCode(r.label) : null,
          value: r.value,
          depth: r.depth,
          bound: r.bound,
          display: r.display,
        };
        break;
      case "text":
        if (!r.body.startsWith('"')) {
          this.comment = "";
          break;
        }
        this.pending = "";
        return this.appendComment(r.body.slice(1), true);
      default:
        break;
    }
    return r;
  }

  private appendComment(line: string, first: boolean): DbLine | null {
    let acc = this.pending ?? "";
    if (!first) acc += "\n";
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c === '"') {
        this.comment = acc;
        this.pending = null;
        return { kind: "text", body: acc };
      }
      if (c === "\\" && (line[i + 1] === '"' || line[i + 1] === "\\")) {
        acc += line[i + 1];
        i++;
      } else acc += c;
    }
    this.pending = acc;
    return null;
  }
}

/** DB 가 이 국면에 대해 말하는 값 — 흑 관점과 둘 차례 관점. */
export interface DbPositionValue {
  blackWinRate: number;
  blackMate: number | null;
  stmWinRate: number;
  stmMate: number | null;
}

/**
 * 자식 값으로 읽는 국면 값 — main.c `evalbar_update_from_db`. 둘 차례는 가장 좋은 자식을
 * 고르므로 «가장 좋은 자식 값 == 국면 값»이다. **승 하나면 승(OR)**, 하지만 «모든 자식이 진다»는
 * AND 라 둘 수 있는 칸이 모두 값으로 덮였을 때만 패로 읽는다 — 아직 안 읽은 수는 기록이 없을
 * 뿐이다(앱에서 살아 있는 10% 수가 있는 국면이 `M40` 으로 읽혔던 버그).
 */
export function positionValue(
  snap: DbSnapshot,
  blackToMove: boolean,
  playablePoints: number,
): DbPositionValue | null {
  let bestRate = -1;
  let hasWin = false;
  let winStep = 0;
  let hasLoss = false;
  let loseStep = 0;
  let valued = 0;
  for (const c of snap.cells.values()) {
    const k = kindOf(valueLabel(c));
    if (k === "rate") {
      const r = winRatePct(c);
      if (r !== null && r > bestRate) bestRate = r;
      valued++;
    } else if (k === "win") {
      const step = mateStep(c) ?? 0;
      if (!hasWin || (step > 0 && step < winStep)) winStep = step;
      hasWin = true;
      valued++;
    } else if (k === "loss") {
      const step = mateStep(c) ?? 0;
      if (step > loseStep) loseStep = step;
      hasLoss = true;
      valued++;
    } else if (k === "draw") {
      if (bestRate < 50) bestRate = 50;
      valued++;
    }
  }
  let stmRate: number;
  let stmMate = 0;
  if (hasWin) {
    stmRate = 1;
    stmMate = winStep;
  } else if (bestRate >= 0) stmRate = bestRate / 100;
  else if (hasLoss && playablePoints > 0 && valued >= playablePoints) {
    stmRate = 0;
    stmMate = -loseStep;
  } else return null;
  let blackRate = blackToMove ? stmRate : 1 - stmRate;
  const blackMate = stmMate !== 0 ? (blackToMove ? stmMate : -stmMate) : 0;
  if (blackMate !== 0) blackRate = blackMate > 0 ? 1 : 0;
  return {
    blackWinRate: blackRate,
    blackMate: blackMate !== 0 ? blackMate : null,
    stmWinRate: stmRate,
    stmMate: stmMate !== 0 ? stmMate : null,
  };
}

/**
 * 증명이 `DATABASE ONE` 을 읽는 법(main.c `prove_on_dbone`). yixindb 는 라벨을 **소문자**로
 * 알리고 main.c 는 소문자만 맞춘다 — 그 밖은 «기록 없음», 곧 탐색 한 번 더다.
 * `w` 는 둔 쪽이 이겼다 = 둘 차례가 진다.
 */
export function proveVerdict(label: number, isOr: boolean): "win" | "nowin" | null {
  if (label === 0x77) return isOr ? "nowin" : "win"; // 'w'
  if (label === 0x6c) return isOr ? "win" : "nowin"; // 'l'
  if (label === 0x64) return "nowin"; // 'd' — 무승부 기록은 승리 주장을 반증한다
  return null;
}

/** 증명된 마디를 DB 에 적는 라벨 — 둘 차례가 이기면 `L`(둔 쪽 관점). */
export const proveWriteTag = (winForStm: boolean): "L" | "W" => (winForStm ? "L" : "W");
