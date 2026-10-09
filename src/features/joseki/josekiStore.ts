import { create } from "zustand";
import { exportJson, exportPsq, importJson } from "../../core/joseki/io";
import { movesText, parseMoveText } from "../../core/joseki/parse";
import {
  NODE_WARN,
  addLine,
  addMove,
  countNodes,
  illegal,
  mainLineFrom,
  moveSibling,
  movesTo,
  newTree,
  nodeAt,
  promoteLine,
  removeAt,
  setComment,
  setMark,
  stepForward,
  type JosekiMark,
  type JosekiNode,
  type JosekiTree,
} from "../../core/joseki/tree";
import { formatOf, parseGameFile } from "../../core/model/game-file";
import { label, sameMove, type Move } from "../../core/model/move";
import { keyOf } from "../../core/model/pos-key";
import { db } from "../../data/db";
import { deleteJoseki, findByKey, listJoseki, putJoseki } from "../../data/joseki";
import { useBoardStore } from "../board/boardStore";
import { useGameStore } from "../board/gameStore";

/**
 * 정석 화면의 상태(W9) — 목록, 열린 정석 하나, 그 안의 커서(`path`).
 *
 * 고치기는 `core/joseki/tree.ts` 의 순수 함수로 새 뿌리를 만들고, 0.6초 쉬면 Dexie 에 쓴다(문서와
 * 국면 색인을 한 트랜잭션으로 — `data/joseki.ts`). 되돌리기는 뿌리 50개까지.
 */

const SAVE_DELAY_MS = 600;
const UNDO_LIMIT = 50;

export interface PositionHit {
  tree: JosekiTree;
  path: number[];
  ply: number;
}

interface JosekiState {
  list: JosekiTree[];
  loaded: boolean;
  current: JosekiTree | null;
  path: number[];
  undo: JosekiNode[];
  saving: boolean;
  notice: string | null;
  hits: PositionHit[] | null;

  load: () => Promise<void>;
  create: (fromBoard: boolean) => Promise<void>;
  open: (id: string, path?: number[]) => void;
  close: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  setInfo: (patch: Partial<Pick<JosekiTree, "title" | "category" | "tags">>) => void;

  go: (path: number[]) => void;
  back: () => void;
  forward: () => void;
  first: () => void;
  last: () => void;
  /** 이 수의 마디로 — 지금 줄 위에 있으면 거기로, 자식이면 그 자식으로. */
  jumpTo: (m: Move) => boolean;

  play: (m: Move) => void;
  addText: (text: string) => boolean;
  deleteNode: () => void;
  promote: () => void;
  shift: (dir: -1 | 1) => void;
  setNodeComment: (text: string) => void;
  setNodeMark: (mark: JosekiMark | null) => void;
  undoEdit: () => void;

  importFiles: (files: readonly File[]) => Promise<void>;
  exportAll: () => string;
  exportCurrent: () => string | null;
  exportLine: () => Uint8Array<ArrayBuffer> | null;
  toBoard: () => void;
  findBoard: () => Promise<void>;
  clearNotice: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useJosekiStore = create<JosekiState>((set, get) => {
  const persist = async (t: JosekiTree) => {
    const d = db();
    if (!d) return;
    set({ saving: true });
    try {
      await putJoseki(d, t);
    } finally {
      set({ saving: false });
    }
  };
  const flush = async () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    const t = get().current;
    if (t) await persist(t);
  };
  const schedule = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };
  /** 열린 정석을 새 뿌리 · 정보로 바꾸고 목록에도 반영, 저장을 미룬다. */
  const commit = (patch: Partial<JosekiTree>, path?: number[], keepUndo = false) => {
    const t = get().current;
    if (!t) return;
    const next: JosekiTree = { ...t, ...patch, updatedAt: Date.now() };
    const undo = keepUndo || !patch.root ? get().undo : [...get().undo, t.root].slice(-UNDO_LIMIT);
    set((s) => ({
      current: next,
      path: path ?? s.path,
      undo,
      list: [next, ...s.list.filter((x) => x.id !== next.id)],
    }));
    schedule();
    if (patch.root && countNodes(next.root) === NODE_WARN)
      set({ notice: `수가 ${NODE_WARN}개가 넘었습니다 — 정석을 나누면 저장이 가벼워집니다` });
  };
  const tell = (notice: string) => set({ notice });

