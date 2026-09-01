import type { ToWorker, FromWorker } from "./messages";
import { serialize, type EngineCommand } from "./protocol";
import { detectCapabilities, type Capabilities } from "./capabilities";

/**
 * 메인 스레드에서 엔진을 다루는 유일한 창구.
 *
 * 화면은 이 클래스만 본다 — 워커도 Emscripten 도 모른다. 그래야 W0c 에서
 * 멀티스레드가 살아났을 때 바뀌는 곳이 여기 하나가 된다.
 *
 * **시간 분할은 여기와 워커에만 있다.** 조각 길이는 `VITE_ENGINE_SLICE_MS`
 * 하나이고, 0 이면 분할하지 않는다(계획서 §3).
 */
export interface EngineOptions {
  engineBaseUrl?: string;
  sliceMs?: number;
  onLines?: (lines: readonly string[]) => void;
  onStatus?: (status: EngineStatus) => void;
}

export type EngineStatus = "idle" | "starting" | "ready" | "searching" | "error";

const env = import.meta.env;

export class EngineClient {
  private worker: Worker | null = null;
  private status: EngineStatus = "idle";
  private readonly opts: Required<Omit<EngineOptions, "onLines" | "onStatus">> &
    Pick<EngineOptions, "onLines" | "onStatus">;

  readonly capabilities: Capabilities = detectCapabilities();

  constructor(opts: EngineOptions = {}) {
    this.opts = {
      engineBaseUrl: opts.engineBaseUrl ?? env.VITE_ENGINE_BASE_URL ?? "/engine/",
      sliceMs: opts.sliceMs ?? Number(env.VITE_ENGINE_SLICE_MS ?? 500),
      ...(opts.onLines ? { onLines: opts.onLines } : {}),
      ...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
    };
  }

  private setStatus(s: EngineStatus) {
    this.status = s;
    this.opts.onStatus?.(s);
  }

  /** 엔진을 띄운다. 변형이 없으면(SIMD 미지원) 그 사실을 던진다. */
  async start(): Promise<void> {
    const variant = this.capabilities.variant;
    if (!variant) throw new Error(this.capabilities.note ?? "엔진을 실행할 수 없습니다");
    if (this.worker) return;

    this.setStatus("starting");
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), {
      type: "module",
      name: "rapfi-engine",
    });
    this.worker = worker;

    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      switch (m.type) {
        case "booted":
          this.setStatus("ready");
          break;
        case "lines":
          this.opts.onLines?.(m.lines);
          break;
        case "searchDone":
          this.setStatus("ready");
          break;
        case "exit":
          this.setStatus("idle");
          break;
        case "fatal":
          console.error("[engine]", m.message);
          this.setStatus("error");
          break;
      }
    };

    this.post({
      type: "boot",
      engineBaseUrl: this.opts.engineBaseUrl,
      variant,
      sliceMs: this.opts.sliceMs,
    });
  }

  send(...cmds: EngineCommand[]): void {
    const lines = cmds.flatMap(serialize);
    if (lines.length) this.post({ type: "send", lines });
  }

  /** 시간 분할 탐색. `totalMs` 는 «최대 이만큼 생각한다». */
  search(cmd: EngineCommand, totalMs: number): void {
    this.setStatus("searching");
    this.post({ type: "search", lines: serialize(cmd), totalMs });
  }

  /**
   * 정지. **조각 경계에서 멈춘다** — 단일 스레드 빌드에서는 그것이 가능한
   * 가장 빠른 시점이다(최대 한 조각 = 기본 500ms).
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
    this.post({ type: "send", lines: ["YXSAVEDATABASE"] });
    this.post({ type: "shutdown" });
    await new Promise((r) => setTimeout(r, graceMs));
    this.terminate();
  }

  /** 최후 수단. 해시 테이블과 DB 를 잃는다 — 정상 정지에는 쓰지 않는다. */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.setStatus("idle");
  }

  get currentStatus(): EngineStatus {
    return this.status;
  }

  private post(m: ToWorker) {
    this.worker?.postMessage(m);
  }
}
