import { create } from "zustand";
import {
  EMPTY_DB_SNAPSHOT,
  deleteAll as deleteAllCmd,
  deleteOne,
  deleteScopeTitle,
  editComment,
  editLabel,
  editRecord,
  proveWriteTag,
  queryAll,
  queryOne,
  type DbDeleteScope,
  type DbLine,
  type DbSnapshot,
} from "../../core/database/yixindb";
import { DEFAULT_SIZE, type Move } from "../../core/model/move";
import { db } from "../../data/db";
import { CoordMapper } from "../../engine/engine-protocol";
import { engineFs, onDbLine, onEngineBooted, useEngineStore } from "../../engine/engine-state";
import type { EngineCommand } from "../../engine/engine-types";
import { useGameStore } from "../board/gameStore";
import {
  DbChannel,
  replyError,
  untilDeleted,
  untilOne,
  untilText,
  untilWrote,
  type DbPort,
} from "./dbChannel";

/**
 * 엔진 DB(yixindb)의 화면 쪽 — 앱 `DatabaseRepositoryImpl` 의 웹판(W8).
 *
 * **파일은 엔진 메모리 FS 에, 영속은 Dexie 에.** 계획서는 IDBFS 를 적었지만 멀티 변형은 pthread
 * 워커가 FS 를 함께 쓰고 `syncfs` 는 비동기라 탐색 사이 언제 마칠지 붙잡기 어렵다. 대신 Emscripten
 * `FS` 를 내보내(w8 패치) 바이트를 직접 옮긴다:
 *
 * ```
 *  붙이기 : Dexie dbfiles["rapfi.db"] → FS.writeFile("rapfi.db") → info usedatabase 1
 *  저장   : YXSAVEDATABASE → "Saved database file …" → FS.readFile("rapfi.db") → Dexie
 * ```
 *
 * 엔진이 다시 뜨면 메모리 FS 는 비어 있다 — 기동 소식(`onEngineBooted`)을 듣고 다시 붙인다.
 * 그래서 **저장하지 않은 변경은 엔진을 다시 띄우면 사라진다**(데스크톱이 엔진을 죽일 때와 같다).
 * 자동 저장과 탭을 숨길 때의 저장이 그 틈을 줄인다.
 *
 * DB 명령 중 질의(`yxquerydatabase*`)만 탐색을 멈추지 않는다(gomocup.cpp:814). 고치기 · 저장은
 * 엔진의 생각을 끊으므로 분석 중이면 먼저 멈추고, 리뷰 · 증명이 엔진을 쥐고 있으면 받지 않는다.
 */

export const DB_FILE = "rapfi.db";
const CSV_FILE = "rapfi.csv";
const SETTINGS_KEY = "rapfi.db";
const LOG_LIMIT = 120;
/** 붙이기 확인(`DATABASE ONE`)의 끈 — 큰 DB 를 여는 데 걸리는 시간까지. */
const ATTACH_TIMEOUT_MS = 30_000;

export interface DbSettings {
  /** `info usedatabase` — settings.txt 32행. */
  enabled: boolean;
  /** `info database_readonly` — 33행. 모든 쓰기 길을 막는다. */
  readonly: boolean;
  /** 주기 저장 — settings_dev.txt 10행 · 11행. */
  autoSave: boolean;
  autoSaveMinutes: number;
  /** 칸 글자를 태그보다 먼저 그린다 — settings.txt 34행. */
  showBoardText: boolean;
  /** 일괄 삭제 확인 — settings.txt 35행. */
  confirmDeleteAll: boolean;
}

export const DEFAULT_DB_SETTINGS: DbSettings = {
  enabled: false,
  readonly: false,
  autoSave: false,
  autoSaveMinutes: 30,
  showBoardText: true,
  confirmDeleteAll: true,
};

