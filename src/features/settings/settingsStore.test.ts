import { describe, expect, it } from "vitest";
import {
  AUTO_THREADS,
  DEFAULT_SETTINGS,
  autoThreads,
  engineInfo,
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
