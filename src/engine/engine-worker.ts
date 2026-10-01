/// <reference lib="webworker" />
import { CoordMapper, parse, serialize } from "./engine-protocol";
import { SearchAggregator } from "./engine-aggregator";
import {
  toSerializable,
  type EngineCommand,
  type FromWorker,
  type Placement,
  type SearchEndReason,
  type ToWorker,
} from "./engine-types";
import { loadWeights } from "./weights-cache";
import type { Move } from "../core/model/move";

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
 * ## 멀티스레드 변형에서는 반대다 (W0c, `docs/W0c-결과.md`)
 *
 * 엔진이 자기 pthread 에서 돌고 `sendCommand` 는 **즉시** 돌아온다. 답은 엔진
 * 스레드가 이 워커로 되돌려 보내는 줄로 **비동기로** 온다. 그래서 멀티 변형은
 * 조각으로 나누지 않고 탐색 하나를 통째로 보낸 뒤,
 *   - 끝은 **좌표 줄**로 판정하고(요약 줄 `MESSAGE Speed …` 은 빠지기도 한다),
 *   - 정지는 `YXSTOP` 을 곧바로 보낸다(실측 1~9ms 에 닿는다),
 *   - 탐색이 도는 동안에는 `YXSTOP` 말고는 아무것도 보내지 않는다 — 요청 줄이
 *     앞 탐색의 좌표를 받은 뒤에야 다음 명령을 낸다(아래 `searchThreaded`).
 *
 * 어느 변형인지는 기동 때 정해지고(`threaded`) 탐색 경로만 가른다. 명령 직렬화·
 * 파싱·집계는 두 변형이 같은 길을 쓴다.
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
  /**
   * file_packager 의 훅 — 버퍼를 돌려주면 글루가 `.data` 를 내려받지 않고 그것을 쓴다.
   * **동기**이고 `ArrayBuffer`(SharedArrayBuffer 아님)여야 한다(글루가 생성자 이름을 본다).
   */
  getPreloadedPackage?: (name: string, size: number) => ArrayBuffer | null;
}
type ModuleFactory = (opts: Partial<EmscriptenModule>) => Promise<EmscriptenModule>;

const post = (m: FromWorker) => self.postMessage(m);

// ── pthread 가드 ─────────────────────────────────────────────────────
//
// 멀티 변형의 글루는 엔진 스레드마다 워커를 **자기 주소로** 연다:
//
//     ba && (_scriptName = self.location.href)          // 워커 안이면 = 이 번들의 주소
//     new Worker(_scriptName, { name: "em-pthread" })
//
// importScripts 로 읽힌 글루에게 self.location 은 **이 워커 번들**이다. 그래서 엔진
// 스레드마다 이 파일이 다시 열린다. 그때 호스트 코드(onmessage 등)를 걸면 글루의
// 부트스트랩(`isPthread && Rapfi()`)이 가로막혀 엔진이 영원히 무응답이 된다 — W0 에서
// 워커 구성이 실패한 원인이다(W0c 에서 확정). 이 판의 글루에는 주소를 바꿀
// `mainScriptUrlOrBlob` 가 없다.
//
// 해법: 이름이 em-pthread 면 **글루만 읽고 비킨다.** 글루 끝이 스레드를 세우고 제
// onmessage 를 건다. 이 파일의 나머지는 선언뿐이고 부작용(onmessage)은 맨 아래에서
// `IS_PTHREAD` 로 막는다.
//
// 글루 주소는 빌드 때 정해진 엔진 기본 경로로 만든다 — 엔진 스레드에게는 기동
// 메시지가 오지 않으므로 그것밖에 알 길이 없다. 클라이언트가 같은 기본값을 쓴다
// (`engine-client.ts`). 다른 경로로 띄우면 여기서 글루를 못 찾고, 기동 핸드셰이크가
// 시간을 넘겨 클라이언트가 단일 변형으로 물러선다.

/** 엔진 스레드로 열렸는가. */
export const IS_PTHREAD =
  typeof self !== "undefined" && (self as unknown as { name?: string }).name === "em-pthread";

/**
 * 이 번들의 엔진 스레드가 읽을 멀티 변형. **번들마다 정해진다** — 엔진 스레드에게는 기동
 * 메시지가 오지 않고, 워커 주소도 바꿀 수 없으므로(`new Worker(new URL(…))` 는 빌드 때
 * 고정된다) 알 길이 이것뿐이다. relaxed 멀티는 제 진입점(`engine-worker-relaxed.ts`)을
 * 따로 두어 이 값을 먼저 심고 이 파일을 불러온다 — 그 번들의 엔진 스레드는 그 번들을
 * 다시 열므로 relaxed 글루를 읽는다.
 */
export function pthreadVariant(): string {
  return (
    (globalThis as { __RAPFI_PTHREAD_VARIANT__?: string }).__RAPFI_PTHREAD_VARIANT__ ??
    "multi-simd128"
  );
}

/** 멀티 변형 글루의 주소 — 엔진 스레드가 읽는다. */
export function pthreadGlueUrl(): string {
  const base = import.meta.env?.VITE_ENGINE_BASE_URL ?? "/engine/";
  return new URL(`${base}rapfi-${pthreadVariant()}.js`, self.location.href).href;
}

if (IS_PTHREAD) importScripts(pthreadGlueUrl());

/**
 * 이 웹앱은 **렌주 전용**이다. `.data` 에 렌주 가중치만 구워져 있고
 * (Cloudflare 의 파일당 25MB 상한 — 4종 전부면 40.3MB), 화면도 그렇게 안내한다.
 *
 * 4 는 엔진이 정한 id 다(`command/gomocup.cpp` 의 RULE 처리).
 */
