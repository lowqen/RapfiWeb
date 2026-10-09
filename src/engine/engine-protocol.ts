import { DEFAULT_SIZE, type Move } from "../core/model/move";
import type { EngineCommand, EngineResponse } from "./engine-types";

/**
 * piskvork/Gomocup 프로토콜 — 직렬화와 한 줄 파싱.
 * `EngineCommand.kt` + `ResponseParser.kt` 의 이식본이다.
 *
 * 상태가 없고 IO 도 없다. 여러 줄에 걸친 것(INFO PV 블록)은 `engine-aggregator.ts`
 * 가 잇는다 — 그래야 파서를 브라우저 없이 시험할 수 있다.
 */

// ── 좌표: 이 파일이 보드 좌표가 전선을 건너는 **유일한** 자리다 ────────
//
// **전선 형식은 "row,col" = "y,x" 다.** 데스크톱 main.c(`iochannelout_watch` /
// `send_board`)에서 확인된 것이고, 보드 인덱스는 cell = y * size + x 다.
//
// W1 의 임시 protocol.ts 는 이것을 "x,y" 로 썼다 — 앱이 CoordMapper 주석에
// «flip-Y 함정»이라고 못 박아 둔 바로 그 실수다. 대칭 국면으로는 드러나지 않아서
// W0 스파이크의 왕복 시험도 통과했다. 여기서 바로잡는다.
export class CoordMapper {
  constructor(
    readonly size: number = DEFAULT_SIZE,
    /** 서버의 `--flip-y` 에 해당. 데스크톱 프록시 경로는 `false` 다. */
    readonly flipY: boolean = false,
  ) {}

  /** 보드 좌표 → `"y,x"`. */
  toWire(m: Move): string {
    const row = this.flipY ? this.size - 1 - m.y : m.y;
    return `${row},${m.x}`;
  }

  /** 전선 (row, col) → 보드 좌표. */
  fromWire(row: number, col: number): Move {
    return { x: col, y: this.flipY ? this.size - 1 - row : row };
  }

  /** `"7,8"` 토큰 하나. 형식이 아니면 `null`. */
  parsePair(token: string): Move | null {
    const parts = token.trim().split(",");
    if (parts.length !== 2) return null;
    const row = Number(parts[0]!.trim());
    const col = Number(parts[1]!.trim());
    if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
    return this.fromWire(row, col);
  }
}

// ── 직렬화 ───────────────────────────────────────────────────────────

function boardBlock(head: string, stones: readonly { move: Move; own: boolean }[], c: CoordMapper) {
  return [head, ...stones.map((p) => `${c.toWire(p.move)},${p.own ? 1 : 2}`), "DONE"];
}

/** 한 명령 → 보낼 줄들. 화면은 문자열을 만들지 않는다 — 전부 여기를 지난다. */
export function serialize(cmd: EngineCommand, coord: CoordMapper): string[] {
  switch (cmd.kind) {
    case "about":
      return ["ABOUT"];
    case "start":
      return [`START ${cmd.size}`];
    case "restart":
      return ["RESTART"];
    case "begin":
      return ["BEGIN"];
    case "turn":
      return [`TURN ${coord.toWire(cmd.move)}`];
    case "board":
      return boardBlock("BOARD", cmd.stones, coord);
    case "yxboard":
      return boardBlock("YXBOARD", cmd.stones, coord);
    case "yxnbest":
      return [`YXNBEST ${cmd.n}`];
    case "info":
      return [`INFO ${cmd.key} ${cmd.value}`];
    case "rule":
      return [`INFO RULE ${cmd.id}`];
    case "yxswap2step":
      return [`yxswap2step${cmd.step}`];
    case "yxsoosorvstep": {
      // 여러 줄이다. 워커의 sendCommand 가 개행으로 이어 붙여 **한 번에** 보낸다 —
      // 줄마다 나눠 보내면 엔진이 첫 줄을 읽는 순간 큐가 비어 EOF 가 된다(W3 참고).
      const head =
        `yxsoosorvstep${cmd.step}` + (cmd.fifthCount === undefined ? "" : ` ${cmd.fifthCount}`);
      const moves = cmd.moves ?? [];
      return moves.length === 0 ? [head] : [head, ...moves.map((m) => coord.toWire(m)), "done"];
    }
    case "showDetail":
      // 소문자 `info` 다 — 데스크톱이 보내는 철자를 그대로 옮긴다.
      return [`info show_detail ${cmd.level}`];
    case "yxshowinfo":
      return ["yxshowinfo"];
    case "yxshowforbid":
      return ["YXSHOWFORBID"];
    case "yxdraw":
      return ["yxdraw"];
    case "yxresign":
      return ["yxresign"];
    case "stop":
      return ["YXSTOP"];
    case "end":
      return ["END"];
    case "raw":
      return [cmd.line];
    case "dbPosition":
      // 여러 줄이다 — 워커가 개행으로 이어 **한 번에** 보낸다(yxsoosorvstep 과 같은 까닭).
      return [cmd.head, ...cmd.moves.map((m) => coord.toWire(m)), "done"];
  }
}

