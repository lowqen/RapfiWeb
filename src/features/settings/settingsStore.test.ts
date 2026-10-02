import { describe, expect, it } from "vitest";
import {
  AUTO_THREADS,
  DEFAULT_SETTINGS,
  autoThreads,
  SETTINGS_VERSION,
  engineInfo,
  migrate,
  planThreadChange,
  resolveThreads,
  sanitize,
  toEngineConfig,
} from "./settingsStore";

describe("스레드 설정", () => {
  it("자동 = 코어 − 1, 1 이상 4 이하, 코어를 모르면 2", () => {
    expect(autoThreads(8)).toBe(4);
    expect(autoThreads(4)).toBe(3);
    expect(autoThreads(2)).toBe(1);
    expect(autoThreads(1)).toBe(1);
    expect(autoThreads(null)).toBe(2);
  });

  it("설정값을 실제 스레드 수로 — 자동이면 위 규칙, 아니면 코어 수 안에서", () => {
    expect(resolveThreads(AUTO_THREADS, 8)).toBe(4);
    expect(resolveThreads(6, 8)).toBe(6);
    expect(resolveThreads(12, 8)).toBe(8); // 코어보다 많이는 주지 않는다
    expect(resolveThreads(3, 2)).toBe(2);
  });

  it("저장된 값을 믿지 않는다 — 범위 밖은 자르고 타입이 틀리면 기본값", () => {
    expect(sanitize({ threads: 99 }).threads).toBe(16);
    expect(sanitize({ threads: -3 }).threads).toBe(0);
    expect(sanitize({ allowThreads: "yes" as unknown as boolean }).allowThreads).toBe(true);
    expect(sanitize({}).allowThreads).toBe(DEFAULT_SETTINGS.allowThreads);
  });

  it("thread_num 은 INFO 목록에 없다 — 떠 있는 변형을 아는 엔진 스토어가 붙인다", () => {
    const info = engineInfo(DEFAULT_SETTINGS);
    expect(info.some((c) => c.kind === "info" && c.key === "thread_num")).toBe(false);
    expect(toEngineConfig({ ...DEFAULT_SETTINGS, threads: 3 }).threads).toBeGreaterThanOrEqual(1);
  });
});

describe("스레드 수 변경의 확정 시점(P1-2)", () => {
  const live = { cores: 8, applied: 4, live: true };

  it("떠 있는 멀티 엔진의 실제 스레드 수가 바뀌면 확정을 받는다", () => {
    expect(planThreadChange({ ...live, current: 4, next: 2 })).toBe("confirm");
    expect(planThreadChange({ ...live, current: AUTO_THREADS, next: 6 })).toBe("confirm");
  });

  it("실제 스레드 수가 같으면 곧바로 — 자동(코어 8 → 4) ↔ 4 는 엔진에 아무것도 안 간다", () => {
    expect(planThreadChange({ ...live, current: 4, next: AUTO_THREADS })).toBe("apply");
    expect(planThreadChange({ ...live, current: AUTO_THREADS, next: 4 })).toBe("apply");
  });

  it("엔진이 없거나 단일이면 곧바로 — 다음 기동의 기동 메시지로 들어가 비용이 없다", () => {
    expect(planThreadChange({ ...live, live: false, current: 4, next: 2 })).toBe("apply");
    expect(planThreadChange({ ...live, applied: null, current: 4, next: 2 })).toBe("apply");
  });

  it("같은 값을 다시 고르면 아무것도 하지 않는다", () => {
    expect(planThreadChange({ ...live, current: 2, next: 2 })).toBe("noop");
  });
});

describe("후보 수 · 고급 설정", () => {
  it("후보 수 기본은 1 — 한 수를 깊게", () => {
    expect(DEFAULT_SETTINGS.multiPv).toBe(1);
  });

  it("옛 저장본(버전 없음)의 기본값 5 는 새 기본 1 로 옮기고, 고른 다른 값은 둔다", () => {
    expect(sanitize(migrate({ multiPv: 5 })).multiPv).toBe(1);
    expect(sanitize(migrate({ multiPv: 3 })).multiPv).toBe(3);
    // 새 버전에서 일부러 5 를 고른 것은 그대로다.
    expect(sanitize(migrate({ multiPv: 5, v: SETTINGS_VERSION })).multiPv).toBe(5);
  });

  it("고급 설정은 기본으로 접혀 있고, 타입이 틀리면 접는다", () => {
    expect(DEFAULT_SETTINGS.showAdvanced).toBe(false);
    expect(sanitize({ showAdvanced: true }).showAdvanced).toBe(true);
    expect(sanitize({ showAdvanced: 1 as unknown as boolean }).showAdvanced).toBe(false);
  });
});
