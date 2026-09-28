import { DEFAULT_SIZE } from "../core/model/move";
import type { Move } from "../core/model/move";
import {
  EMPTY_SNAPSHOT,
  fromSerializable,
  type AnalysisSnapshot,
  type EngineCommand,
  type EngineStatus,
  type FromWorker,
  type Placement,
  type ToWorker,
} from "./engine-types";

/**
 * 메인 스레드에서 엔진을 다루는 유일한 창구.
 *
 * 화면은 이 클래스만 본다 — 워커도 Emscripten 도 프로토콜 문자열도 모른다.
 * 그래야 W0c 에서 멀티스레드가 살아났을 때 바뀌는 곳이 여기 하나가 된다.
 */

// ── 브라우저가 이 엔진을 돌릴 수 있는가 ──────────────────────────────
//
// **WASM SIMD 가 하한선이다.** 비SIMD 변형은 이 엔진 커밋에서 빌드되지 않는다 —
// `eval/mix10nnue.cpp:256` 의 `static_assert(InstType != SCALAR)` 가 스칼라 백엔드를
// 거부하고 그 파일은 CORE_SOURCES 에 무조건 들어간다. 하향할 변형이 없으므로
// SIMD 가 없으면 안내 화면으로 끝낸다.

/**
 * SIMD 프로브.
 *
 * 처음 쓴 바이트열은 함수 타입을 `() -> v128` 로 선언해 놓고 본문에서 `drop` 해
 * 검증에 실패했다 — 헤드리스 Chromium 이 `simd:false` 를 보고하는데 엔진은 그
 * 자리에서 `WASM_SIMD` 로 잘 돌아 한동안 헤맸다. 타입은 `() -> ()` 여야 한다.
 */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 9, 1, 7, 0, 65, 0, 253, 15, 26,
  11,
]);

export interface Capabilities {
  simd: boolean;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number | null;
  /** 고를 변형. `null` 이면 이 브라우저에서는 엔진을 돌릴 수 없다. */
  variant: "single-simd128" | "multi-simd128" | null;
  note: string | null;
}

export function detectCapabilities(): Capabilities {
  let simd = false;
  try {
    simd = WebAssembly.validate(SIMD_PROBE);
  } catch {
    simd = false;
  }
  const isolated = typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false;
  return {
    simd,
    crossOriginIsolated: isolated,
    hardwareConcurrency:
      typeof navigator === "undefined" ? null : (navigator.hardwareConcurrency ?? null),
    // 멀티 변형은 브라우저 워커에서 동작을 확인하지 못했다(W0-1). 살아나면(W0c)
    // 여기서 isolated 를 보고 고르게 된다. 그때까지는 단일 스레드가 유일한 경로다.
    variant: simd ? "single-simd128" : null,
    note: simd
      ? null
      : "이 브라우저는 WebAssembly SIMD 를 지원하지 않아 엔진을 실행할 수 없습니다. " +
        "Chrome/Edge 91+, Firefox 89+, Safari 16.4+ 가 필요합니다.",
  };
}

// ── 클라이언트 ───────────────────────────────────────────────────────

export interface EngineEvents {
  onStatus?: (s: EngineStatus) => void;
  onSnapshot?: (s: AnalysisSnapshot) => void;
  onConsole?: (lines: readonly string[]) => void;
  onBestMove?: (moves: readonly Move[]) => void;
  onForbid?: (cells: readonly Move[]) => void;
  onError?: (message: string) => void;
  /** 오프닝 협상 응답. 대국 상태 기계가 받는다(W4). */
  onOpening?: (r: OpeningResponse) => void;
}

export interface EngineOptions extends EngineEvents {
  engineBaseUrl?: string;
  sliceMs?: number;
  size?: number;
}

/** 협상 응답 세 갈래만 골라 낸 것 — 화면과 상태 기계가 이 타입으로 받는다. */
export type OpeningResponse = Extract<FromWorker, { type: "opening" }>["response"];

const env = import.meta.env;

export class EngineClient {
  private worker: Worker | null = null;
  private status: EngineStatus = "idle";
  private snapshot: AnalysisSnapshot = EMPTY_SNAPSHOT;
  private readyResolvers: (() => void)[] = [];

  readonly capabilities: Capabilities = detectCapabilities();
  readonly engineBaseUrl: string;
  readonly sliceMs: number;
  readonly size: number;

  constructor(private readonly events: EngineOptions = {}) {
    this.engineBaseUrl = events.engineBaseUrl ?? env.VITE_ENGINE_BASE_URL ?? "/engine/";
    this.sliceMs = events.sliceMs ?? Number(env.VITE_ENGINE_SLICE_MS ?? 500);
    this.size = events.size ?? DEFAULT_SIZE;
  }

  get currentStatus(): EngineStatus {
    return this.status;
  }
  get lastSnapshot(): AnalysisSnapshot {
    return this.snapshot;
  }

  private setStatus(s: EngineStatus) {
    if (this.status === s) return;
    this.status = s;
    this.events.onStatus?.(s);
    if (s === "ready") {
      const rs = this.readyResolvers;
      this.readyResolvers = [];
      for (const r of rs) r();
    }
  }

