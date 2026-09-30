/**
 * 스모크 서버가 붙이는 교차 출처 격리 헤더 — `public/_headers` 와 같은 두 줄.
 *
 *   SMOKE_ISOLATE=1 (기본)  배포와 같다 → 멀티스레드 엔진 경로
 *   SMOKE_ISOLATE=0         헤더 없음(GitHub Pages 같은 호스팅) → 단일 스레드 폴백 경로
 *
 * 스모크가 두 경로를 다 보려면 같은 스크립트를 두 값으로 돌린다(web.yml).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export const ISOLATE = process.env.SMOKE_ISOLATE !== "0";

export const ISOLATION_HEADERS: Record<string, string> = ISOLATE
  ? {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    }
  : {};

/** dist 에 그 변형의 글루·wasm 이 있는가(가중치는 모든 변형이 rapfi.data 하나를 쓴다). */
const hasVariant = (dist: string, v: string) =>
  ["js", "wasm"].every((ext) => existsSync(join(dist, `engine/rapfi-${v}.${ext}`)));

/**
 * 이 조건에서 떠야 할 엔진 변형. 스모크의 Chromium 은 relaxed SIMD 를 알므로(114+) 산출물이
 * 있으면 relaxed 가 먼저다. 격리돼 있으면 멀티, 아니면 단일(앱이 물러선다).
 * `SMOKE_RELAXED=0` 이면 relaxed 를 기대하지 않는다(앱을 `?relaxed=0` 으로 연다).
 */
export const RELAXED = process.env.SMOKE_RELAXED !== "0";

export function expectedVariant(dist: string): string {
  const threads = ISOLATE && hasVariant(dist, "multi-simd128");
  const base = threads ? "multi-simd128" : "single-simd128";
  return RELAXED && hasVariant(dist, `${base}-relaxed`) ? `${base}-relaxed` : base;
}

/** 엔진이 돌 수 있는 산출물이 dist 에 있는가 — 공유 가중치 + 가장 낮은 변형. */
export function hasEngine(dist: string): boolean {
  return existsSync(join(dist, "engine/rapfi.data")) && hasVariant(dist, "single-simd128");
}
