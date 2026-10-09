import { MoveOrderSession } from "../../../core/moveorder/session";
import type {
  FromMoveOrderWorker,
  MoveOrderReplyMap,
  MoveOrderRequest,
  ToMoveOrderWorker,
} from "./protocol";

/**
 * 수순 계산 창구 — 브라우저에서는 워커(`moveOrder.worker.ts`), 워커가 없는 곳(시험의 node)에서는
 * 같은 세션을 그 자리에서 돌린다. 두 길이 같은 `handle` 을 지난다.
 */
export interface MoveOrderService {
  call<K extends MoveOrderRequest["op"]>(
    req: Extract<MoveOrderRequest, { op: K }>,
  ): Promise<MoveOrderReplyMap[K]>;
  dispose(): void;
}

export function handle(session: MoveOrderSession, req: MoveOrderRequest): unknown {
  switch (req.op) {
    case "build":
      return session.build(req.cells, req.size, req.rules);
    case "drill":
      return session.drill(req.cell);
    case "back":
      return session.back();
    case "root":
      return session.root();
    case "complete":
      return session.complete();
  }
}

/** 그 자리에서 — 시험용, 그리고 워커를 띄울 수 없는 곳의 물러섬. */
export function inlineService(): MoveOrderService {
  const session = new MoveOrderSession();
  return {
    call: async (req) => handle(session, req) as never,
    dispose: () => {},
  };
}

export function workerService(): MoveOrderService {
  // Vite 가 워커를 번들로 알아보려면 `new Worker(new URL(…))` 가 이 모양 그대로여야 한다.
  const worker = new Worker(new URL("./moveOrder.worker.ts", import.meta.url), {
    type: "classic",
    name: "rapfi-moveorder",
  });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (ev: MessageEvent<FromMoveOrderWorker>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if ("error" in ev.data) p.reject(new Error(ev.data.error));
    else p.resolve(ev.data.result);
  };
  return {
    call: (req) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        const msg: ToMoveOrderWorker = { id, req };
        worker.postMessage(msg);
      }),
    dispose: () => {
      worker.terminate();
      for (const p of pending.values()) p.reject(new Error("수순 워커를 내렸습니다"));
      pending.clear();
    },
  };
}

/** 쓸 수 있는 쪽으로. */
export const createMoveOrderService = (): MoveOrderService =>
  typeof Worker === "undefined" ? inlineService() : workerService();
