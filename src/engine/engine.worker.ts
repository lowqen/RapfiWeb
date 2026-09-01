/// <reference lib="webworker" />
import type { ToWorker, FromWorker } from "./messages";

/**
 * 엔진 워커 — Emscripten 모듈을 여기서만 만진다.
 *
 * ## upstream 이 이미 풀어 놓은 것
 *
 * `Rapfi/emscripten/preamble.js` 가 `--pre-js` 로 들어가 프로토콜을 세 함수로
 * 노출한다. 그래서 `SharedArrayBuffer` 도 `Atomics.wait` 도 ASYNCIFY 도 필요 없다.
 *
 *     Module.sendCommand("START 15")
 *     Module.onReceiveStdout = (chunk) => …
 *     Module.terminate()
 *
 * ## 그런데 단일 스레드 빌드에서는 그 호출이 **동기**다
 *
 * `command/gomocup.cpp`:
 *
 *     extern "C" void gomocupLoopOnce() {
 *     #ifdef MULTI_THREADING
 *         emscripten_atomic_add_u32(&loop_ready, 1);   // 깨우기만 한다
 *         emscripten_atomic_notify(&loop_ready, 1);
 *     #else
 *         if (Command::GomocupProtocol::runProtocol())  // 여기서 직접 다 한다
 *             emscripten_force_exit(EXIT_SUCCESS);
 *     #endif
 *     }
 *
 * 즉 탐색이 도는 동안 **이 워커의 이벤트 루프가 통째로 멈춘다.** `postMessage` 도
 * 다음 `sendCommand` 도 도착할 곳이 없다 — 정지 명령이 닿을 방법이 없다는 뜻이다.
 *
 * ## 그래서 시간 분할
 *
 * 무한 분석을 한 번의 탐색으로 돌리지 않고, `INFO timeout_turn <조각>` 으로 끊어
 * 연달아 발행한다. 조각과 조각 사이에서만 이벤트 루프가 돌아오므로, 정지·설정
 * 변경·새 명령은 **그 경계에서** 처리된다. 해시 테이블이 유지되므로 재탐색
 * 비용은 크지 않다. 대가는 «즉시 정지»가 «최대 한 조각 뒤 정지»가 되는 것이다.
 *
 * 멀티스레드 변형이 브라우저에서 살아나면(W0c) `sliceMs = 0` 하나로 이 분할이
 * 꺼진다 — 그때는 엔진 pthread 가 따로 돌아 정지가 바로 닿는다.
 */

interface EmscriptenModule {
  sendCommand(line: string): void;
  terminate(): void;
  onReceiveStdout?: (chunk: string) => void;
  onReceiveStderr?: (chunk: string) => void;
  locateFile?: (path: string) => string;
  onExit?: (code: number) => void;
}
type ModuleFactory = (opts: Partial<EmscriptenModule>) => Promise<EmscriptenModule>;

const post = (m: FromWorker) => self.postMessage(m);

let mod: EmscriptenModule | null = null;
let sliceMs = 500;
let stopRequested = false;
let searching = false;

/** 줄 조립. onReceiveStdout 은 줄 단위 보장이 없다. */
let pending = "";
const drain = (chunk: string) => {
  pending += chunk;
  const parts = pending.split("\n");
  pending = parts.pop() ?? "";
  const lines = parts.map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);
  if (lines.length) post({ type: "lines", lines });
};

/**
 * upstream 글루는 CommonJS 다(`EXPORT_ES6` 를 쓰지 않는다). ES 모듈 워커에는
 * `importScripts` 가 없으므로 소스를 받아 CommonJS 껍데기 안에서 평가한다.
 * 번들러에 태우지 않는 것은 의도다 — `locateFile` 로 `.wasm`/`.data` 를 찾는
 * upstream 규약을 그대로 두어야 한다.
 */
async function loadFactory(baseUrl: string, variant: string): Promise<ModuleFactory> {
  const url = `${baseUrl}rapfi-${variant}.js`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`엔진 글루를 받지 못했습니다: ${url} (${res.status})`);
  const src = await res.text();
  const shim = { exports: {} as unknown };
  new Function("module", "exports", "self", src)(shim, shim.exports, self);
  const factory = shim.exports as ModuleFactory;
  if (typeof factory !== "function") {
    throw new Error("엔진 글루가 팩토리를 내보내지 않았습니다 (MODULARIZE 빌드가 맞습니까?)");
  }
  return factory;
}

async function boot(msg: Extract<ToWorker, { type: "boot" }>) {
  const t0 = performance.now();
  sliceMs = msg.sliceMs;
  const factory = await loadFactory(msg.engineBaseUrl, msg.variant);
  mod = await factory({
    locateFile: (p: string) => msg.engineBaseUrl + p,
    onReceiveStdout: drain,
    onReceiveStderr: drain,
    onExit: (code: number) => post({ type: "exit", code }),
  });
  if (typeof mod.sendCommand !== "function") {
    throw new Error("Module.sendCommand 가 없습니다 — preamble.js 가 빠진 빌드입니다");
  }
  post({ type: "booted", version: msg.variant, bootMs: Math.round(performance.now() - t0) });
}

const send = (lines: readonly string[]) => {
  for (const l of lines) mod?.sendCommand(l);
};

/** 이벤트 루프에 한 번 양보한다 — 이 틈에만 `stop` 이 도착할 수 있다. */
const yieldToLoop = () => new Promise<void>((r) => setTimeout(r, 0));

async function search(lines: readonly string[], totalMs: number) {
  if (!mod) return;
  searching = true;
  stopRequested = false;
  const t0 = performance.now();

  // sliceMs = 0 은 «분할하지 않는다» — 멀티스레드 변형이 살아난 뒤의 설정이다.
  if (sliceMs <= 0) {
    send(lines);
    searching = false;
    post({ type: "searchDone", reason: "finished", elapsedMs: Math.round(performance.now() - t0) });
    return;
  }

  let reason: "finished" | "stopped" | "timeout" = "timeout";
  while (!stopRequested) {
    const left = totalMs - (performance.now() - t0);
    if (left <= 0) break;
    send([`INFO timeout_turn ${Math.min(sliceMs, Math.ceil(left))}`, ...lines]);
    await yieldToLoop(); // ← 정지 요청이 들어올 수 있는 유일한 지점
  }
  if (stopRequested) reason = "stopped";

  searching = false;
  post({ type: "searchDone", reason, elapsedMs: Math.round(performance.now() - t0) });
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case "boot":
        await boot(msg);
        break;
      case "send":
        send(msg.lines);
        break;
      case "search":
        await search(msg.lines, msg.totalMs);
        break;
      case "stop":
        stopRequested = true;
        // 탐색 중이 아닐 때만 닿는다. 탐색 중이면 조각 경계에서 위 루프가 본다.
        if (!searching) mod?.sendCommand("YXSTOP");
        break;
      case "shutdown":
        try {
          mod?.sendCommand("END");
        } catch {
          // END 는 정상 종료라 ExitStatus 를 던진다. 오류가 아니다.
        }
        break;
    }
  } catch (e) {
    post({ type: "fatal", message: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  }
};
