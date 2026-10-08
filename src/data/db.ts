import Dexie, { type EntityTable } from "dexie";
import type { Move } from "../core/model/move";

/**
 * 앱 자신의 데이터베이스 `rapfiweb` — 계획서 §4 의 Dexie 층.
 *
 * **v1 은 `games` 하나다.** 계획서의 나머지 표(정석 · 팩 · 리뷰 · 큐 …)는 그 기능이
 * 들어올 때 `version(n)` 을 올리며 더한다 — 쓰지 않는 표를 미리 파 두면 그 모양이
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
   * 특별한 자리. `"autosave"` 는 **지금 판** 한 건이고, 늘 같은 줄을 덮어쓴다.
   * 사용자가 저장한 기보에는 없다(색인에 걸리지 않는다).
   */
  slot?: "autosave";
}

export class RapfiDb extends Dexie {
  games!: EntityTable<GameRecord, "id">;

  constructor(name = "rapfiweb") {
    super(name);
    this.version(1).stores({
      // &slot: 자리마다 한 줄. slot 이 없는 줄은 IndexedDB 가 색인에 넣지 않으므로
      // 사용자 기보는 몇 건이든 이 유일 조건에 걸리지 않는다.
      games: "++id, name, savedAt, &slot",
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
