/// <reference lib="webworker" />
import { CoordMapper, parse, serialize } from "./engine-protocol";
import { SearchAggregator } from "./engine-aggregator";
import { toSerializable, type EngineCommand, type FromWorker, type ToWorker } from "./engine-types";

/**
 * 엔진 워커 — Emscripten 모듈을 만지는 유일한 자리.
 *
 * ## upstream 이 이미 풀어 놓은 것
 *
 * `Rapfi/emscripten/preamble.js` 가 `--pre-js` 로 들어가 프로토콜을 세 함수로
 * 노출한다. 그래서 `SharedArrayBuffer` 도 `Atomics.wait` 도 ASYNCIFY 도 필요 없다.
 *
 * ## 그런데 단일 스레드 빌드에서 그 호출은 **동기**다
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
 * 다음 `sendCommand` 도 도착할 곳이 없으니, 정지 명령이 닿을 방법이 없다.
 *
 * ## 그래서 시간 분할
 *
 * 무한 분석을 한 번의 탐색으로 돌리지 않고 `INFO timeout_turn <조각>` 으로 끊어
 * 연달아 발행한다. 조각과 조각 사이에서만 이벤트 루프가 돌아오므로 정지·설정
 * 변경·새 명령은 **그 경계에서** 처리된다. 해시 테이블이 유지되므로 재탐색 비용은
 * 크지 않다. 대가는 「즉시 정지」가 「최대 한 조각 뒤 정지」가 되는 것이다.
 *
 * 멀티스레드 변형이 브라우저에서 살아나면(W0c) `sliceMs = 0` 하나로 분할이 꺼진다.
 *
 * ## 파싱과 집계는 여기서 끝낸다
 *
 * 탐색 중 엔진은 초당 수십~수백 줄을 뱉는다. 메인 스레드에서 파싱하면 UI 가 그만큼
 * 갉아먹힌다. 메인은 **집계된 스냅샷**(~10Hz)과 저주파 콘솔 배치만 받는다.
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

/**
 * 예외를 사람이 읽을 문장으로.
 *
 * `String(e)` 만 쓰면 안 된다. Emscripten 이 던지는 `ExitStatus` 는 Error 가 아니라
 * **평범한 객체**라, 화면에 «[object Object]» 만 뜨고 원인이 통째로 사라진다 —
 * 실제로 그렇게 나와서 한 런을 헤맸다.
 */
