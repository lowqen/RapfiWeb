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
  type SearchEndReason,
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

export type EngineVariant = "single-simd128" | "multi-simd128";

export interface Capabilities {
  simd: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  hardwareConcurrency: number | null;
  /**
   * 이 환경에서 **먼저 시도할** 변형. `null` 이면 엔진을 돌릴 수 없다.
   * 멀티를 골라도 기동에 실패하면 클라이언트가 단일로 물러선다(`EngineClient.start`).
   */
  variant: EngineVariant | null;
  /** 멀티스레드 변형을 쓸 수 있는 환경인가. */
  threads: boolean;
  /** 멀티를 못 쓰는 까닭(화면이 그대로 말한다). 쓸 수 있으면 null. */
  threadsNote: string | null;
  note: string | null;
}

/**
 * 멀티 변형의 조건 — W0c 에서 잰 그대로다(`docs/W0c-결과.md`):
 *   - WebAssembly SIMD (두 변형 모두의 하한)
 *   - `crossOriginIsolated` — COOP/COEP 헤더가 붙어야 켜진다. 없으면 멀티 엔진은
 *     세 브라우저 모두 **무응답**이었다(대조군).
 *   - `SharedArrayBuffer` · `Atomics` — pthread 의 메모리와 깨우기
 *
 * `?engine=single|multi` 로 강제할 수 있다(진단용). 멀티를 강제해도 조건이 안 되면
 * 기동 핸드셰이크가 실패해 단일로 물러선다.
 */
export function detectCapabilities(): Capabilities {
  let simd = false;
  try {
    simd = WebAssembly.validate(SIMD_PROBE);
  } catch {
    simd = false;
  }
  const isolated = typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false;
  const sab = typeof SharedArrayBuffer === "function" && typeof Atomics === "object";
  const forced = forcedVariant();

  let threadsNote: string | null = null;
  if (!simd) threadsNote = "WebAssembly SIMD 가 없습니다";
  else if (forced === "single") threadsNote = "주소의 ?engine=single 로 단일 스레드를 골랐습니다";
  else if (!isolated) {
    threadsNote =
      "교차 출처 격리(COOP/COEP 헤더)가 꺼져 있어 멀티스레드를 쓸 수 없습니다 — " +
      "헤더를 붙일 수 없는 호스팅(GitHub Pages 등)이거나 개발 서버 설정이 빠졌습니다";
  } else if (!sab) threadsNote = "이 브라우저는 SharedArrayBuffer 를 허용하지 않습니다";
  const threads = threadsNote === null || (simd && forced === "multi");

  return {
    simd,
    crossOriginIsolated: isolated,
    sharedArrayBuffer: sab,
    hardwareConcurrency:
      typeof navigator === "undefined" ? null : (navigator.hardwareConcurrency ?? null),
    variant: !simd ? null : threads ? "multi-simd128" : "single-simd128",
    threads,
    threadsNote: threads ? null : threadsNote,
    note: simd
      ? null
      : "이 브라우저는 WebAssembly SIMD 를 지원하지 않아 엔진을 실행할 수 없습니다. " +
        "Chrome/Edge 91+, Firefox 89+, Safari 16.4+ 가 필요합니다.",
  };
}

function forcedVariant(): "single" | "multi" | null {
  try {
    const q =
      typeof location === "undefined" ? null : new URLSearchParams(location.search).get("engine");
    return q === "single" || q === "multi" ? q : null;
  } catch {
    return null;
  }
}

/** 기동이 끝나고 알게 된 것 — 실제로 뜬 변형과 그 까닭. */
export interface BootInfo {
  variant: EngineVariant;
  threaded: boolean;
  maxThreads: number | null;
  /** 멀티를 시도했다가 단일로 물러섰다면 그 까닭. */
  fallbackReason: string | null;
  /**
   * 떠 있던 멀티 엔진이 멈춰 **다시 띄운** 것인가. 참이면 엔진 스토어가 설정을 다시
   * 보내고 켜 둔 분석을 잇는다(처음 기동은 스토어의 `start` 가 그 일을 한다).
   */
  recovered: boolean;
}

