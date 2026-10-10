import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  budgetLabel,
  buildReport,
  csv,
  dateStamp,
  fixed,
  gameJson,
  html,
  json,
  markdown,
  queueSummary,
  sanitizeBudget,
  watchdogSeconds,
  type GameReport,
} from "./report";
import { move } from "../model/move";

/** 내보내기 파일을 데스크톱의 쓰개에 — 앱 `ReportFormatsTest` 의 이식. */

const size = 15;
const moves = [move(7, 7), move(8, 6)];

const report: GameReport = buildReport({
  title: "test game",
  data: {
    moves,
    size,
    records: [
      { blackWinRate: 0.52, blackMate: 0, best: moves[0]!, gap: 0.12 },
      { blackWinRate: 0.4, blackMate: 0, best: move(5, 5), gap: null },
      { blackWinRate: null, blackMate: 0, best: null, gap: null },
    ],
  },
  budget: { seconds: 3, byDepth: false, depth: 14 },
  preset: "default",
  skipOpening: false,
  createdAt: 0,
  ruleName: "Renju",
});

describe("CSV", () => {
  it("데스크톱 머리줄과 국면마다 한 줄", () => {
    const lines = csv(report).trim().split("\n");
    expect(lines[0]).toBe("position,black_winrate,mate,bestmove,played,played_class,gap");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("0,0.5200,0,h8,h8,,0.1200");
    expect(lines[3]!.startsWith("2,,,")).toBe(true);
  });

  it("등급은 영어 이름", () => {
    expect(csv(report)).toContain("Best");
  });
});

describe("Markdown", () => {
  it("데스크톱의 절이 다 있다", () => {
    const md = markdown(report);
    expect(md.startsWith("# 게임 리뷰: test game")).toBe(true);
    expect(md).toContain("- 수: 2, 수당 3 s");
    expect(md).toContain("| 등급 | 흑 | 백 |");
    expect(md).toContain("## 최악의 수");
    expect(md).toContain("| # | 수 | 등급 | dWR | 흑 승률 | 최선 | 격차 | 코멘트 |");
    expect(md).toContain("| 1 | h8 |");
  });

  it("깊이 예산은 데스크톱처럼 적는다", () => {
    const byDepth = { ...report, budget: { seconds: 3, byDepth: true, depth: 20 } };
    expect(markdown(byDepth)).toContain("수당 depth 20");
  });

  it("큐 요약은 미실행까지 센다", () => {
    const s = queueSummary(
      [
        { name: "a.psq", result: "완료" },
        { name: "b.psq", result: "" },
      ],
      1,
      0,
    );
    expect(s).toContain("총 2개: 리뷰 1, 실패 0, 미실행 1");
    expect(s).toContain("- [02] b.psq: 미실행");
  });
});

describe("HTML", () => {
  it("틀 사이에 GAME 객체가 들어간다", () => {
    const out = html(
      report,
      { head: "<head><title>", body: "</title>const GAME = ", tail: ";</html>" },
      "2026-07-28 21:00",
    );
    expect(
      out.startsWith("<head><title>test game · RapfiWeb 게임 리포트</title>const GAME = {"),
    ).toBe(true);
    expect(out.endsWith(";</html>")).toBe(true);
    expect(out).toContain('"size":15');
    expect(out).toContain('"rule":"Renju"');
    expect(out).toContain('"spm":3,"dpm":0');
    expect(out).toContain('"movestr":"h8i9"');
  });

  it("범례에 모든 등급이 있다", () => {
    const j = gameJson(report, "2026-07-28 21:00", "");
    expect(j.split('{"n":').length - 1).toBe(11);
    expect(j).toContain('"kk":{"brilliant":1,"great":2,"best":3');
    expect(() => JSON.parse(j)).not.toThrow();
  });

  it("제목은 HTML 과 JSON 양쪽으로 이스케이프된다", () => {
    const nasty = { ...report, title: 'a<b>&"c"' };
    const out = html(nasty, { head: "", body: "", tail: "" }, "2026-07-28 21:00");
    expect(out).toContain("a&lt;b&gt;&amp;&quot;c&quot;");
    expect(out).toContain('"title":"a<b>&\\"c\\""');
  });

  it("실린 틀 셋을 이으면 한 페이지가 된다", () => {
    const read = (f: string) =>
      readFileSync(new URL(`./report-shell/${f}`, import.meta.url), "utf8");
    const out = html(
      report,
      { head: read("head.html"), body: read("body.html"), tail: read("tail.html") },
      "x",
    );
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out).toContain("<title>test game · RapfiWeb 게임 리포트</title>");
    expect(out).toMatch(/const GAME = \s*\{"title":"test game"/);
    expect(out).not.toContain("Yixin [DevBuild]");
  });
});

describe("도움", () => {
  it("printf 처럼 고정 소수", () => {
    expect(fixed(0.5, 4)).toBe("0.5000");
    expect(fixed(-1, 3)).toBe("-1.000");
    expect(fixed(12.34, 1)).toBe("12.3");
    expect(fixed(12.36, 1)).toBe("12.4");
    expect(fixed(7, 0)).toBe("7");
  });

  it("JSON 은 제어 문자를 이스케이프한다", () => {
    expect(json("a\nb\\c")).toBe('"a\\nb\\\\c"');
    expect(JSON.parse(json("x\u0001y"))).toBe("x\u0001y");
  });

  it("예산 표기 · 감시견 · 범위", () => {
    expect(budgetLabel({ seconds: 3, byDepth: false, depth: 14 })).toBe("3 s");
    expect(budgetLabel({ seconds: 3, byDepth: true, depth: 14 })).toBe("depth 14");
    expect(watchdogSeconds({ seconds: 3, byDepth: false, depth: 14 })).toBe(66);
    expect(watchdogSeconds({ seconds: 3, byDepth: true, depth: 14 })).toBe(1200);
    expect(sanitizeBudget({ seconds: 0, byDepth: false, depth: 99 })).toEqual({
      seconds: 1,
      byDepth: false,
      depth: 64,
    });
  });

  it("날짜 도장", () => {
    expect(dateStamp(new Date(2026, 9, 9, 7, 5).getTime())).toBe("2026-10-09 07:05");
  });
});
