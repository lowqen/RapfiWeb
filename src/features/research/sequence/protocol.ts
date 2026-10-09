import type { BuildResult, MoveOrderRules, MoveOrderView } from "../../../core/moveorder/session";
import type { Completion } from "../../../core/moveorder/move-order";

/** 수순 워커와 주고받는 것 — 요청마다 번호를 달고 같은 번호로 답한다. */
export type MoveOrderRequest =
  | { op: "build"; cells: number[]; size: number; rules: MoveOrderRules }
  | { op: "drill"; cell: number }
  | { op: "back" }
  | { op: "root" }
  | { op: "complete" };

export interface MoveOrderReplyMap {
  build: BuildResult;
  drill: MoveOrderView | null;
  back: MoveOrderView | null;
  root: MoveOrderView | null;
  complete: Completion | null;
}

export type ToMoveOrderWorker = { id: number; req: MoveOrderRequest };
export type FromMoveOrderWorker = { id: number; result: unknown } | { id: number; error: string };
