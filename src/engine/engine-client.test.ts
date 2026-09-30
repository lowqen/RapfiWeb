import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EngineClient,
  RELAXED_SIMD_PROBE,
  detectCapabilities,
  planVariants,
  weightsSpec,
  type BootInfo,
} from "./engine-client";
import manifest from "./engine-manifest.json";
import type { FromWorker, ToWorker } from "./engine-types";

/**
 * 멀티 → 단일 폴백 — 가짜 Worker 로 클라이언트의 기동 순서만 본다.
 *
 * 가짜 워커는 기동 메시지의 변형을 보고, 멀티면 `failMulti` 에 따라 `fatal`(핸드셰이크
 * 실패)을, 아니면 `booted` 를 돌려준다. 띄운 워커와 종료된 워커를 모두 적어 둔다.
 */
const spawned: FakeWorker[] = [];
let failMulti: "fatal" | "error" | false = "fatal";
/** relaxed 변형을 예열에서 실패시킨다(구현 정의 명령이 이 기기에서 이상한 경우). */
let failRelaxed = false;

class FakeWorker {
  url: string;
  boot: Extract<ToWorker, { type: "boot" }> | null = null;
  onmessage: ((ev: { data: FromWorker }) => void) | null = null;
  onerror:
    | ((ev: {
        message: string;
        filename?: string;
        lineno?: number;
        colno?: number;
        type?: string;
      }) => void)
    | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  variant = "";
  constructor(url: URL | string) {
    this.url = String(url);
    spawned.push(this);
  }
  postMessage(m: ToWorker) {
    if (m.type !== "boot") return;
    this.variant = m.variant;
    this.boot = m;
    setTimeout(() => {
      if (m.variant.endsWith("-relaxed") && failRelaxed) {
        this.onmessage?.({
          data: { type: "fatal", message: "멀티스레드 엔진이 예열 탐색에 답하지 않습니다" },
        });
      } else if (m.variant.startsWith("multi") && failMulti === "fatal") {
        this.onmessage?.({
          data: {
            type: "fatal",
            message: "multi-simd128 기동 핸드셰이크(START): 15000ms 안에 답이 없습니다",
          },
        });
      } else if (m.variant.startsWith("multi") && failMulti === "error") {
        this.onerror?.({ message: "SharedArrayBuffer is not defined" });
      } else {
        this.onmessage?.({
          data: {
            type: "booted",
            version: m.variant,
            bootMs: 1,
            about: {},
            threaded: m.variant.startsWith("multi"),
            maxThreads: 256,
            weights: { source: "cache", ms: 3 },
            warmupMs: m.warmupMs ?? null,
          },
        });
      }
    }, 5);
  }
  terminate() {
    this.terminated = true;
  }
}

