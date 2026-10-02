import { RELAXED_SIMD_PROBE, type EngineVariant } from "../engine-client";

/**
 * **시험 전용** — relaxed SIMD 지원을 런타임에서 읽어 기대 변형 순서를 만든다.
 *
 * relaxed SIMD 는 런타임마다 다르다: 노드 20(V8 11.3)은 플래그 없이 모르고, 노드 22+ 와
 * Chromium 114+ 는 기본으로 읽고, Firefox·Safari 는 아직 모른다. 그래서 「노드는 relaxed 를
 * 모른다」를 시험에 박아 두면 런타임을 올리는 순간 폴백 시험이 통째로 빨개진다(노드 22 에서
 * 12건). 기대값은 **지금 이 런타임이 프로브에 어떻게 답하는지**에서 만든다. relaxed 의 참·거짓
 * 두 갈래 자체는 각 시험이 `WebAssembly.validate` 를 가로채 어느 런타임에서든 둘 다 본다.
 */

function validates(bytes: BufferSource): boolean {
  try {
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

/**
 * 프로브와 **다른 relaxed 명령**으로 만든 모듈 — `() -> v128` 함수가 v128 상수 셋에
 * `f32x4.relaxed_madd`(0xfd 0x105) 를 건다. 앱의 프로브(`i8x16.relaxed_swizzle`)가 런타임의
 * 실제 지원과 맞는지 따로 확인하는 데 쓴다 — 프로브로 프로브를 확인하면 순환이다.
 */
export const RELAXED_MADD_MODULE = (() => {
  const zero = [0xfd, 0x0c, ...new Array<number>(16).fill(0)]; // v128.const 0
  const body = [0x00, ...zero, ...zero, ...zero, 0xfd, 0x85, 0x02, 0x0b];
  return new Uint8Array([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...[0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b], // 타입: () -> v128
    ...[0x03, 0x02, 0x01, 0x00], // 함수 하나
    ...[0x0a, body.length + 2, 0x01, body.length, ...body], // 코드
  ]);
})();

/**
 * 앱의 프로브에 이 런타임이 어떻게 답하는가. **모듈을 읽을 때 한 번** 잰다 — 시험이
 * `validate` 를 가로채기 전의 진짜 값이어야 한다.
 */
export const RUNTIME_RELAXED: boolean = validates(RELAXED_SIMD_PROBE);
/** 독립 모듈(`f32x4.relaxed_madd`)로 잰 실제 지원. */
export const RUNTIME_RELAXED_MADD: boolean = validates(RELAXED_MADD_MODULE);

type Base = "multi-simd128" | "single-simd128";

/** 같은 스레드 방식 안에서 시도할 순서 — relaxed 를 읽으면 relaxed 판이 먼저. */
export function chainOf(base: Base, relaxed = RUNTIME_RELAXED): EngineVariant[] {
  return relaxed ? [`${base}-relaxed`, base] : [base];
}

/** 그 스레드 방식에서 맨 먼저 띄울 변형. */
export const firstOf = (base: Base, relaxed = RUNTIME_RELAXED): EngineVariant =>
  chainOf(base, relaxed)[0]!;
