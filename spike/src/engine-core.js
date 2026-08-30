/**
 * Rapfi WASM 모듈 하나를 띄운다 — **upstream 이 이미 정해 둔 방식으로.**
 *
 * 처음에는 stdin 을 SharedArrayBuffer 링버퍼 + Atomics.wait 로 우리가 만들었다.
 * 그 전제가 틀렸다. upstream 의 `Rapfi/emscripten/preamble.js` 는 프로토콜 루프를
 * **펌프**로 노출한다:
 *
 *     Module.sendCommand("START 15")   // 큐에 넣고 gomocupLoopOnce() 한 번 호출
 *     Module.onReceiveStdout = (line) => …   // 줄 단위로 조립되어 온다
 *     Module.onReceiveStderr = (line) => …
 *     Module.terminate()               // _emscripten_force_exit(0)
 *
 * 즉 엔진은 stdin 에서 블로킹하지 않는다. `gomocupLoopOnce()` 가 한 명령만 읽고
 * 돌아오고, 큐가 비면 stdin 콜백은 그냥 null 을 준다. 우리가 풀려던 문제 자체가
 * 없다 — 블로킹도, SAB 도, Atomics 도 필요 없다.
 *
 * 따라오는 결과가 두 개 더 있다:
 *   - 단일 스레드 변형은 **COOP/COEP 없이** 돈다. 헤더는 pthread 때문에만 필요하다.
 *   - 멀티 변형은 upstream 이 `-s PROXY_TO_PTHREAD=1` 로 링크한다. main() 이
 *     별도 pthread 에서 돌므로 호스트 스레드는 애초에 막히지 않는다.
 */

/** 산출물 이름. upstream 의 WASM_OUTPUT_NAME 규칙 그대로. */
export const VARIANTS = ["single-simd128", "multi-simd128"];

/**
 * 모듈을 띄우고 준비된 Module 을 돌려준다.
 *
 * @param {object} opts
 * @param {(name: string) => any} opts.loadFactory  `rapfi-<변형>.js` 를 읽어 전역
 *        팩토리(`Rapfi`)를 돌려준다. node 와 브라우저가 각자 다르게 구현한다 —
 *        upstream 은 `-sMODULARIZE=1 -sEXPORT_NAME=Rapfi` 만 쓰고 EXPORT_ES6 는
 *        쓰지 않으므로, 산출물은 ESM 이 아니라 전역/CommonJS 형태다.
 * @param {string} opts.baseUrl  `.wasm` 과 `.data` 를 찾을 위치
 * @param {(line: string) => void} opts.onLine
 */
export async function startEngine({ factory, baseUrl, onLine, onErr, onExit }) {
  const args = {
    locateFile: (path) => (baseUrl ? baseUrl + path : path),
    onReceiveStdout: (line) => onLine(line),
    onReceiveStderr: (line) => (onErr ?? onLine)("[stderr] " + line),
    onExit: (code) => onExit?.(code),
    // 로더 자신의 진단은 stdout 과 섞지 않는다 — 프로토콜 파서가 읽는 통로다.
    print: () => {},
    printErr: () => {},
  };

  const Module = await factory(args);

  if (typeof Module.sendCommand !== "function") {
    throw new Error(
      "Module.sendCommand 가 없습니다 — upstream 의 emscripten/preamble.js 가 " +
        "링크에 안 들어갔습니다(--pre-js 확인).",
    );
  }
  return Module;
}
