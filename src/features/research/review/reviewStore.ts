import { create } from "zustand";
import { db as defaultDb, type RapfiDb, type ReviewJob, type ReviewRow } from "../../../data/db";
import {
  addJob,
  addReview,
  clearFinishedJobs,
  deleteJob,
  deleteReview,
  listJobs,
  listReviews,
  recoverInterruptedJobs,
  updateJob,
} from "../../../data/reviews";
import { useCurrentReview } from "../../../data/current-review";
import {
  DEFAULT_BUDGET,
  buildReport,
  sanitizeBudget,
  type GameReport,
  type ReviewBudget,
} from "../../../core/review/report";
import { coord, type GradingPreset } from "../../../core/review/move-quality";
import { baseName, formatOf, parseGameFile } from "../../../core/model/game-file";
import type { Move } from "../../../core/model/move";
import { useEngineStore } from "../../../engine/engine-state";
import { useBoardStore } from "../../board/boardStore";
import { useGameStore } from "../../board/gameStore";
import { runReview, type ReviewPort } from "./runner";
import { t } from "../../../i18n/i18n";

/**
 * 게임 리뷰의 화면 쪽 — 앱 `ReviewRepositoryImpl` 의 큐 · 실행 · 리포트 상태.
 *
 * **모든 리뷰는 큐를 지난다.** 「지금 판 리뷰」는 지금 판(무른 수까지)을 작업으로 만들어 맨
 * 앞에 끼우고 큐를 돌린다. 그래서 체크포인트 · 이어서 하기 · 리포트 저장이 한 길이다.
 *
 * 엔진은 리뷰가 도는 동안 **독점**한다(`engine-state` 의 `owner`). 분석은 꺼지고, 대국의
 * 엔진 착수도 받지 않는다 — 앱 · 데스크톱의 `reviewactive` 와 같다.
 */

export interface ReviewSettings {
  budget: ReviewBudget;
  /** 첫 다섯 수는 읽지도 매기지도 않는다(`SKIP_OPENING_N`). */
  skipOpening: boolean;
  preset: GradingPreset;
}

const SETTINGS_KEY = "rapfi.review";
const DEFAULT_SETTINGS: ReviewSettings = {
  budget: DEFAULT_BUDGET,
  skipOpening: true,
  preset: "default",
};

function loadSettings(): ReviewSettings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const v = JSON.parse(raw) as Partial<ReviewSettings>;
    return {
      budget: sanitizeBudget({ ...DEFAULT_BUDGET, ...v.budget }),
      skipOpening: v.skipOpening ?? true,
      preset: v.preset === "strict" || v.preset === "lenient" ? v.preset : "default",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: ReviewSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 저장이 안 돼도 이번 세션은 그대로 */
  }
}

export interface ReviewProgress {
  jobId: number;
  name: string;
  index: number;
  total: number;
  /** 큐에서 몇 번째인가(1부터)와 이번 실행의 작업 수. */
  queueIndex: number;
  queueTotal: number;
}

const LOG_LIMIT = 60;

interface ReviewState {
  settings: ReviewSettings;
  setBudget: (b: Partial<ReviewBudget>) => void;
  setSkipOpening: (v: boolean) => void;
  setPreset: (p: GradingPreset) => void;

  jobs: ReviewJob[];
  reviews: ReviewRow[];
  selectedId: number | null;
  running: boolean;
  progress: ReviewProgress | null;
  log: readonly string[];
  /** 스토어가 저장소에서 큐와 리포트를 읽어 왔다. */
  loaded: boolean;

  /** 저장소에서 큐와 리포트를 읽는다(한 번). 시험은 저장소를 넘긴다. */
  init: (d?: RapfiDb | null) => Promise<void>;
  /** 지금 판(무른 수까지)을 맨 앞에 끼워 리뷰한다. 못 하면 까닭. */
  reviewBoard: () => Promise<string | null>;
  /** 기보 파일들을 큐 끝에 더한다. 읽지 못한 파일은 실패 작업으로 남긴다. */
  addFiles: (files: readonly File[]) => Promise<void>;
  removeJob: (id: number) => Promise<void>;
  clearFinished: () => Promise<void>;
  /** 큐를 돈다(대기 · 중단 작업을 순서대로). 못 하면 까닭. */
  start: () => Promise<string | null>;
  cancel: () => void;
  select: (id: number | null) => void;
  removeReview: (id: number) => Promise<void>;
  /** 고른 리포트의 `ply` 수째 국면을 보드에 올린다(앞날은 무른 수로). */
  openOnBoard: (ply: number) => void;
}

let db: RapfiDb | null = null;
let cancelFlag = false;

/** 고른 리포트를 지금 기준으로 다시 만든다. */
export function reportOf(row: ReviewRow, preset: GradingPreset): GameReport {
  return buildReport({
    title: row.title,
    data: { moves: row.moves, size: row.size, records: row.records },
    budget: row.budget,
    preset,
    skipOpening: row.skipOpening,
    createdAt: row.createdAt,
  });
}

const percent = (v: number | null) => `${(v ?? 0).toFixed(1)}%`;