function describe(e: unknown): string {
  if (e instanceof Error) return e.stack ?? e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (o.name === "ExitStatus" || typeof o.status === "number") {
      return `엔진이 종료했습니다 (ExitStatus ${String(o.status)}) — 분석 중 exit 가 불렸습니다`;
    }
    try {
      return JSON.stringify(e) ?? String(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

let mod: EmscriptenModule | null = null;
let coord = new CoordMapper();
let agg = new SearchAggregator(15);
let sliceMs = 500;
let stopRequested = false;
let searching = false;

/** 스냅샷은 ~10Hz 로만 올린다. 그보다 잦으면 메인이 그리는 것보다 받는 게 많아진다. */
const SNAPSHOT_MS = 100;
let lastSnapshotAt = 0;
let snapshotDirty = false;

/** 콘솔 원시 줄: 100ms 배치 + 상한. */
const CONSOLE_BATCH_MS = 100;
let consoleBuffer: string[] = [];
let consoleTimer: ReturnType<typeof setTimeout> | null = null;

function flushConsole() {
  consoleTimer = null;
  if (consoleBuffer.length === 0) return;
  post({ type: "console", lines: consoleBuffer });
  consoleBuffer = [];
}

function pushConsole(line: string) {
  consoleBuffer.push(line);
  if (consoleBuffer.length > 500) consoleBuffer = consoleBuffer.slice(-500);
  if (consoleTimer === null) consoleTimer = setTimeout(flushConsole, CONSOLE_BATCH_MS);
}

function maybeEmitSnapshot(force = false) {
  if (!snapshotDirty && !force) return;
  const now = Date.now();
  if (!force && now - lastSnapshotAt < SNAPSHOT_MS) return;
  lastSnapshotAt = now;
  snapshotDirty = false;
  post({ type: "snapshot", snapshot: toSerializable(agg.snapshot()) });
}

/**
 * 엔진이 뱉은 줄 하나를 처리한다.
 *
 * **`onReceiveStdout` 은 이미 완성된 줄을 준다.** `preamble.js` 의 `stdout(char)`
 * 이 개행에서 끊어 버퍼를 넘기고, 넘기는 문자열에는 개행이 없다:
 *
 *     function stdout(char) {
 *       if (!char || char == newline_charcode) { stdout_fn(stdout_buffer); stdout_buffer = ""; }
 *       else stdout_buffer += String.fromCharCode(char);
 *     }
 *
 * 처음에는 이것을 «청크»로 보고 `split("\n")` 뒤 마지막 조각을 다음 호출까지
 * 붙들어 뒀다. 개행이 없으니 조각이 언제나 하나였고, 그 하나가 매번 보류돼
 * **한 줄도 나가지 않았다** — 엔진은 392ms 만에 잘 떴는데 콘솔이 영원히 비었다.
 * 만약을 위해 split 은 남기되 보류는 하지 않는다.
 */
function drain(chunk: string) {
  for (const part of chunk.split("\n")) {
    const line = part.replace(/\r$/, "");
    if (!line) continue;
    pushConsole(line);
    const r = parse(line, coord);
    if (agg.consume(r)) snapshotDirty = true;
    if (r.kind === "bestMove") post({ type: "bestMove", moves: r.moves });
    else if (r.kind === "forbid") post({ type: "forbid", cells: r.cells });
  }
  maybeEmitSnapshot();
}

/**
 * upstream 글루를 읽어 팩토리를 꺼낸다.
 *
 * `-sMODULARIZE=1 -sEXPORT_NAME=Rapfi` 만 쓰고 `EXPORT_ES6` 는 쓰지 않으므로,
 * 산출물은 ESM 이 아니라 **전역 `Rapfi` 를 정의하는 스크립트**다. 그래서
 * `importScripts` 로 읽는다 — 이것이 W0-1 이 브라우저에서 통과시킨 구성이다.
 *
 * 번들러에 태우지 않는 것은 의도다: `locateFile` 로 `.wasm`/`.data` 를 찾는
 * upstream 규약을 그대로 둬야 하고, 40MB 짜리 `.data` 를 번들에 넣을 일도 없다.
 */
function loadFactory(baseUrl: string, variant: string): ModuleFactory {
  const url = `${baseUrl}rapfi-${variant}.js`;
  importScripts(url);
  const factory = (self as unknown as Record<string, unknown>)["Rapfi"];
  if (typeof factory !== "function") {
    throw new Error(`엔진 글루가 전역 Rapfi 를 정의하지 않았습니다: ${url}`);
  }
  return factory as ModuleFactory;
}

/**
 * 명령 하나를 보낸다. **여러 줄짜리 명령은 한 번의 `sendCommand` 로 보내야 한다.**
 *
 * `preamble.js` 의 펌프는 이렇게 생겼다:
 *
 *     Module["sendCommand"] = function (data) {
 *       stdin_queue.push(data + "\n");
 *       execute_command();            // = gomocupLoopOnce()
 *     };
 *
 * 즉 **넣자마자 프로토콜을 한 바퀴 돌린다.** `BOARD`/`YXBOARD` 처럼 뒤에 돌 목록과
 * `DONE` 이 따라오는 블록 명령을 줄 단위로 나눠 보내면, 엔진이 `YXBOARD` 를 읽은
 * 그 순간 큐가 비어 있어 `stdin()` 이 null(=EOF)을 돌려준다. 돌이 하나도 없는
 * 빈 국면이 세워지고, 뒤이어 도착한 `7,7,1` 같은 줄은 **명령으로** 해석된다.
 *
 * W0 스파이크가 이걸 놓쳤다: BOARD 를 줄 단위로 보내고 `7,7` 을 받아 「통과」로
 * 적었는데, 7,7 은 15×15 의 정중앙이다 — 빈 판에서 엔진이 두는 자리 그대로였다.
 * 국면이 전달됐다는 증거가 아니라 전달되지 **않았다**는 증거였던 셈이다.
 */
const sendCommand = (lines: readonly string[]) => {
  if (lines.length) mod?.sendCommand(lines.join("\n"));
};

/** 명령 여러 개를 순서대로. 각각이 자기만의 `sendCommand` 호출이 된다. */
const sendAll = (cmds: readonly EngineCommand[]) => {
  for (const c of cmds) sendCommand(serialize(c, coord));
};

async function boot(msg: Extract<ToWorker, { type: "boot" }>) {
  const t0 = performance.now();
  sliceMs = msg.sliceMs;
  coord = new CoordMapper(msg.size);
  agg = new SearchAggregator(msg.size);

  const factory = loadFactory(msg.engineBaseUrl, msg.variant);
  mod = await factory({
    locateFile: (p: string) => msg.engineBaseUrl + p,
    onReceiveStdout: drain,
    onReceiveStderr: drain,
    onExit: (code: number) => post({ type: "exit", code }),
  });
  if (typeof mod.sendCommand !== "function") {
    throw new Error("Module.sendCommand 가 없습니다 — preamble.js 가 빠진 빌드입니다");
  }

  // 기동 직후 상세 모드로 바꾼다. 이걸 안 보내면 INFO PV/DEPTH/EVAL/WINRATE 가
  // 한 줄도 오지 않고 분석 UI 가 통째로 빈다(데스크톱도 init_engine 에서 같은 짝을 보낸다).
  sendAll([
    { kind: "showDetail", level: 3 },
    { kind: "yxshowinfo" },
    { kind: "start", size: msg.size },
    { kind: "about" },
  ]);

  // ABOUT 응답이 위 drain 을 지나 콘솔에 들어가 있다. 버전만 뽑아 올린다.
  const about =
    consoleBuffer
      .map((l) => parse(l, coord))
      .find((r): r is Extract<typeof r, { kind: "about" }> => r.kind === "about")?.fields ?? {};

  post({
    type: "booted",
    version: msg.variant,
    bootMs: Math.round(performance.now() - t0),
    about,
  });
  flushConsole();
}

/** 이벤트 루프에 한 번 양보한다 — 이 틈에만 `stop` 이 도착할 수 있다. */
const yieldToLoop = () => new Promise<void>((r) => setTimeout(r, 0));

async function search(msg: Extract<ToWorker, { type: "search" }>) {
  if (!mod) return;
  searching = true;
  stopRequested = false;
  agg.reset();
  const t0 = performance.now();

  // 국면은 **한 번만** 세운다. 데스크톱도 분석마다 `yxboard` 를 한 번 보내고
  // START 는 세션 내내 보내지 않는다 — START 는 엔진을 리셋한다
  // (EngineRepositoryImpl.analyze 의 주석이 그 이유를 적어 두었다).
  sendAll(msg.setup);

  // sliceMs = 0 은 「분할하지 않는다」 — 멀티스레드 변형이 살아난 뒤의 설정이다.
  if (sliceMs <= 0) {
    sendAll(msg.repeat);
    searching = false;
    maybeEmitSnapshot(true);
    post({ type: "searchDone", reason: "finished", elapsedMs: Math.round(performance.now() - t0) });
    return;
  }

  let reason: "finished" | "stopped" | "timeout" = "timeout";
  while (!stopRequested) {
    const left = msg.totalMs - (performance.now() - t0);
    if (left <= 0) break;
    // 조각 하나: 이만큼만 생각하고 돌아온다. 해시 테이블이 남아 있으므로 다음
    // 조각은 이어서 깊어진다 — 매번 처음부터 다시 세는 것이 아니다.
    sendCommand([`INFO timeout_turn ${Math.min(sliceMs, Math.ceil(left))}`]);
    sendAll(msg.repeat);
    maybeEmitSnapshot(true);
    await yieldToLoop(); // ← 정지 요청이 들어올 수 있는 유일한 지점
  }
  if (stopRequested) reason = "stopped";

  // 조각 사이에는 엔진이 놀고 있으므로 여기서 YXSTOP 은 무해하다.
  // 앱도 분석 흐름을 닫을 때 같은 것을 보낸다(awaitClose).
  sendAll([{ kind: "stop" }]);

  searching = false;
  maybeEmitSnapshot(true);
  flushConsole();
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
        sendAll(msg.commands);
        maybeEmitSnapshot(true);
        break;
      case "search":
        await search(msg);
        break;
      case "stop":
        stopRequested = true;
        // 탐색 중이 아닐 때만 닿는다. 탐색 중이면 조각 경계에서 위 루프가 본다.
        if (!searching) sendAll([{ kind: "stop" }]);
        break;
      case "shutdown":
        try {
          sendAll([{ kind: "end" }]);
        } catch {
          // END 는 정상 종료라 ExitStatus 를 던진다. 오류가 아니다.
        }
        break;
    }
  } catch (e) {
    post({ type: "fatal", message: describe(e) });
  }
};