// ── 파싱 ─────────────────────────────────────────────────────────────

const BEST_MOVE = /^(\d+)\s*,\s*(\d+)(?:\s+(\d+)\s*,\s*(\d+))?$/;
const WHITESPACE = /\s+/;
/** 협상 줄의 좌표는 쉼표가 아니라 공백으로 나뉜다 — 숫자만 훑어 뽑는다. */
const SIGNED_DIGITS = /-?\d+/g;
const ABOUT_FIELD = /(\w+)\s*=\s*"([^"]*)"|(\w+)\s*=\s*([^,]+)/g;

const int = (s: string): number | null => {
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t)) return null;
  return Number(t);
};

/**
 * 개수. Rapfi 는 사람이 읽는 줄에서 큰 수를 줄여 쓴다(`Node 36K`, `Node 1.2M`).
 * 예전엔 앞쪽 숫자만 떼어 `36K` 를 36 으로 읽었다 — 탐색 끝 요약 줄마다 노드 수가
 * 천분의 일로 떨어졌다가 다음 줄에 되돌아왔다.
 */
const COUNT = /^([+-]?\d+(?:\.\d+)?)\s*([KMGB])?/i;
const SCALE: Record<string, number> = { K: 1e3, M: 1e6, G: 1e9, B: 1e9 };
export function count(v: string): number | null {
  const m = COUNT.exec(v.trim());
  if (!m) return null;
  const unit = m[2]?.toUpperCase();
  return Math.round(Number(m[1]) * (unit ? SCALE[unit]! : 1));
}

/**
 * 시간 → ms. `INFO TOTALTIME 36` 은 단위 없는 ms 이고, 사람이 읽는 줄은
 * `691ms`·`29s`·`3min`·`1h` 로 쓴다(Rapfi `timeText`).
 */
const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|min|h)?\b/i;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000 };
export function durationMs(v: string): number | null {
  const m = DURATION.exec(v.trim());
  if (!m) return null;
  return Math.round(Number(m[1]) * UNIT_MS[(m[2] ?? "ms").toLowerCase()]!);
}

/** 한 줄 → 응답. 모르는 줄도 `unknown` 으로 **남긴다** — 버리지 않는다. */
export function parse(rawLine: string, coord: CoordMapper): EngineResponse {
  const raw = rawLine;
  const line = rawLine.trim();
  if (!line) return { kind: "unknown", raw };
  const upper = line.toUpperCase();

  if (upper.startsWith("MESSAGE REALTIME")) return parseRealtime(line.slice(16).trim(), coord, raw);
  if (upper.startsWith("MESSAGE SWAP2"))
    return parseOpening(line.slice(13).trim(), true, coord, raw);
  if (upper.startsWith("MESSAGE SOOSORV")) {
    return parseOpening(line.slice(15).trim(), false, coord, raw);
  }
  if (upper.startsWith("MESSAGE INFO")) {
    const rest = line.slice(12).trim();
    const sp = rest.indexOf(" ");
    return {
      kind: "capability",
      key: sp < 0 ? rest : rest.slice(0, sp),
      value: sp < 0 ? "" : rest.slice(sp + 1).trim(),
      raw,
    };
  }
  if (upper.startsWith("MESSAGE")) {
    const body = line.slice(7).trim();
    return parseThinking(body, raw) ?? { kind: "message", text: body, raw };
  }
  if (upper.startsWith("INFO")) return parseInfo(line.slice(4).trim(), coord, raw);
  if (upper.startsWith("DEBUG")) return { kind: "debug", text: line.slice(5).trim(), raw };
  if (upper.startsWith("ERROR")) return { kind: "error", text: line.slice(5).trim(), raw };
  if (upper.startsWith("UNKNOWN")) return { kind: "unknown", raw };
  if (upper.startsWith("FORBID")) return parseForbid(line, coord, raw);
  if (upper === "OK") return { kind: "ok", raw };
  if (looksLikeAbout(line)) return { kind: "about", fields: parseAboutFields(line), raw };

  const m = BEST_MOVE.exec(line);
  if (m) {
    const moves = [coord.fromWire(Number(m[1]), Number(m[2]))];
    if (m[3] !== undefined) moves.push(coord.fromWire(Number(m[3]), Number(m[4])));
    return { kind: "bestMove", moves, raw };
  }

  return { kind: "unknown", raw };
}