const RENJU_RULE_ID = 4 as const;

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
/** 지금 엔진이 찍는 좌표가 착수 요청의 답인가(동기 착수 동안만 참). */
let forwardMoves = false;
/** 분할 탐색에서 가장 최근 조각이 고른 수. 무제한 착수가 끝에 이걸 둔다. */
let sliceMoves: readonly Move[] | null = null;

/** 엔진이 제 pthread 에서 도는가(멀티 변형). 기동 때 정해진다. */
let threaded = false;

/**
 * 예열 탐색 중인가. 이때의 줄은 콘솔에만 남기고 **집계·스냅샷·좌표는 올리지 않는다** —
 * 올리면 사용자가 두지도 않은 예열 국면의 수순이 보드와 평가 바에 뜬다.
 */
let warming = false;

/**
 * 멀티 변형에서 엔진이 **탐색 중**인가 — 탐색 명령을 보낸 뒤부터 좌표 줄이 올
 * 때까지. 이 사이에 `YXSTOP` 말고 다른 명령이 나가면 엔진의 프로토콜 스레드가
 * 탐색과 경합한다. 설계상 일어나지 않지만(요청 줄) 일어나면 콘솔에 남긴다.
 */
let engineBusy = false;

/** 멀티 변형: 엔진이 정지에 이만큼 안에 좌표로 답하지 않으면 고장으로 본다(실측 1~9ms). */
const STOP_GRACE_MS = 5_000;
/** 멀티 변형: 기동 핸드셰이크(START → OK) 한도. 넘기면 클라이언트가 단일로 물러선다. */
const HANDSHAKE_MS = 15_000;
/**
 * 무제한 탐색의 `timeout_turn`. Rapfi 에게 「시간 무제한」은 따로 없으므로 사실상
 * 끝나지 않는 값을 준다(약 11.5일 — 32비트 정수 안). 끝은 정지나 새 요청이 정한다.
 */
const UNLIMITED_TURN_MS = 1_000_000_000;

/**
 * **좌표 뒤 정착 대기(ms) — 멀티 변형의 동시성 사고를 막는 핵심.**
 *
 * 엔진은 좌표 줄을 찍은 **뒤에도** 탐색 스레드가 잠깐 표준입력을 계속 읽는다
 * (탐색 중 `YXSTOP` 감시). 그 틈에 다음 명령을 보내면 두 스레드가 입력을 나눠 먹는다:
 * `INFO THREAD_NUM 2` 가 `ERROR Unknown command: THREAD_NUM` · `… : 2` 로 토막 나고,
 * 다음 `YXNBEST` 가 통째로 사라져 **엔진이 영원히 무응답**이 된다(YXSTOP 도 안 듣는다).
 *
 * 실측(로컬 2코어, 워커+pthread 가드와 페이지 둘 다): 좌표 직후 곧바로 보내면 첫 몇
 * 번 안에 엔진이 죽는다. 5ms 만 기다려도 120회 연속 0건. 여기서는 그 10배를 둔다 —
 * 사람이 느낄 수 없고, 느린 기기의 여유가 된다.
 */
const SETTLE_MS = 50;
/** 마지막 좌표 줄(탐색의 끝)이 온 때. 멀티 변형은 여기서 `SETTLE_MS` 가 지나야 다음 명령을 낸다. */
let lastMoveAt = -Infinity;
/** 마지막으로 엔진 줄을 받은 때 — 탐색 명령이 삼켜졌는지 보는 데 쓴다. */
let lastLineAt = 0;
/**
 * 탐색 명령을 보낸 뒤 이만큼 **한 줄도** 오지 않으면 명령이 엔진 입력에서 사라진 것으로
 * 본다. 정상 탐색은 수 ms 안에 `INFO PV`·`MESSAGE Depth` 를 낸다(캡처).
 */
const FIRST_LINE_MS = 5_000;

/** 좌표 뒤 정착 대기. 이미 지났으면 곧바로. 멀티 변형에서만 기다린다. */
async function quiet(): Promise<void> {
  if (!threaded) return;
  const left = lastMoveAt + SETTLE_MS - performance.now();
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

/**
 * 탐색 명령 뒤 첫 줄 감시 — `FIRST_LINE_MS` 동안 한 줄도 없으면 풀린다. 탐색이 끝나면
 * (`cancel`) 조용히 멈춘다.
 */
function firstLineWatch(since: number): { silent: Promise<"silent">; cancel: () => void } {
  let id: ReturnType<typeof setInterval> | null = null;
  const silent = new Promise<"silent">((resolve) => {
    id = setInterval(() => {
      if (lastLineAt > since) {
        if (id !== null) clearInterval(id);
        return;
      }
      if (performance.now() - since > FIRST_LINE_MS) {
        if (id !== null) clearInterval(id);
        resolve("silent");
      }
    }, 250);
  });
  return { silent, cancel: () => id !== null && clearInterval(id) };
}

/** 다음 좌표 줄(탐색의 끝)을 기다리는 쪽. */
let moveWaiter: ((moves: readonly Move[]) => void) | null = null;
const nextMove = () =>
  new Promise<readonly Move[]>((resolve) => {
    moveWaiter = resolve;
  });

/** 특정 줄을 기다리는 쪽들 — 기동 핸드셰이크가 쓴다. */
const lineWaiters: { re: RegExp; resolve: (line: string) => void }[] = [];
function waitLine(re: RegExp, ms: number, what: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = { re, resolve };
    lineWaiters.push(w);
    setTimeout(() => {
      const i = lineWaiters.indexOf(w);
      if (i >= 0) {
        lineWaiters.splice(i, 1);
        reject(new Error(`${what}: ${ms}ms 안에 답이 없습니다`));
      }
    }, ms);
  });
}