export function sanitizeDbSettings(s: Partial<DbSettings>): DbSettings {
  const d = DEFAULT_DB_SETTINGS;
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  const mins = Number(s.autoSaveMinutes);
  return {
    enabled: bool(s.enabled, d.enabled),
    readonly: bool(s.readonly, d.readonly),
    autoSave: bool(s.autoSave, d.autoSave),
    autoSaveMinutes: Number.isFinite(mins)
      ? Math.min(1440, Math.max(1, Math.round(mins)))
      : d.autoSaveMinutes,
    showBoardText: bool(s.showBoardText, d.showBoardText),
    confirmDeleteAll: bool(s.confirmDeleteAll, d.confirmDeleteAll),
  };
}

function loadSettings(): DbSettings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SETTINGS_KEY);
    return raw ? sanitizeDbSettings(JSON.parse(raw) as Partial<DbSettings>) : DEFAULT_DB_SETTINGS;
  } catch {
    return DEFAULT_DB_SETTINGS;
  }
}

export type DbStatus = "off" | "attaching" | "on" | "error";

interface DbState {
  settings: DbSettings;
  setSettings: (patch: Partial<DbSettings>) => Promise<string | null>;
  status: DbStatus;
  /** 붙이기 실패 · 엔진 소식 따위 — 화면이 그대로 보인다. */
  message: string | null;
  /** Dexie 에 있는 파일 — 크기와 저장 시각. 없으면 null. */
  stored: { size: number; savedAt: number } | null;
  /** 마지막 저장 뒤에 쓴 적이 있나(우리가 보낸 고치기 · 탐색의 DB 쓰기는 모른다 — 보수적으로 참). */
  dirty: boolean;
  busy: boolean;
  /** 마지막으로 읽은 국면과 그 모습. */
  view: { moves: readonly Move[]; snapshot: DbSnapshot } | null;
  log: readonly string[];

  attach: () => Promise<string | null>;
  detach: () => Promise<string | null>;
  save: (why?: string) => Promise<string | null>;
  refresh: (moves: readonly Move[]) => Promise<string | null>;
  setComment: (moves: readonly Move[], text: string) => Promise<string | null>;
  setLabel: (moves: readonly Move[], target: Move, label: string) => Promise<string | null>;
  setRecord: (
    moves: readonly Move[],
    mask: number,
    rec: { tag?: string | null; value?: number; depth?: number },
  ) => Promise<string | null>;
  deleteHere: (moves: readonly Move[]) => Promise<string | null>;
  deleteAll: (moves: readonly Move[], scope: DbDeleteScope) => Promise<string | null>;
  exportCsv: () => Promise<{ bytes: Uint8Array } | { error: string }>;
  exportFile: () => Promise<{ bytes: Uint8Array } | { error: string }>;
  importFile: (bytes: Uint8Array) => Promise<string | null>;
  clearFile: () => Promise<string | null>;
  loadStored: () => Promise<void>;
}

// ── 엔진과의 길 ───────────────────────────────────────────────────────

const coord = new CoordMapper(DEFAULT_SIZE);
const enginePort: DbPort = {
  send: (cmd) => useEngineStore.getState().send(cmd),
  listen: onDbLine,
};
let channel: DbChannel | null = null;
let lineHook: ((l: DbLine) => void) | null = null;

function ch(): DbChannel {
  channel ??= new DbChannel(
    enginePort,
    DEFAULT_SIZE,
    (r, c) => coord.fromWire(r, c),
    (l) => lineHook?.(l),
  );
  return channel;
}

const info = (key: string, value: number): EngineCommand => ({ kind: "info", key, value });

/** 고치기 · 저장이 지금 엔진을 써도 되나. 분석 중이면 멈춘다. 못 쓰면 까닭. */
function claimForWrite(): string | null {
  const e = useEngineStore.getState();
  if (e.owner) return "리뷰나 증명이 엔진을 쓰는 중입니다 — 끝나거나 멈춘 뒤에 하세요";
  if (useGameStore.getState().thinking) return "엔진이 착수를 생각하는 중입니다";
  if (e.analyzing) e.stop();
  return null;
}

