import { describe, expect, it } from "vitest";
import {
  ANALYSIS_TIME_SPEC,
  MOVE_TIME_SPEC,
  PROVE_MAX_SPEC,
  REVIEW_TIME_SPEC,
  durationText,
  formatDuration,
  parseDuration,
  type DurationSpec,
} from "./duration";

const ms = (text: string, spec: DurationSpec = MOVE_TIME_SPEC) => parseDuration(text, spec).ms;
const kind = (text: string, spec: DurationSpec = MOVE_TIME_SPEC) => parseDuration(text, spec).kind;

describe("parseDuration — 받는 꼴", () => {
  it("단위 없는 수는 칸의 기본 단위(초)", () => {
    expect(ms("2.5")).toBe(2_500);
    expect(ms("3")).toBe(3_000);
    expect(ms(" 10 ")).toBe(10_000);
    expect(ms("2,5")).toBe(2_500);
    expect(ms(".5")).toBe(500);
    expect(ms("5.")).toBe(5_000);
  });

  it("단위 글자 — ms · 초 · 분 · 시간", () => {
    expect(ms("1500ms")).toBe(1_500);
    expect(ms("1500 ms")).toBe(1_500);
    expect(ms("1500밀리초")).toBe(1_500);
    expect(ms("2s")).toBe(2_000);
    expect(ms("2 초")).toBe(2_000);
    expect(ms("2SEC")).toBe(2_000);
    expect(ms("1.5m")).toBe(90_000);
    expect(ms("2분")).toBe(120_000);
    expect(ms("1h")).toBe(3_600_000);
  });

  it("기본 단위가 ms 인 칸", () => {
    expect(ms("750", { ...MOVE_TIME_SPEC, unit: "ms" })).toBe(800); // 100ms 눈금
    expect(ms("2s", { ...MOVE_TIME_SPEC, unit: "ms" })).toBe(2_000);
  });

  it("무제한 — 받는 칸에서만", () => {
    for (const t of ["0", "0s", "무제한", "∞", "Unlimited"]) {
      expect(parseDuration(t, MOVE_TIME_SPEC)).toEqual({ kind: "ok", ms: 0 });
    }
    const r = parseDuration("무제한", REVIEW_TIME_SPEC);
    expect(r.kind).toBe("fallback");
    expect(r.ms).toBe(REVIEW_TIME_SPEC.defaultMs);
    expect(kind("0", REVIEW_TIME_SPEC)).toBe("fallback");
  });
});

describe("parseDuration — 범위와 폴백", () => {
  it("범위를 벗어나면 끝값으로 자르고 까닭을 말한다", () => {
    const lo = parseDuration("0.1", MOVE_TIME_SPEC);
    expect(lo).toMatchObject({ kind: "clamped", ms: 500 });
    expect(lo.kind === "clamped" && lo.note).toContain("500ms");
    const hi = parseDuration("500", REVIEW_TIME_SPEC);
    expect(hi).toMatchObject({ kind: "clamped", ms: 120_000 });
    expect(parseDuration("2h", PROVE_MAX_SPEC)).toMatchObject({ kind: "clamped", ms: 3_600_000 });
  });

  it("음수 · 글자 · 빈칸 · 지수 · 모르는 단위는 기본값으로", () => {
    for (const t of [
      "-3",
      "-0.5s",
      "abc",
      "",
      "   ",
      "1e3",
      "3x",
      "3일",
      "NaN",
      "Infinity",
      "2..5",
    ]) {
      const r = parseDuration(t, REVIEW_TIME_SPEC);
      expect(r.kind, t).toBe("fallback");
      expect(r.ms, t).toBe(3_000);
      expect(r.kind === "fallback" && r.note, t).toContain("기본값(3초)");
    }
    // 착수 시간의 기본값은 무제한이다.
    expect(parseDuration("-1", MOVE_TIME_SPEC)).toMatchObject({ kind: "fallback", ms: 0 });
  });

  it("정수 초로만 저장하는 칸은 1초 눈금으로 반올림한다", () => {
    expect(ms("2.4", ANALYSIS_TIME_SPEC)).toBe(2_000);
    expect(ms("2.6", ANALYSIS_TIME_SPEC)).toBe(3_000);
    expect(ms("1500ms", REVIEW_TIME_SPEC)).toBe(2_000);
    // 반올림해 0 이 되어도 무제한으로 읽지 않는다 — 가장 짧은 값이다.
    expect(parseDuration("0.2", ANALYSIS_TIME_SPEC)).toMatchObject({ kind: "clamped", ms: 1_000 });
  });
});

describe("표시", () => {
  it("formatDuration", () => {
    expect(formatDuration(0)).toBe("무제한");
    expect(formatDuration(800)).toBe("800ms");
    expect(formatDuration(2_500)).toBe("2.5초");
    expect(formatDuration(90_000)).toBe("90초");
    expect(formatDuration(600_000)).toBe("10분");
  });

  it("durationText 는 칸의 기본 단위로 되돌린다", () => {
    expect(durationText(2_500, "s")).toBe("2.5");
    expect(durationText(2_500, "ms")).toBe("2500");
    expect(durationText(0, "s")).toBe("");
  });
});
