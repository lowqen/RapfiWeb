import { create } from "zustand";
import { db } from "../../../data/db";
import { buildPack, packBytes, type PackSource, type RenjuPack } from "../../../core/rif/pack";
import {
  GameColumns,
  RES_BLACK,
  RES_DRAW,
  RES_UNKNOWN,
  RES_WHITE,
} from "../../../core/rif/rif-parse";
import { result } from "../../../core/model/referee";
import { DEFAULT_SIZE } from "../../../core/model/move";
import {
  NO_GAMES,
  type FromRifWorker,
  type LocalGame,
  type RifPhase,
  type ToRifWorker,
} from "./protocol";
import { t, useLang } from "../../../i18n/i18n";

/**
 * W7 팩의 화면 쪽 — 변환(워커) · 저장(IndexedDB) · 불러오기 · 내 기보 폴백.
 *
 * **팩은 쓸 때만 읽는다.** 랭킹 · 오프닝 화면이 처음 열릴 때 `ensure()` 가 IndexedDB 에서 꺼낸다 —
 * 15MB 를 앱이 뜰 때마다 들 까닭이 없다. RenjuNet 팩이 없으면 **내 기보**(`games` 표 — 저장한 기보와
 * 지금 판)로 같은 모양의 팩을 그 자리에서 만든다(몇 판이라 수 ms).
 *
 * `.rif` 와 그 팩은 이 기기 밖으로 나가지 않는다(RenjuNet 라이선스 — 오프라인 · 비상업 전용).
 */

export interface RifJob {
  fileName: string;
  fileSize: number;
  phase: RifPhase;
  fraction: number;
  loaded: number;
  games: number;
  startedAt: number;
}

export interface RifDone {
  fileName: string;
  ms: number;
  games: number;
  positions: number;
  packBytes: number;
  peakBytes: number;
  /** 저장하지 못했으면 까닭(그래도 이번 세션은 쓴다). */
  saveError: string | null;
}

interface RifState {
  /** 저장된 팩을 읽어 봤는가. */
  ready: boolean;
  pack: RenjuPack | null;
  local: RenjuPack | null;
  /** 둘 다 있을 때 무엇을 보나. */
  source: PackSource;
  job: RifJob | null;
  done: RifDone | null;
  error: string | null;

  ensure: () => Promise<void>;
  importFile: (file: File) => Promise<void>;
  cancel: () => void;
  remove: () => Promise<void>;
  refreshLocal: () => Promise<void>;
  setSource: (s: PackSource) => void;
  dismiss: () => void;
}

/** 지금 보여 줄 팩 — RenjuNet 을 고른 상태이고 있으면 그것, 아니면 내 기보. */
export const activePack = (s: Pick<RifState, "pack" | "local" | "source">): RenjuPack | null =>
  s.source === "renjunet" && s.pack ? s.pack : (s.local ?? s.pack);

/** `.rif` 로 볼 만한 파일인가 — 이름으로만 본다(내용은 워커가 확인한다). */
export const isRifFile = (f: File): boolean => /\.(rif|xml)$/i.test(f.name);

let worker: Worker | null = null;
let ensuring: Promise<void> | null = null;

function spawn(): Worker {
  // Vite 가 워커를 번들로 알아보려면 `new Worker(new URL(…))` 가 이 모양 그대로여야 한다.
  return new Worker(new URL("./rif.worker.ts", import.meta.url), {
    type: "classic",
    name: "rapfi-rif",
  });
}