async function storedRow() {
  const d = db();
  return d ? ((await d.dbfiles.get(DB_FILE)) ?? null) : null;
}

export const useDbStore = create<DbState>((set, get) => {
  const note = (t: string) => set((s) => ({ log: [...s.log, t].slice(-LOG_LIMIT) }));
  lineHook = (l) => {
    if (l.kind === "saved") note(`저장: ${l.ms}ms`);
    else if (l.kind === "deleted") note(`지움: 기록 ${l.count}개`);
    else if (l.kind === "error") note(`엔진 오류: ${l.text}`);
  };

  const writable = (): string | null => {
    if (get().status !== "on") return "DB 가 붙어 있지 않습니다";
    if (get().settings.readonly) return "읽기 전용 DB 입니다";
    return claimForWrite();
  };

  /** 지금 판으로 다시 읽기 — 고치기 뒤의 확인. */
  /**
   * 국면 하나를 통째로 읽는다 — 자식 값 · 주석(`yxquerydatabaseallt`)과 이 국면의 기록
   * (`yxquerydatabaseone`). 기록(`ONE`)은 따로 물어야 한다: 집계기의 `entry` 는 마지막 `ONE` 일
   * 뿐이라 묻지 않으면 다른 국면(붙이기 확인 · 증명)의 답이 이 국면 것처럼 보인다.
   */
  const readPosition = async (moves: readonly Move[]) => {
    const all = await ch().request(queryAll(moves), untilText);
    const err = replyError(all);
    if (!all) return err;
    const one = await ch().request(queryOne(moves), untilOne);
    const snapshot = one ? one.snapshot : { ...all.snapshot, entry: null };
    set({ view: { moves: [...moves], snapshot } });
    return err ?? replyError(one);
  };
  const reread = async (moves: readonly Move[]) => {
    await readPosition(moves);
  };

  const persist = (s: DbSettings) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* 이번 세션만 */
    }
  };

  return {
    settings: loadSettings(),
    status: "off",
    message: null,
    stored: null,
    dirty: false,
    busy: false,
    view: null,
    log: [],

    setSettings: async (patch) => {
      const prev = get().settings;
      const next = sanitizeDbSettings({ ...prev, ...patch });
      set({ settings: next });
      persist(next);
      // 뜨는 중이면 기동 소식(`wireDatabase`)이 붙인다 — 여기서도 붙이면 두 번 붙는다.
      const st = useEngineStore.getState().status;
      const engineUp = st === "ready" || st === "searching";
      if (next.readonly !== prev.readonly && get().status === "on")
        useEngineStore.getState().send(info("database_readonly", next.readonly ? 1 : 0));
      if (next.enabled !== prev.enabled && engineUp) {
        return next.enabled ? get().attach() : get().detach();
      }
      return null;
    },

    loadStored: async () => {
      const row = await storedRow();
      set({ stored: row ? { size: row.bytes.byteLength, savedAt: row.savedAt } : null });
    },

    attach: async () => {
      if (get().status === "attaching") return "이미 붙이는 중입니다";
      const e = useEngineStore.getState();
      if (e.status === "idle" || e.status === "error")
        return "엔진이 떠 있지 않습니다 — 엔진을 먼저 시작하세요";
      set({ status: "attaching", message: null });
      try {
        const row = await storedRow();
        if (row) {
          const w = await engineFs("write", DB_FILE, row.bytes.slice());
          if (!w.ok) throw new Error(w.error ?? "DB 파일을 엔진에 넣지 못했습니다");
        } else {
          await engineFs("remove", DB_FILE);
        }
        const s = get().settings;
        useEngineStore
          .getState()
          .send(info("database_readonly", s.readonly ? 1 : 0), info("usedatabase", 1));
        const hello = await ch().request(queryOne([]), untilOne, ATTACH_TIMEOUT_MS);
        const err = replyError(hello);
        if (err) throw new Error(err);
        set({
          status: "on",
          dirty: false,
          stored: row ? { size: row.bytes.byteLength, savedAt: row.savedAt } : null,
        });
        note(
          row
            ? `붙임: 저장된 DB ${(row.bytes.byteLength / 1024).toFixed(1)}KB`
            : "붙임: 새 DB(비어 있음)",
        );
        return null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ status: "error", message: msg });
        note(`붙이기 실패: ${msg}`);
        return msg;
      }
    },

    detach: async () => {
      if (get().status !== "on") {
        set({ status: "off" });
        return null;
      }
      const why = claimForWrite();
      if (why) return why;
      if (!get().settings.readonly) {
        const err = await get().save("떼기 전");
        if (err) return err;
      }
      useEngineStore.getState().send(info("usedatabase", 0));
      set({ status: "off", view: null });
      note("뗌");
      return null;
    },

    save: async (why = "저장") => {
      if (get().status !== "on") return "DB 가 붙어 있지 않습니다";
      if (get().settings.readonly) return "읽기 전용 DB 는 저장하지 않습니다";
      const claim = claimForWrite();
      if (claim) return claim;
      set({ busy: true });
      try {
        const r = await engineFs("save", DB_FILE);
        if (!r.ok || !r.bytes) return r.error ?? "엔진이 DB 파일을 돌려주지 않았습니다";
        const d = db();
        const savedAt = Date.now();
        if (d) await d.dbfiles.put({ name: DB_FILE, bytes: r.bytes, savedAt });
        set({ stored: { size: r.bytes.byteLength, savedAt }, dirty: false });
        note(
          `${why}: ${(r.bytes.byteLength / 1024).toFixed(1)}KB${d ? "" : " (이 브라우저는 저장소가 없어 이번 세션만)"}`,
        );
        return null;
      } finally {
        set({ busy: false });
      }
    },

    refresh: async (moves) => {
      if (get().status !== "on") return "DB 가 붙어 있지 않습니다";
      return readPosition(moves);
    },

    setComment: async (moves, text) => {
      const why = writable();
      if (why) return why;
      await ch().request(editComment(text, moves), null);
      set({ dirty: true });
      await reread(moves);
      return null;
    },

    setLabel: async (moves, target, label) => {
      const why = writable();
      if (why) return why;
      await ch().request(
        editLabel(target, label, moves, (m) => coord.toWire(m)),
        null,
      );
      set({ dirty: true });
      await reread(moves);
      return null;
    },

    setRecord: async (moves, mask, rec) => {
      const why = writable();
      if (why) return why;
      const r = await ch().request(editRecord(mask, rec, moves), untilOne);
      set({ dirty: true });
      await reread(moves);
      return replyError(r);
    },

    deleteHere: async (moves) => {
      const why = writable();
      if (why) return why;
      await ch().request(deleteOne(moves), null);
      set({ dirty: true });
      note(`이 국면의 기록을 지움(${moves.length}수)`);
      await reread(moves);
      return null;
    },

    deleteAll: async (moves, scope) => {
      const why = writable();
      if (why) return why;
      set({ busy: true });
      try {
        note(`일괄 삭제: ${deleteScopeTitle(scope)} (${moves.length}수 아래)`);
        const r = await ch().request(deleteAllCmd(scope, moves), untilDeleted, 120_000);
        set({ dirty: true });
        const err = replyError(r);
        await reread(moves);
        return err;
      } finally {
        set({ busy: false });
      }
    },

    exportCsv: async () => {
      if (get().status !== "on") return { error: "DB 가 붙어 있지 않습니다" };
      const claim = claimForWrite();
      if (claim) return { error: claim };
      set({ busy: true });
      try {
        const r = await ch().request(
          { kind: "raw", line: `yxdbtotxtall\n${CSV_FILE}` },
          untilWrote,
          120_000,
        );
        const err = replyError(r);
        if (err) return { error: err };
        // **장벽.** Rapfi 는 `Wrote … database to …` 를 CSV 의 `std::ofstream` 이 **아직 열려 있을 때**
        // 낸다(dbcommand.cpp `databaseToTxt` — 파일은 그 뒤 스코프를 벗어나며 소멸자에서 비워진다).
        // 멀티 변형은 명령이 엔진 스레드에서 돌아 그 소멸자와 우리 FS 읽기가 경주하고, 느린 기계
        // (로컬 Celeron)에서는 0바이트를 읽었다 — CI 러너는 빨라서 이겼다. 엔진은 명령을 한 줄씩
        // 차례로 처리하므로 다음 명령의 답이 오면 앞 명령은 소멸자까지 끝났다. 가장 싼 질의 하나를
        // 왕복시키고 나서 읽는다(DB 저장은 `flush()` 가 파일을 닫은 뒤 알리므로 이것이 필요 없다).
        const barrier = await ch().request(queryOne([]), untilOne, 30_000);
        if (!barrier) return { error: "엔진이 CSV 쓰기를 마쳤는지 답하지 않았습니다" };
        const f = await engineFs("read", CSV_FILE);
        await engineFs("remove", CSV_FILE);
        if (!f.ok || !f.bytes) return { error: f.error ?? "CSV 를 읽지 못했습니다" };
        // 머리줄(`index,key,…`)은 늘 있다 — 비었으면 다 쓰기 전에 읽은 것이다.
        if (f.bytes.byteLength === 0) return { error: "엔진이 빈 CSV 를 남겼습니다" };
        return { bytes: f.bytes };
      } finally {
        set({ busy: false });
      }
    },

    exportFile: async () => {
      // 붙어 있으면 지금 것을 먼저 저장 — 내려받는 파일이 엔진의 최신이어야 한다.
      if (get().status === "on" && !get().settings.readonly) {
        const err = await get().save("내보내기 전 저장");
        if (err) return { error: err };
      }
      const row = await storedRow();
      return row ? { bytes: row.bytes } : { error: "저장된 DB 파일이 없습니다" };
    },

    importFile: async (bytes) => {
      const d = db();
      if (!d) return "이 브라우저는 저장소(IndexedDB)를 쓸 수 없습니다";
      const wasOn = get().status === "on";
      if (wasOn) {
        const claim = claimForWrite();
        if (claim) return claim;
        // 지금 DB 는 버린다 — 떼기 전 저장은 하지 않는다(덮어쓸 파일이다).
        useEngineStore.getState().send(info("usedatabase", 0));
        set({ status: "off", view: null });
      }
      await d.dbfiles.put({ name: DB_FILE, bytes, savedAt: Date.now() });
      set({ stored: { size: bytes.byteLength, savedAt: Date.now() } });
      note(`가져옴: ${(bytes.byteLength / 1024).toFixed(1)}KB`);
      if (wasOn || (get().settings.enabled && useEngineStore.getState().status !== "idle"))
        return get().attach();
      return null;
    },

    clearFile: async () => {
      const wasOn = get().status === "on";
      if (wasOn) {
        const claim = claimForWrite();
        if (claim) return claim;
        useEngineStore.getState().send(info("usedatabase", 0));
        set({ status: "off", view: null });
      }
      await db()?.dbfiles.delete(DB_FILE);
      set({ stored: null });
      note("저장된 DB 를 지움");
      return wasOn ? get().attach() : null;
    },
  };
});

