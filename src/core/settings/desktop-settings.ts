/**
 * 데스크톱 `settings.txt`(47줄) · `settings_dev.txt`(20줄) — 앱 `DesktopSettings.kt` ·
 * `SettingsCodec.kt` 의 이식. 원본은 `Yixin-Board/main.c` 의 `save_setting()` / `load_setting()`.
 *
 * 데스크톱은 두 파일을 **위치로** 읽는다: `load_setting` 이 정해진 순서로 줄마다
 * `read_int_from_file` 을 한 번씩 부른다. 줄 하나가 빠지거나 순서가 바뀌면 그 뒤의 설정이
 * 모두 한 칸씩 밀린다. 그래서:
 *   - `render` 는 언제나 파일의 **모든 줄**을 표 순서로 쓴다(예약 슬롯 · 한 번 쓰는 표시 포함)
 *   - `parse` 는 이름이 아니라 **줄 번호**로 맞추고, 입력에 없는 줄은 지금 값을 둔다
 *     (데스크톱의 `feof` 물러섬)
 *
 * 값은 웹 스토어가 아니라 `DesktopValues`(67칸 평면 기록)로 다룬다 — 웹에 없는 기능의 줄도
 * 잃지 않고 왕복시키기 위해서다. 웹 스토어와의 대응은 `features/settings/desktopBridge.ts`.
 */

export type SettingsFile = "main" | "dev";
export const FILE_NAME: Record<SettingsFile, string> = {
  main: "settings.txt",
  dev: "settings_dev.txt",
};
export const LINE_COUNT: Record<SettingsFile, number> = { main: 47, dev: 20 };

type Kind =
  | { kind: "int"; min: number; max: number }
  | { kind: "choice"; options: readonly number[] }
  | { kind: "bool" }
  | { kind: "text" }
  /** 읽고 그대로 쓰기만 한다 — 예약 슬롯과 한 번 쓰는 표시. */
  | { kind: "fixed" };

export interface DesktopSpec {
  readonly id: string;
  readonly file: SettingsFile;
  /** 1부터. 표의 자리에서 매겨진다 — 표가 곧 파일 배치다. */
  readonly line: number;
  /** 데스크톱이 쓰는 `;주석` — 그대로. */
  readonly comment: string;
  readonly label: string;
  readonly type: Kind;
  readonly def: number | boolean | string;
}

export type DesktopValue = number | boolean | string;
export type DesktopValues = Readonly<Record<string, DesktopValue>>;

const range = (a: number, b: number): number[] =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i);

type Row = [id: string, comment: string, label: string, type: Kind, def: DesktopValue];
const int = (min: number, max: number): Kind => ({ kind: "int", min, max });
const choice = (options: readonly number[]): Kind => ({ kind: "choice", options });
const BOOL: Kind = { kind: "bool" };
const TEXT: Kind = { kind: "text" };
const FIXED: Kind = { kind: "fixed" };

/**
 * 기본값은 앱 `AppSettings()` 의 것 — 배포된 PC 파일과 두 줄만 다르다(4행 컴퓨터 흑 0 ·
 * 19행 해시 1024MB). 처음 쓰는 사람의 첫 대국이 엔진의 흑으로 열리지 않고, 해시가 서버 크기가
 * 아니게(앱 `SettingsCodecTest` 가 그 두 줄을 고정한다).
 */