/** `INFO <key> <value>` — 상세 모드의 실시간 탐색 스트림. */
function parseInfo(rest: string, coord: CoordMapper, raw: string): EngineResponse {
  const sp = rest.indexOf(" ");
  const key = (sp < 0 ? rest : rest.slice(0, sp)).toUpperCase();
  const value = sp < 0 ? "" : rest.slice(sp + 1).trim();

  switch (key) {
    case "PV":
      return value.toUpperCase().startsWith("DONE")
        ? { kind: "infoPvDone", raw }
        : { kind: "infoPvStart", index: int(value) ?? 0, raw };
    case "NUMPV":
      return { kind: "infoNumPv", count: int(value) ?? 1, raw };
    case "DEPTH":
      // "12-34" 는 심화 깊이와 선택 깊이다. 앞쪽만 취한다.
      return { kind: "infoDepth", depth: int(value.split("-")[0]!.trim()) ?? 0, raw };
    case "BESTLINE":
      return { kind: "infoBestline", line: parseMoveList(value, coord), raw };
    case "WINRATE": {
      const n = Number(value);
      return { kind: "infoWinRate", winRate: Number.isFinite(n) ? n : 0, raw };
    }
    case "EVAL":
      return parseEval(value, raw);
    case "NODE":
    case "NODES":
    case "TOTALNODES":
    case "SPEED":
    case "SELDEPTH":
    case "TIME":
    case "TOTALTIME": {
      // 예전엔 TOTALNODES·TOTALTIME 을 몰라 메시지로 흘렸고, 대신 **PV 하나의**
      // 노드 수인 NODES 를 총계로 그렸다 — 노드가 들쭉날쭉 튀고 시간이 멈춰 보인 이유.
      const v = key.endsWith("TIME") ? durationMs(value) : count(value);
      return v === null
        ? { kind: "message", text: `INFO ${rest}`, raw }
        : { kind: "infoStat", key, value: v, raw };
    }
    default:
      return { kind: "message", text: `INFO ${rest}`, raw };
  }
}

/** EVAL 은 `+M<n>` / `-M<n>`(외통) 이거나 숫자 평가값이다. */
function parseEval(value: string, raw: string): EngineResponse {
  const token = value.trim().split(" ")[0] ?? "";
  const up = token.toUpperCase();
  if (up.startsWith("+M")) return { kind: "infoEval", mate: int(token.slice(2)), cp: null, raw };
  if (up.startsWith("-M")) {
    const n = int(token.slice(2));
    return { kind: "infoEval", mate: n === null ? null : -n, cp: null, raw };
  }
  return { kind: "infoEval", mate: null, cp: int(token), raw };
}

/**
 * `Depth 2-3 | Eval 814 | Time 1ms | F7 H7` — 파이프로 나뉜 필드이고,
 * 키가 없는 조각이 문자 라벨로 쓰인 PV 다. 평범한 메시지면 `null` 을 돌려
 * 호출자가 `message` 로 떨어뜨리게 한다.
 */