afterEach(() => {
  spawned.length = 0;
  failRelaxed = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** relaxed SIMD 를 아는 브라우저인 척 — 노드 20 의 V8 은 플래그 없이 relaxed 를 모른다. */
function pretendRelaxed() {
  const real = WebAssembly.validate.bind(WebAssembly);
  vi.spyOn(WebAssembly, "validate").mockImplementation((b) =>
    b === RELAXED_SIMD_PROBE ? true : real(b),
  );
}

function client() {
  const booted: BootInfo[] = [];
  const consoleLines: string[] = [];
  const statuses: string[] = [];
  const c = new EngineClient({
    onBooted: (b) => booted.push(b),
    onConsole: (l) => consoleLines.push(...l),
    onStatus: (s) => statuses.push(s),
  });
  return { c, booted, consoleLines, statuses };
}

describe("엔진 기동 — 멀티 우선, 실패하면 단일로", () => {
  it("멀티 핸드셰이크가 실패하면 그 워커를 버리고 단일로 뜬다 — 까닭을 남긴다", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", FakeWorker);
    failMulti = "fatal";
    const { c, booted, consoleLines, statuses } = client();
    await c.start(true);
    expect(spawned.map((w) => w.variant)).toEqual(["multi-simd128", "single-simd128"]);
    expect(spawned[0]!.terminated).toBe(true); // 실패한 멀티 워커(와 그 엔진 스레드)는 내린다
    expect(c.runningVariant).toBe("single-simd128");
    expect(booted[0]).toMatchObject({ variant: "single-simd128", threaded: false });
    expect(booted[0]!.fallbackReason).toContain("핸드셰이크");
    expect(consoleLines.join("\n")).toContain("물러섭니다");
    // 물러서는 동안 「오류」를 거치지 않는다 — 사용자에게는 기동이 조금 길 뿐이다.
    expect(statuses).not.toContain("error");
    expect(statuses.at(-1)).toBe("ready");
  });

  it("워커 오류(SAB 없음 등)도 같은 폴백을 탄다", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", FakeWorker);
    failMulti = "error";
    const { c, booted } = client();
    await c.start(true);
    expect(c.runningVariant).toBe("single-simd128");
    expect(booted[0]!.fallbackReason).toContain("SharedArrayBuffer");
  });

  it("멀티가 뜨면 그대로 쓴다", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", FakeWorker);
    failMulti = false;
    const { c, booted } = client();
    await c.start(true);
    expect(spawned).toHaveLength(1);
    expect(booted[0]).toMatchObject({
      variant: "multi-simd128",
      threaded: true,
      fallbackReason: null,
    });
  });

  it("멀티를 끄면(설정) 환경이 되어도 처음부터 단일", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", FakeWorker);
    failMulti = false;
    const { c } = client();
    await c.start(false);
    expect(spawned.map((w) => w.variant)).toEqual(["single-simd128"]);
  });

  it("격리가 없으면 멀티를 시도하지도 않는다", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    vi.stubGlobal("Worker", FakeWorker);
    const { c } = client();
    await c.start(true);
    expect(spawned.map((w) => w.variant)).toEqual(["single-simd128"]);
  });

  it("떠 있던 멀티 엔진이 멈추면(fatal) 단일로 다시 띄우고 recovered 로 알린다", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", FakeWorker);
    failMulti = false;
    const { c, booted, statuses } = client();
    await c.start(true);
    expect(c.runningVariant).toBe("multi-simd128");
    // 기동 뒤 멀티 워커가 입력 경합으로 멈췄다.
    spawned[0]!.onmessage?.({
      data: { type: "fatal", message: "멀티스레드 엔진이 탐색 명령에 답하지 않습니다(입력 경합)" },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(spawned[0]!.terminated).toBe(true);
    expect(spawned[1]!.variant).toBe("single-simd128");
    expect(c.runningVariant).toBe("single-simd128");
    expect(booted.at(-1)).toMatchObject({ variant: "single-simd128", recovered: true });
    expect(booted.at(-1)!.fallbackReason).toContain("입력 경합");
    expect(statuses).not.toContain("error");
  });

  it("동시에 두 번 불러도 워커는 한 벌이다", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", FakeWorker);
    failMulti = false;
    const { c } = client();
    await Promise.all([c.start(true), c.start(true)]);
    expect(spawned).toHaveLength(1);
  });
});