  return {
    list: [],
    loaded: false,
    current: null,
    path: [],
    undo: [],
    saving: false,
    notice: null,
    hits: null,

    load: async () => {
      const d = db();
      const list = d ? await listJoseki(d) : get().list;
      set({ list, loaded: true });
    },

    create: async (fromBoard) => {
      const t = newTree();
      let path: number[] = [];
      if (fromBoard) {
        const stones = useBoardStore.getState().render.stones;
        const r = addLine(t.root, stones, [], t.boardSize);
        t.root = r.root;
        path = r.path;
        t.title = stones.length
          ? `${movesText(stones.slice(0, 5))}${stones.length > 5 ? " …" : ""}`
          : t.title;
      }
      set((s) => ({ current: t, path, undo: [], list: [t, ...s.list], hits: null }));
      await persist(t);
    },

    open: (id, path = []) => {
      const t =
        get().list.find((x) => x.id === id) ?? get().hits?.find((h) => h.tree.id === id)?.tree;
      if (!t) return;
      set({ current: t, path: nodeAt(t.root, path) ? path : [], undo: [], notice: null });
    },

    close: async () => {
      await flush();
      set({ current: null, path: [], undo: [] });
    },

    remove: async (id) => {
      if (get().current?.id === id) {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        set({ current: null, path: [], undo: [] });
      }
      const d = db();
      if (d) await deleteJoseki(d, id);
      set((s) => ({
        list: s.list.filter((x) => x.id !== id),
        hits: s.hits?.filter((h) => h.tree.id !== id) ?? null,
      }));
    },

    setInfo: (patch) => commit(patch),

    go: (path) => {
      const t = get().current;
      if (t && nodeAt(t.root, path)) set({ path });
    },
    back: () => set((s) => ({ path: s.path.slice(0, -1) })),
    forward: () => {
      const t = get().current;
      if (t) set({ path: stepForward(t.root, get().path) });
    },
    first: () => set({ path: [] }),
    last: () => {
      const t = get().current;
      if (t) set({ path: mainLineFrom(t.root, get().path) });
    },
    jumpTo: (m) => {
      const t = get().current;
      if (!t) return false;
      const { path } = get();
      const moves = movesTo(t.root, path);
      const at = moves.findIndex((x) => sameMove(x, m));
      if (at >= 0) {
        set({ path: path.slice(0, at + 1) });
        return true;
      }
      const kids = nodeAt(t.root, path)?.children ?? [];
      const i = kids.findIndex((c) => sameMove(c.move, m));
      if (i >= 0) {
        set({ path: [...path, i] });
        return true;
      }
      return false;
    },

    play: (m) => {
      const t = get().current;
      if (!t) return;
      const why = illegal(t.root, get().path, m, t.boardSize);
      const kids = nodeAt(t.root, get().path)?.children ?? [];
      if (why && !kids.some((c) => sameMove(c.move, m))) {
        tell(`${label(m, t.boardSize)}: ${why}`);
        return;
      }
      const r = addMove(t.root, get().path, m, t.boardSize);
      if (!r) return;
      if (r.added) commit({ root: r.root }, r.path);
      else set({ path: r.path });
    },

    addText: (text) => {
      const t = get().current;
      if (!t) return false;
      const p = parseMoveText(text, t.boardSize);
      if (!p.ok) {
        tell(p.error);
        return false;
      }
      if (p.moves.length === 0) return false;
      const r = addLine(t.root, p.moves, get().path, t.boardSize);
      if (r.stoppedAt !== null) {
        tell(
          `${r.stoppedAt + 1}번째 수 ${label(p.moves[r.stoppedAt]!, t.boardSize)} 는 이 줄에 둘 수 없습니다 — 그 앞까지 넣었습니다`,
        );
      }
      if (r.added > 0) commit({ root: r.root }, r.path);
      else set({ path: r.path });
      return r.stoppedAt === null;
    },

    deleteNode: () => {
      const t = get().current;
      if (!t) return;
      const r = removeAt(t.root, get().path);
      if (r) commit({ root: r.root }, r.path);
    },

    promote: () => {
      const t = get().current;
      if (!t) return;
      const r = promoteLine(t.root, get().path);
      if (r.root !== t.root) commit({ root: r.root }, r.path);
    },

    shift: (dir) => {
      const t = get().current;
      if (!t) return;
      const r = moveSibling(t.root, get().path, dir);
      if (r.root !== t.root) commit({ root: r.root }, r.path);
    },

    setNodeComment: (text) => {
      const t = get().current;
      if (!t || nodeAt(t.root, get().path)?.comment === text) return;
      // 글자마다 되돌리기 칸을 쓰지 않는다 — 메모는 되돌리기 밖.
      commit({ root: setComment(t.root, get().path, text) }, undefined, true);
    },

    setNodeMark: (mark) => {
      const t = get().current;
      if (!t) return;
      commit({ root: setMark(t.root, get().path, mark) });
    },

    undoEdit: () => {
      const t = get().current;
      const u = get().undo;
      if (!t || u.length === 0) return;
      const root = u[u.length - 1]!;
      let path = get().path;
      while (path.length && !nodeAt(root, path)) path = path.slice(0, -1);
      set({ undo: u.slice(0, -1) });
      commit({ root }, path, true);
    },

    importFiles: async (files) => {
      const notes: string[] = [];
      const added: JosekiTree[] = [];
      for (const f of files) {
        const fmt = formatOf(f.name);
        if (fmt) {
          // 기보 → 정석 초안: 열린 정석이 있으면 그 뿌리에 한 줄로 잇는다, 없으면 새 정석.
          const moves = parseGameFile(new Uint8Array(await f.arrayBuffer()), fmt, 15);
          if (!moves) {
            notes.push(`${f.name}: 기보를 읽지 못했습니다`);
            continue;
          }
          const cur = get().current;
          if (cur) {
            const r = addLine(cur.root, moves, [], cur.boardSize);
            commit({ root: r.root }, r.path);
            notes.push(`${f.name}: ${moves.length}수를 이 정석에 이었습니다(새 마디 ${r.added}개)`);
          } else {
            const t = newTree(f.name.replace(/\.[^.]+$/, ""));
            t.root = addLine(t.root, moves, [], t.boardSize).root;
            added.push(t);
          }
          continue;
        }
        const r = importJson(await f.text());
        if (!r.ok) {
          notes.push(`${f.name}: ${r.error}`);
          continue;
        }
        // 같은 id 가 이미 있으면 새 id 로 — 남의 파일이 내 정석을 덮어쓰지 않게.
        const have = new Set(get().list.map((x) => x.id));
        for (const t of r.trees) added.push(have.has(t.id) ? { ...t, id: newTree().id } : t);
        if (r.dropped)
          notes.push(`${f.name}: 둘 수 없는 수 ${r.dropped}개(와 그 아래)를 버렸습니다`);
      }
      const d = db();
      if (d) for (const t of added) await putJoseki(d, t);
      if (added.length) {
        set((s) => ({ list: [...added, ...s.list] }));
        notes.unshift(`정석 ${added.length}개를 가져왔습니다`);
      }
      if (notes.length) tell(notes.join("\n"));
    },

    exportAll: () => exportJson(get().list),
    exportCurrent: () => {
      const t = get().current;
      return t ? exportJson([t]) : null;
    },
    exportLine: () => {
      const t = get().current;
      return t ? exportPsq(t, get().path) : null;
    },

    toBoard: () => {
      const t = get().current;
      if (!t) return;
      const moves = movesTo(t.root, get().path);
      useGameStore
        .getState()
        .loadMoves(moves, { name: t.title, what: `정석 «${t.title}» — ${moves.length}수` });
      tell(`보드에 ${moves.length}수를 올렸습니다`);
    },

    findBoard: async () => {
      const stones = useBoardStore.getState().render.stones;
      if (stones.length === 0) {
        tell("보드가 비었습니다 — 돌을 놓고 찾으세요");
        return;
      }
      await flush();
      const d = db();
      const hits = d ? await findByKey(d, keyOf(stones)) : [];
      set({ hits });
      if (hits.length === 0) tell(`이 국면(${stones.length}수)을 담은 정석이 없습니다`);
    },

    clearNotice: () => set({ notice: null }),
  };
});

/** 시험 전용. */
export function resetJosekiForTest(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  useJosekiStore.setState({
    list: [],
    loaded: false,
    current: null,
    path: [],
    undo: [],
    saving: false,
    notice: null,
    hits: null,
  });
}
