/// <reference lib="webworker" />
import { MoveOrderSession } from "../../../core/moveorder/session";
import { handle } from "./moveOrderService";
import type { FromMoveOrderWorker, ToMoveOrderWorker } from "./protocol";

/**
 * 수순 워커 — `MoveOrderSet` 한 판을 들고 화면의 물음에 답한다. 20돌 국면은 30만 마디 예산을
 * 다 쓰며 1초 남짓 걸리므로(느린 기계) 메인 스레드에서 돌리면 화면이 멈춘다. 앱도 같은 이유로
 * `Dispatchers.Default` 에서 돈다. 요청은 온 순서대로 하나씩 처리한다.
 */
const session = new MoveOrderSession();

self.onmessage = (ev: MessageEvent<ToMoveOrderWorker>) => {
  const { id, req } = ev.data;
  let msg: FromMoveOrderWorker;
  try {
    msg = { id, result: handle(session, req) };
  } catch (e) {
    msg = { id, error: e instanceof Error ? e.message : String(e) };
  }
  (self as unknown as Worker).postMessage(msg);
};
