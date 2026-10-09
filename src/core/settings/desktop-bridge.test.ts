import { describe, expect, it } from "vitest";
import {
  hashChoice,
  MAPPED_IDS,
  overlayWeb,
  webFromDesktop,
  type WebSettings,
} from "./desktop-bridge";
import { ALL_SPECS, DESKTOP_DEFAULTS, parse, render, type DesktopValues } from "./desktop-settings";

const WEB: WebSettings = {
  opening: "none",
  computerSide: "none",
  maxDepth: 225,
  maxNode: -1,
  style: 3,
  threads: 0,
  threadsResolved: 3,
  hashMb: 128,
  multiPv: 1,
  vcThread: 0,
  hashAutoClear: false,
  showEvalBar: true,
  showNumbers: true,
  dark: true,
  showForbidden: true,
  preset: "default",
  review: { byDepth: false, depth: 14, skipOpening: true },
  prove: {
    budget0Sec: 10,
    budgetMaxSec: 320,
    nbest: 2,
    bestFirst: true,
    probe: true,
    byDepth: false,
    depth0: 15,
    depthMax: 30,
  },
  db: {
    enabled: false,
    readonly: false,
    autoSave: false,
    autoSaveMinutes: 30,
    showBoardText: true,
    confirmDeleteAll: true,
  },
};

const deployed: DesktopValues = { ...DESKTOP_DEFAULTS, computerBlack: true, hashSizeMb: 8192 };

describe("가져오기(데스크톱 → 웹)", () => {
  it("배포 파일은 웹 값이 되고, 웹 한계 밖은 메모로 말한다", () => {
    const { web, notes } = webFromDesktop(deployed, WEB);
    expect(web.opening).toBe("none");
    expect(web.computerSide).toBe("black");
    expect(web.hashMb).toBe(512);
    expect(web.maxDepth).toBe(100);
    expect(web.maxNode).toBe(-1); // 10억 = 무제한
    expect(web.threads).toBe(4);
    expect(web.multiPv).toBe(3);
    expect(web.dark).toBe(true);
    expect(web.db.enabled).toBe(true);
    expect(web.prove).toMatchObject({ budget0Sec: 10, budgetMaxSec: 320, nbest: 1 });
    expect(notes).toEqual(["해시 8192MB → 512MB(웹 선택지)"]);
  });

  it("웹에 없는 규칙은 개시를 그대로 두고 그렇다고 말한다", () => {
    const { web, notes } = webFromDesktop({ ...deployed, rule: 6 }, { ...WEB, opening: "rif" });
    expect(web.opening).toBe("rif");
    expect(notes[0]).toMatch(/규칙 6\(스왑2\)/);
    expect(webFromDesktop({ ...deployed, rule: 3 }, WEB).web.opening).toBe("swapFirst");
    expect(webFromDesktop({ ...deployed, rule: 4 }, WEB).web.opening).toBe("rif");
  });

  it("컴퓨터 진영 비트", () => {
    const side = (b: boolean, w: boolean) =>
      webFromDesktop({ ...deployed, computerBlack: b, computerWhite: w }, WEB).web.computerSide;
    expect([side(false, false), side(true, false), side(false, true), side(true, true)]).toEqual([
      "none",
      "black",
      "white",
      "both",
    ]);
  });

  it("해시 선택지는 넘지 않는 가장 큰 것", () => {
    expect([hashChoice(1), hashChoice(16), hashChoice(100), hashChoice(1024)]).toEqual([
      16, 16, 64, 512,
    ]);
  });
});

describe("내보내기(웹 → 데스크톱)", () => {
  it("웹이 모르는 칸은 가져온 값을 지킨다", () => {
    const base = {
      ...deployed,
      language: 1,
      boardTextFont: "Noto 14",
      showClock: true,
      logScale: 99,
    };
    const out = overlayWeb(base, WEB);
    expect(out.language).toBe(1);
    expect(out.boardTextFont).toBe("Noto 14");
    expect(out.showClock).toBe(true);
    expect(out.logScale).toBe(99);
  });

  it("웹의 상한에 닿은 값은 PC 의 더 큰 값을 깎지 않는다", () => {
    const out = overlayWeb(
      { ...deployed, maxDepth: 300, multiPv: 20, threadNum: 32 },
      {
        ...WEB,
        hashMb: 512,
        multiPv: 10,
        threads: 16,
      },
    );
    expect(out.hashSizeMb).toBe(8192);
    expect(out.maxDepth).toBe(300);
    expect(out.multiPv).toBe(20);
    expect(out.threadNum).toBe(32);
    expect(out.maxNode).toBe(1_000_000_000);
  });

  it("자동 스레드는 실제로 쓰는 수로 적는다", () => {
    expect(overlayWeb(deployed, { ...WEB, threads: 0, threadsResolved: 3 }).threadNum).toBe(3);
    expect(overlayWeb(deployed, { ...WEB, threads: 0, threadsResolved: null }).threadNum).toBe(4);
    expect(overlayWeb(deployed, { ...WEB, threads: 2 }).threadNum).toBe(2);
  });

  it("가져온 뒤 바로 내보내면 웹이 깎은 칸 말고는 그대로다", () => {
    const { web } = webFromDesktop(deployed, WEB);
    const back = overlayWeb(deployed, web);
    const changed = ALL_SPECS.filter((s) => back[s.id] !== deployed[s.id]).map((s) => s.id);
    expect(changed).toEqual([]);
    // 파일 두 개로도 바이트가 같다.
    for (const f of ["main", "dev"] as const) expect(render(back, f)).toBe(render(deployed, f));
  });

  it("웹에서 고친 값은 파일을 지나 다시 웹으로 온다", () => {
    const edited: WebSettings = {
      ...WEB,
      opening: "rif",
      computerSide: "white",
      maxDepth: 40,
      maxNode: 5_000_000,
      style: 1,
      threads: 2,
      hashMb: 256,
      multiPv: 5,
      vcThread: 2,
      hashAutoClear: true,
      showEvalBar: false,
      showNumbers: false,
      dark: false,
      showForbidden: false,
      preset: "lenient",
      review: { byDepth: true, depth: 20, skipOpening: false },
      prove: {
        budget0Sec: 5,
        budgetMaxSec: 60,
        nbest: 4,
        bestFirst: false,
        probe: false,
        byDepth: true,
        depth0: 10,
        depthMax: 24,
      },
      db: {
        enabled: true,
        readonly: true,
        autoSave: true,
        autoSaveMinutes: 7,
        showBoardText: false,
        confirmDeleteAll: false,
      },
    };
    const text = {
      main: render(overlayWeb(deployed, edited), "main"),
      dev: render(overlayWeb(deployed, edited), "dev"),
    };
    const parsed = parse(text.dev, "dev", parse(text.main, "main"));
    const { web, notes } = webFromDesktop(parsed, WEB);
    expect(notes).toEqual([]);
    expect({ ...web, threadsResolved: null }).toEqual({ ...edited, threadsResolved: null });
  });

  it("옮기는 칸 목록은 표에 있는 칸만", () => {
    const ids = new Set(ALL_SPECS.map((s) => s.id));
    for (const id of MAPPED_IDS) expect(ids.has(id)).toBe(true);
    expect(MAPPED_IDS).toHaveLength(33);
  });
});