// ── 클라이언트 ───────────────────────────────────────────────────────

export interface EngineEvents {
  onStatus?: (s: EngineStatus) => void;
  onSnapshot?: (s: AnalysisSnapshot) => void;
  onConsole?: (lines: readonly string[]) => void;
  onBestMove?: (moves: readonly Move[]) => void;
  onForbid?: (cells: readonly Move[]) => void;
  onError?: (message: string) => void;
  /**
   * **가장 최근** 요청의 탐색이 끝났다. 밀려난 탐색의 끝은 여기로 오지 않는다 —
   * 뒤이은 탐색이 이미 돌고 있기 때문이다.
   */
  onSearchDone?: (mode: "analyze" | "move", reason: SearchEndReason) => void;
  /** 오프닝 협상 응답. 대국 상태 기계가 받는다(W4). */
  onOpening?: (r: OpeningResponse) => void;
  /** 엔진이 떴다 — 어느 변형으로, 물러섰다면 왜. */
  onBooted?: (info: BootInfo) => void;
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
  /** 마지막으로 보낸 탐색 요청의 번호. `searchDone` 이 이것과 같을 때만 「대기」다. */
  private searchSeq = 0;

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

  /** 실제로 떠 있는 변형. 뜨기 전에는 null. */
  get runningVariant(): EngineVariant | null {
    return this.variant;
  }

  /**
   * 엔진을 띄운다. 돌릴 변형이 없으면(SIMD 미지원) 그 사실을 던진다.
   *
   * **멀티를 먼저 시도하고, 실패하면 단일로 물러선다.** 멀티의 실패는 대개 조용하다 —
   * pthread 를 세우지 못하면 명령에 영원히 답이 없다(W0). 그래서 워커가 기동
   * 핸드셰이크(START → OK)에 한도를 두고 넘기면 `fatal` 을 올리며, 여기서 그 워커를
   * 버리고 단일 변형으로 새로 띄운다. 사용자에게는 「기동 중」이 조금 길어질 뿐이다.
   *
   * `allowThreads` 가 거짓이면(설정 ▸ 멀티스레드 끔) 처음부터 단일로 띄운다.
   */
  async start(allowThreads = true): Promise<void> {
    const best = this.capabilities.variant;
    if (!best) throw new Error(this.capabilities.note ?? "엔진을 실행할 수 없습니다");
    if (this.booting) return this.booting;
    if (this.worker) return this.whenReady();

    const order: EngineVariant[] =
      best === "multi-simd128" && allowThreads
        ? ["multi-simd128", "single-simd128"]
        : ["single-simd128"];
    this.setStatus("starting");
    this.booting = (async () => {
      let fallbackReason: string | null = null;
      for (const variant of order) {
        try {
          const booted = await this.spawn(variant);
          this.variant = variant;
          this.setStatus("ready");
          this.events.onBooted?.({
            variant,
            threaded: booted.threaded,
            maxThreads: booted.maxThreads,
            fallbackReason,
            recovered: false,
          });
          return;
        } catch (e) {
          this.worker?.terminate();
          this.worker = null;
          const why = e instanceof Error ? e.message : String(e);
          if (variant === order.at(-1)) {
            this.events.onError?.(why);
            this.setStatus("error");
            throw e instanceof Error ? e : new Error(why);
          }
          // 다음 변형으로 — 이 사실은 콘솔과 화면에 남긴다(조용히 느려지면 원인을 모른다).
          fallbackReason = why;
          this.events.onConsole?.([`! ${variant} 기동 실패 — 단일 스레드로 물러섭니다: ${why}`]);
        }
      }
    })().finally(() => {
      this.booting = null;
    });
    return this.booting;
  }

  private variant: EngineVariant | null = null;
  private booting: Promise<void> | null = null;