// ── 증명이 쓰는 손잡이 ─────────────────────────────────────────────────

/** 증명의 DB 단계(main.c `prove_send_query` · `prove_send_edit`). 붙어 있지 않으면 null. */
export interface ProveDb {
  /** 이 국면의 기록 — 라벨 문자 코드 · 값 · 깊이. 답이 없으면 null. */
  query(moves: readonly Move[]): Promise<{ label: number; value: number; depth: number } | null>;
  /** 증명된 마디를 적는다(마스크 7). 읽기 전용이면 쓰지 않고 false. */
  write(moves: readonly Move[], winForStm: boolean, value: number, depth: number): Promise<boolean>;
}

export function proveDb(): ProveDb | null {
  const s = useDbStore.getState();
  if (s.status !== "on") return null;
  return {
    query: async (moves) => {
      const r = await ch().request(queryOne(moves), untilOne);
      const one = r?.lines.find((l) => l.kind === "one");
      return one && one.kind === "one"
        ? { label: one.label, value: one.value, depth: one.depth }
        : null;
    },
    write: async (moves, winForStm, value, depth) => {
      if (useDbStore.getState().settings.readonly) return false;
      const r = await ch().request(
        editRecord(
          7,
          {
            tag: proveWriteTag(winForStm),
            value: Math.max(-30000, Math.min(30000, value)),
            depth: depth > 0 ? depth : 1,
          },
          moves,
        ),
        untilOne,
      );
      useDbStore.setState({ dirty: true });
      return r !== null;
    },
  };
}

