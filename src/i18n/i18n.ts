import { create } from "zustand";
import { EN } from "./en";

/**
 * 다국어(W10) — 한국어 · 영어.
 *
 * **열쇠는 한국어 원문 그대로다.** `t("기보 열기")` 처럼 쓰고, 영어 사전(`en.ts`)에 그 문장이 없으면
 * 한국어를 그대로 돌려준다. 그래서 코드에서 문구가 그대로 읽히고, 번역이 빠져도 화면이 비지 않는다.
 * 빠진 번역은 시험(`i18n.test.ts`)이 소스의 모든 `t("…")` 를 훑어 잡는다 — 영어 칸이 없거나, 영어에
 * 한글이 섞였거나, 대시(— · – · « - »)를 쓴 문구가 있으면 실패한다.
 *
 * 값 끼우기: `t("돌 {n}개", { n: 3 })` — 두 언어 모두 `{이름}` 자리를 쓴다.
 *
 * `t` 는 React 밖(스토어 · 순수 모듈)에서도 부른다 — 부르는 순간의 언어로 만든다. 화면은 언어가
 * 바뀌면 뿌리부터 다시 그린다(`main.tsx` 의 `key`), 그래서 컴포넌트마다 구독할 필요가 없다. 이미 만들어
 * 둔 안내 문구(예: 지난 오류)는 만든 때의 언어로 남는다.
 */

export type Lang = "ko" | "en";

const KEY = "rapfi.lang";

/** 브라우저 언어 — 한국어 계열(ko, ko-KR …)이 하나라도 앞에 있으면 한국어, 아니면 영어. */
export function detectLang(languages: readonly string[]): Lang {
  const first = languages.find((l) => /^[a-z]{2}/i.test(l)) ?? "";
  return first.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function initial(): Lang {
  try {
    const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch {
    /* 저장소가 막혀도 감지로 */
  }
  // 창이 없는 곳(시험의 node — `navigator` 는 있다)은 한국어 — 시험이 원문을 견준다.
  if (typeof window === "undefined" || typeof navigator === "undefined") return "ko";
  return detectLang(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

let current: Lang = initial();

export const getLang = (): Lang => current;

/** 화면이 구독하는 언어(뿌리의 `key`). */
export const useLang = create<{ lang: Lang }>(() => ({ lang: current }));

function applyDocument(l: Lang): void {
  if (typeof document !== "undefined") document.documentElement.lang = l;
}
applyDocument(current);

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* 이번 세션만 */
  }
  applyDocument(l);
  useLang.setState({ lang: l });
}

export type Vars = Readonly<Record<string, string | number>>;

/** 한국어 원문 → 지금 언어의 문구. 사전에 없으면 원문. */
export function t(ko: string, vars?: Vars): string {
  const s = current === "en" ? (EN[ko] ?? ko) : ko;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/**
 * 번역 열쇠 표시 — 원문을 그대로 돌려준다. 표(메뉴 항목 · 단계 이름 …)에 문구를 담아 두고 **그릴 때**
 * `t(값)` 하는 자리에 쓴다. 시험이 `msg("…")` 도 열쇠로 훑는다(`t(변수)` 는 훑을 수 없으므로).
 */
export const msg = (ko: string): string => ko;

/**
 * 값을 읽는 순간 번역하는 표 — `LABEL[x]` 꼴로 여러 화면이 바로 읽는 이름표용. 값은 `msg("…")` 로 적는다.
 * 쓰는 쪽은 그대로 두고도 그릴 때의 언어가 나온다.
 */
export function localized<K extends string>(
  table: Readonly<Record<K, string>>,
): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(table) as K[]) {
    Object.defineProperty(out, k, { get: () => t(table[k]), enumerable: true });
  }
  return out;
}

/**
 * 번역할 수 없는 자료(4수 이름 · 선수 이름 같은 한국어 원자료)를 영어 화면에 그대로 둘 때 그 요소의
 * `lang` — 화면 읽기 프로그램이 한국어로 읽게 한다. 한국어 화면이거나 한글이 없으면 `undefined`.
 */
export const langOf = (text: string): Lang | undefined =>
  current === "en" && /[가-힣]/.test(text) ? "ko" : undefined;

/** 언어마다 다른 값을 고른다 — 문장이 아니라 표(예: 26주형 이름 ↔ 로마자). */
export const pick = <T>(ko: T, en: T): T => (current === "en" ? en : ko);

/** 시험 전용 — 언어를 저장 없이 바꾼다. */
export function setLangForTest(l: Lang): void {
  current = l;
}
