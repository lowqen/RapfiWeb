import type { EnginePreference, EngineVariant } from "../../engine/engine-client";
import { localized, msg } from "../../i18n/i18n";

export const VARIANT_LABEL: Readonly<Record<EngineVariant, string>> = localized({
  "multi-simd128-relaxed": msg("멀티스레드 · relaxed SIMD"),
  "multi-simd128": msg("멀티스레드"),
  "single-simd128-relaxed": msg("단일 스레드 · relaxed SIMD"),
  "single-simd128": msg("단일 스레드"),
});

/** 드롭다운 항목 — 짧은 이름(상단 바)과 긴 이름(설정). 사전 열쇠라 그릴 때 `t()`. */
export const PREFERENCE_LABEL: Record<EnginePreference, { short: string; long: string }> = {
  auto: { short: msg("자동"), long: msg("자동 (가장 빠른 것)") },
  multi: { short: "Multi-thread", long: "Multi-thread (pthread)" },
  relaxed: { short: "Relaxed SIMD", long: msg("WASM Relaxed SIMD (단일 스레드)") },
  simd: { short: "Standard SIMD", long: msg("WASM Standard SIMD (단일 스레드)") },
};