/** 엔진 스토어를 리뷰 포트로. */
const enginePort: ReviewPort = {
  search: (stones, opts, onSnapshot) =>
    useEngineStore.getState().exclusiveSearch(stones, opts, onSnapshot),
  stop: () => useEngineStore.getState().stop(),
};

export const useReviewStore = create<ReviewState>((set, get) => {
  const note = (text: string) => set((s) => ({ log: [...s.log, text].slice(-LOG_LIMIT) }));

  const patchJob = (id: number, patch: Partial<ReviewJob>) => {
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
    if (db) void updateJob(db, id, patch).catch(() => {});
  };

  const publishSelection = () => {
    const { selectedId, reviews, settings } = get();
    const row = reviews.find((r) => r.id === selectedId);
    useCurrentReview.setState({
      data: row ? { moves: row.moves, size: row.size, records: row.records } : null,
      preset: settings.preset,
      skipOpening: row?.skipOpening ?? settings.skipOpening,
    });
  };

  const updateSettings = (next: ReviewSettings) => {
    set({ settings: next });
    saveSettings(next);
    publishSelection();
  };

  const nextOrder = () => Math.max(0, ...get().jobs.map((j) => j.order)) + 1;

  const newJob = (
    name: string,
    size: number,
    moves: readonly Move[],
    order: number,
  ): Omit<ReviewJob, "id"> => ({
    order,
    name,
    size,
    moves: moves.map(({ x, y }) => ({ x, y })),
    status: "pending",
    records: [],
    index: 0,
    result: "",
    createdAt: Date.now(),
  });

  /** 리뷰를 시작할 수 없는 까닭(main.c:7189 · 7195 · 7440 의 거절). */
  const refusal = (): string | null => {
    if (get().running) return t("이미 리뷰가 진행 중입니다");
    if (useGameStore.getState().thinking) return t("엔진이 대국 수를 계산 중입니다. 먼저 멈추세요");
    return null;
  };

  return {
    settings: loadSettings(),
    setBudget: (b) =>
      updateSettings({
        ...get().settings,
        budget: sanitizeBudget({ ...get().settings.budget, ...b }),
      }),
    setSkipOpening: (v) => updateSettings({ ...get().settings, skipOpening: v }),
    setPreset: (p) => updateSettings({ ...get().settings, preset: p }),

    jobs: [],
    reviews: [],
    selectedId: null,
    running: false,
    progress: null,
    log: [],
    loaded: false,

    init: async (d) => {
      if (get().loaded) return;
      db = d === undefined ? defaultDb() : d;
      if (!db) {
        set({ loaded: true });
        return;
      }
      try {
        await recoverInterruptedJobs(db);
        const [jobs, reviews] = await Promise.all([listJobs(db), listReviews(db)]);
        set({ jobs, reviews, loaded: true, selectedId: reviews[0]?.id ?? null });
        publishSelection();
      } catch {
        set({ loaded: true });
      }
    },

    reviewBoard: async () => {
      const why = refusal();
      if (why) return why;
      const { render, future } = useBoardStore.getState();
      const moves = [...render.stones, ...future];
      if (moves.length === 0) return t("리뷰할 수가 없습니다");
      const order = Math.min(0, ...get().jobs.map((j) => j.order)) - 1;
      const name =
        useGameStore.getState().gameName ??
        (moves
          .slice(0, 3)
          .map((m) => coord(m, render.size))
          .join("-") ||
          "game");
      const draft = newJob(name, render.size, moves, order);
      const job = db ? await addJob(db, draft) : { ...draft, id: -Date.now() };
      set((s) => ({ jobs: [job, ...s.jobs].sort((a, b) => a.order - b.order) }));
      note(t("지금 판을 큐 맨 앞에: {name} ({n}수)", { name, n: moves.length }));
      return get().start();
    },

    addFiles: async (files) => {
      const size = useBoardStore.getState().render.size;
      let order = nextOrder();
      for (const file of files) {
        const format = formatOf(file.name);
        let moves: Move[] | null = null;
        if (format) {
          try {
            moves = parseGameFile(new Uint8Array(await file.arrayBuffer()), format, size);
          } catch {
            moves = null;
          }
        }
        const draft = newJob(baseName(file.name), size, moves ?? [], order++);
        if (!moves || moves.length === 0) {
          draft.status = "failed";
          draft.result = !format
            ? t("실패: 모르는 형식(.psq · .sav · .pos)")
            : moves === null
              ? t("실패: 파일을 읽을 수 없음")
              : t("실패: 수가 없음");
          note(t("큐: {name} 을(를) 읽을 수 없어 건너뜁니다", { name: file.name }));
        }
        const job = db ? await addJob(db, draft) : { ...draft, id: -Date.now() - order };
        set((s) => ({ jobs: [...s.jobs, job] }));
      }
    },

    removeJob: async (id) => {
      if (get().progress?.jobId === id) return;
      set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
      if (db) await deleteJob(db, id).catch(() => {});
    },

    clearFinished: async () => {
      set((s) => ({ jobs: s.jobs.filter((j) => j.status !== "done" && j.status !== "failed") }));
      if (db) await clearFinishedJobs(db).catch(() => {});
    },

    start: async () => {
      const why = refusal();
      if (why) return why;
      const runnable = () =>
        get().jobs.filter((j) => j.status === "pending" || j.status === "paused");
      if (runnable().length === 0) return t("리뷰할 작업이 없습니다");
      const lock = useEngineStore.getState().acquire("review");
      if (lock) {
        return useEngineStore.getState().owner === "prove"
          ? t("국면 증명이 진행 중입니다. 먼저 멈추세요")
          : lock;
      }
      cancelFlag = false;
      set({ running: true });
      const queueTotal = runnable().length;
      let queueIndex = 0;
      let reviewed = 0;
      let failed = 0;
      try {
        for (;;) {
          const job = runnable()[0];
          if (!job || job.id === undefined || cancelFlag) break;
          const id = job.id;
          queueIndex++;
          patchJob(id, { status: "running", result: "" });
          const { budget, skipOpening } = get().settings;
          const outcome = await runReview(
            {
              moves: job.moves,
              size: job.size,
              records: job.records,
              index: job.index,
              log: job.log ?? [],
            },
            { budget, skipOpening },
            enginePort,
            {
              onCheckpoint: (records, index, log) =>
                patchJob(id, { records: [...records], index, log: [...log] }),
              onProgress: (index, total) =>
                set({
                  progress: { jobId: id, name: job.name, index, total, queueIndex, queueTotal },
                }),
              isCancelled: () => cancelFlag,
              log: note,
            },
          );
          if (outcome.kind === "done") {
            const createdAt = Date.now();
            const draft: Omit<ReviewRow, "id"> = {
              title: job.name,
              size: job.size,
              moves: job.moves,
              records: outcome.records,
              budget,
              skipOpening,
              log: outcome.log,
              createdAt,
            };
            const row = db ? await addReview(db, draft) : { ...draft, id: -createdAt };
            const r = reportOf(row, get().settings.preset);
            patchJob(id, {
              status: "done",
              records: outcome.records,
              index: job.moves.length + 1,
              reviewId: row.id!,
              result: t("완료: 정확도 흑 {b} / 백 {w}, {n}수", {
                b: percent(r.tally.blackAccuracy),
                w: percent(r.tally.whiteAccuracy),
                n: r.moves.length,
              }),
            });
            set((s) => ({ reviews: [row, ...s.reviews], selectedId: row.id! }));
            publishSelection();
            reviewed++;
            continue;
          }
          const at = `${outcome.index}/${job.moves.length + 1}`;
          if (outcome.kind === "cancelled") {
            patchJob(id, {
              status: "paused",
              records: outcome.records,
              index: outcome.index,
              log: outcome.log,
              result: t("중단: {at}에서 이어서", { at }),
            });
            note(t("게임 리뷰 취소 ({at})", { at }));
          } else {
            patchJob(id, {
              status: "paused",
              records: outcome.records,
              index: outcome.index,
              log: outcome.log,
              result: `${outcome.reason}: ${t("{at}에서 이어서", { at })}`,
            });
            note(outcome.reason);
            failed++;
          }
          break;
        }
      } finally {
        useEngineStore.getState().release("review");
        set({ running: false, progress: null });
        if (queueTotal > 1) {
          note(
            cancelFlag
              ? t("분석 큐 취소: 리뷰 {r}, 중단 {f} / 총 {n}", {
                  r: reviewed,
                  f: failed,
                  n: queueTotal,
                })
              : t("분석 큐 끝: 리뷰 {r}, 중단 {f} / 총 {n}", {
                  r: reviewed,
                  f: failed,
                  n: queueTotal,
                }),
          );
        }
      }
      return null;
    },

    cancel: () => {
      if (!get().running) return;
      cancelFlag = true;
      useEngineStore.getState().stop();
    },

    select: (id) => {
      set({ selectedId: id });
      publishSelection();
    },

    removeReview: async (id) => {
      set((s) => ({
        reviews: s.reviews.filter((r) => r.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
      }));
      publishSelection();
      if (db) await deleteReview(db, id).catch(() => {});
    },

    openOnBoard: (ply) => {
      const row = get().reviews.find((r) => r.id === get().selectedId);
      if (!row) return;
      const n = Math.max(0, Math.min(ply, row.moves.length));
      useGameStore.getState().loadMoves(row.moves.slice(0, n), {
        future: row.moves.slice(n),
        name: row.title,
        what: t("리뷰에서 {n}수 국면으로", { n }),
      });
    },
  };
});

/** 시험 전용 — 저장소를 갈아 끼우고 상태를 처음으로 되돌린다. */
export function resetReviewStoreForTest(d: RapfiDb | null) {
  db = d;
  cancelFlag = false;
  useReviewStore.setState({
    settings: DEFAULT_SETTINGS,
    jobs: [],
    reviews: [],
    selectedId: null,
    running: false,
    progress: null,
    log: [],
    loaded: false,
  });
}