/** 정지·새 요청을 기다리는 쪽. `interrupt()` 가 깨운다. */
let stopWaiter: (() => void) | null = null;
const stopSignal = () =>
  new Promise<void>((resolve) => {
    if (stopRequested) resolve();
    else stopWaiter = resolve;
  });

/** 이만큼만 기다리고, 넘기면 null. */
const settle = <T>(p: Promise<T | null>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** 기다림에 한도를 둔다. 넘기면 던진다 — 멀티 엔진이 멈춘 것이다. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${what}: ${ms}ms 안에 답이 없습니다`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/** 스냅샷은 ~10Hz 로만 올린다. 그보다 잦으면 메인이 그리는 것보다 받는 게 많아진다. */
const SNAPSHOT_MS = 100;

/** 분석 조각의 하한. 엔진이 30ms 를 통신 여유로 떼므로 그보다 넉넉해야 한다. */
const MIN_SLICE_MS = 100;

/**
 * 이보다 빨리 끝난 조각은 「즉답」이다 — 엔진이 탐색 없이 뻔한 수를 돌려준 것.
 * 정상 조각은 예산(≈470ms)의 상당 부분을 쓰고, 외통을 찾아 일찍 끝나도 수십~수백
 * ms 다(실측 183ms). 즉답은 1ms 안팎이다.
 */
const TRIVIAL_SLICE_MS = 20;
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

/**
 * 한 번에 넘기는 콘솔 줄의 상한. 메인 스토어의 링버퍼(5000)와 같게 둔다.
 *
 * 예전엔 500 이었다. 그런데 분석 조각 하나(500ms, YXNBEST 5)가 REALTIME 줄만으로
 * 500 을 넘겨서, 조각 **머리에 있는** 보낸 명령(`> YXNBEST 5`)이 매번 잘려 나갔다
 * — 엔진이 무엇을 받았는지 보려고 단 에코가 정작 분석에서는 보이지 않았다.
 * 조각 사이에 이벤트 루프로 돌아올 때만 비워지므로 조각 하나를 통째로 담아야 한다.
 */
const CONSOLE_BATCH_MAX = 5000;

function pushConsole(line: string) {
  consoleBuffer.push(line);
  if (consoleBuffer.length > CONSOLE_BATCH_MAX) {
    consoleBuffer = consoleBuffer.slice(-CONSOLE_BATCH_MAX);
  }
  if (consoleTimer === null) consoleTimer = setTimeout(flushConsole, CONSOLE_BATCH_MS);
}

function maybeEmitSnapshot(force = false) {
  if (!snapshotDirty && !force) return;
  const now = Date.now();
  if (!force && now - lastSnapshotAt < SNAPSHOT_MS) return;
  lastSnapshotAt = now;
  snapshotDirty = false;
  post({ type: "snapshot", id: currentSearchId, snapshot: toSerializable(agg.snapshot()) });
}

/** 지금(또는 마지막으로) 집계기를 쓰는 탐색 요청의 번호. 스냅샷에 붙는다. */
let currentSearchId = 0;

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
    lastLineAt = performance.now();
    for (const w of lineWaiters.slice()) {
      if (w.re.test(line)) {
        lineWaiters.splice(lineWaiters.indexOf(w), 1);
        w.resolve(line);
      }
    }
    const r = parse(line, coord);
    if (!warming && agg.consume(r)) snapshotDirty = true;
    if (r.kind === "bestMove") {
      // 좌표 한 줄은 **착수 요청의 답일 때만** 대국에 올린다. 분석의 조각도
      // 끝날 때마다 좌표를 찍는데(YXNBEST), 그걸 올리면 마침 엔진 차례인 대국이
      // 분석 조각의 수를 엔진의 착수로 받아 둔다. 예열의 좌표는 어디에도 올리지 않는다.
      if (!warming) {
        sliceMoves = r.moves;
        if (forwardMoves) post({ type: "bestMove", moves: r.moves });
      }
      // 멀티 변형: 좌표 줄이 곧 탐색의 끝이다. 다음 명령은 정착 대기 뒤(`quiet`).
      engineBusy = false;
      lastMoveAt = performance.now();
      const w = moveWaiter;
      moveWaiter = null;
      w?.(r.moves);
    } else if (warming) {
      // 예열 중의 나머지 줄은 콘솔에만.
    } else if (r.kind === "forbid") post({ type: "forbid", cells: r.cells });
    else if (r.kind === "openingMove" || r.kind === "openingSwap" || r.kind === "soosorvFifth") {
      post({ type: "opening", response: r });
    }
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
 * upstream 규약을 그대로 둬야 하고, 20MB 짜리 `.data` 를 번들에 넣을 일도 없다.
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
  if (!lines.length) return;
  // 보낸 것도 콘솔에 남긴다(`> ` 머리). 엔진이 `MaxTime 0ms` 처럼 이상하게
  // 굴 때 **무엇을 받았는지** 보이지 않으면 원인을 가를 수 없다. 여러 줄
  // 블록(BOARD 등)은 머리 줄과 줄 수만 적는다 — 돌 좌표로 콘솔을 덮지 않게.
  pushConsole(`> ${lines[0]}${lines.length > 1 ? ` …(+${lines.length - 1}줄)` : ""}`);
  if (engineBusy && lines[0] !== "YXSTOP") {
    // 설계상 오지 않는 자리다(요청 줄이 앞 탐색의 끝을 기다린다). 오면 흔적을 남긴다.
    pushConsole(`! 탐색 중에 보낸 명령: ${lines[0]}`);
  }
  mod?.sendCommand(lines.join("\n"));
};

/** 멀티 변형: 탐색을 거는 명령. 좌표 줄이 올 때까지 엔진은 바쁘다. */
const sendSearch = (cmds: readonly EngineCommand[]) => {
  sendAll(cmds);
  if (threaded) engineBusy = true;
};

/** 명령 여러 개를 순서대로. 각각이 자기만의 `sendCommand` 호출이 된다. */
const sendAll = (cmds: readonly EngineCommand[]) => {
  for (const c of cmds) sendCommand(serialize(c, coord));
};

async function boot(msg: Extract<ToWorker, { type: "boot" }>) {
  const t0 = performance.now();
  threaded = msg.variant.startsWith("multi");
  // 멀티 변형은 조각으로 나누지 않는다 — 정지가 탐색 도중에 닿는다.
  sliceMs = threaded ? 0 : msg.sliceMs;
  coord = new CoordMapper(msg.size);
  agg = new SearchAggregator(msg.size);

  // **가중치 선적재.** 공유 가중치가 있으면 글루를 읽기 **전에** 받기 시작한다 — 20MB
  // 내려받기(또는 캐시 읽기·해시 검증)가 글루 파싱과 겹친다. 글루는 인스턴스를 만들 때
  // 이 버퍼를 `getPreloadedPackage` 로 받아 내려받기를 건너뛴다.
  const weightsP = msg.weights ? loadWeights(msg.weights) : null;
  weightsP?.catch(() => undefined); // 아래에서 기다린다 — 그 전에 거부돼도 처리되지 않은 거부로 새지 않게
  const factory = loadFactory(msg.engineBaseUrl, msg.variant);
  let weights: Extract<FromWorker, { type: "booted" }>["weights"] = { source: "glue", ms: 0 };
  let preloaded: ArrayBuffer | null = null;
  if (weightsP && msg.weights) {
    const w = await weightsP;
    for (const n of w.notes) pushConsole(`! ${n}`);
    const how = w.source === "cache" ? "캐시에서" : "네트워크에서";
    pushConsole(
      `· 가중치 ${how} ${(w.buffer.byteLength / 2 ** 20).toFixed(1)}MB · ${w.ms}ms · SHA-256 확인`,
    );
    weights = { source: w.source, ms: w.ms };
    preloaded = w.buffer;
  }
  const shared = msg.weights?.url;
  const opts: Partial<EmscriptenModule> = {
    // 공유 가중치를 쓰면 `.data` 요청은 어느 변형이든 그 한 파일로 간다(훅이 먼저 답하므로
    // 실제로는 요청이 나가지 않는다 — 훅이 없는 글루를 위한 안전망).
    locateFile: (p: string) => (shared && p.endsWith(".data") ? shared : msg.engineBaseUrl + p),
    onReceiveStdout: drain,
    onReceiveStderr: drain,
    onExit: (code: number) => post({ type: "exit", code }),
  };
  if (preloaded) {
    opts.getPreloadedPackage = () => {
      // 한 번만 넘긴다 — 글루가 MEMFS 에 붙들고, 워커는 참조를 놓는다.
      const b = preloaded;
      preloaded = null;
      return b;
    };
  }
  mod = await factory(opts);
  if (typeof mod.sendCommand !== "function") {
    throw new Error("Module.sendCommand 가 없습니다 — preamble.js 가 빠진 빌드입니다");
  }

  // 답을 기다릴 자리를 **보내기 전에** 건다. 단일 변형은 답이 sendCommand 안에서
  // 동기로 와 버리고, 멀티 변형은 엔진 스레드에서 나중에 온다 — 둘 다 이 순서면 잡힌다.
  // START 의 OK 가 핸드셰이크다: 멀티 엔진이 떠 있지 않으면(pthread 를 못 세웠다 등)
  // 여기서 시간이 넘고, 클라이언트가 단일 변형으로 물러선다.
  const hs = msg.handshakeMs ?? HANDSHAKE_MS;
  const ok = waitLine(/^OK$/, hs, `${msg.variant} 기동 핸드셰이크(START)`);
  const aboutLine = waitLine(/version\s*=/i, HANDSHAKE_MS, "ABOUT").catch(() => null);
  const maxLine = waitLine(/MAX_THREAD_NUM/, HANDSHAKE_MS, "yxshowinfo").catch(() => null);

  // 기동 직후 상세 모드로 바꾼다. 이걸 안 보내면 INFO PV/DEPTH/EVAL/WINRATE 가
  // 한 줄도 오지 않고 분석 UI 가 통째로 빈다(데스크톱도 init_engine 에서 같은 짝을 보낸다).
  sendAll([
    { kind: "showDetail", level: 3 },
    { kind: "yxshowinfo" },
    // **규칙을 START 보다 먼저.** 이 빌드의 `.data` 에는 렌주 가중치만 구워져 있어서
    // (Cloudflare 25MB 상한 — `tools/build_engine_wasm.sh` [2.5/6] 참고), 기본 규칙인
    // 프리스타일로 START 하면 없는 가중치를 찾게 된다.
    // 보드가 생기기 전에 보내야 규칙 변경이 newGame()/TT 비우기를 유발하지 않는다.
    { kind: "rule", id: RENJU_RULE_ID },
    { kind: "start", size: msg.size },
    { kind: "about" },
  ]);

  await ok;
  // ABOUT·MAX_THREAD_NUM 은 있으면 좋은 정보다 — OK 뒤에는 잠깐만 기다린다.
  const aboutRaw = await settle(aboutLine, 2_000);
  const aboutParsed = aboutRaw === null ? null : parse(aboutRaw, coord);
  const about = aboutParsed?.kind === "about" ? aboutParsed.fields : {};
  // `MESSAGE INFO MAX_THREAD_NUM 256` — 단일 빌드도 256 이라고 답하므로(실측) 능력의
  // 신호로는 쓰지 않고 상한으로만 쓴다.
  const maxRaw = await settle(maxLine, 500);
  const maxThreads = maxRaw === null ? null : Number(/(\d+)\s*$/.exec(maxRaw)?.[1] ?? NaN);

  // 기동 설정 — **예열 전에.** 스레드 수가 바뀌면 엔진이 스레드를 전부 다시 세우며
  // 평가기(가중치)를 버린다(`SearchEngine::setNumThreads`). 예열 뒤에 보내면 예열이 푼
  // 가중치가 버려지고 첫 사용자 탐색이 다시 푼다 — 확정된 스레드·해시에서 한 번만 데운다.
  // 아직 탐색 전이라 멀티 변형의 입력 경합(좌표 뒤 정착 대기)도 없다.
  if (msg.settings?.length) sendAll(msg.settings);

  // 예열 — 「떴다」를 알리기 **전에** 돈다. 첫 탐색이 치르던 가중치 풀기(0.4~0.9초)와
  // JIT 승격 전 구간(첫 탐색 10~26% 느림, docs/gomocalc-엔진-비교.md §4.2)을 여기서
  // 치르고, 이 변형이 **실제로 탐색하는지**까지 확인한다 — 여기서 던지면 클라이언트가 다음
  // 변형으로 물러선다(relaxed 가 이 기기에서 이상하면 일반 SIMD 로).
  const warmupMs = msg.warmupMs && msg.warmupMs > 0 ? await warmup(msg.warmupMs) : null;

  post({
    type: "booted",
    version: msg.variant,
    bootMs: Math.round(performance.now() - t0),
    about,
    threaded,
    maxThreads: maxThreads !== null && Number.isFinite(maxThreads) ? maxThreads : null,
    weights,
    warmupMs,
  });
  flushConsole();
}

/**
 * 예열 국면 — 3수 직접 개시(흑 h8 · 백 h9 · 흑 i9, 백 차례). 빈 판은 엔진이 탐색 없이
 * 천원을 두므로(즉답) 가중치도 JIT 도 데우지 못한다.
 */
const WARMUP_STONES: readonly Placement[] = [
  { move: { x: 7, y: 7 }, own: false },
  { move: { x: 7, y: 6 }, own: true },
  { move: { x: 8, y: 6 }, own: false },
];
/** 예열의 상한 — 가중치 풀기가 느린 기기를 위해 예산에 더해 기다리는 몫. */
const WARMUP_GRACE_MS = 20_000;

/**
 * 짧은 탐색 하나. 결과는 버린다(`warming` — 집계·스냅샷·좌표를 올리지 않는다). 끝나면
 * 해시를 비워 예열의 흔적이 사용자의 첫 탐색에 섞이지 않게 한다. 걸린 시간을 돌려준다.
 */
async function warmup(budgetMs: number): Promise<number> {
  const t = performance.now();
  const turn = Math.max(MIN_SLICE_MS, Math.round(budgetMs));
  pushConsole(`· 예열 탐색 ${turn}ms — 가중치 풀기와 JIT 승격을 첫 요청 앞으로 당긴다`);
  warming = true;
  try {
    sendCommand(["INFO timeout_match 0"]);
    sendCommand([`INFO timeout_turn ${turn}`]);
    sendAll([{ kind: "yxboard", stones: WARMUP_STONES }]);
    if (!threaded) {
      sendAll([{ kind: "yxnbest", n: 1 }]); // 단일 변형: 이 호출 안에서 끝난다
    } else {
      const done = nextMove();
      const since = performance.now();
      sendSearch([{ kind: "yxnbest", n: 1 }]);
      const watch = firstLineWatch(since);
      const first = await Promise.race([
        done.then(() => "done" as const),
        watch.silent,
        new Promise<"late">((r) => setTimeout(() => r("late"), turn + WARMUP_GRACE_MS)),
      ]);
      watch.cancel();
      if (first === "silent") {
        throw new Error("멀티스레드 엔진이 예열 탐색에 답하지 않습니다(입력 경합)");
      }
      if (first === "late") {
        sendAll([{ kind: "stop" }]);
        await within(done, STOP_GRACE_MS, "멀티스레드 엔진이 예열 정지에 답하지 않습니다");
      }
      await quiet(); // 좌표 뒤 정착 대기 — 다음 명령(해시 비우기)이 입력 경합에 휘말리지 않게
    }
    sendAll([{ kind: "raw", line: "YXHASHCLEAR" }]);
  } finally {
    warming = false;
    agg.reset();
    sliceMoves = null;
  }
  const ms = Math.round(performance.now() - t);
  pushConsole(`· 예열 끝 — ${ms}ms`);
  return ms;
}

/** 이벤트 루프에 한 번 양보한다 — 이 틈에만 `stop` 이 도착할 수 있다. */
const yieldToLoop = () => new Promise<void>((r) => setTimeout(r, 0));

/** 잠깐 쉰다. 즉답만 돌아오는 분석이 코어 하나를 헛돌리지 않게. */
let wakeIdle: (() => void) | null = null;
const sleep = (ms: number) =>
  new Promise<void>((r) => {
    const id = setTimeout(() => {
      wakeIdle = null;
      r();
    }, ms);
    wakeIdle = () => {
      clearTimeout(id);
      r();
    };
  });

/**
 * 즉답 분석의 쉼 — 처음 100ms 에서 두 배씩, 1초에서 멈춘다. 쉬는 동안 정지나 새
 * 요청이 오면 `interrupt()` 가 곧바로 깨운다(`wakeIdle`).
 */
const IDLE_MIN_MS = 100;
const IDLE_MAX_MS = 1000;

async function search(msg: Extract<ToWorker, { type: "search" }>, epoch: number) {
  if (!mod) return;
  searching = true;
  // 줄 뒤에서 기다리는 동안 정지가 왔다면 그 정지는 **이 요청의 것**이다. 예전엔
  // 여기서 무조건 false 로 되돌려, 기동·앞 요청을 기다리던 중에 누른 정지가
  // 조용히 사라졌다.
  stopRequested = epoch !== stopEpoch || pending > 0;
  currentSearchId = msg.id;
  agg.reset();
  sliceMoves = null;
  const t0 = performance.now();

  // 분석인데 시작도 하기 전에 멈추라고 했다 — 한 조각도 돌리지 않는다.
  // (착수는 다르다: 한 조각은 돌아야 둘 수가 있다. 아래 `first`.)
  if (stopRequested && msg.mode === "analyze") {
    finishSearch(msg, "stopped", t0);
    return;
  }

  // **대국 예산을 물려받지 않는다.** 앞선 시간제 대국이 `timeout_match` 를 걸어
  // 두었다면 Rapfi 는 탐색마다 쓴 시간을 `time_left` 에서 빼는데(gomocup.cpp:134),
  // 조각마다 그러면 금세 0 이 되어 `OptiTime 0ms | MaxTime 0ms` · `Depth 0-0` 이
  // 된다 — 사용자가 분석에서 본 그대로다. 무제한으로 되돌리고 조각이 시간을 정한다.
  sendCommand(["INFO timeout_match 0"]);

  if (threaded) {
    const reason = await searchThreaded(msg);
    finishSearch(msg, reason, t0);
    return;
  }

  // sliceMs = 0 은 「분할하지 않는다」(단일 변형에서 조각을 끄는 설정 — 정지는 탐색이
  // 끝나야 닿는다).
  if (sliceMs <= 0) {
    sendAll(msg.setup);
    sendAll(msg.repeat);
    finishSearch(msg, "finished", t0);
    return;
  }

  let reason: SearchEndReason = "timeout";
  let idleMs = 0;
  // 착수는 최소 한 조각은 돈다 — 한 조각도 없으면 둘 수가 없다.
  let first = true;
  for (;;) {
    if (pending > 0) stopRequested = true; // 뒤에 선 요청에 자리를 내준다
    if (stopRequested && !first) break;
    first = false;
    const left = msg.totalMs - (performance.now() - t0);
    // 자투리 조각은 보내지 않는다. `Math.ceil(left)` 가 몇 ms 이면 엔진의 예산이
    // `timeout_turn − 30ms(예약)` ≤ 0 이 되어 Depth 0 탐색을 한 번 더 할 뿐이다.
    if (left < MIN_SLICE_MS) break;
    // 조각 하나: 이만큼만 생각하고 돌아온다. 해시 테이블이 남아 있으므로 다음
    // 조각은 이어서 깊어진다 — 매번 처음부터 다시 세는 것이 아니다.
    sendCommand([`INFO timeout_turn ${Math.round(Math.min(sliceMs, left))}`]);
    // **국면도 조각마다 다시 세운다** — YXNBEST 가 끝에 최선수를 엔진 판에 두므로,
    // 안 그러면 조각마다 한 수씩 앞선 국면을 분석한다(메시지 타입의 주석 참고).
    agg.beginSlice();
    sendAll(msg.setup);
    const s0 = performance.now();
    sendAll(msg.repeat); // 단일 스레드 빌드에서 탐색은 이 호출 안에서 끝난다
    const took = performance.now() - s0;
    maybeEmitSnapshot(true);
    if (took < TRIVIAL_SLICE_MS) {
      // **즉답** — 5목을 완성하는 수·막아야만 하는 수처럼 뻔한 국면에서 Rapfi 는
      // 탐색 없이 곧바로 좌표(`7,8`)를 돌려준다(tryTrivialBestmove).
      //
      // 착수면 그 수를 바로 둔다. 조각을 계속 돌리면 초당 수백 번 같은 답을 받으며
      // 헛돈다 — 무제한 착수가 「지금 두기」까지 엔진과 콘솔을 그렇게 덮었다.
      if (msg.mode === "move") {
        reason = "finished";
        break;
      }
      // **분석은 끝내지 않는다.** 예전엔 착수와 같이 여기서 `finished` 로 빠져
      // YXSTOP 을 보냈다 — 무제한 분석이 좌표 한 줄에 스스로 멈춘 버그다. 분석의
      // 끝은 사용자(정지)나 새 국면(새 요청)만 정한다. 다만 같은 답을 초당 수백 번
      // 받지 않도록 쉬어 가며 되묻는다.
      idleMs = Math.min(IDLE_MAX_MS, idleMs ? idleMs * 2 : IDLE_MIN_MS);
      await sleep(idleMs); // ← 이 틈에도 정지가 들어온다
      continue;
    }
    idleMs = 0;
    await yieldToLoop(); // ← 정지 요청이 들어올 수 있는 지점
  }
  if (stopRequested) reason = "stopped";

  // 조각 사이에는 엔진이 놀고 있으므로 여기서 YXSTOP 은 무해하다.
  // 앱도 분석 흐름을 닫을 때 같은 것을 보낸다(awaitClose).
  sendAll([{ kind: "stop" }]);
  finishSearch(msg, reason, t0);
}

/**
 * 멀티 변형의 탐색 하나 — 조각 없이 통째로.
 *
 * 먼저 오는 쪽이 끝을 정한다:
 *   - **좌표 줄** → 엔진이 스스로 끝냈다(예산 소진·증명·즉답).
 *   - **정지/새 요청** → `YXSTOP` 을 보내고 그 탐색의 좌표 줄을 기다린다. 좌표가 오기
 *     전에는 다음 명령을 내지 않는다 — 엔진의 프로토콜 스레드가 탐색과 경합하지 않게.
 *
 * 무제한 분석이 스스로 끝나면(증명 완료·즉답) 그 결과는 확정이므로 되묻지 않고
 * **정지나 새 국면까지 그대로 둔다** — 단일 변형이 즉답에 쉬어 가며 기다리는 것과
 * 같은 뜻이다. 분석의 끝은 사용자나 새 국면이 정한다.
 */
async function searchThreaded(
  msg: Extract<ToWorker, { type: "search" }>,
): Promise<SearchEndReason> {
  const unlimited = !Number.isFinite(msg.totalMs);
  const budget = unlimited ? UNLIMITED_TURN_MS : Math.max(MIN_SLICE_MS, Math.round(msg.totalMs));
  sendCommand([`INFO timeout_turn ${budget}`]);
  agg.beginSlice();
  sendAll(msg.setup);
  const done = nextMove();
  const since = performance.now();
  sendSearch(msg.repeat);
  const watch = firstLineWatch(since);

  const first = await Promise.race([
    done.then(() => "done" as const),
    stopSignal().then(() => "stop" as const),
    watch.silent,
  ]);
  watch.cancel();
  if (first === "silent") {
    // 탐색 명령이 엔진 입력에서 사라졌다 — 정착 대기가 막아야 할 사고다. 이 엔진은
    // 믿을 수 없으므로 올려 보내고, 클라이언트가 단일 스레드 엔진으로 다시 띄운다.
    throw new Error("멀티스레드 엔진이 탐색 명령에 답하지 않습니다(입력 경합)");
  }
  if (first === "stop") {
    if (engineBusy) {
      sendAll([{ kind: "stop" }]);
      await within(done, STOP_GRACE_MS, "멀티스레드 엔진이 정지(YXSTOP)에 좌표로 답하지 않습니다");
    }
    return "stopped";
  }
  maybeEmitSnapshot(true);
  if (msg.mode === "analyze" && unlimited) {
    await stopSignal();
    return "stopped";
  }
  return msg.mode === "analyze" ? "timeout" : "finished";
}

function finishSearch(
  msg: Extract<ToWorker, { type: "search" }>,
  reason: SearchEndReason,
  t0: number,
) {
  searching = false;
  maybeEmitSnapshot(true);
  flushConsole();
  // 무제한 대국의 한 수: 마지막 조각이 고른 수가 착수다. 분석의 조각별 좌표는
  // 어디에도 올리지 않는다 — 올리면 대국이 그것을 엔진의 수로 받아 둔다.
  if (msg.mode === "move" && sliceMoves) post({ type: "bestMove", moves: sliceMoves });
  post({
    type: "searchDone",
    id: msg.id,
    mode: msg.mode,
    reason,
    elapsedMs: Math.round(performance.now() - t0),
  });
}

/**
 * 워커의 일은 **한 줄로 세운다.**
 *
 * 엔진 쪽 펌프는 `sendCommand` 한 번에 `runProtocol` 한 번 — 명령 하나를 읽는다.
 * 이 짝이 한 번이라도 어긋나면 그 뒤의 **모든** 명령이 한 칸씩 밀려 읽힌다.
 * 그런데 분석(`search`)은 조각 사이에 이벤트 루프로 양보하는 비동기 루프라,
 * 예전에는 그 틈에 착수(`move`)가 끼어들어 명령이 섞였다. 결과: 착수가 자기
 * `timeout_turn` 이 아니라 분석 조각의 값으로 돌았고, 그 뒤의 수들도 계속 그랬다.
 * 마지막 조각이 몇 ms 이면 `OptiTime 0ms | MaxTime 0ms` · `Depth 0-0` 으로 구석에
 * 던지는 수가 된다 — 사용자가 본 그대로다(CI 스모크 「분석 도중 착수」로 재현).
 *
 * 그래서: 모든 요청은 앞 요청이 끝난 뒤에 돈다. 돌고 있는 분석은 새 요청이
 * 오면 **다음 조각 경계에서 멈추고** 자리를 내준다. `stop` 만은 줄을 서지 않는다 —
 * 줄 뒤에서 기다리는 정지는 정지가 아니다.
 */
let queue: Promise<void> = Promise.resolve();

/**
 * 정지 요청의 차례 번호. 요청은 줄에 설 때 이 값을 적어 두고, 제 차례가 와서
 * 시작할 때 값이 달라져 있으면 「기다리는 동안 정지가 왔다」로 읽는다.
 */
let stopEpoch = 0;

/**
 * 줄에서 기다리는 요청 수. 제 차례가 온 무제한 분석도 **뒤에 누가 서 있으면**
 * 한 조각 뒤 비켜야 한다 — `interrupt()` 는 이미 돌고 있는 탐색만 깨우므로, 줄 안의
 * 분석이 시작하며 정지 표시를 지우면 뒤에 선 착수가 영원히 기다린다.
 */
let pending = 0;

/**
 * 정지·새 요청을 알린다. 즉답 분석이 쉬는 중이면 깨우고, 멀티 변형의 탐색이 기다리는
 * 정지 신호를 울린다(그쪽이 `YXSTOP` 을 보낸다 — 여기서 직접 보내지 않는 것은, 탐색을
 * 거는 명령과 정지가 엇갈려 **아무도 멈추지 않는 탐색**이 남지 않게 하기 위해서다).
 */
function interrupt() {
  stopRequested = true;
  const w = wakeIdle;
  wakeIdle = null;
  w?.();
  const s = stopWaiter;
  stopWaiter = null;
  s?.();
}

/** 명시적 정지(「정지」·「지금 두기」·무르기) 알림 — 시간제 착수는 이것만 끊는다. */
let explicitStopWaiter: (() => void) | null = null;

if (!IS_PTHREAD) {
  self.onmessage = (ev: MessageEvent<ToWorker>) => {
    const msg = ev.data;
    if (msg.type === "stop") {
      stopEpoch++;
      interrupt();
      const e = explicitStopWaiter;
      explicitStopWaiter = null;
      e?.();
      // 탐색 중이 아닐 때만 곧바로 닿는다. 탐색 중이면 조각 경계(단일) 또는
      // 탐색 루프(멀티)가 본다. 멀티는 놀 때 멈출 것이 없고, 줄 밖에서 보내면 좌표 뒤
      // 정착 대기를 건너뛰어 입력 경합을 부를 수 있으므로 보내지 않는다.
      if (!searching && !threaded) sendAll([{ kind: "stop" }]);
      return;
    }
    // 분석이 돌고 있으면 비켜 달라고 한다 — 착수·새 대국·국면 변경이 기다린다.
    if (msg.type !== "boot" && searching) interrupt();
    const epoch = stopEpoch;
    pending++;
    queue = queue.then(() => {
      pending--;
      return handle(msg, epoch);
    });
  };
}

async function handle(msg: ToWorker, epoch: number): Promise<void> {
  try {
    // 멀티 변형: 앞 탐색의 좌표 뒤 정착 대기를 **모든 요청 앞에서** 지킨다(`SETTLE_MS`).
    // 요청 줄이 하나라서 여기 한 곳이면 설정·금수 조회·다음 탐색이 다 덮인다.
    if (msg.type !== "boot") await quiet();
    switch (msg.type) {
      case "boot":
        await boot(msg);
        break;
      case "send":
        sendAll(msg.commands);
        maybeEmitSnapshot(true);
        break;
      case "search":
        await search(msg, epoch);
        break;
      case "move": {
        // 한 수는 **한 번의 유한한 탐색**이다. 조각으로 나누면 조각마다 새 탐색이 되어
        // 엔진이 매번 처음부터 생각한다.
        currentSearchId = msg.id;
        agg.reset();
        searching = true;
        const t0 = performance.now();
        // 시간 설정 셋을 **모두** 다시 세운다 — 앞 명령이 남긴 값에 기대지 않는다.
        sendCommand([`INFO timeout_turn ${Math.max(100, Math.round(msg.turnMs))}`]);
        sendCommand([`INFO timeout_match ${Math.max(0, Math.round(msg.matchMs))}`]);
        if (msg.matchLeftMs !== undefined) {
          sendCommand([`INFO time_left ${Math.max(0, Math.round(msg.matchLeftMs))}`]);
        }
        forwardMoves = true;
        try {
          if (!threaded) {
            sendAll(msg.commands); // 단일 변형: 탐색이 이 호출 안에서 끝나고 좌표가 올라간다
          } else {
            // 멀티 변형: 좌표는 나중에 온다. 명시적 정지(지금 두기·무르기)만 이것을
            // 끊는다 — 뒤에 선 요청은 시간제 착수를 기다린다(단일과 같다).
            const done = nextMove();
            const stop = new Promise<"stop">((r) => {
              explicitStopWaiter = () => r("stop");
            });
            const since = performance.now();
            sendSearch(msg.commands);
            const watch = firstLineWatch(since);
            const ceiling = Math.max(100, Math.round(msg.turnMs)) + STOP_GRACE_MS;
            const first = await Promise.race([
              done.then(() => "done" as const),
              stop,
              watch.silent,
              new Promise<"late">((r) => setTimeout(() => r("late"), ceiling)),
            ]);
            watch.cancel();
            explicitStopWaiter = null;
            if (first === "silent") {
              throw new Error("멀티스레드 엔진이 착수 명령에 답하지 않습니다(입력 경합)");
            }
            if (first !== "done" && engineBusy) {
              // 정지이거나, 예산을 넉넉히 넘겼다 — 멈춰 세우고 그때의 최선수를 받는다.
              sendAll([{ kind: "stop" }]);
              await within(done, STOP_GRACE_MS, "멀티스레드 엔진이 착수 정지에 답하지 않습니다");
            }
          }
        } finally {
          forwardMoves = false;
        }
        searching = false;
        maybeEmitSnapshot(true);
        flushConsole();
        post({
          type: "searchDone",
          id: msg.id,
          mode: "move",
          reason: "finished",
          elapsedMs: Math.round(performance.now() - t0),
        });
        break;
      }
      case "stop":
        // onmessage 가 줄 밖에서 처리한다 — 여기로 오지 않는다.
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
    // 탐색 도중에 던졌으면 `searching` 이 켜진 채로 남는다 — 그러면 뒤이은 모든
    // 요청이 「돌고 있는 분석」을 멈추려 들며 헛돈다.
    searching = false;
    engineBusy = false;
    forwardMoves = false;
    explicitStopWaiter = null;
    post({ type: "fatal", message: describe(e) });
  }
}