/** 워커에 한 일을 맡기고 끝(팩)을 기다린다. 진행은 `onProgress`. */
function run(
  msg: ToRifWorker,
  onProgress: (m: Extract<FromRifWorker, { type: "progress" }>) => void,
): Promise<{ pack: RenjuPack; ms: number }> {
  return new Promise((resolve, reject) => {
    worker?.terminate();
    const w = spawn();
    worker = w;
    w.onmessage = (ev: MessageEvent<FromRifWorker>) => {
      const m = ev.data;
      if (m.type === "progress") onProgress(m);
      else {
        w.terminate();
        if (worker === w) worker = null;
        if (m.type === "done") resolve({ pack: m.pack, ms: m.ms });
        else reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      if (worker === w) worker = null;
      reject(new Error(e.message || t("변환 워커가 멈췄습니다")));
    };
    w.postMessage(msg);
  });
}

/**
 * 내 기보 팩 — 몇 판뿐이라 **메인 스레드에서** 곧바로 만든다(수 ms). 워커는 `.rif` 전용이다 — 같은
 * 워커를 쓰면 변환 도중 랭킹 화면을 여는 순간 변환을 죽인다. 한 판에만 나온 국면도 보여 준다.
 */
export function buildLocalPack(games: readonly LocalGame[]): RenjuPack {
  const cols = new GameColumns();
  games.forEach((g, i) =>
    cols.add(
      { id: i + 1, tournament: i, rule: 0, black: 0, white: 1, res: g.res },
      g.cells,
      g.cells.length,
    ),
  );
  cols.trim();
  return buildPack(
    {
      source: "local",
      date: new Date().toISOString().slice(0, 10),
      fileName: t("내 기보"),
      fileSize: 0,
      games: cols,
      playerName: (id) => ({ name: id === 0 ? t("흑") : t("백"), country: "" }),
      ruleName: () => t("내 기보"),
      tournament: (id) => ({
        name: games[id]?.name ?? "",
        year: new Date(games[id]?.savedAt ?? 0).getFullYear(),
      }),
      skipped: {},
      parseMs: 0,
    },
    { minGames: 1, partitions: 1 },
  );
}

/** 내 기보 → 변환 입력. 같은 수순은 한 판으로, 판 크기가 다른 것은 뺀다. */
async function localGames(): Promise<LocalGame[]> {
  const rows = (await db()?.games.toArray()) ?? [];
  const seen = new Set<string>();
  const out: LocalGame[] = [];
  for (const r of rows) {
    if (r.size !== DEFAULT_SIZE || r.moves.length === 0) continue;
    const key = r.moves.map((m) => m.y * r.size + m.x).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const res = result(r.moves, r.size, true);
    out.push({
      name: r.slot === "autosave" ? t("지금 판") : r.name,
      cells: Uint8Array.from(r.moves.map((m) => m.y * r.size + m.x)),
      res: !res
        ? RES_UNKNOWN
        : res.winner === "black"
          ? RES_BLACK
          : res.winner === "white"
            ? RES_WHITE
            : RES_DRAW,
      savedAt: r.savedAt,
    });
  }
  return out;
}

export const useRifStore = create<RifState>((set, get) => ({
  ready: false,
  pack: null,
  local: null,
  source: "renjunet",
  job: null,
  done: null,
  error: null,

  ensure: () => {
    ensuring ??= (async () => {
      try {
        const row = await db()?.packs.get("renjunet");
        if (row?.pack && !get().pack) set({ pack: row.pack });
      } catch {
        // 저장소를 못 읽어도(사생활 보호 모드 등) 화면은 내 기보로 돈다
      }
      set({ ready: true });
      if (!get().pack) await get().refreshLocal();
    })();
    return ensuring;
  },

  refreshLocal: async () => {
    const games = await localGames();
    set({ local: games.length ? buildLocalPack(games) : null });
  },

  importFile: async (file) => {
    if (typeof Worker === "undefined") return;
    if (get().job) return;
    set({
      job: {
        fileName: file.name,
        fileSize: file.size,
        phase: "read",
        fraction: 0,
        loaded: 0,
        games: 0,
        startedAt: performance.now(),
      },
      done: null,
      error: null,
    });
    try {
      const { pack, ms } = await run({ type: "rif", file }, (m) =>
        set((s) =>
          s.job
            ? {
                job: {
                  ...s.job,
                  phase: m.phase,
                  // 막대는 뒤로 가지 않는다
                  fraction: Math.max(s.job.fraction, m.fraction),
                  loaded: m.loaded,
                  games: m.games,
                },
              }
            : {},
        ),
      );
      let saveError: string | null = null;
      try {
        const d = db();
        if (!d) saveError = t("이 브라우저는 저장소(IndexedDB)를 쓸 수 없어 이번 세션만 씁니다");
        else await d.packs.put({ name: "renjunet", pack, savedAt: Date.now() });
      } catch (e) {
        saveError = t("저장 공간이 모자라 이번 세션만 씁니다 ({why})", {
          why: e instanceof Error ? e.name : String(e),
        });
      }
      set({
        pack,
        source: "renjunet",
        ready: true,
        job: null,
        done: {
          fileName: file.name,
          ms,
          games: pack.games.id.length,
          positions: pack.pos.n.length,
          packBytes: packBytes(pack),
          peakBytes: pack.stats.peakBytes,
          saveError,
        },
      });
    } catch (e) {
      if (!get().job) return; // 취소했다
      const why = e instanceof Error ? e.message : String(e);
      set({
        job: null,
        error:
          why === NO_GAMES
            ? t(
                "이 파일에서 대국을 찾지 못했습니다. renju.net 기보 화면의 [XML] 로 받은 파일(.rif)인지 확인해 주세요.",
              )
            : why,
      });
    }
  },

  cancel: () => {
    worker?.terminate();
    worker = null;
    set({ job: null });
  },

  remove: async () => {
    try {
      await db()?.packs.delete("renjunet");
    } catch {
      /* 없으면 이미 없다 */
    }
    set({ pack: null, done: null });
    await get().refreshLocal();
  },

  setSource: (source) => set({ source }),
  dismiss: () => set({ done: null, error: null }),
}));

// 내 기보 팩의 이름(흑 · 백 · 내 기보)은 만들 때의 언어로 굳는다 — 언어가 바뀌면 다시 만든다(몇 판이라 수 ms).
useLang.subscribe(() => {
  if (useRifStore.getState().local) void useRifStore.getState().refreshLocal();
});

/** 스모크 · 실측이 변환 상태를 꺼내 보는 손잡이(`__rapfiPack()`). */
if (typeof window !== "undefined") {
  (window as unknown as { __rapfiPack: () => unknown }).__rapfiPack = () => {
    const s = useRifStore.getState();
    const p = s.pack;
    return {
      ready: s.ready,
      job: s.job,
      done: s.done,
      error: s.error,
      pack: p
        ? {
            games: p.games.id.length,
            positions: p.pos.n.length,
            edges: p.edges.n.length,
            date: p.date,
            stats: p.stats,
          }
        : null,
      local: s.local ? { games: s.local.games.id.length } : null,
    };
  };
}
