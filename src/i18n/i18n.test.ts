import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EN } from "./en";
import { detectLang, getLang, setLangForTest, t } from "./i18n";

/**
 * 다국어 사전의 완결성 — 소스의 모든 `t("…")` 열쇠를 훑는다.
 *
 *   1. 한글이 든 열쇠마다 영어가 있다(빠지면 영어 화면에 한글이 남는다)
 *   2. 영어에 한글이 없다
 *   3. 양쪽 문구 모두 대시(— · – · 띄어 쓴 « - »)를 쓰지 않는다(W10 — 화면 문구 규칙)
 *   4. 자리(`{n}`)가 양쪽에서 같다
 *   5. 사전에 쓰이지 않는 줄이 없다(문구를 고치고 옛 줄을 남겨 두지 않게)
 */

const SRC = join(__dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

/** `t("…")` · `msg("…")`(따옴표 셋, 끼움 없는 것)의 첫 인자. */
const CALL =
  /(?<![\w.$])(?:t|msg)\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\$])*)`)/g;
const unescape = (s: string) => s.replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");

const keys = new Map<string, string>();
for (const f of files(SRC)) {
  // 주석 속 예시는 열쇠가 아니다 — 블록 주석과 줄 머리의 `//` 주석을 걷어 내고 훑는다.
  const text = readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const m of text.matchAll(CALL)) {
    const k = unescape(m[1] ?? m[2] ?? m[3] ?? "");
    if (!keys.has(k)) keys.set(k, f.slice(SRC.length + 1));
  }
}

const HANGUL = /[가-힣]/;
const DASH = /[—–]| - /;
const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("다국어 사전", () => {
  afterEach(() => setLangForTest("ko"));

  it("소스의 한글 문구마다 영어가 있다", () => {
    const missing = [...keys]
      .filter(([k]) => HANGUL.test(k) && !(k in EN))
      .map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
    expect(keys.size).toBeGreaterThan(0);
  });

  it("영어에 한글이 없고, 자리가 같다", () => {
    expect(Object.entries(EN).filter(([, v]) => HANGUL.test(v))).toEqual([]);
    expect(Object.entries(EN).filter(([k, v]) => slots(k).join() !== slots(v).join())).toEqual([]);
  });

  it("화면 문구에 대시를 쓰지 않는다(두 언어 모두)", () => {
    expect([...keys.keys()].filter((k) => DASH.test(k))).toEqual([]);
    expect(Object.values(EN).filter((v) => DASH.test(v))).toEqual([]);
  });

  it("사전에 쓰이지 않는 줄이 없다", () => {
    expect(Object.keys(EN).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("t: 언어 · 끼우기 · 없는 번역은 원문", () => {
    setLangForTest("ko");
    expect(t("돌 {n}개", { n: 3 })).toBe("돌 3개");
    setLangForTest("en");
    expect(getLang()).toBe("en");
    expect(t("사전에 없는 문장")).toBe("사전에 없는 문장");
  });

  it("t: 영어의 단수 · 복수 {n|one|other}", () => {
    setLangForTest("en");
    expect(t("{n}수", { n: 1 })).toBe("1 move");
    expect(t("{n}수", { n: 2 })).toBe("2 moves");
    expect(t("{n}수", { n: 0 })).toBe("0 moves");
    expect(t("{a} / {b}수", { a: 1, b: 1 })).toBe("1 of 1 move");
    expect(
      t("{n}판 · 국면 {p} · {time} · 저장 {size}", {
        n: 1,
        p: "116,191",
        time: "4s",
        size: "15MB",
      }),
    ).toBe("1 game · 116,191 positions · 4s · 15MB stored");
    setLangForTest("ko");
    expect(t("{n}수", { n: 1 })).toBe("1수");
  });

  it("단수 · 복수 자리는 원문에 있는 자리만 쓴다", () => {
    const bad = Object.entries(EN).filter(([k, v]) =>
      [...v.matchAll(/\{(\w+)\|/g)].some((m) => !slots(k).includes(m[1]!)),
    );
    expect(bad).toEqual([]);
  });

  it("수를 세는 영어 낱말은 단수 · 복수를 고른다(«1 moves» 막기)", () => {
    // 수 뒤에 바로 오는 셀 수 있는 낱말 — 새 문구가 «{n} moves» 처럼 복수로 박히면 여기서 잡는다.
    const COUNTED =
      /\{\w+\} (?:\w+ )?(moves|nodes|candidates|records|games|positions|points|stones|lines|branches|threads|cores|searches|conclusions|arrangements|lessons|warnings|defenses|children)\b/;
    expect(Object.entries(EN).filter(([, v]) => COUNTED.test(v))).toEqual([]);
  });

  it("브라우저 언어 감지 — 한국어 계열이 앞서면 한국어, 아니면 영어", () => {
    expect(detectLang(["ko-KR", "en-US"])).toBe("ko");
    expect(detectLang(["ko"])).toBe("ko");
    expect(detectLang(["en-US", "ko-KR"])).toBe("en");
    expect(detectLang(["ja-JP"])).toBe("en");
    expect(detectLang([])).toBe("en");
  });
});
