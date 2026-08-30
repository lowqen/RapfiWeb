/**
 * W0-1 주 경로: SharedArrayBuffer 링버퍼 + Atomics.wait 로 만든 stdin.
 *
 * 풀려는 문제. Rapfi 는 piskvork 프로토콜을 **stdin 블로킹 읽기**로 소비한다
 * (`std::getline(std::cin, …)`). 브라우저에는 stdin 이 없고, Emscripten 이 주는
 * 훅(`Module.stdin`)은 **동기 함수**라 "아직 입력이 없다"를 표현할 방법이 없다.
 * null 을 돌려주면 그건 EOF 이고, 엔진은 종료한다.
 *
 * 그래서 소비자를 진짜로 재운다. 워커 스레드에서는 `Atomics.wait` 가 허용되므로
 * (메인 스레드에서는 금지) 링버퍼가 비었을 때 생산자가 깨울 때까지 블로킹한다.
 * 엔진 입장에서는 그냥 느린 파이프이고, 우리 입장에서는 UI 스레드가 멀쩡하다.
 *
 * 이 파일은 순수 ESM 이다 — 브라우저 워커와 node 의 worker_threads 가 같은 코드를
 * 쓴다. W0-1 을 브라우저 없이도 한 번 검증할 수 있는 이유가 이것이다.
 */

/** 제어 배열의 자리. 세 개면 충분하지만 캐시라인을 생각해 넉넉히 잡는다. */
export const CTL_READ = 0;
export const CTL_WRITE = 1;
export const CTL_CLOSED = 2;
const CTL_SLOTS = 8;

/** 기본 64KB. 가장 긴 명령(15×15 BOARD 블록)이 2KB 남짓이라 넉넉하다. */
const DEFAULT_CAPACITY = 1 << 16;

/**
 * 채널 하나. `ctl` 과 `data` 는 둘 다 SharedArrayBuffer 위에 있어야 하며,
 * postMessage 로 워커에 그대로 넘긴다(구조화 복제가 SAB 는 공유로 처리한다).
 */
export function createStdinChannel(capacity = DEFAULT_CAPACITY) {
  return {
    ctl: new Int32Array(new SharedArrayBuffer(CTL_SLOTS * 4)),
    data: new Uint8Array(new SharedArrayBuffer(capacity)),
  };
}

/** SAB 를 쓸 수 있는 환경인가. 헤더가 없으면 생성자만 있고 실제로는 못 쓴다. */
export function sabAvailable() {
  if (typeof SharedArrayBuffer === "undefined") return false;
  // 브라우저에서는 crossOriginIsolated 가 진실이다. node 에는 그 전역이 없다.
  if (typeof crossOriginIsolated === "boolean") return crossOriginIsolated;
  return true;
}

const encoder = new TextEncoder();

/**
 * 생산자 쪽(메인 스레드). 메인 스레드는 `Atomics.wait` 가 금지지만 `notify` 는 된다.
 *
 * 버퍼가 가득 차면 던진다. 덮어쓰기로 조용히 명령을 잃느니 여기서 죽는 편이 낫다 —
 * 잃어버린 한 줄은 나중에 "엔진이 가끔 응답하지 않는다"로 나타나고, 그건 못 잡는다.
 */
export function stdinWrite(channel, text) {
  const { ctl, data } = channel;
  const bytes = encoder.encode(text);
  const cap = data.length;
  let w = Atomics.load(ctl, CTL_WRITE);
  for (let i = 0; i < bytes.length; i++) {
    const next = (w + 1) % cap;
    if (next === Atomics.load(ctl, CTL_READ)) {
      throw new Error(`stdin 링버퍼가 가득 찼습니다 (용량 ${cap}B)`);
    }
    data[w] = bytes[i];
    w = next;
  }
  Atomics.store(ctl, CTL_WRITE, w);
  Atomics.notify(ctl, CTL_WRITE);
}

/** 남은 것을 다 읽은 뒤 EOF 를 주도록 표시한다. 엔진은 그때 프로토콜 루프를 끝낸다. */
export function stdinClose(channel) {
  Atomics.store(channel.ctl, CTL_CLOSED, 1);
  Atomics.notify(channel.ctl, CTL_WRITE);
}

/**
 * 소비자 쪽(워커). Emscripten 이 바이트 하나씩 동기로 부른다.
 *
 * @returns {() => (number|null)} 다음 바이트, EOF 면 null
 */
export function makeBlockingStdin(channel, { onBlock } = {}) {
  const { ctl, data } = channel;
  const cap = data.length;
  return function stdinByte() {
    for (;;) {
      const r = Atomics.load(ctl, CTL_READ);
      const w = Atomics.load(ctl, CTL_WRITE);
      if (r !== w) {
        const byte = data[r];
        Atomics.store(ctl, CTL_READ, (r + 1) % cap);
        return byte;
      }
      if (Atomics.load(ctl, CTL_CLOSED)) return null;
      if (onBlock) onBlock();
      // 비었다. WRITE 가 w 에서 바뀔 때까지 잔다. 생산자가 store 후 notify 하므로
      // store 와 wait 사이의 경쟁은 wait 의 값 비교가 막아준다(값이 이미 바뀌었으면
      // 즉시 not-equal 로 돌아온다).
      Atomics.wait(ctl, CTL_WRITE, w);
    }
  };
}

/**
 * 폴백 경로에 쓰는 비블로킹 stdin. 바이트를 미리 다 넣어 두고 소진되면 EOF 를 준다.
 *
 * 대화형이 아니다 — 명령을 미리 다 아는 경우(BENCH 처럼)에만 성립한다. W0-3 이
 * 이걸로 충분한 이유이고, 동시에 이 방식으로는 대화형 앱을 만들 수 없다는 증거다.
 */
export function makePreloadedStdin(text) {
  const bytes = encoder.encode(text);
  let i = 0;
  return function stdinByte() {
    return i < bytes.length ? bytes[i++] : null;
  };
}
