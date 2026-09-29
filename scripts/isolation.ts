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

/**
 * 이 조건에서 떠야 할 엔진 변형. 격리돼 있고 dist 에 멀티 산출물이 있으면 멀티,
 * 아니면 단일(앱이 물러선다).
 */
export function expectedVariant(dist: string): "multi-simd128" | "single-simd128" {
  const multi = ["js", "wasm", "data"].every((ext) =>
    existsSync(join(dist, `engine/rapfi-multi-simd128.${ext}`)),
  );
  return ISOLATE && multi ? "multi-simd128" : "single-simd128";
}