// ── 기동 · 자동 저장 · 숨길 때 저장 ─────────────────────────────────────

let wired = false;

/** 앱이 한 번 부른다(`main.tsx`). 시험은 부르지 않는다. */
export function wireDatabase(): void {
  if (wired) return;
  wired = true;
  void useDbStore.getState().loadStored();
  onEngineBooted(() => {
    // 새 엔진의 메모리 FS 는 비어 있다 — 앞 엔진에 붙어 있던 DB 는 이미 없다.
    useDbStore.setState({ status: "off", view: null });
    if (useDbStore.getState().settings.enabled) void useDbStore.getState().attach();
  });
  const idle = () => {
    const e = useEngineStore.getState();
    return e.status === "ready" && !e.analyzing && !e.owner && !useGameStore.getState().thinking;
  };
  setInterval(() => {
    const s = useDbStore.getState();
    if (s.status !== "on" || !s.settings.autoSave || s.settings.readonly || s.busy) return;
    const last = s.stored?.savedAt ?? 0;
    if (Date.now() - last < s.settings.autoSaveMinutes * 60_000) return;
    if (!idle()) return;
    void s.save("자동 저장");
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    const s = useDbStore.getState();
    if (document.visibilityState !== "hidden") return;
    if (s.status !== "on" || s.settings.readonly || !s.dirty || s.busy || !idle()) return;
    void s.save("탭을 숨길 때 저장");
  });
}

