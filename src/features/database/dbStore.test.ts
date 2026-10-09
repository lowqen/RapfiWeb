import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineCommand } from "../../engine/engine-types";

/**
 * CSV 내보내기의 순서 — Rapfi 는 `Wrote …` 를 CSV 파일을 닫기 **전에** 알린다(dbStore 주석).
 * 그래서 다음 명령 하나의 답(장벽)을 받은 **뒤에만** FS 를 읽어야 한다. 여기서는 그 경주를
 * 흉내 낸다: 파일은 장벽 질의를 엔진이 받는 순간에야 채워진다.
 */
const fs = vi.hoisted(() => ({ file: new Uint8Array(0), reads: [] as number[] }));

vi.mock("../../engine/engine-state", async (orig) => ({
  ...(await orig<typeof import("../../engine/engine-state")>()),
  engineFs: vi.fn(async (op: string) => {
    if (op === "read") {
      fs.reads.push(fs.file.byteLength);
      return { ok: true, bytes: fs.file.slice() };
    }
    return { ok: true };
  }),
}));

const { setDbPortForTest, useDbStore } = await import("./dbStore");

const CSV = new TextEncoder().encode("index,key,label,value,depth,bound,text\n");

function fakeEngine(onBarrier: () => void, answerBarrier = true) {
  const sent: string[] = [];
  let listener: ((l: string) => void) | null = null;
  const later = (lines: string[]) => setTimeout(() => lines.forEach((l) => listener?.(l)), 0);
  return {
    sent,
    port: {
      send: (cmd: EngineCommand) => {
        if (cmd.kind === "raw") {
          sent.push(cmd.line.split("\n")[0]!);
          // 파일은 아직 비어 있다 — 소멸자가 돌기 전이다.
          later(["Wrote (all) database to csv-format text file rapfi.csv"]);
        } else if (cmd.kind === "dbPosition") {
          sent.push(cmd.head);
          onBarrier(); // 다음 명령을 엔진이 받았다 = 앞 명령의 소멸자까지 끝났다
          if (answerBarrier) later(["DATABASE ONE 0 0 0 0"]);
        }
      },
      listen: (fn: (l: string) => void) => {
        listener = fn;
        return () => (listener = null);
      },
    },
  };
}

afterEach(() => {
  setDbPortForTest(null);
  fs.file = new Uint8Array(0);
  fs.reads.length = 0;
});

describe("CSV 내보내기", () => {
  it("`Wrote` 뒤 장벽 질의의 답을 받고 나서야 파일을 읽는다", async () => {
    const e = fakeEngine(() => (fs.file = CSV));
    setDbPortForTest(e.port);
    useDbStore.setState({ status: "on" });

    const r = await useDbStore.getState().exportCsv();

    expect(e.sent).toEqual(["yxdbtotxtall", "yxquerydatabaseone"]);
    expect(fs.reads).toEqual([CSV.byteLength]);
    expect("bytes" in r && new TextDecoder().decode(r.bytes)).toMatch(/^index,key/);
  });

  it("장벽이 답하지 않거나 파일이 비었으면 빈 파일을 내려주지 않고 까닭을 돌려준다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const silent = fakeEngine(() => {}, false);
    setDbPortForTest(silent.port);
    useDbStore.setState({ status: "on" });
    const pending = useDbStore.getState().exportCsv();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await pending).toEqual({ error: expect.stringContaining("답하지 않았습니다") });
    expect(fs.reads).toEqual([]);
    vi.useRealTimers();

    const empty = fakeEngine(() => {}); // 장벽은 답하지만 파일은 끝내 비어 있다
    setDbPortForTest(empty.port);
    useDbStore.setState({ status: "on" });
    expect(await useDbStore.getState().exportCsv()).toEqual({
      error: expect.stringContaining("빈 CSV"),
    });
  });
});
