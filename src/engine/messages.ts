/** 메인 스레드 ↔ 엔진 워커 사이의 메시지. 양쪽이 같은 이 파일을 본다. */

export type ToWorker =
  | { type: "boot"; engineBaseUrl: string; variant: string; sliceMs: number }
  | { type: "send"; lines: readonly string[] }
  /** 시간 분할 탐색. 조각 사이에 이 워커의 이벤트 루프가 돌아온다. */
  | { type: "search"; lines: readonly string[]; totalMs: number }
  | { type: "stop" }
  | { type: "shutdown" };

export type FromWorker =
  | { type: "booted"; version: string; bootMs: number }
  | { type: "lines"; lines: readonly string[] }
  | { type: "searchDone"; reason: "finished" | "stopped" | "timeout"; elapsedMs: number }
  | { type: "exit"; code: number }
  | { type: "fatal"; message: string };
