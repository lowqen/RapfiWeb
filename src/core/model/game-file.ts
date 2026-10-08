import { inBoard, move, sameMove, type Move } from "./move";

/**
 * 기보 파일 — 앱 `core/model/GameFile.kt` 의 이식. 데스크톱이 읽는 세 형식
 * (`load_game_file`, main.c:3536)과 쓰는 두 형식(`show_dialog_save` / `queue_add_current`).
 *
 * 데스크톱은 **확장자만으로** 형식을 고르고 수를 **지금 판** 위에 다시 둔다 — 저장된 판
 * 크기는 읽기만 하고 쓰지 않는다(`fscanf("%*d")`). 여기서도 같고, 판 밖의 수에서 수순을
 * 끊는다.
 */
export type GameFileFormat = "psq" | "sav" | "pos";

export const GAME_FILE_FORMATS: readonly GameFileFormat[] = ["psq", "sav", "pos"];

/** 열 수 있는 파일 — `<input accept>` 에 그대로 쓴다. */
export const GAME_FILE_ACCEPT = GAME_FILE_FORMATS.map((f) => `.${f}`).join(",");

export const GAME_FILE_LABEL: Record<GameFileFormat, string> = {
  /** Piskvork: 머리 줄, 그다음 `열,행,시간`(1부터), `-1` 로 끝. */
  psq: "Piskvork 기보",
  /** Yixin: 크기, 크기, 수, 그다음 줄마다 `행 열`. */
  sav: "Yixin 저장 국면",
  /** Yixin 이진: 수 1바이트, 그다음 수마다 1바이트(`열 * 15 + 행`). */
  pos: "POS 국면",
};

/** 파일 이름의 확장자로 형식을 고른다(대소문자 무시). 모르면 `null`. */
export function formatOf(name: string): GameFileFormat | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return (GAME_FILE_FORMATS as readonly string[]).includes(ext) ? (ext as GameFileFormat) : null;
}

/** `.pos` 는 설정과 무관하게 15×15 를 한 수 1바이트로 싼다. */
const POS_SIZE = 15;

/**
 * `bytes` 를 `format` 으로 읽는다. 읽을 수 없는 파일이면 `null`. 판(`size`) 밖의 수나
 * 이미 돌이 있는 자리에서 수순을 끊는다 — 데스크톱 `make_move` 의 경계 검사가 그런
 * 수를 조용히 버리는 것과 같다.
 */
export function parseGameFile(
  bytes: Uint8Array,
  format: GameFileFormat,
  size: number,
): Move[] | null {
  switch (format) {
    case "pos":
      return parsePos(bytes, size);
    case "sav":
      return parseSav(latin1(bytes), size);
    case "psq":
      return parsePsq(latin1(bytes), size);
  }
}

/** 앱의 `Charsets.ISO_8859_1` — 바이트 하나가 글자 하나. 숫자만 읽으므로 이것이면 된다. */
function latin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** 수순 끝에 이어 붙일 수 있는가 — 판 안이고 아직 빈 자리. */
const fits = (out: readonly Move[], m: Move, size: number) =>
  inBoard(m, size) && !out.some((p) => sameMove(p, m));

/** main.c:3546 — `x = xy % 15`, `y = xy / 15` 를 데스크톱 순서(y,x)로 `make_move`. */
function parsePos(bytes: Uint8Array, size: number): Move[] | null {
  if (bytes.length === 0) return null;
  const count = bytes[0]!;
  const out: Move[] = [];
  for (let i = 1; i <= count && i < bytes.length; i++) {
    const xy = bytes[i]!;
    const m = move(Math.floor(xy / POS_SIZE), xy % POS_SIZE);
    if (!fits(out, m, size)) break;
    out.push(m);
  }
  return out;
}

/** main.c:3568 — 건너뛸 크기 둘, 수, 그다음 `행 열` 쌍. */
function parseSav(text: string, size: number): Move[] | null {
  const numbers = (text.match(/-?\d+/g) ?? []).map(Number);
  if (numbers.length < 3) return null;
  const count = numbers[2]!;
  const out: Move[] = [];
  for (let i = 3; out.length < count && i + 1 < numbers.length; i += 2) {
    const m = move(numbers[i + 1]!, numbers[i]!);
    if (!fits(out, m, size)) break;
    out.push(m);
  }
  return out;
}

/**
 * main.c:3592 — 머리 줄을 건너뛰고 `열,행,시간`(1부터)을 읽는다. 숫자로 시작하지
 * 않는 줄이나 `-1` 끝표에서 멈춘다.
 */
function parsePsq(text: string, size: number): Move[] | null {
  // Kotlin `lineSequence` 처럼 \n · \r\n · \r 을 모두 줄 끝으로 친다.
  const lines = text.split(/\r\n|\r|\n/);
  const out: Move[] = [];
  for (const raw of lines.slice(1)) {
    const l = raw.trim();
    if (l === "") continue;
    if (!/^\d/.test(l)) break;
    const parts = l.split(",");
    if (parts.length < 2) break;
    const col = toInt(parts[0]!);
    const row = toInt(parts[1]!);
    if (col === null || row === null) break;
    if (col < 0) break; // `-1` 끝표
    const m = move(col - 1, row - 1);
    if (!fits(out, m, size)) break;
    out.push(m);
  }
  return out;
}

/** Kotlin `toIntOrNull` — 부호 있는 정수 전체가 아니면 `null`. */
function toInt(s: string): number | null {
  const t = s.trim();
  return /^[+-]?\d+$/.test(t) ? Number(t) : null;
}

const ascii = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

/** `show_dialog_save`(main.c:3700): 크기, 크기, 수, 그다음 `행 열`. */
export function writeSav(moves: readonly Move[], size: number): Uint8Array<ArrayBuffer> {
  let s = `${size}\n${size}\n${moves.length}\n`;
  for (const m of moves) s += `${m.y} ${m.x}\n`;
  return ascii(s);
}

/** `queue_add_current`(main.c:7470): `.psq` 리더가 읽는 모양. */
export function writePsq(moves: readonly Move[], size: number): Uint8Array<ArrayBuffer> {
  let s = `Piskvorky ${size}x${size}, 0:0, 0\n`;
  for (const m of moves) s += `${m.x + 1},${m.y + 1},0\n`;
  return ascii(s + "-1\n");
}

/**
 * `queue_basename`(main.c:7263): 디렉터리와 확장자를 뗀 파일 이름, 공백은 밑줄로 —
 * 내보내는 리포트·저장 파일의 이름이 된다.
 */
export function baseName(path: string): string {
  const tail = path.slice(path.lastIndexOf("/") + 1);
  const name = tail.slice(tail.lastIndexOf("\\") + 1);
  const dot = name.indexOf(".");
  const stem = dot < 0 ? name : name.slice(0, dot);
  return stem.replace(/[ \t]/g, "_") || "game";
}
