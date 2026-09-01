/**
 * 브라우저가 이 엔진을 돌릴 수 있는가.
 *
 * **WASM SIMD 가 하한선이다.** 비SIMD 변형은 이 엔진 커밋에서 빌드되지 않는다 —
 * `eval/mix10nnue.cpp:256` 의 `static_assert(InstType != SCALAR)` 가 스칼라 백엔드를
 * 거부하고, 그 파일은 `CORE_SOURCES` 에 무조건 들어간다(계획서 §3).
 * 그러므로 하향할 변형이 없다: SIMD 가 없으면 안내 화면으로 끝낸다.
 */

/**
 * SIMD 프로브.
 *
 * 처음 쓴 바이트열은 함수 타입을 `() -> v128` 로 선언해 놓고 본문에서 `drop` 해
 * 검증에 실패했다 — 헤드리스 Chromium 이 `simd:false` 를 보고하는데 엔진은 그
 * 자리에서 `WASM_SIMD` 로 잘 돌아 한동안 헤맸다. 타입은 `() -> ()` 여야 한다.
 *
 *   type  () -> ()
 *   code  i32.const 0 ; i8x16.splat ; drop ; end
 */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 9, 1, 7, 0, 65, 0, 253, 15, 26,
  11,
]);

export interface Capabilities {
  simd: boolean;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number | null;
  /** 고를 변형. `null` 이면 이 브라우저에서는 엔진을 돌릴 수 없다. */
  variant: "single-simd128" | "multi-simd128" | null;
  note: string | null;
}

export function detectCapabilities(): Capabilities {
  let simd = false;
  try {
    simd = WebAssembly.validate(SIMD_PROBE);
  } catch {
    simd = false;
  }
  const isolated = typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false;

  return {
    simd,
    crossOriginIsolated: isolated,
    // 브라우저 밖(테스트·SSR)에서도 부를 수 있어야 한다 — navigator 는 Node 20 에 없다.
    hardwareConcurrency:
      typeof navigator === "undefined" ? null : (navigator.hardwareConcurrency ?? null),
    // 멀티 변형은 브라우저 워커에서 동작을 확인하지 못했다(W0-1). 살아나면(W0c)
    // 여기서 isolated 를 보고 고르게 된다. 그때까지는 단일 스레드가 유일한 경로다.
    variant: simd ? "single-simd128" : null,
    note: simd
      ? null
      : "이 브라우저는 WebAssembly SIMD 를 지원하지 않아 엔진을 실행할 수 없습니다. " +
        "Chrome/Edge 91+, Firefox 89+, Safari 16.4+ 가 필요합니다.",
  };
}