  /** 엔진을 띄운다. 돌릴 변형이 없으면(SIMD 미지원) 그 사실을 던진다. */
  async start(): Promise<void> {
    const variant = this.capabilities.variant;
    if (!variant) throw new Error(this.capabilities.note ?? "엔진을 실행할 수 없습니다");
    if (this.worker) return this.whenReady();

    this.setStatus("starting");
    // **클래식 워커다.** 이유는 vite.config.ts 의 worker.format 주석에 있다 —
    // upstream 글루를 읽는 유일한 방법인 importScripts 가 모듈 워커에는 없다.
    const worker = new Worker(new URL("./engine-worker.ts", import.meta.url), {
      type: "classic",
      name: "rapfi-engine",
    });
    this.worker = worker;

    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      switch (m.type) {
        case "booted":
          this.setStatus("ready");
          break;
        case "snapshot":
          this.snapshot = fromSerializable(m.snapshot);
          this.events.onSnapshot?.(this.snapshot);
          break;
        case "console":
          this.events.onConsole?.(m.lines);
          break;
        case "bestMove":
          this.events.onBestMove?.(m.moves);
          break;
        case "opening":
          this.events.onOpening?.(m.response);
          break;
        case "forbid":
          this.events.onForbid?.(m.cells);
          break;
        case "searchDone":
          this.setStatus("ready");
          break;
        case "exit":
          this.setStatus("idle");
          break;
        case "fatal":
          this.events.onError?.(m.message);
          this.setStatus("error");
          break;
      }
    };
    // `String(e)` 로 뭉개면 화면에 «[object Object]» 가 뜬다 — 실제로 그렇게 나와서
    // 한 런을 통째로 헤맸다. 워커 오류 이벤트가 들고 있는 것을 전부 풀어 적는다.
    worker.onerror = (e) => {
      const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : "";
      const what = e.message || e.type || "알 수 없는 워커 오류";
      this.events.onError?.(`워커 오류: ${what}${where}`);
      this.setStatus("error");
    };
    worker.onmessageerror = () => {
      this.events.onError?.("워커 메시지를 복제하지 못했습니다(구조화 복제 실패)");
      this.setStatus("error");
    };

    this.post({
      type: "boot",
      engineBaseUrl: this.engineBaseUrl,
      variant,
      sliceMs: this.sliceMs,
      size: this.size,
    });
    return this.whenReady();
  }

  whenReady(timeoutMs = 60_000): Promise<void> {
    if (this.status === "ready") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`엔진이 ${timeoutMs}ms 안에 기동하지 않았습니다`)),
        timeoutMs,
      );
      this.readyResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  send(...commands: EngineCommand[]): void {
    if (commands.length) this.post({ type: "send", commands });
  }

  /**
   * 국면을 세우고 **분석**한다(수를 두지는 않는다).
   *
   * `YXBOARD` 는 Rapfi 확장이라 착수 없이 분석 국면만 세운다. 그 뒤 `YXNBEST` 로
   * 상위 후보 여러 개를 요청한다 — 보드의 값 칩이 그 결과다.
   */
  analyze(stones: readonly Placement[], opts: { totalMs?: number; nbest?: number } = {}): void {
    this.setStatus("searching");
    this.post({
      type: "search",
      // 국면은 한 번, 탐색은 조각마다.
      setup: [{ kind: "yxboard", stones }],
      repeat: [{ kind: "yxnbest", n: opts.nbest ?? 5 }],
      totalMs: opts.totalMs ?? 5000,
    });
  }

  /**
   * 대국의 한 수를 둔다 — 분석이 아니라 **착수**다.
   *
   * 빈 판이면 `BEGIN`, 아니면 `BOARD …/DONE` 이다. gomocup 에서는 둘 다 그 자체로
   * 「두어라」라는 뜻이고 엔진이 좌표 한 줄로 답한다. 조각으로 나누지 않는 이유는
   * 워커 주석에 있다 — 한 수는 시계가 정하는 유한한 일이다.
   */
  play(
    stones: readonly Placement[],
    emptyBoard: boolean,
    opts: { turnMs?: number; matchMs?: number; matchLeftMs?: number } = {},
  ): void {
    this.setStatus("searching");
    const msg: Extract<ToWorker, { type: "move" }> = {
      type: "move",
      commands: emptyBoard ? [{ kind: "begin" }] : [{ kind: "board", stones }],
      turnMs: opts.turnMs ?? 5000,
      matchMs: opts.matchMs ?? 0,
    };
    // exactOptionalPropertyTypes: 값이 없으면 키 자체가 없어야 한다.
    if (opts.matchLeftMs !== undefined) msg.matchLeftMs = opts.matchLeftMs;
    this.post(msg);
  }

  /**
   * 정지. **조각 경계에서 멈춘다** — 단일 스레드 빌드에서 그것이 가능한 가장
   * 빠른 시점이다(최대 한 조각 = 기본 500ms).
   */
  stop(): void {
    this.post({ type: "stop" });
  }

  /**
   * 세션 종료. 앱의 순서를 지킨다: `YXSTOP` → `YXSAVEDATABASE` → EOF.
   * yixindb 는 메모리에 있고 명령이나 종료 때만 쓰이므로, 그냥 죽이면 그 세션이
   * 배운 것이 전부 사라진다.
   */
  async shutdown(graceMs = 3000): Promise<void> {
    if (!this.worker) return;
    this.post({ type: "stop" });
    this.post({ type: "send", commands: [{ kind: "raw", line: "YXSAVEDATABASE" }] });
    this.post({ type: "shutdown" });
    await new Promise((r) => setTimeout(r, graceMs));
    this.terminate();
  }

  /**
   * 최후 수단. 해시 테이블과 DB 를 잃으므로 정상 정지에는 쓰지 않는다.
   * 다만 조각 경계에서도 반응하지 않을 때는 이것뿐이다 — 재기동은 수백 ms 다.
   */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.snapshot = EMPTY_SNAPSHOT;
    this.setStatus("idle");
  }

  private post(m: ToWorker) {
    this.worker?.postMessage(m);
  }
}
