import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineClient, type BootInfo } from "./engine-client";
import type { FromWorker, ToWorker } from "./engine-types";

/**
 * 멀티 → 단일 폴백 — 가짜 Worker 로 클라이언트의 기동 순서만 본다.
 *
 * 가짜 워커는 기동 메시지의 변형을 보고, 멀티면 `failMulti` 에 따라 `fatal`(핸드셰이크
 * 실패)을, 아니면 `booted` 를 돌려준다. 띄운 워커와 종료된 워커를 모두 적어 둔다.
 */
const spawned: FakeWorker[] = [];
let failMulti: "fatal" | "error" | false = "fatal";

class FakeWorker {
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
  constructor() {
    spawned.push(this);
  }
  postMessage(m: ToWorker) {
    if (m.type !== "boot") return;
    this.variant = m.variant;
    setTimeout(() => {
      if (m.variant.startsWith("multi") && failMulti === "fatal") {
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
  vi.unstubAllGlobals();
});

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
