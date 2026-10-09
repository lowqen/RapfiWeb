import { describe, expect, it } from "vitest";
import { capturePvs, proveRefusal, runProve, type ProveHooks, type ProvePort } from "./proveRunner";
import { DEFAULT_PROVE_OPTIONS, sanitizeProveOptions } from "../../../core/prove/prove-tree";
import {
  EMPTY_SNAPSHOT,
  type AnalysisSnapshot,
  type PvSnapshot,
} from "../../../engine/engine-types";
import { fromLabel, move, type Move } from "../../../core/model/move";

/**
 * 증명 실행기 — 국면(돌 수 · 차례)마다 정해 둔 답을 돌려주는 가짜 엔진으로. 트리의 규칙은
 * `prove-tree.test.ts` 가 보고, 여기는 «엔진에 무엇을 묻고 답을 어떻게 트리에 넣는가»를 본다.
 */

const size = 15;
const m = (l: string): Move => fromLabel(l, size)!;
const pv = (
  index: number,
  head: Move | null,
  winRate: number | null,
  mate: number | null = null,
  round = 1,
): PvSnapshot => ({
  index,
  depth: 10,
  winRate,
  mate,
  evalCp: null,
  line: head ? [head] : [],
  round,
});
const snap = (pvs: PvSnapshot[]): AnalysisSnapshot => ({
  ...EMPTY_SNAPSHOT,
  pvs,
  bestMove: pvs[0]?.line[0] ?? null,
});

function harness(
  answer: (stones: number, defend: boolean) => AnalysisSnapshot | null,
  cancelAfter = Infinity,
) {
  const calls: { stones: number; defend: boolean; nbest: number; totalMs: number }[] = [];
  let stops = 0;
  const port: ProvePort = {
    search: async (stones, opts, onSnapshot) => {
      calls.push({
        stones: stones.length,
        defend: opts.defend,
        nbest: opts.nbest,
        totalMs: opts.totalMs,
      });
      const s = answer(stones.length, opts.defend);
      if (s) onSnapshot(s);
      return s;
    },
    stop: () => {
      stops++;
    },
  };
  const logs: string[] = [];
  const overlays: number[] = [];
  const hooks: ProveHooks = {
    onProgress: () => {},
    onOverlay: (o) => overlays.push(o.line.length),
    isCancelled: () => calls.length > cancelAfter,
    log: (t) => logs.push(t),
    now: () => 0,
  };
  return { port, hooks, calls, logs, overlays, stops: () => stops };
}

const root = [m("h8"), m("i9"), m("j10")]; // 백 차례(3수 뒤)
const opts = sanitizeProveOptions({ ...DEFAULT_PROVE_OPTIONS, budget0Sec: 2 });

describe("PV 거두기", () => {
  it("마지막 라운드만, 엔진 번호 순으로", () => {
    const s = snap([
      pv(1, m("a1"), 0.4, null, 2),
      pv(0, m("b2"), 0.6, null, 2),
      pv(2, m("c3"), 0.3, null, 1),
    ]);
    const got = capturePvs(s);
    expect(got.pvs.map((p) => p.move)).toEqual([m("b2"), m("a1")]);
    expect(got.complete).toBe(true);
  });

  it("좌표 없는 PV 는 빼고 불완전하다고 알린다, PV 0 에 수가 없으면 빈 목록", () => {
    const partial = capturePvs(snap([pv(0, m("b2"), 0.6), pv(1, null, 0.4)]));
    expect(partial.pvs).toHaveLength(1);
    expect(partial.complete).toBe(false);
    expect(capturePvs(snap([pv(0, null, 0.6), pv(1, m("a1"), 0.4)])).pvs).toEqual([]);
    expect(capturePvs(null).pvs).toEqual([]);
  });

  it("승률이 없는 블록은 null 로 남는다", () => {
    expect(capturePvs(snap([pv(0, m("b2"), null, 3)])).pvs[0]).toMatchObject({
      winRate: null,
      mate: 3,
    });
  });
});

