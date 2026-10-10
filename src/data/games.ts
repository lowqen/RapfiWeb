import type { GameRecord, GameSlot, RapfiDb } from "./db";
import type { Move } from "../core/model/move";

/** 자동 저장이 담는 것 — 지금 판. */
export interface AutosaveState {
  name: string;
  size: number;
  moves: readonly Move[];
  future: readonly Move[];
  /** 분석 판(`"analysis"` 자리)만 — 갈라져 나온 대국 수순. */
  base?: readonly Move[];
}

/** 자리 하나를 읽는다. 없으면 `null`. */
export async function readSlot(d: RapfiDb, slot: GameSlot): Promise<AutosaveState | null> {
  const r = await d.games.where("slot").equals(slot).first();
  if (!r) return null;
  const s: AutosaveState = { name: r.name, size: r.size, moves: r.moves, future: r.future };
  if (r.base) s.base = r.base;
  return s;
}

/**
 * 자리 하나를 덮어쓴다. 자리의 `id` 를 찾아 `put` 하므로 줄은 늘 하나다 — 읽기와 쓰기를
 * 한 트랜잭션에 묶어 두 탭이 동시에 써도 둘째 줄이 생기지 않는다(생기려 해도 `&slot`
 * 유일 색인이 막는다).
 */
export async function writeSlot(d: RapfiDb, slot: GameSlot, s: AutosaveState): Promise<void> {
  await d.transaction("rw", d.games, async () => {
    const prev = await d.games.where("slot").equals(slot).first();
    const rec: GameRecord = {
      name: s.name,
      size: s.size,
      moves: s.moves.map(({ x, y }) => ({ x, y })),
      future: s.future.map(({ x, y }) => ({ x, y })),
      savedAt: Date.now(),
      slot,
    };
    if (s.base) rec.base = s.base.map(({ x, y }) => ({ x, y }));
    if (prev?.id !== undefined) rec.id = prev.id;
    await d.games.put(rec);
  });
}

/** 자리를 비운다. */
export async function clearSlot(d: RapfiDb, slot: GameSlot): Promise<void> {
  await d.games.where("slot").equals(slot).delete();
}

/** 지금 판의 자동 저장을 읽는다. 없으면 `null`. */
export const readAutosave = (d: RapfiDb) => readSlot(d, "autosave");

/** 지금 판을 자동 저장 자리에 덮어쓴다. */
export const writeAutosave = (d: RapfiDb, s: AutosaveState) => writeSlot(d, "autosave", s);
