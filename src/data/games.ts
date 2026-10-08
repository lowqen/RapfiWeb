import type { GameRecord, RapfiDb } from "./db";
import type { Move } from "../core/model/move";

/** 자동 저장이 담는 것 — 지금 판. */
export interface AutosaveState {
  name: string;
  size: number;
  moves: readonly Move[];
  future: readonly Move[];
}

/** 지금 판의 자동 저장을 읽는다. 없으면 `null`. */
export async function readAutosave(d: RapfiDb): Promise<AutosaveState | null> {
  const r = await d.games.where("slot").equals("autosave").first();
  if (!r) return null;
  return { name: r.name, size: r.size, moves: r.moves, future: r.future };
}

/**
 * 지금 판을 자동 저장 자리에 덮어쓴다. 자리의 `id` 를 찾아 `put` 하므로 줄은 늘 하나다 —
 * 읽기와 쓰기를 한 트랜잭션에 묶어 두 탭이 동시에 써도 둘째 줄이 생기지 않는다
 * (생기려 해도 `&slot` 유일 색인이 막는다).
 */
export async function writeAutosave(d: RapfiDb, s: AutosaveState): Promise<void> {
  await d.transaction("rw", d.games, async () => {
    const prev = await d.games.where("slot").equals("autosave").first();
    const rec: GameRecord = {
      name: s.name,
      size: s.size,
      moves: s.moves.map(({ x, y }) => ({ x, y })),
      future: s.future.map(({ x, y }) => ({ x, y })),
      savedAt: Date.now(),
      slot: "autosave",
    };
    if (prev?.id !== undefined) rec.id = prev.id;
    await d.games.put(rec);
  });
}
