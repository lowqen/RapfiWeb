/**
 * 브라우저 워커 — **클래식 워커**다(모듈 워커가 아니다).
 *
 * upstream 은 `-sMODULARIZE=1 -sEXPORT_NAME=Rapfi` 만 쓰고 `EXPORT_ES6` 는 쓰지
 * 않으므로 산출물은 ESM 이 아니라 전역을 정의하는 스크립트다. 그래서 `import` 가
 * 아니라 `importScripts` 로 읽는다.
 *
 * 명령은 메시지로 받는다. sendCommand 가 블로킹하지 않기 때문에 가능한 구조이고,
 * 예전의 SAB 링버퍼가 필요 없어진 이유이기도 하다. 다만 **탐색 명령 하나는**
 * gomocupLoopOnce 안에서 오래 돌 수 있어, 그동안 이 워커의 onmessage 는 밀린다.
 * 그게 어느 정도인지가 W0-1 이 재는 것 중 하나다.
 */
let Module = null;

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === "start") {
      importScripts(m.factoryUrl);
      // eslint-disable-next-line no-undef
      Module = await Rapfi({
        locateFile: (path) => m.baseUrl + path,
        onReceiveStdout: (line) => self.postMessage({ type: "line", line, t: performance.now() }),
        onReceiveStderr: (line) =>
          self.postMessage({ type: "line", line: "[stderr] " + line, t: performance.now() }),
        onExit: (code) => self.postMessage({ type: "exit", code }),
        print: () => {},
        printErr: () => {},
      });
      if (typeof Module.sendCommand !== "function") {
        throw new Error("Module.sendCommand 가 없습니다 — preamble.js 가 링크에 없습니다");
      }
      self.postMessage({ type: "ready", t: performance.now() });
    } else if (m.type === "cmd") {
      Module.sendCommand(m.line);
      self.postMessage({ type: "sent", line: m.line, t: performance.now() });
    }
  } catch (e) {
    self.postMessage({ type: "error", message: String((e && e.stack) || e) });
  }
};
