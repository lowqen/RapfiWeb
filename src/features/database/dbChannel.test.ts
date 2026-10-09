import { afterEach, describe, expect, it, vi } from "vitest";
import { CoordMapper } from "../../engine/engine-protocol";
import type { EngineCommand } from "../../engine/engine-types";
import { queryAll, queryOne } from "../../core/database/yixindb";
import { DbChannel, replyError, untilDeleted, untilOne, untilText } from "./dbChannel";

/** 엔진 대신 — 받은 명령마다 정해 둔 줄을 (다음 틱에) 돌려준다. */
function fakeEngine(reply: (cmd: EngineCommand) => string[]) {
  const sent: EngineCommand[] = [];
  let listener: ((l: string) => void) | null = null;
  return {
    sent,
    emit: (l: string) => listener?.(l),
    port: {
      send: (cmd: EngineCommand) => {
        sent.push(cmd);
        const lines = reply(cmd);
        setTimeout(() => lines.forEach((l) => listener?.(l)), 0);
      },
      listen: (fn: (l: string) => void) => {
        listener = fn;
        return () => (listener = null);
      },
    },
  };
}

const coord = new CoordMapper(15);
const open = (e: ReturnType<typeof fakeEngine>) =>
  new DbChannel(e.port, 15, (r, c) => coord.fromWire(r, c));

afterEach(() => vi.useRealTimers());

describe("DB 채널", () => {
  it("질의 하나: 칸 · DONE · 여러 줄 TEXT 까지 모아 끝낸다", async () => {
    const e = fakeEngine(() => [
      "DATABASE REFRESH",
      "DATABASE 7 7 119 0 0 0 0",
      "DATABASE DONE",
      'DATABASE TEXT "첫 줄',
      '둘째 줄"',
    ]);
    const r = await open(e).request(queryAll([]), untilText);
    expect(r?.snapshot.cells.size).toBe(1);
    expect(r?.snapshot.comment).toBe("첫 줄\n둘째 줄");
    expect(r?.lines.map((l) => l.kind)).toEqual(["refresh", "cell", "done", "text"]);
  });

  it("요청은 줄을 선다 — 앞 요청의 DONE 을 뒤 요청이 가져가지 않는다", async () => {
    const e = fakeEngine((cmd) =>
      cmd.kind === "dbPosition" && cmd.head === "yxquerydatabaseone"
        ? ["DATABASE ONE 119 5 1 3 w"]
        : ["DATABASE REFRESH", "DATABASE DONE", 'DATABASE TEXT ""'],
    );
    const ch = open(e);
    const [a, b] = await Promise.all([
      ch.request(queryAll([]), untilText),
      ch.request(queryOne([]), untilOne),
    ]);
    expect(a?.lines.map((l) => l.kind)).toEqual(["refresh", "done", "text"]);
    expect(b?.lines.map((l) => l.kind)).toEqual(["one"]);
    expect(b?.snapshot.entry?.value).toBe(5);
  });

  it("답이 없으면 시간 끈에서 null — 다음 요청은 막히지 않는다", async () => {
    vi.useFakeTimers();
    let silent = true;
    const e = fakeEngine(() => (silent ? [] : ["DATABASE ONE 0 0 0 0"]));
    const ch = open(e);
    const first = ch.request(queryOne([]), untilOne, 1000);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await first).toBeNull();
    expect(replyError(await first)).toMatch(/답하지 않았습니다/);
    silent = false;
    const second = ch.request(queryOne([]), untilOne, 1000);
    await vi.advanceTimersByTimeAsync(5);
    expect((await second)?.lines[0]?.kind).toBe("one");
  });

  it("ERROR 는 곧장 끝내고 그 글을 돌려준다", async () => {
    const e = fakeEngine(() => ["ERROR No game has been started."]);
    const r = await open(e).request(queryOne([]), untilOne);
    expect(replyError(r)).toBe("No game has been started.");
  });

  it("일괄 삭제는 Done deleting 뒤의 DONE 에서 끝난다", async () => {
    const e = fakeEngine(() => [
      "Deleting child records, this might take a while...",
      "Done deleting 3 records using 1 ms.",
      "DATABASE REFRESH",
      "DATABASE DONE",
    ]);
    const r = await open(e).request({ kind: "raw", line: "x" }, untilDeleted);
    expect(r?.lines.some((l) => l.kind === "deleted")).toBe(true);
  });

  it("답이 없는 명령은 보내기만 한다", async () => {
    const e = fakeEngine(() => []);
    const r = await open(e).request({ kind: "raw", line: "yxedittextdatabase" }, null);
    expect(r?.lines).toEqual([]);
    expect(e.sent).toHaveLength(1);
  });
});