/** 시험 전용 — 길을 갈아 끼운다. */
export function setDbPortForTest(p: DbPort | null): void {
  channel?.close();
  channel = p ? new DbChannel(p, DEFAULT_SIZE, (r, c) => coord.fromWire(r, c)) : null;
  useDbStore.setState({
    settings: DEFAULT_DB_SETTINGS,
    status: "off",
    message: null,
    stored: null,
    dirty: false,
    busy: false,
    view: null,
    log: [],
  });
}

export { EMPTY_DB_SNAPSHOT };

/** 스모크 · 개발자 도구가 DB 상태를 꺼내 보는 손잡이(`__rapfiDb()`). */
if (typeof window !== "undefined") {
  (window as unknown as { __rapfiDb: () => unknown }).__rapfiDb = () => {
    const s = useDbStore.getState();
    const snap = s.view?.snapshot ?? null;
    return {
      status: s.status,
      message: s.message,
      stored: s.stored,
      dirty: s.dirty,
      moves: s.view?.moves.length ?? null,
      cells: snap
        ? [...snap.cells.values()].map((c) => ({
            x: c.move.x,
            y: c.move.y,
            tag: c.tag,
            text: c.text,
          }))
        : [],
      comment: snap?.comment ?? null,
      entry: snap?.entry ?? null,
      log: s.log,
    };
  };
}