const MAIN_ROWS: Row[] = [
  ["boardSize", "board size (10 ~ 22)", "보드 크기", int(5, 22), 15],
  ["language", "language (0: English, 1,2,...: custom)", "언어", choice(range(0, 6)), 0],
  ["rule", "rule (0: freestyle, 1: standard, 2: free renju, 3: swap after 1st move, 5: soosorv, 6: swap-2)", "규칙", choice(range(0, 6)), 2],
  ["computerBlack", "computer play black (0: no, 1: yes)", "컴퓨터가 흑돌", BOOL, false],
  ["computerWhite", "computer play white (0: no, 1: yes)", "컴퓨터가 백돌", BOOL, false],
  ["level", "level (0: unlimited time 1: custom level 2-12: predefined level)", "레벨", choice(range(0, 11)), 0],
  ["timeoutTurnSec", "time limit (turn)", "턴 시간", int(1, 1_000_000), 2000],
  ["timeoutMatchSec", "time limit (match)", "매치 시간", int(1, 10_000_000), 100000],
  ["maxDepth", "max depth", "최대 깊이", int(2, 484), 100],
  ["maxNode", "max node", "최대 노드 수", int(1_000, 2_000_000_000), 1_000_000_000],
  ["style", "style (rash 0 ~ 5 cautious)", "스타일", choice(range(0, 5)), 3],
  ["toolbarStyle", "toolbar style (0: only icon, 1: both icon and words, 2: both with horizontally stacked)", "툴바 스타일", choice([0, 1, 2]), 2],
  ["showLog", "show log (0: no, 1: yes)", "로그", BOOL, true],
  ["showNumber", "show number (0: no, 1: yes)", "번호 매기기", BOOL, true],
  ["showAnalysis", "show analysis (0: no, 1: yes)", "분석 표시", BOOL, true],
  ["showAnalysisWinrate", "show analysis winrate (0: no, 1: yes)", "승률 분석", BOOL, true],
  ["showWarning", "show warning (0: no, 1: yes)", "실행 취소 경고", BOOL, true],
  ["threadNum", "number of threads", "스레드 수", int(1, 256), 4],
  ["hashSizeMb", "hash size (MB)", "해시 크기", int(1, 65_536), 1024],
  ["multiPv", "default number of multi-pv", "멀티-PV 수", int(1, 225), 3],
  ["blockAutoReset", "block autoreset (0: no, 1: yes)", "차단 자동 해제", BOOL, true],
  ["blockPathAutoReset", "blockpath autoreset (0: no, 1: yes)", "차단 경로 자동 해제", BOOL, false],
  ["pondering", "pondering (0: off, 1: on)", "사색", BOOL, false],
  ["vcThread", "checkmate in global search (0: no, 1: vct, 2: vc2)", "전역 검색 추가 위협 확인", choice([0, 1, 2]), 0],
  ["hashAutoClear", "hash autoclear (0: no, 1: yes)", "해시 자동 지우기", BOOL, false],
  ["toolbarPos", "toolbar postion (0: left vertical, 1: right horizontal)", "툴바 위치", choice([0, 1]), 0],
  ["darkMode", "enable dark mode", "다크 모드", BOOL, true],
  ["showClock", "show clock (0: no, 1: yes)", "시계", BOOL, false],
  ["incrementMs", "time increment per move", "수당 시간 증가", int(0, 200_000), 0],
  ["showForbidden", "show forbidden moves", "금수 표시", BOOL, true],
  ["checkTimeout", "check timeout", "시간 초과 확인", BOOL, false],
  ["useDatabase", "use database moves (0: no, 1: yes)", "데이터베이스 사용", BOOL, true],
  ["databaseReadonly", "enable database read-only mode (0: no, 1: yes)", "데이터베이스 읽기 전용", BOOL, false],
  ["showBoardText", "show database baord texts (0: no, 1: yes)", "보드 텍스트", BOOL, true],
  ["showDbDelConfirm", "show database delall confirmation (0: no, 1: yes)", "삭제 확인", BOOL, true],
  ["recordDebugLog", "record debug log", "디버그 로그 기록", BOOL, false],
  ["logScale", "log area horizontal scale", "로그 영역 배율", int(50, 300), 140],
  ["nbestSym", "symmetric nbest for the 5th moves", "5수 대칭 nbest", BOOL, false],
  ["lossSaturation", "lossing move color saturation (0~100)", "패배 수 색 채도", int(0, 100), 0],
  ["winSaturation", "winning move color saturation (0~100)", "승리 수 색 채도", int(0, 100), 83],
  ["minSaturation", "min winrate color saturation (0~100)", "최소 승률 채도", int(0, 100), 20],
  ["maxSaturation", "max winrate color saturation (0~100)", "최대 승률 채도", int(0, 100), 80],
  ["colorValue", "value of color (0~100)", "색 명도", int(0, 100), 100],
  ["boardTextFont", "Board Text Font", "보드 텍스트 글꼴", TEXT, "SimHei, sans-serif 12"],
  ["textLogFont", "Text Log Font", "로그 글꼴", TEXT, "Sarasa Mono SC, Cascadia Mono, SimHei, monospace 9"],
  ["dbCommentFont", "Database Comment Font", "DB 주석 글꼴", TEXT, "SimHei, sans-serif 12"],
  ["dbCommentFont2", "Database Comment Font", "DB 주석 글꼴 2", TEXT, "Courier New, monospace 10"],
]; // prettier-ignore