function parseThinking(body: string, raw: string): EngineResponse | null {
  // 두 모양이다: 깊이마다의 `Depth 11-15 | Eval -319 | Time 618ms | …` 와, 탐색이
  // 끝날 때 한 번의 `Speed 26080 | Depth 11-15 | Eval -319 | Node 16K | Time 618ms`.
  // 뒤엣것이 조각 하나의 **마지막** 노드·시간을 나르는 유일한 줄이다 — 깊은 조각은
  // 마지막 PV 뒤에도 수백 ms 를 더 읽는데, 그 몫은 여기에만 찍힌다.
  const head = body.toUpperCase();
  if (!(head.startsWith("DEPTH") || head.startsWith("SPEED")) || !body.includes("|")) return null;
  let depth: number | null = null;
  let selDepth: number | null = null;
  let evalCp: number | null = null;
  let mate: number | null = null;
  let timeMs: number | null = null;
  let nodes: number | null = null;
  let speed: number | null = null;
  let line: Move[] = [];

  for (const segment of body.split("|")) {
    const seg = segment.trim();
    if (!seg) continue;
    const sp = seg.indexOf(" ");
    const key = (sp < 0 ? seg : seg.slice(0, sp)).toUpperCase();
    const value = sp < 0 ? "" : seg.slice(sp + 1).trim();

    switch (key) {
      case "DEPTH": {
        const [a, b] = value.split("-");
        depth = int(a ?? "");
        selDepth = b === undefined ? null : int(b);
        break;
      }
      case "EVAL":
      case "EVALUATION": {
        const up = value.toUpperCase();
        if (up.startsWith("+M")) mate = int(value.slice(2));
        else if (up.startsWith("-M")) {
          const n = int(value.slice(2));
          mate = n === null ? null : -n;
        } else evalCp = int(value);
        break;
      }
      case "TIME":
        timeMs = durationMs(value);
        break;
      case "NODE":
      case "NODES":
      case "N":
        nodes = count(value);
        break;
      case "SPEED":
        speed = count(value);
        break;
      default: {
        // 키가 없는 조각 = PV. 토큰이 **전부** 좌표 라벨일 때만 PV 로 본다.
        const tokens = seg.split(WHITESPACE).filter(Boolean);
        // `map(labelToMove)` 로 쓰면 안 된다 — Array.map 이 인덱스를 두 번째 인자로
        // 넘겨 `size` 가 0 이 되고, 모든 라벨이 조용히 null 이 된다. PV 가 통째로
        // 사라지는데 예외는 나지 않아서, 시험이 아니었으면 못 잡았을 종류의 버그다.
        const moves = tokens.map((t) => labelToMove(t)).filter((m): m is Move => m !== null);
        if (moves.length > 0 && moves.length === tokens.length) line = moves;
      }
    }
  }
  return { kind: "thinking", depth, selDepth, evalCp, mate, timeMs, nodes, speed, line, raw };
}

/** `H8` 같은 사람 표기 → 좌표. 행은 아래에서 위로 1부터다. */
export function labelToMove(token: string, size = DEFAULT_SIZE): Move | null {
  const m = /^([A-Za-z])(\d{1,2})$/.exec(token.trim());
  if (!m) return null;
  const x = m[1]!.toUpperCase().charCodeAt(0) - 65;
  const row = Number(m[2]);
  if (x < 0 || x >= size || row < 1 || row > size) return null;
  return { x, y: size - row };
}

/** `MESSAGE REALTIME <sub>` — 탐색 중 보드 오버레이. */
function parseRealtime(rest: string, coord: CoordMapper, raw: string): EngineResponse {
  const upper = rest.toUpperCase();
  const one = (
    skip: number,
    kind: "realtimeBest" | "realtimeLose" | "realtimePos" | "realtimeDone",
  ): EngineResponse => {
    const move = coord.parsePair(rest.slice(skip).trim().split(" ")[0] ?? "");
    return move ? ({ kind, move, raw } as EngineResponse) : { kind: "unknown", raw };
  };
  if (upper.startsWith("BEST")) return one(4, "realtimeBest");
  if (upper.startsWith("LOSE")) return one(4, "realtimeLose");
  if (upper.startsWith("POS")) return one(3, "realtimePos");
  if (upper.startsWith("DONE")) return one(4, "realtimeDone");
  if (upper.startsWith("REFRESH")) return { kind: "realtimeRefresh", raw };
  if (upper.startsWith("PV")) {
    return { kind: "realtimePv", line: parseMoveList(rest.slice(2).trim(), coord), raw };
  }
  if (upper.startsWith("VAL")) {
    return { kind: "realtimeVal", value: int(rest.slice(3).trim()) ?? 0, raw };
  }
  return { kind: "unknown", raw };
}

