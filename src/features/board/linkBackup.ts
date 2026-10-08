import { create } from "zustand";
import { useGameStore } from "./gameStore";
import { clearSlot, readSlot, writeSlot, type AutosaveState } from "../../data/games";
import type { RapfiDb } from "../../data/db";
import { sameMove } from "../../core/model/move";

/**
 * 국면 딥링크를 열기 직전에 두던 판 — 링크가 판을 덮어도 잃지 않게.
 *
 * 링크를 열면 그 국면이 지금 판이 되어 자동 저장 자리를 덮는다(`autosave.ts`). 그 전에
 * 두던 판이 있었으면 `beforeLink` 자리에 옮겨 두고, 보드 옆 칸에 「두던 판으로 돌아가기 ·
 * 버리기」를 띄운다. **사용자가 둘 중 하나를 고를 때까지 남는다** — 새로고침해도 다시
 * 묻는다. 보관만 하고 다시 꺼낼 길이 없으면 보관하지 않은 것과 같기 때문이다.
 *
 * 두던 판이 비었거나 링크와 같은 판이면 보관하지 않는다(물을 것이 없다).
 */
interface LinkBackupState {
  backup: AutosaveState | null;
  /** 두던 판을 다시 올린다. 지금 판(링크의 국면)은 그 판으로 바뀐다. */
  restore: () => Promise<void>;
  /** 보관한 판을 버린다. */
  discard: () => Promise<void>;
}

let db: RapfiDb | null = null;

export const useLinkBackup = create<LinkBackupState>((set, get) => ({
  backup: null,
  restore: async () => {
    const b = get().backup;
    if (!b) return;
    useGameStore.getState().loadMoves(b.moves, {
      future: b.future,
      name: b.name || null,
      what: `링크를 열기 전 판으로 — ${b.moves.length}수`,
    });
    set({ backup: null });
    if (db) await clearSlot(db, "beforeLink").catch(() => {});
  },
  discard: async () => {
    set({ backup: null });
    if (db) await clearSlot(db, "beforeLink").catch(() => {});
  },
}));

const sameLine = (a: AutosaveState, link: readonly { x: number; y: number }[]) =>
  a.future.length === 0 &&
  a.moves.length === link.length &&
  a.moves.every((m, i) => sameMove(m, link[i]!));

/**
 * 링크를 열 때 — 덮이기 전의 자동 저장을 `beforeLink` 로 옮긴다. 링크가 없을 때 —
 * 지난번에 고르지 않고 떠난 보관판이 있으면 다시 띄운다.
 */
export async function prepareLinkBackup(
  d: RapfiDb,
  link: readonly { x: number; y: number }[] | null,
): Promise<void> {
  db = d;
  try {
    if (link) {
      const old = await readSlot(d, "autosave");
      if (old && old.moves.length + old.future.length > 0 && !sameLine(old, link)) {
        await writeSlot(d, "beforeLink", old);
        useLinkBackup.setState({ backup: old });
        return;
      }
    }
    const kept = await readSlot(d, "beforeLink");
    if (kept) useLinkBackup.setState({ backup: kept });
  } catch {
    /* 저장소가 막혀도 링크는 연다 — 보관만 못 할 뿐이다 */
  }
}
