import Dexie, { type EntityTable } from "dexie";
import type { Move } from "../core/model/move";
import type { PositionRecord } from "../core/review/move-quality";
import type { ReviewBudget } from "../core/review/report";
import type { JosekiTree } from "../core/joseki/tree";
import type { RenjuPack } from "../core/rif/pack";

/**
 * 앱 자신의 데이터베이스 `rapfiweb` — 계획서 §4 의 Dexie 층.
 *
 * **v1 은 `games` 하나, v2 가 리뷰의 `reviews` · `queue` 를, v3 가 엔진 DB 파일 `dbfiles` 를,
 * v4 가 정석 `joseki` · `josekiIndex` 를, v5 가 `.rif` 변환 팩 `packs` 를 더했다(W6b · W8 · W9 · W7).** 계획서의 나머지
 * 표(정석 · 팩 …)는 그 기능이 들어올 때 `version(n)` 을 올리며 더한다 — 쓰지 않는 표를 미리 파 두면 그 모양이
 * 실제 요구보다 먼저 굳는다. 이미 있는 표의 색인을 바꿀 때도 버전을 올린다.
 *
 * 설정 · 테마 · 보드 탭은 여전히 `localStorage` 다(동기로 읽혀야 첫 그림부터 맞다).
 */

/** 기보 한 건. 수는 엔진 좌표(`Move`) 그대로 — 구조화 복제로 들어간다. */
export interface GameRecord {
  id?: number;
  /** 사람이 읽는 이름. 파일에서 왔으면 그 파일의 `baseName`. */
  name: string;
  size: number;
  moves: Move[];
  /** 무른 수(다시 둘 차례대로) — 자동 저장이 이동 바의 `>` 까지 되살린다. */
  future: Move[];
  savedAt: number;
  /**
   * 특별한 자리 — 자리마다 한 줄이고 늘 같은 줄을 덮어쓴다. 사용자가 저장한 기보에는
   * 없다(색인에 걸리지 않는다).
   *   `"autosave"`   지금 판
   *   `"beforeLink"` 국면 딥링크를 열기 직전에 두던 판 — 되돌리거나 버릴 때까지 남는다
   */
  slot?: GameSlot;
}

export type GameSlot = "autosave" | "beforeLink";

/** 리뷰 작업 하나의 상태. `paused` 는 중단(취소 · 엔진 소실 · 새로고침) — 체크포인트에서 잇는다. */
export type JobStatus = "pending" | "running" | "paused" | "done" | "failed";

/**
 * 리뷰 큐의 작업 하나 = 리뷰할 수순 하나. 브라우저는 파일을 나중에 다시 읽을 수 없으므로
 * 올릴 때 수순을 통째로 담는다. `records` · `index` 가 체크포인트다 — 국면 하나를 끝낼
 * 때마다 쓰고, 다음 실행이 `index` 부터 잇는다.
 */
export interface ReviewJob {
  id?: number;
  /** 실행 순서(작을수록 먼저). 「지금 판 리뷰」는 맨 앞으로 끼어든다. */
  order: number;
  name: string;
  size: number;
  moves: Move[];
  status: JobStatus;
  records: PositionRecord[];
  index: number;
  /** 사람이 읽는 결과 한 줄(완료 요약 · 실패 까닭). */
  result: string;
  /** 끝났으면 그 리포트(`reviews`)의 id. */
  reviewId?: number;
  /** 국면마다 엔진 로그 한 줄(깊이 · 노드 · 시간) — 체크포인트와 함께. 예전 작업에는 없다. */
  log?: string[];
  createdAt: number;
}

/**
 * 끝난 리뷰 하나 — 등급은 저장하지 않는다. 기록(`records`)만 있으면 기준을 바꿔 언제든
 * 다시 매긴다(앱의 `GameReport.of` 와 같다).
 */
export interface ReviewRow {
  id?: number;
  title: string;
  size: number;
  moves: Move[];
  records: PositionRecord[];
  budget: ReviewBudget;
  skipOpening: boolean;
  /** 국면마다 엔진 로그 한 줄 — HTML 리포트의 「엔진 로그」. 예전 리포트에는 없다. */
  log?: string[];
  createdAt: number;
}

/**
 * 엔진의 yixindb 파일 한 벌(W8) — 엔진 메모리 FS 의 `rapfi.db` 바이트 그대로. 엔진이 뜰 때
 * 메모리 FS 에 써 넣고(`info usedatabase 1` 이 그 파일을 연다), 저장할 때 엔진이 쓴 파일을
 * 읽어 여기 덮어쓴다. IDBFS 대신 이 길을 쓰는 까닭은 `features/database/dbStore.ts`.
 */
export interface DbFileRow {
  name: string;
  bytes: Uint8Array;
  savedAt: number;
}

/**
 * 정석 색인 한 줄(W9) — 마디 하나의 정규 국면 키(`PosKey.canonical`). 보드의 지금 국면이 어느
 * 정석의 어디인지를 키 하나로 찾는다(대칭 · 회전은 같은 키로 접힌다). 정석을 저장할 때마다 그
 * 정석의 줄을 통째로 다시 쓴다.
 */
export interface JosekiIndexRow {
  id?: number;
  key: string;
  josekiId: string;
  path: number[];
  ply: number;
}

/**
 * `.rif` 변환 팩 한 벌(W7) — RenjuNet 파생물이라 **이 브라우저에만** 둔다(서버 · 번들 금지). 15MB
 * 남짓의 타입드 배열 묶음이 구조화 복제로 통째 들어간다. 지금은 `"renjunet"` 한 줄뿐이다(내 기보
 * 팩은 그때그때 만든다).
 */
export interface PackRow {
  name: "renjunet";
  pack: RenjuPack;
  savedAt: number;
}

export class RapfiDb extends Dexie {
  games!: EntityTable<GameRecord, "id">;
  reviews!: EntityTable<ReviewRow, "id">;
  queue!: EntityTable<ReviewJob, "id">;
  dbfiles!: EntityTable<DbFileRow, "name">;
  joseki!: EntityTable<JosekiTree, "id">;
  josekiIndex!: EntityTable<JosekiIndexRow, "id">;
  packs!: EntityTable<PackRow, "name">;

  constructor(name = "rapfiweb") {
    super(name);
    this.version(1).stores({
      // &slot: 자리마다 한 줄. slot 이 없는 줄은 IndexedDB 가 색인에 넣지 않으므로
      // 사용자 기보는 몇 건이든 이 유일 조건에 걸리지 않는다.
      games: "++id, name, savedAt, &slot",
    });
    this.version(2).stores({
      reviews: "++id, createdAt",
      queue: "++id, order, status",
    });
    this.version(3).stores({
      dbfiles: "&name",
    });
    // 한 정석 = 한 문서(계획서 §4·§7). 색인은 따로 — 문서를 정규화하지 않는 대신 키만 뽑아 둔다.
    this.version(4).stores({
      joseki: "id, title, category, updatedAt",
      josekiIndex: "++id, key, josekiId",
    });
    this.version(5).stores({
      packs: "&name",
    });
  }
}

let instance: RapfiDb | null = null;

/**
 * 앱 전체가 함께 쓰는 연결. IndexedDB 가 없는 곳(시험의 node, 일부 사생활 보호 모드)
 * 에서는 `null` — 부르는 쪽은 저장 없이 그대로 돈다.
 */
export function db(): RapfiDb | null {
  if (typeof indexedDB === "undefined") return null;
  instance ??= new RapfiDb();
  return instance;
}
