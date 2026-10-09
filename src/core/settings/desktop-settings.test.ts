import { describe, expect, it } from "vitest";
import {
  ALL_SPECS,
  DESKTOP_DEFAULTS,
  DEV_SPECS,
  MAIN_SPECS,
  detectFile,
  parse,
  render,
  specOf,
  writeValue,
  type DesktopValues,
} from "./desktop-settings";

/**
 * 설정 목록을 데스크톱 파일에 묶는다 — 앱 `SettingsCodecTest` 의 이식. 아래 두 상수는
 * **배포된** `test-yixin/settings.txt` · `settings_dev.txt` 를 바이트 그대로 옮긴 것이다:
 * 데스크톱은 둘 다 위치로 읽으므로 줄 하나가 빠지거나 더해지거나 바뀌면 그 뒤가 모두 밀린다.
 * 이 시험이 깨지면 웹과 PC 가 더는 37행의 뜻에 합의하지 않는다.
 */

const MAIN_LINES = [
  "15\t;board size (10 ~ 22)",
  "0\t;language (0: English, 1,2,...: custom)",
  "2\t;rule (0: freestyle, 1: standard, 2: free renju, 3: swap after 1st move, 5: soosorv, 6: swap-2)",
  "1\t;computer play black (0: no, 1: yes)",
  "0\t;computer play white (0: no, 1: yes)",
  "0\t;level (0: unlimited time 1: custom level 2-12: predefined level)",
  "2000\t;time limit (turn)",
  "100000\t;time limit (match)",
  "100\t;max depth",
  "1000000000\t;max node",
  "3\t;style (rash 0 ~ 5 cautious)",
  "2\t;toolbar style (0: only icon, 1: both icon and words, 2: both with horizontally stacked)",
  "1\t;show log (0: no, 1: yes)",
  "1\t;show number (0: no, 1: yes)",
  "1\t;show analysis (0: no, 1: yes)",
  "1\t;show analysis winrate (0: no, 1: yes)",
  "1\t;show warning (0: no, 1: yes)",
  "4\t;number of threads",
  "8192\t;hash size (MB)",
  "3\t;default number of multi-pv",
  "1\t;block autoreset (0: no, 1: yes)",
  "0\t;blockpath autoreset (0: no, 1: yes)",
  "0\t;pondering (0: off, 1: on)",
  "0\t;checkmate in global search (0: no, 1: vct, 2: vc2)",
  "0\t;hash autoclear (0: no, 1: yes)",
  "0\t;toolbar postion (0: left vertical, 1: right horizontal)",
  "1\t;enable dark mode",
  "0\t;show clock (0: no, 1: yes)",
  "0\t;time increment per move",
  "1\t;show forbidden moves",
  "0\t;check timeout",
  "1\t;use database moves (0: no, 1: yes)",
  "0\t;enable database read-only mode (0: no, 1: yes)",
  "1\t;show database baord texts (0: no, 1: yes)",
  "1\t;show database delall confirmation (0: no, 1: yes)",
  "0\t;record debug log",
  "140\t;log area horizontal scale",
  "0\t;symmetric nbest for the 5th moves",
  "0\t;lossing move color saturation (0~100)",
  "83\t;winning move color saturation (0~100)",
  "20\t;min winrate color saturation (0~100)",
  "80\t;max winrate color saturation (0~100)",
  "100\t;value of color (0~100)",
  "SimHei, sans-serif 12;Board Text Font",
  "Sarasa Mono SC, Cascadia Mono, SimHei, monospace 9;Text Log Font",
  "SimHei, sans-serif 12;Database Comment Font",
  "Courier New, monospace 10;Database Comment Font",
];

const DEV_LINES = [
  "1\t;show evaluation bar (0: no, 1: yes)",
  "1\t;show winrate graph (0: no, 1: yes)",
  "1\t;move quality preset (0: strict, 1: default, 2: lenient)",
  "1\t;show move badges on stones (0: no, 1: yes)",
  "10\t;prove mode initial budget per node (seconds)",
  "320\t;prove mode budget cap (seconds)",
  "1\t;prove mode attacker candidates (yxnbest k)",
  "100\t;board zoom scale percent (60~300)",
  "0\t;reserved (was: fit board to window)",
  "0\t;auto-save database periodically (0: no, 1: yes)",
  "30\t;database auto-save interval in minutes",
  "1\t;prove best attack move first (0: no, 1: yes)",
  "1\t;prove early probe of strongest defense (0: no, 1: yes)",
  "0\t;review budget unit (0: seconds, 1: depth)",
  "14\t;review fixed depth per move",
  "0\t;prove budget unit (0: seconds, 1: depth)",
  "15\t;prove initial depth per node",
  "30\t;prove depth cap per node",
  "1\t;skip grading/search of opening moves 1-5 (0: no, 1: yes)",
  "1\t;one-time dark+korean defaults applied (do not edit)",
];

const MAIN_TEXT = MAIN_LINES.join("\n") + "\n";
const DEV_TEXT = DEV_LINES.join("\n") + "\n";
const with_ = (patch: Record<string, string | number | boolean>): DesktopValues => ({
  ...DESKTOP_DEFAULTS,
  ...patch,
});

