/**
 * relaxed 멀티 변형 번들의 표지 — `engine-worker-relaxed.ts` 가 **맨 먼저** 불러온다.
 *
 * 엔진 스레드(em-pthread)는 이 번들을 다시 열고, `engine-worker.ts` 머리의 pthread 가드가
 * 이 값을 보고 relaxed 글루를 읽는다(`pthreadVariant`). import 는 적힌 순서대로 평가되므로
 * 가드보다 이것이 먼저 돈다.
 */
(globalThis as { __RAPFI_PTHREAD_VARIANT__?: string }).__RAPFI_PTHREAD_VARIANT__ =
  "multi-simd128-relaxed";

export {};
