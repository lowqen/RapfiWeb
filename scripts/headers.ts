/**
 * 보안 · 격리 헤더의 **원본은 `public/_headers` 하나**다(보안 강화 계획 Phase 1).
 *
 * 예전에는 COOP/COEP 두 줄을 `_headers` · `vite.config.ts` · `scripts/isolation.ts` 세 곳에 손으로
 * 맞춰 두었다. 헤더가 늘면(CSP · CORP · XFO …) 반드시 어긋나므로, 나머지 둘은 이 파서로
 * `_headers` 의 `/*` 블록을 읽어 쓴다 — 개발 서버 · 미리보기 · 스모크 서버가 배포와 같은 정책 아래서 돈다.
 *
 * Cloudflare Pages 형식의 부분집합만 읽는다: 들여쓰지 않은 줄이 경로, 그 아래 들여쓴 `이름: 값` 줄이
 * 그 경로의 헤더, `#` 은 주석. (`! 이름` 떼기 문법은 쓰지 않는다 — 쓰게 되면 여기에 더한다.)
 */
import { readFileSync } from "node:fs";

/** 교차 출처 격리(SharedArrayBuffer) 헤더 — 격리 없는 호스팅을 흉내 낼 때 이 둘만 뺀다. */
export const ISOLATION_KEYS = [
  "Cross-Origin-Opener-Policy",
  "Cross-Origin-Embedder-Policy",
] as const;

/** CSP 계열 — 개발 서버는 빼야 한다(Vite 개발 클라이언트 · React Refresh 가 인라인 스크립트 · <style> 을 쓴다). */
export const CSP_KEYS = ["Content-Security-Policy", "Content-Security-Policy-Report-Only"] as const;

export type HeaderRules = Map<string, Record<string, string>>;

export function parseHeaders(text: string): HeaderRules {
  const rules: HeaderRules = new Map();
  let current: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = {};
      rules.set(raw.trim(), current);
      continue;
    }
    const colon = raw.indexOf(":");
    if (!current || colon < 0) throw new Error(`_headers: 알 수 없는 줄 «${raw.trim()}»`);
    const name = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (current[name] !== undefined) throw new Error(`_headers: «${name}» 가 한 규칙에 두 번 있다`);
    current[name] = value;
  }
  return rules;
}

const HEADERS_FILE = new URL("../public/_headers", import.meta.url);

/** `_headers` 의 `/*` 블록 — 모든 응답(페이지 · 워커 스크립트 · 자산)에 붙는 헤더. */
export function siteHeaders(file: URL | string = HEADERS_FILE): Record<string, string> {
  const site = parseHeaders(readFileSync(file, "utf8")).get("/*");
  if (!site) throw new Error("_headers: «/*» 규칙이 없다");
  return { ...site };
}

export function omit(
  headers: Record<string, string>,
  keys: readonly string[],
): Record<string, string> {
  const drop = new Set(keys.map((k) => k.toLowerCase()));
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !drop.has(k.toLowerCase())));
}