describe("목록", () => {
  it("두 파일 모두 데스크톱의 줄 수", () => {
    expect(MAIN_SPECS).toHaveLength(47);
    expect(DEV_SPECS).toHaveLength(20);
    expect(ALL_SPECS).toHaveLength(67);
  });

  it("줄 번호는 이어지고 id 는 하나씩", () => {
    for (const [specs, file] of [
      [MAIN_SPECS, "main"],
      [DEV_SPECS, "dev"],
    ] as const) {
      specs.forEach((s, i) => {
        expect(s.line).toBe(i + 1);
        expect(s.file).toBe(file);
      });
    }
    expect(new Set(ALL_SPECS.map((s) => s.id)).size).toBe(67);
    expect(ALL_SPECS.filter((s) => s.label.trim() === "")).toEqual([]);
  });

  it("선택지 칸의 기본값은 선택지 안에 있다", () => {
    for (const s of ALL_SPECS) {
      if (s.type.kind === "choice") expect(s.type.options).toContain(s.def);
      if (s.type.kind === "int") expect(s.type.min).toBeLessThanOrEqual(s.type.max);
    }
  });
});

describe("배포 파일 왕복", () => {
  it("기본값은 배포 파일과 의도한 두 줄만 다르다", () => {
    const rendered = render(DESKTOP_DEFAULTS, "main").split("\n");
    const deployed = MAIN_TEXT.split("\n");
    expect(rendered).toHaveLength(deployed.length);
    const differ = deployed.flatMap((l, i) => (rendered[i] !== l ? [i + 1] : []));
    expect(differ).toEqual([4, 19]);
    expect(rendered[3]).toBe("0\t;computer play black (0: no, 1: yes)");
    expect(rendered[18]).toBe("1024\t;hash size (MB)");
    expect(render(DESKTOP_DEFAULTS, "dev")).toBe(DEV_TEXT);
  });

  it("배포 파일은 데스크톱 값으로 읽힌다 — 출발점이 달라도", () => {
    const other = with_({ rule: 0, threadNum: 1, hashSizeMb: 256, darkMode: false });
    const parsed = parse(DEV_TEXT, "dev", parse(MAIN_TEXT, "main", other));
    expect(parsed).toEqual(with_({ computerBlack: true, hashSizeMb: 8192 }));
  });

  it("고친 값은 모두 왕복한다", () => {
    const edited = with_({
      boardSize: 20,
      rule: 6,
      level: 1,
      timeoutTurnSec: 42,
      maxNode: 123_456_000,
      style: 5,
      threadNum: 2,
      multiPv: 8,
      darkMode: false,
      incrementMs: 5000,
      databaseReadonly: true,
      logScale: 100,
      winSaturation: 12,
      boardTextFont: "Noto Sans KR 14",
      dbCommentFont2: "Consolas 11",
      boardZoomPercent: 175,
      reservedFitBoard: 3,
      reviewDepth: 20,
      devDefaults: 0,
    });
    const back = parse(
      render(edited, "dev"),
      "dev",
      parse(render(edited, "main"), "main", DESKTOP_DEFAULTS),
    );
    expect(back).toEqual(edited);
  });

  it("짧은 파일은 남은 값을 둔다", () => {
    const base = with_({ threadNum: 7, hashSizeMb: 999 });
    const p = parse("9\t;board size\n1\t;language\n", "main", base);
    expect(p.boardSize).toBe(9);
    expect(p.language).toBe(1);
    expect(p.threadNum).toBe(7);
    expect(p.hashSizeMb).toBe(999);
  });

  it("CRLF · BOM 도 읽는다", () => {
    expect(parse("FEFF12\t;board size\r\n1\t;language\r\n", "main").boardSize).toBe(12);
  });

  it("범위 밖은 묶고, 없는 선택지와 쓰레기는 지금 값을 둔다", () => {
    const sp = (id: string) => specOf(id)!;
    expect(writeValue(sp("boardSize"), 15, "99")).toBe(22);
    expect(writeValue(sp("boardSize"), 15, "1")).toBe(5);
    expect(writeValue(sp("winSaturation"), 83, "500")).toBe(100);
    expect(writeValue(sp("rule"), 2, "9")).toBe(2);
    expect(writeValue(sp("darkMode"), false, "7")).toBe(true);
    expect(writeValue(sp("darkMode"), true, "0")).toBe(false);
    expect(writeValue(sp("threadNum"), 4, "abc")).toBe(4);
    expect(writeValue(sp("boardTextFont"), "x", "Noto 12;Board Text Font")).toBe("Noto 12");
  });

  it("예약 슬롯은 제 줄을 지킨다", () => {
    expect(DEV_SPECS[8]!.id).toBe("reservedFitBoard");
    const text = render(with_({ reservedFitBoard: 7, dbAutoSave: true }), "dev");
    expect(text.split("\n")[8]).toBe("7\t;reserved (was: fit board to window)");
    expect(parse(text, "dev").dbAutoSave).toBe(true);
  });
});

describe("파일 알아보기", () => {
  it("이름으로, 이름이 없으면 첫 줄 주석으로", () => {
    expect(detectFile("settings.txt", "")).toBe("main");
    expect(detectFile("settings_dev.txt", "")).toBe("dev");
    expect(detectFile("내 설정.txt", MAIN_TEXT)).toBe("main");
    expect(detectFile("x.txt", DEV_TEXT)).toBe("dev");
    expect(detectFile("x.txt", "hello")).toBeNull();
  });
});