describe("루프", () => {
  it("뿌리에서 메이트가 보이면 곧바로 승리 증명", async () => {
    const h = harness(() => snap([pv(0, m("k11"), 0.99, 3)]));
    const { outcome } = await runProve(root, size, opts, h.port, h.hooks);
    expect(outcome.resolved).toBe(true);
    expect(outcome.win).toBe(true);
    expect(outcome.kind).toBe("mate");
    expect(outcome.blackToMove).toBe(false);
    expect(outcome.dbWrites).toBeNull();
    expect(h.calls).toEqual([{ stones: 3, defend: false, nbest: opts.nbest, totalMs: 2000 }]);
  });

  it("공격 후보 → 방어 탐색(YXSEARCHDEFEND) → 모든 방어가 지면 뿌리까지 승리", async () => {
    const h = harness((stones, defend) =>
      stones === 3
        ? snap([pv(0, m("k11"), 0.8)]) // 뿌리: 메이트는 아직 — 후보 k11 을 세운다
        : defend
          ? snap([pv(0, m("g7"), 0, -5), pv(1, m("l12"), 0, -7)]) // 방어자: 모든 방어가 메이트 당한다
          : null,
    );
    const { outcome, tree } = await runProve(root, size, opts, h.port, h.hooks);
    expect(h.calls.map((c) => [c.stones, c.defend])).toEqual([
      [3, false],
      [4, true],
    ]);
    expect(outcome.resolved).toBe(true);
    expect(outcome.win).toBe(true);
    expect(tree.root.result).toBe("win");
    expect(h.overlays.some((n) => n === 1)).toBe(true); // 탐색 중인 줄(k11)이 덧그림에
  });

  it("취소하면 그 자리에서 멈추고 취소로 알린다", async () => {
    const h = harness(() => snap([pv(0, m("k11"), 0.8)]), 1);
    const { outcome } = await runProve(root, size, opts, h.port, h.hooks);
    expect(outcome.cancelled).toBe(true);
    expect(outcome.resolved).toBe(false);
  });

  it("엔진이 사라지면 실패로 끝난다", async () => {
    const h = harness(() => null);
    const r = await runProve(root, size, opts, h.port, h.hooks);
    expect(r.failed).toMatch(/엔진이 내려가/);
    expect(r.outcome.cancelled).toBe(true);
  });

  it("빈 답은 같은 마디를 다시 묻고, 세 번이면 포기한다", async () => {
    let n = 0;
    const h = harness(() => (++n <= 3 ? snap([pv(0, null, 0.5)]) : null));
    await runProve(root, size, opts, h.port, h.hooks);
    expect(h.calls.slice(0, 3).every((c) => c.stones === 3)).toBe(true);
  });

  it("깊이 방식은 초 상한을 끈으로, 깊이에 닿으면 멈춘다", async () => {
    const deep: AnalysisSnapshot = {
      ...snap([{ ...pv(0, m("k11"), 0.99, 3), depth: 12 }]),
      stats: { ...EMPTY_SNAPSHOT.stats, depth: 12 },
    };
    const h = harness(() => deep);
    const byDepth = sanitizeProveOptions({
      ...DEFAULT_PROVE_OPTIONS,
      byDepth: true,
      depth0: 12,
      budgetMaxSec: 40,
    });
    await runProve(root, size, byDepth, h.port, h.hooks);
    expect(h.calls[0]!.totalMs).toBe(40_000);
    expect(h.stops()).toBe(1);
  });
});

describe("DB 단계(W8)", () => {
  /** 수순 키 → 라벨 문자. 쓰기는 따로 모은다. */
  function fakeDb(known: Record<string, string>) {
    const queries: number[] = [];
    const writes: { len: number; win: boolean; value: number; depth: number }[] = [];
    const key = (ms: readonly Move[]) => ms.map((x) => `${x.x},${x.y}`).join(" ");
    return {
      queries,
      writes,
      db: {
        query: async (ms: readonly Move[]) => {
          queries.push(ms.length);
          const l = known[key(ms)];
          return l
            ? { label: l.charCodeAt(0), value: 29990, depth: 4 }
            : { label: 0, value: 0, depth: 0 };
        },
        write: async (ms: readonly Move[], win: boolean, value: number, depth: number) => {
          writes.push({ len: ms.length, win, value, depth });
          return true;
        },
      },
      key,
    };
  }

  it("DB 가 아는 뿌리는 탐색 없이 결론 — 다시 쓰지 않는다", async () => {
    const f = fakeDb({});
    // 둘 차례(백)가 이기는 국면은 둔 쪽(흑) 관점의 'l'
    f.db.query = async (ms) => {
      f.queries.push(ms.length);
      return { label: 0x6c, value: 29990, depth: 4 };
    };
    const h = harness(() => null);
    const { outcome } = await runProve(root, size, opts, { ...h.port, db: f.db }, h.hooks);
    expect(h.calls).toEqual([]);
    expect(outcome.resolved).toBe(true);
    expect(outcome.win).toBe(true);
    expect(outcome.kind).toBe("db");
    expect(outcome.dbWrites).toBe(0);
    expect(f.writes).toEqual([]);
  });

  it("대문자나 빈 기록은 «모름» — 탐색하고, 증명된 메이트는 L 쪽(둘 차례 승)으로 적는다", async () => {
    const f = fakeDb({});
    f.db.query = async (ms) => {
      f.queries.push(ms.length);
      return { label: 0x57, value: 0, depth: 0 }; // 'W' — main.c 는 소문자만 맞춘다
    };
    const h = harness(() => snap([pv(0, m("k11"), 0.99, 3)]));
    const { outcome } = await runProve(root, size, opts, { ...h.port, db: f.db }, h.hooks);
    expect(f.queries).toEqual([3]);
    expect(h.calls).toHaveLength(1);
    expect(outcome.kind).toBe("mate");
    expect(outcome.dbWrites).toBe(1);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toMatchObject({ len: 3, win: true });
  });
});

describe("거절", () => {
  it("이미 승부가 난 국면은 증명하지 않는다", () => {
    const five = [7, 8, 9, 10, 11].flatMap((x, i) =>
      i < 4 ? [move(x, 7), move(x, 9)] : [move(x, 7)],
    );
    expect(proveRefusal(five, size)).toMatch(/이미 승부가 결정된/);
    expect(proveRefusal(root, size)).toBeNull();
  });
});
