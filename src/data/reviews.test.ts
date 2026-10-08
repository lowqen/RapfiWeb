import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { RapfiDb, type ReviewJob } from "./db";
import {
  addJob,
  addReview,
  clearFinishedJobs,
  deleteReview,
  listJobs,
  listReviews,
  recoverInterruptedJobs,
  updateJob,
} from "./reviews";
import { readAutosave, writeAutosave } from "./games";
import { move } from "../core/model/move";

let d: RapfiDb;
afterEach(async () => {
  await d.delete();
});

const job = (order: number, extra: Partial<ReviewJob> = {}): Omit<ReviewJob, "id"> => ({
  order,
  name: `g${order}`,
  size: 15,
  moves: [move(7, 7)],
  status: "pending",
  records: [],
  index: 0,
  result: "",
  createdAt: order,
  ...extra,
});

describe("리뷰 큐", () => {
  it("실행 순서대로 읽고, 체크포인트를 고쳐 쓴다", async () => {
    d = new RapfiDb(`rv-${Math.random()}`);
    await addJob(d, job(2));
    const first = await addJob(d, job(1));
    expect((await listJobs(d)).map((j) => j.order)).toEqual([1, 2]);
    await updateJob(d, first.id!, {
      index: 3,
      records: [{ blackWinRate: 0.5, blackMate: 0, best: move(1, 1), gap: null }],
    });
    const again = (await listJobs(d))[0]!;
    expect(again.index).toBe(3);
    expect(again.records[0]!.best).toEqual(move(1, 1));
  });

  it("끊긴 작업은 이어서 할 수 있게 되살린다", async () => {
    d = new RapfiDb(`rv-${Math.random()}`);
    await addJob(d, job(1, { status: "running", index: 4 }));
    await addJob(d, job(2, { status: "done" }));
    expect(await recoverInterruptedJobs(d)).toBe(1);
    const jobs = await listJobs(d);
    expect(jobs.map((j) => j.status)).toEqual(["paused", "done"]);
    expect(jobs[0]!.index).toBe(4);
  });

  it("끝난 작업만 걷어낸다", async () => {
    d = new RapfiDb(`rv-${Math.random()}`);
    for (const [i, status] of (["pending", "done", "failed", "paused"] as const).entries()) {
      await addJob(d, job(i, { status }));
    }
    await clearFinishedJobs(d);
    expect((await listJobs(d)).map((j) => j.status)).toEqual(["pending", "paused"]);
  });
});

describe("리포트", () => {
  it("새것부터 읽고 지운다", async () => {
    d = new RapfiDb(`rv-${Math.random()}`);
    const row = {
      title: "a",
      size: 15,
      moves: [move(7, 7)],
      records: [],
      budget: { seconds: 3, byDepth: false, depth: 14 },
      skipOpening: true,
    };
    const old = await addReview(d, { ...row, createdAt: 1 });
    await addReview(d, { ...row, title: "b", createdAt: 2 });
    expect((await listReviews(d)).map((r) => r.title)).toEqual(["b", "a"]);
    await deleteReview(d, old.id!);
    expect((await listReviews(d)).map((r) => r.title)).toEqual(["b"]);
  });
});

describe("v1 → v2", () => {
  it("v1 에서 쓴 자동 저장이 v2 로 열어도 남아 있다", async () => {
    const name = `up-${Math.random()}`;
    const { default: Dexie } = await import("dexie");
    const v1 = new Dexie(name);
    v1.version(1).stores({ games: "++id, name, savedAt, &slot" });
    await v1.table("games").add({
      name: "",
      size: 15,
      moves: [move(7, 7)],
      future: [],
      savedAt: 1,
      slot: "autosave",
    });
    v1.close();
    d = new RapfiDb(name);
    expect((await readAutosave(d))?.moves).toEqual([move(7, 7)]);
    await writeAutosave(d, { name: "", size: 15, moves: [], future: [] });
    expect(await d.reviews.count()).toBe(0);
  });
});