describe("relaxed SIMD — 최우선, 안 되면 같은 스레드 방식의 일반 SIMD 로", () => {
  it("변형 순서: relaxed 멀티 → 멀티 → relaxed 단일 → 단일, SIMD 가 없으면 없다", () => {
    expect(planVariants({ simd: true, relaxed: true, threads: true })).toEqual([
      "multi-simd128-relaxed",
      "multi-simd128",
      "single-simd128-relaxed",
      "single-simd128",
    ]);
    expect(planVariants({ simd: true, relaxed: false, threads: true })).toEqual([
      "multi-simd128",
      "single-simd128",
    ]);
    expect(planVariants({ simd: true, relaxed: true, threads: false })).toEqual([
      "single-simd128-relaxed",
      "single-simd128",
    ]);
    expect(planVariants({ simd: false, relaxed: true, threads: true })).toEqual([]);
  });

  it("프로브는 relaxed 를 모르는 엔진(노드 20)에서 거짓 — 그러면 예전 순서 그대로", () => {
    vi.stubGlobal("crossOriginIsolated", true);
    const caps = detectCapabilities();
    expect(caps.simd).toBe(true);
    expect(caps.relaxedSimd).toBe(false);
    expect(caps.variants).toEqual(["multi-simd128", "single-simd128"]);
  });

  it("relaxed 를 알면 relaxed 멀티를 **제 번들**로 먼저 띄운다", async () => {
    pretendRelaxed();
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", FakeWorker);
    failMulti = false;
    const { c, booted } = client();
    expect(c.capabilities.variant).toBe("multi-simd128-relaxed");
    await c.start(true);
    expect(c.runningVariant).toBe("multi-simd128-relaxed");
    // 엔진 스레드가 relaxed 글루를 읽으려면 relaxed 진입점 번들이어야 한다.
    expect(spawned[0]!.url).toContain("engine-worker-relaxed");
    expect(booted[0]).toMatchObject({ variant: "multi-simd128-relaxed", threaded: true });
  });

  it("relaxed 가 예열에서 실패하면 스레드를 버리지 않고 일반 멀티로 물러선다", async () => {
    pretendRelaxed();
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", FakeWorker);
    failMulti = false;
    failRelaxed = true;
    const { c, booted, statuses } = client();
    await c.start(true);
    expect(spawned.map((w) => w.variant)).toEqual(["multi-simd128-relaxed", "multi-simd128"]);
    expect(spawned[0]!.terminated).toBe(true);
    expect(spawned[1]!.url).not.toContain("engine-worker-relaxed");
    expect(c.runningVariant).toBe("multi-simd128");
    expect(booted[0]!.fallbackReason).toContain("multi-simd128-relaxed");
    expect(statuses).not.toContain("error");
  });

  it("격리가 없으면 relaxed 단일 → 실패 시 일반 단일", async () => {
    pretendRelaxed();
    vi.stubGlobal("crossOriginIsolated", false);
    vi.stubGlobal("Worker", FakeWorker);
    failRelaxed = true;
    const { c } = client();
    await c.start(true);
    expect(spawned.map((w) => w.variant)).toEqual(["single-simd128-relaxed", "single-simd128"]);
    expect(c.runningVariant).toBe("single-simd128");
  });

  it("떠 있던 relaxed 멀티가 멈추면 relaxed 단일로 다시 띄운다", async () => {
    pretendRelaxed();
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("Worker", FakeWorker);
    failMulti = false;
    const { c, booted } = client();
    await c.start(true);
    spawned[0]!.onmessage?.({ data: { type: "fatal", message: "입력 경합" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(c.runningVariant).toBe("single-simd128-relaxed");
    expect(booted.at(-1)).toMatchObject({ recovered: true, variant: "single-simd128-relaxed" });
  });

  it("?relaxed=0 이면 relaxed 를 빼고 시작한다(진단)", () => {
    pretendRelaxed();
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("location", { href: "http://localhost/?relaxed=0", search: "?relaxed=0" });
    const caps = detectCapabilities();
    expect(caps.relaxedSimd).toBe(true);
    expect(caps.variants).toEqual(["multi-simd128", "single-simd128"]);
  });
});

describe("기동 메시지 — 공유 가중치와 예열", () => {
  it("가중치 하나를 버전 주소로 넘기고, 예열 시간을 싣는다", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("location", { href: "https://rapfi.example/board", search: "" });
    const { c, booted } = client();
    await c.start(true);
    const boot = spawned[0]!.boot!;
    expect(boot.warmupMs).toBeGreaterThan(0);
    expect(boot.weights).toEqual({
      url: `https://rapfi.example/engine/rapfi.data?v=${manifest.data.sha256.slice(0, 16)}`,
      size: manifest.data.size,
      sha256: manifest.data.sha256,
    });
    expect(booted[0]).toMatchObject({ weights: { source: "cache" }, warmupMs: boot.warmupMs });
  });

  it("매니페스트는 64자리 SHA-256 과 크기를 갖는다 — 변형마다 다른 파일을 두지 않는다", () => {
    expect(manifest.data.file).toBe("rapfi.data");
    expect(manifest.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.data.size).toBeGreaterThan(1_000_000);
    const spec = weightsSpec("/engine/", "http://x/")!;
    expect(spec.url).toBe(`http://x/engine/rapfi.data?v=${manifest.data.sha256.slice(0, 16)}`);
  });
});
