import type { JobStatus, RapfiDb, ReviewJob, ReviewRow } from "./db";

/**
 * 리뷰 큐와 리포트 — Dexie v2 의 `queue` · `reviews`. 화면 스토어가 부르는 얇은 층이다.
 * 수 · 기록은 구조화 복제로 들어가므로 `Move` 객체를 그대로 넣는다.
 */

/** 실행 순서대로. */
export const listJobs = (d: RapfiDb): Promise<ReviewJob[]> => d.queue.orderBy("order").toArray();

export async function addJob(d: RapfiDb, job: Omit<ReviewJob, "id">): Promise<ReviewJob> {
  const id = (await d.queue.add(job as ReviewJob)) as number;
  return { ...job, id };
}

export const updateJob = (d: RapfiDb, id: number, patch: Partial<ReviewJob>): Promise<number> =>
  d.queue.update(id, patch);

export const deleteJob = (d: RapfiDb, id: number): Promise<void> => d.queue.delete(id);

/** 끝난(완료 · 실패) 작업을 걷어낸다. 리포트는 남는다. */
export async function clearFinishedJobs(d: RapfiDb): Promise<void> {
  const finished: JobStatus[] = ["done", "failed"];
  await d.queue.where("status").anyOf(finished).delete();
}

/**
 * 앱이 뜰 때 — 지난 세션에서 `running` 으로 남은 작업은 그 탭이 닫히며 끊긴 것이다.
 * 체크포인트는 남아 있으므로 `paused` 로 돌려 이어서 할 수 있게 한다.
 */
export async function recoverInterruptedJobs(d: RapfiDb): Promise<number> {
  return d.queue.where("status").equals("running").modify({ status: "paused" });
}

/** 새것부터. */
export const listReviews = (d: RapfiDb): Promise<ReviewRow[]> =>
  d.reviews.orderBy("createdAt").reverse().toArray();

export async function addReview(d: RapfiDb, row: Omit<ReviewRow, "id">): Promise<ReviewRow> {
  const id = (await d.reviews.add(row as ReviewRow)) as number;
  return { ...row, id };
}

export const deleteReview = (d: RapfiDb, id: number): Promise<void> => d.reviews.delete(id);
