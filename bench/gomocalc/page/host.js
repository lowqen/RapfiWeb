/**
 * 벤치 호스트 — **두 엔진을 똑같은 방식으로** 띄운다. 호스트가 다르면 엔진이 아니라
 * 호스트를 재게 되므로, 둘 다 gomocalc 의 탑재 방식을 그대로 따른다:
 *
 *   - multi-*: 페이지(메인 스레드)에서 글루를 불러 `Rapfi({...})`. PROXY_TO_PTHREAD
 *     빌드라 main() 은 pthread 에서 돌고 메인 스레드는 막히지 않는다.
 *   - single-*: 전용 워커에서 불러 동기 `sendCommand`. 탐색이 끝날 때까지 워커가 막힌다.
 *
 * 선형 메모리는 호스트가 만들어 넘긴다(IMPORTED_MEMORY=1). 두 엔진 모두 64MB 에서
 * 시작하고 상한은 gomocalc 처럼 2048MB 부터 반씩 줄여 가며 잡히는 값이다 — 그래야
 * `memory.buffer.byteLength` 로 **같은 잣대의** 점유량을 읽을 수 있다.
 *
 * 줄마다 `performance.now()` 도장을 찍는다. 깊이 도달 시간을 엔진의 TOTALTIME 과
 * 벽시계 두 가지로 잴 수 있게.
 */
(function () {
  const MB = 1024 * 1024;
  const PAGE = 65536;

  function memoryArgs(shared, maxMb) {
    return { initial: (64 * MB) / PAGE, maximum: (maxMb * MB) / PAGE, shared };
  }

  /** gomocalc `instantiateSharedWasmMemory` 와 같은 탐색. 공유가 아니어도 같은 규칙. */
  function makeMemory(shared) {
    let maxMb = 2048;
    while (maxMb > 512) {
      try {
        const m = new WebAssembly.Memory(memoryArgs(shared, maxMb));
        return { memory: m, maxMb };
      } catch {
        maxMb /= 2;
      }
    }
    return { memory: new WebAssembly.Memory(memoryArgs(shared, maxMb)), maxMb };
  }

  const bench = {
    lines: [],
    status: [],
    errors: [],
    ready: false,
    loadMs: null,
    maxMb: null,
    kind: null,
    _memory: null,
    _engine: null,
    _worker: null,
    _pending: new Map(),
    _seq: 0,

    push(line) {
      bench.lines.push({ t: performance.now(), line });
    },

    /** engineDir: "/engines/gomocalc/" 등. dataName: 그 변형이 찾는 .data 를 돌릴 이름(없으면 그대로). */
    async load(engineDir, variant, dataName) {
      const url = `${engineDir}rapfi-${variant}.js`;
      const locateFile = (f) => engineDir + (dataName && /^rapfi.*\.data$/.test(f) ? dataName : f);
      const t0 = performance.now();
      if (variant.startsWith("multi")) {
        bench.kind = "main-thread";
        const { memory, maxMb } = makeMemory(true);
        bench._memory = memory;
        bench.maxMb = maxMb;
        await new Promise((ok, fail) => {
          const s = document.createElement("script");
          s.src = url;
          s.onload = ok;
          s.onerror = () => fail(new Error("글루를 불러오지 못했습니다: " + url));
          document.head.appendChild(s);
        });
        bench._engine = await self.Rapfi({
          locateFile,
          onReceiveStdout: (o) => bench.push(o),
          onReceiveStderr: (o) => bench.errors.push(o),
          onExit: (c) => bench.errors.push("exit " + c),
          setStatus: (s) => bench.status.push(s),
          wasmMemory: memory,
        });
      } else {
        bench.kind = "worker";
        const w = new Worker("single-worker.js");
        bench._worker = w;
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === "stdout") bench.lines.push({ t: m.t + bench._workerOffset, line: m.data });
          else if (m.type === "stderr") bench.errors.push(m.data);
          else if (m.type === "status") bench.status.push(m.data);
          else if (m.id !== undefined) {
            const p = bench._pending.get(m.id);
            bench._pending.delete(m.id);
            if (p) p(m);
          }
        };
        w.onerror = (e) => bench.errors.push("worker: " + e.message);
        const hello = await bench._call({ type: "ping" });
        // 워커와 페이지의 performance.now() 원점이 다르다 — 페이지 시계로 옮긴다.
        bench._workerOffset = performance.timeOrigin - hello.timeOrigin;
        const r = await bench._call({ type: "load", url, engineDir, dataName });
        if (r.error) throw new Error(r.error);
        bench.maxMb = r.maxMb;
      }
      bench.loadMs = performance.now() - t0;
      bench.ready = true;
      return { loadMs: bench.loadMs, kind: bench.kind, maxMb: bench.maxMb };
    },

    _workerOffset: 0,
    _call(msg) {
      const id = ++bench._seq;
      return new Promise((ok) => {
        bench._pending.set(id, ok);
        bench._worker.postMessage({ ...msg, id });
      });
    },

    /** 명령 한 줄. 단일 변형이면 워커가 그 명령을 끝낼 때까지(탐색 포함) 기다린다. */
    async send(cmd) {
      if (bench._engine) {
        bench._engine.sendCommand(cmd);
        return null;
      }
      const r = await bench._call({ type: "cmd", data: cmd });
      return r.ms;
    },

    /** 단일 변형용: 워커에 보내고 기다리지 않는다(탐색이 오래 걸리는 명령). */
    post(cmd) {
      if (bench._engine) bench._engine.sendCommand(cmd);
      else bench._call({ type: "cmd", data: cmd });
    },

    async memoryBytes() {
      if (bench._memory) return bench._memory.buffer.byteLength;
      if (!bench._worker) return null;
      return (await bench._call({ type: "mem" })).bytes;
    },
  };
  self.bench = bench;
})();