/**
 * `MESSAGE SWAP2 …` / `MESSAGE SOOSORV …` — 오프닝 협상(main.c:13347-13537).
 * 여기서는 좌표가 **쉼표가 아니라 공백**으로 나뉜다.
 */
function parseOpening(
  rest: string,
  swap2: boolean,
  coord: CoordMapper,
  raw: string,
): EngineResponse {
  const upper = rest.toUpperCase();
  // 첫 공백 **뒤**. 공백이 없으면 빈 문자열이다 — `slice(indexOf+1)` 로 쓰면
  // -1+1=0 이 되어 머리말까지 본문에 들어온다(앱의 `substringAfter(' ', "")`).
  const sp = rest.indexOf(" ");
  const body = sp < 0 ? "" : rest.slice(sp + 1).trim();
  const nums = (s: string): number[] =>
    (s.match(SIGNED_DIGITS) ?? []).map(Number).filter(Number.isFinite);

  // Soosorv 의 MOVE5 는 5수 단계이지 평범한 돌이 아니다.
  if (!swap2 && upper.startsWith("MOVE5")) {
    const tail = rest.slice(5).trim();
    const t = tail.toUpperCase();
    const c = nums(tail);
    const pair = (stage: "choose" | "offer"): EngineResponse =>
      c.length >= 2
        ? { kind: "soosorvFifth", stage, move: coord.fromWire(c[0]!, c[1]!), raw }
        : { kind: "message", text: `SOOSORV ${rest}`, raw };
    if (t.startsWith("C")) return pair("choose");
    if (t.startsWith("R")) return { kind: "soosorvFifth", stage: "refresh", move: null, raw };
    if (t.startsWith("D")) return { kind: "soosorvFifth", stage: "done", move: null, raw };
    return pair("offer");
  }

  const n = nums(body);
  if (upper.startsWith("MOVE") && n.length >= 2) {
    const index = Number(upper[4]);
    return {
      kind: "openingMove",
      swap2,
      index: Number.isInteger(index) ? index : 0,
      move: coord.fromWire(n[0]!, n[1]!),
      // Soosorv 의 MOVE4 는 N 을 덧붙인다(main.c:13472 "%d %d %d").
      fifthCount: n.length >= 3 ? n[2]! : null,
      raw,
    };
  }

  if (upper.startsWith("SWAP")) {
    const w = Number(upper[4]);
    // Swap2 는 YES/NO 로, Soosorv 는 Y/N 으로 답한다 — 둘 다 첫 글자가 가른다.
    return {
      kind: "openingSwap",
      swap2,
      which: Number.isInteger(w) ? w : 1,
      yes: body.toUpperCase().startsWith("Y"),
      raw,
    };
  }

  return { kind: "message", text: `${swap2 ? "SWAP2" : "SOOSORV"} ${rest}`, raw };
}

/** `FORBID` + `"yyxx"` 묶음이 `.` 까지. 두 자리 행, 두 자리 열이다. */
function parseForbid(line: string, coord: CoordMapper, raw: string): EngineResponse {
  // 접두사 뒤 공백을 떼고 시작한다. 공백이 남으면 첫 묶음이 " 07" 로 읽혀
  // 행과 열이 한 칸씩 밀린다(70,7 같은 좌표가 나온다).
  const body = line.slice(6).trim();
  const cells: Move[] = [];
  let i = 0;
  while (i + 4 <= body.length && body[i] !== ".") {
    const row = int(body.slice(i, i + 2));
    const col = int(body.slice(i + 2, i + 4));
    if (row === null || col === null) break;
    cells.push(coord.fromWire(row, col));
    i += 4;
  }
  return { kind: "forbid", cells, raw };
}

/** 공백으로 나뉜 `"y,x"` 토큰들 (BESTLINE / REALTIME PV). */
function parseMoveList(value: string, coord: CoordMapper): Move[] {
  return value
    .trim()
    .split(WHITESPACE)
    .filter(Boolean)
    .map((t) => coord.parsePair(t))
    .filter((m): m is Move => m !== null);
}

const looksLikeAbout = (line: string) => /name\s*=/i.test(line) && /version\s*=/i.test(line);

function parseAboutFields(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  ABOUT_FIELD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ABOUT_FIELD.exec(line)) !== null) {
    const key = (m[1] || m[3] || "").trim();
    const value = (m[2] ?? m[4] ?? "").trim();
    if (key) out[key] = value;
  }
  return out;
}
