/**
 * 단일 스레드 변형의 호스트 워커 — gomocalc `engine-warpper.worker.js` 와 같은 구조.
 * 명령마다 끝난 시각을 돌려준다(단일 빌드의 sendCommand 는 탐색이 끝나야 돌아온다).
 */
let engine = null;
let memory = null;

function makeMemory() {
  const MB = 1024 * 1024;
  let maxMb = 2048;
  while (maxMb > 512) {
    try {
      return {
        memory: new WebAssembly.Memory({
          initial: (64 * MB) / 65536,
          maximum: (maxMb * MB) / 65536,
        }),
        maxMb,
      };
    } catch {
      maxMb /= 2;
    }
  }
  return {
    memory: new WebAssembly.Memory({ initial: (64 * MB) / 65536, maximum: (maxMb * MB) / 65536 }),
    maxMb,
  };
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "ping") {
    self.postMessage({ id: m.id, timeOrigin: performance.timeOrigin });
  } else if (m.type === "load") {
    const made = makeMemory();
    memory = made.memory;
    try {
      self.importScripts(m.url);
    } catch (err) {
      self.postMessage({ id: m.id, error: String(err) });
      return;
    }
    self
      .Rapfi({
        locateFile: (f) => m.engineDir + (m.dataName && /^rapfi.*\.data$/.test(f) ? m.dataName : f),
        onReceiveStdout: (o) => self.postMessage({ type: "stdout", data: o, t: performance.now() }),
        onReceiveStderr: (o) => self.postMessage({ type: "stderr", data: o }),
        onExit: (c) => self.postMessage({ type: "stderr", data: "exit " + c }),
        setStatus: (s) => self.postMessage({ type: "status", data: s }),
        wasmMemory: memory,
      })
      .then(
        (inst) => {
          engine = inst;
          self.postMessage({ id: m.id, maxMb: made.maxMb });
        },
        (err) => self.postMessage({ id: m.id, error: String(err) }),
      );
  } else if (m.type === "cmd") {
    const t = performance.now();
    engine.sendCommand(m.data);
    self.postMessage({ id: m.id, ms: performance.now() - t });
  } else if (m.type === "mem") {
    self.postMessage({ id: m.id, bytes: memory ? memory.buffer.byteLength : null });
  }
};
