import type { EnginePreference, EngineVariant } from "../../engine/engine-client";

export const VARIANT_LABEL: Record<EngineVariant, string> = {
  "multi-simd128-relaxed": "멀티스레드 · relaxed SIMD",
  "multi-simd128": "멀티스레드",
  "single-simd128-relaxed": "단일 스레드 · relaxed SIMD",
  "single-simd128": "단일 스레드",
};

/** 드롭다운 항목 — 짧은 이름(상단 바)과 긴 이름(설정). */
export const PREFERENCE_LABEL: Record<EnginePreference, { short: string; long: string }> = {
  auto: { short: "자동", long: "자동 (가장 빠른 것)" },
  multi: { short: "Multi-thread", long: "Multi-thread (pthread)" },
  relaxed: { short: "Relaxed SIMD", long: "WASM Relaxed-SIMD (단일 스레드)" },
  simd: { short: "Standard SIMD", long: "WASM Standard SIMD (단일 스레드)" },
};
