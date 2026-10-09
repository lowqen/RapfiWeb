import type { RenjuPack } from "../../../core/rif/pack";

/**
 * W7 변환 워커와 주고받는 말. 변환은 몇 초지만 그동안 화면이 멈추면 안 되고(진행 막대가 흘러야
 * 한다), 15MB 남짓한 결과는 복사 없이 **넘긴다**(transfer) — 그래서 워커다.
 */

/** 내 기보 한 판 — 수순(보드 인덱스)과 결과(2 흑승 · 1 무 · 0 백승 · 3 모름). */
export interface LocalGame {
  readonly name: string;
  readonly cells: Uint8Array;
  readonly res: number;
  readonly savedAt: number;
}

export type ToRifWorker = { type: "rif"; file: File; partitions?: number };

export type RifPhase = "read" | "index" | "sort" | "count";

export type FromRifWorker =
  | {
      type: "progress";
      phase: RifPhase;
      /** 전체 진행 0..1(`overallFraction`). */
      fraction: number;
      /** 읽은 바이트(읽기 단계). */
      loaded: number;
      total: number;
      games: number;
    }
  | { type: "done"; pack: RenjuPack; ms: number }
  | { type: "error"; message: string };

/**
 * 전체 진행 0..1 — 파일 읽기가 앞의 18%, 나머지는 수 구간마다 같은 몫이고 구간 안에서 색인 · 정렬 ·
 * 세기가 58 · 20 · 22% 다. 몫은 Celeron N4500 실측(파싱 0.8초 · 집계 4.2초, 집계 안에서 색인이 가장
 * 길다)에서 왔다 — 막대가 한 단계에서 멈췄다 다음에서 튀지 않게 시간에 맞춘다. 구간이 바뀌어도
 * 뒤로 가지 않는다(단조 증가).
 */
const READ_SPAN = 0.18;
const PHASE_IN_PART: Readonly<Record<Exclude<RifPhase, "read">, readonly [number, number]>> = {
  index: [0, 0.58],
  sort: [0.58, 0.78],
  count: [0.78, 1],
};

export function overallFraction(phase: RifPhase, f: number, part = 0, parts = 1): number {
  const x = Math.min(1, Math.max(0, f));
  if (phase === "read") return READ_SPAN * x;
  const [a, b] = PHASE_IN_PART[phase];
  return READ_SPAN + (1 - READ_SPAN) * ((part + a + (b - a) * x) / parts);
}

export const RIF_PHASE_TEXT: Readonly<Record<RifPhase, string>> = {
  read: "파일 읽는 중",
  index: "국면 세는 중",
  sort: "정리하는 중",
  count: "통계 만드는 중",
};