  /**
   * 떠 있던 멀티 엔진이 멈췄을 때 — 그 워커(와 엔진 스레드들)를 버리고 단일 스레드
   * 엔진을 새로 띄운다. 사용자에게는 「기동 중」이 잠깐 보이고 분석이 이어진다
   * (엔진 스토어가 `recovered` 를 보고 잇는다). 해시와 도는 탐색은 잃는다.
   *
   * 대국에서 엔진이 제 수를 생각하던 중이었다면 그 수는 오지 않는다 — 대국 쪽 감시견
   * (시간제)이나 사용자의 무르기·지금 두기가 판을 푼다.
   */
  private async recoverToSingle(reason: string): Promise<void> {
    this.worker?.terminate();
    this.worker = null;
    this.variant = null;
    this.snapshot = EMPTY_SNAPSHOT;
    this.events.onConsole?.([`! 멀티스레드 엔진이 멈춰 단일 스레드로 다시 띄웁니다: ${reason}`]);
    this.setStatus("starting");
    try {
      const booted = await this.spawn("single-simd128");
      this.variant = "single-simd128";
      this.setStatus("ready");
      this.events.onBooted?.({
        variant: "single-simd128",
        threaded: booted.threaded,
        maxThreads: booted.maxThreads,
        fallbackReason: `멀티스레드 엔진이 동작 중 멈췄습니다 — ${reason}`,
        recovered: true,
      });
    } catch (e) {
      // `spawn` 이 새 워커를 this.worker 에 넣었다 — 위에서 null 로 좁혀진 타입을 푼다.
      (this.worker as Worker | null)?.terminate();
      this.worker = null;
      this.events.onError?.(e instanceof Error ? e.message : String(e));
      this.setStatus("error");
    }
  }