const DEV_ROWS: Row[] = [
  ["showEvalBar", "show evaluation bar (0: no, 1: yes)", "평가 바 표시", BOOL, true],
  ["showWrGraph", "show winrate graph (0: no, 1: yes)", "승률 그래프 표시", BOOL, true],
  ["mqPreset", "move quality preset (0: strict, 1: default, 2: lenient)", "수 품질 기준", choice([0, 1, 2]), 1],
  ["showMoveBadge", "show move badges on stones (0: no, 1: yes)", "돌에 수 품질 배지", BOOL, true],
  ["proveBudget0Sec", "prove mode initial budget per node (seconds)", "증명 초기 예산", int(1, 3_600), 10],
  ["proveBudgetMaxSec", "prove mode budget cap (seconds)", "증명 예산 상한", int(1, 36_000), 320],
  ["proveNbest", "prove mode attacker candidates (yxnbest k)", "증명 공격 후보 수", int(1, 8), 1],
  ["boardZoomPercent", "board zoom scale percent (60~300)", "보드 확대", int(60, 300), 100],
  ["reservedFitBoard", "reserved (was: fit board to window)", "예약 슬롯", FIXED, 0],
  ["dbAutoSave", "auto-save database periodically (0: no, 1: yes)", "DB 주기 자동 저장", BOOL, false],
  ["dbAutoSaveMinutes", "database auto-save interval in minutes", "DB 자동 저장 간격", int(1, 1_440), 30],
  ["proveBestFirst", "prove best attack move first (0: no, 1: yes)", "증명: 최선 공격 먼저", BOOL, true],
  ["proveProbe", "prove early probe of strongest defense (0: no, 1: yes)", "증명: 최강 방어 조기 탐색", BOOL, true],
  ["reviewByDepth", "review budget unit (0: seconds, 1: depth)", "검토 예산 단위 = 깊이", BOOL, false],
  ["reviewDepth", "review fixed depth per move", "검토 고정 깊이", int(4, 64), 14],
  ["proveByDepth", "prove budget unit (0: seconds, 1: depth)", "증명 예산 단위 = 깊이", BOOL, false],
  ["proveDepth0", "prove initial depth per node", "증명 초기 깊이", int(4, 64), 15],
  ["proveDepthMax", "prove depth cap per node", "증명 깊이 상한", int(4, 128), 30],
  ["skipOpening", "skip grading/search of opening moves 1-5 (0: no, 1: yes)", "1~5수 채점 생략", BOOL, true],
  ["devDefaults", "one-time dark+korean defaults applied (do not edit)", "초기 기본값 적용 표시", FIXED, 1],
]; // prettier-ignore

const build = (file: SettingsFile, rows: Row[]): DesktopSpec[] =>
  rows.map(([id, comment, label, type, def], i) => ({
    id,
    file,
    line: i + 1,
    comment,
    label,
    type,
    def,
  }));

