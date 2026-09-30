/**
 * relaxed SIMD **멀티** 변형 전용 워커 진입점.
 *
 * 워커 본체는 `engine-worker.ts` 그대로다. 다른 것은 엔진 스레드가 읽을 글루 하나 —
 * 멀티 글루는 엔진 스레드마다 **이 번들의 주소**로 워커를 여는데, 그 스레드에게는 기동
 * 메시지가 오지 않아 어느 변형인지 알릴 길이 번들 자체밖에 없다. 그래서 번들을 나눈다
 * (`engine-client.ts` 의 `spawn` 이 변형을 보고 고른다). 단일 변형은 엔진 스레드가 없어
 * 어느 번들로 띄워도 같다.
 */
import "./pthread-variant-relaxed";
import "./engine-worker";