  /**
   * 워커 하나를 띄워 기동 결과를 기다린다. `booted` 면 풀리고, 기동 중의 `fatal`·워커
   * 오류·시간 초과면 거부한다(그러면 `start` 가 다음 변형을 시도한다).
   */
  private spawn(variant: EngineVariant): Promise<Extract<FromWorker, { type: "booted" }>> {
    // **클래식 워커다.** 이유는 vite.config.ts 의 worker.format 주석에 있다 —
    // upstream 글루를 읽는 유일한 방법인 importScripts 가 모듈 워커에는 없다.
    // 멀티 변형의 엔진 스레드도 **이 워커 번들을 다시 연다** — 거기서 글루만 읽고
    // 비키는 가드가 워커 머리에 있다(engine-worker.ts 「pthread 가드」).
    const worker = new Worker(new URL("./engine-worker.ts", import.meta.url), {
      type: "classic",
      name: "rapfi-engine",
    });
    this.worker = worker;

    let settle: {
      resolve: (b: Extract<FromWorker, { type: "booted" }>) => void;
      reject: (e: Error) => void;
    } | null = null;
    const booted = new Promise<Extract<FromWorker, { type: "booted" }>>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // 가중치(~20MB) 내려받기가 기동에 들어간다 — 느린 회선을 위해 넉넉히. 멀티가 조용히
    // 멈추는 경우는 워커의 핸드셰이크 한도(15초, 내려받기 **뒤**부터)가 먼저 잡는다.
    const timer = setTimeout(
      () => settle?.reject(new Error(`${variant} 엔진이 120초 안에 기동하지 않았습니다`)),
      120_000,
    );
    const failBoot = (why: string): boolean => {
      if (!settle) return false;
      clearTimeout(timer);
      settle.reject(new Error(why));
      settle = null;
      return true;
    };

    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      switch (m.type) {
        case "booted":
          clearTimeout(timer);
          settle?.resolve(m);
          settle = null;
          break;
        case "snapshot":
          // 밀려난 탐색이 마지막으로 올린 스냅샷은 **옛 국면**의 값이다. 받으면 보드의
          // 값 칩과 평가 바가 새 국면 위에서 옛 값을 말한다.
          if (m.id !== this.searchSeq) break;
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
          // 밀려난 탐색의 끝이면 무시한다. 새 요청이 이미 돌고 있는데 「대기」로
          // 바꾸면, 그 틈에 금수 조회(YXBOARD+YXSHOWFORBID)가 나가 도는 분석을
          // 끊는다 — 무제한 분석이 저절로 멈추던 경로 하나가 이것이었다.
          if (m.id !== this.searchSeq) break;
          this.setStatus("ready");
          this.events.onSearchDone?.(m.mode, m.reason);
          break;
        case "exit":
          if (failBoot(`${variant} 엔진이 기동 중에 종료했습니다 (${m.code})`)) break;
          this.setStatus("idle");
          break;
        case "fatal":
          // 기동 중의 오류는 `start` 가 받아 다음 변형을 시도한다.
          if (failBoot(m.message)) break;
          // 떠 있던 멀티 엔진이 멈췄다(입력 경합·정지 무응답 등) — 단일로 다시 띄운다.
          if (this.variant === "multi-simd128" && this.worker === worker) {
            void this.recoverToSingle(m.message);
            break;
          }
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
      if (failBoot(`워커 오류: ${what}${where}`)) return;
      this.events.onError?.(`워커 오류: ${what}${where}`);
      this.setStatus("error");
    };
    worker.onmessageerror = () => {
      if (failBoot("워커 메시지를 복제하지 못했습니다(구조화 복제 실패)")) return;
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
    return booted;
  }

  whenReady(timeoutMs = 60_000): Promise<void> {
    if (this.status === "ready") return Promise.resolve();
    if (this.booting) return this.booting;
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
      mode: "analyze",
      // 국면과 탐색을 조각마다 — YXNBEST 가 끝에 엔진 판에 수를 두기 때문이다.
      setup: [{ kind: "yxboard", stones }],
      repeat: [{ kind: "yxnbest", n: opts.nbest ?? 5 }],
      // 기본은 **무제한** — 분석은 정지나 새 국면이 올 때까지 읽는다(앱의 분석과
      // 같다). 예전 기본값 5초는 「무제한 분석」이 5초 뒤 저절로 멈추게 했다.
      totalMs: opts.totalMs ?? Infinity,
      id: ++this.searchSeq,
    });
  }

  /**
   * 대국의 한 수를 둔다 — 분석이 아니라 **착수**다.
   *
   * **시간 제한이 있으면** 빈 판은 `BEGIN`, 아니면 `BOARD …/DONE` 을 한 번에
   * 보낸다 — 엔진이 대국 예산 안에서 스스로 멈추고 좌표 한 줄로 답한다.
   *
   * **무제한이면**(`turnMs` 가 없거나 `Infinity`) 조각으로 나눠 **정지가 올 때까지**
   * 생각하고, 정지(「지금 두기」)가 오면 마지막 조각의 최선수를 둔다. 데스크톱·앱의
   * 기본 레벨(level 0)과 같은 동작이다. 조각으로 나누는 이유는 단일 스레드 빌드가
   * 탐색 도중에는 정지를 받을 수 없어서다.
   */
  play(
    stones: readonly Placement[],
    emptyBoard: boolean,
    opts: { turnMs?: number; matchMs?: number; matchLeftMs?: number } = {},
  ): void {
    this.setStatus("searching");
    const turnMs = opts.turnMs ?? Infinity;
    if (!Number.isFinite(turnMs)) {
      this.post({
        type: "search",
        mode: "move",
        setup: [{ kind: "yxboard", stones }],
        repeat: [{ kind: "yxnbest", n: 1 }],
        totalMs: Infinity,
        id: ++this.searchSeq,
      });
      return;
    }
    const msg: Extract<ToWorker, { type: "move" }> = {
      type: "move",
      commands: emptyBoard ? [{ kind: "begin" }] : [{ kind: "board", stones }],
      turnMs,
      matchMs: opts.matchMs ?? 0,
      id: ++this.searchSeq,
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
    // 멀티 변형이면 엔진 스레드(중첩 워커)도 이 워커와 함께 사라진다.
    this.worker?.terminate();
    this.worker = null;
    this.variant = null;
    this.snapshot = EMPTY_SNAPSHOT;
    this.setStatus("idle");
  }

  private post(m: ToWorker) {
    this.worker?.postMessage(m);
  }
}