export const MAIN_SPECS: readonly DesktopSpec[] = build("main", MAIN_ROWS);
export const DEV_SPECS: readonly DesktopSpec[] = build("dev", DEV_ROWS);
export const ALL_SPECS: readonly DesktopSpec[] = [...MAIN_SPECS, ...DEV_SPECS];
export const specsOf = (f: SettingsFile) => (f === "main" ? MAIN_SPECS : DEV_SPECS);
export const specOf = (id: string) => ALL_SPECS.find((s) => s.id === id);

export const DESKTOP_DEFAULTS: DesktopValues = Object.fromEntries(
  ALL_SPECS.map((s) => [s.id, s.def]),
);

/** 칸 하나의 값을 파일 글자로. 불은 0/1. */
function show(spec: DesktopSpec, v: DesktopValue): string {
  if (spec.type.kind === "bool") return v ? "1" : "0";
  return String(v);
}

/** 데스크톱이 쓰는 그 줄(글꼴은 `;` 앞에 탭이 없다). */
export function renderLine(spec: DesktopSpec, values: DesktopValues): string {
  const v = values[spec.id] ?? spec.def;
  return spec.type.kind === "text"
    ? `${show(spec, v)};${spec.comment}`
    : `${show(spec, v)}\t;${spec.comment}`;
}

/** 파일 하나의 전문 — 줄 끝까지. */
export const render = (values: DesktopValues, file: SettingsFile): string =>
  specsOf(file)
    .map((s) => renderLine(s, values))
    .join("\n") + "\n";

const toInt = (raw: string): number | null =>
  /^[+-]?\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;

/**
 * 파일 글자 하나를 칸에 쓴다 — `load_setting` 이 묶듯이 범위로 묶고, 없는 선택지 · 읽을 수 없는
 * 값은 지금 값을 둔다. 불은 0 이 아니면 켬(main.c 의 `t != 0`).
 */
export function writeValue(spec: DesktopSpec, current: DesktopValue, raw: string): DesktopValue {
  const t = spec.type;
  switch (t.kind) {
    case "text":
      // read_str_from_file 은 첫 ';' 에서 자른다 — 값에 ';' 가 있을 수 없다.
      return raw.split(";")[0]!.trimEnd();
    case "bool": {
      const n = toInt(raw);
      return n === null ? current : n !== 0;
    }
    case "fixed": {
      const n = toInt(raw);
      return n === null ? current : n;
    }
    case "int": {
      const n = toInt(raw);
      return n === null ? current : Math.min(t.max, Math.max(t.min, n));
    }
    case "choice": {
      const n = toInt(raw);
      return n !== null && t.options.includes(n) ? n : current;
    }
  }
}

/** 값 부분 — 첫 `;` 앞, 데스크톱이 정수 뒤에 붙이는 탭 빼고(`read_int_from_file`). */
const valueOf = (line: string) => line.split(";")[0]!.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");

/** 파일 하나를 `base` 위에 얹는다. 짧은 입력은 남은 칸을 그대로 둔다. */
export function parse(
  text: string,
  file: SettingsFile,
  base: DesktopValues = DESKTOP_DEFAULTS,
): DesktopValues {
  const lines = text.replace(/^FEFF/, "").split(/\r?\n/);
  const out: Record<string, DesktopValue> = { ...base };
  specsOf(file).forEach((spec, i) => {
    const raw = lines[i];
    if (raw === undefined || raw.trim() === "") return;
    out[spec.id] = writeValue(spec, out[spec.id] ?? spec.def, valueOf(raw));
  });
  return out;
}

/**
 * 어느 파일인가 — 이름이 말하면 이름으로, 아니면 첫 줄의 주석으로(사용자가 이름을 바꿔 올려도
 * 알아본다). 모르면 `null`.
 */
export function detectFile(name: string, text: string): SettingsFile | null {
  const n = name.toLowerCase();
  if (n.includes("settings_dev")) return "dev";
  if (n.includes("settings")) return "main";
  const first = text.replace(/^FEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  if (first.includes(MAIN_SPECS[0]!.comment)) return "main";
  if (first.includes(DEV_SPECS[0]!.comment)) return "dev";
  return null;
}
