import { create } from "zustand";
import { cleanCurriculum, type CurriculumFile } from "../core/curriculum/schema";
import { msg } from "../i18n/i18n";

/**
 * 공식 정석 커리큘럼 받기 · 진도(docs/공식-정석-설계.md).
 *
 * 커리큘럼은 같은 출처의 정적 자산 `public/joseki/curriculum.json` 이다 — 앱 번들과 따로 캐시되고, 관리자가
 * 그 파일만 바꿔 배포한다. 받은 JSON 은 검증을 거친 것만 쓴다(`cleanCurriculum`).
 *
 * 진도는 이 브라우저의 `localStorage`(`rapfi.curriculum.progress`) — 사용자마다의 편의라 서버가 필요 없다.
 * 막혀 있으면(사생활 보호 모드) 이번 세션만 기억한다.
 */

export const CURRICULUM_URL = `${import.meta.env.BASE_URL}joseki/curriculum.json`;
const PROGRESS_KEY = "rapfi.curriculum.progress";

export interface LessonProgress {
  /** 가장 좋은 점수(0..100, 첫 시도 정답률). */
  best: number;
  /** 끝까지 마친 횟수. */
  runs: number;
  completedAt: number;
}

type Status = "idle" | "loading" | "ready" | "error";

interface CurriculumState {
  status: Status;
  file: CurriculumFile | null;
  /** 사전 열쇠(그릴 때 `t()`). */
  error: string | null;
  progress: Readonly<Record<string, LessonProgress>>;
  load: () => Promise<void>;
  /** 레슨을 끝까지 마쳤다 — 가장 좋은 점수와 횟수를 남긴다. */
  record: (lessonId: string, score: number, now?: number) => void;
  resetProgress: () => void;
}

function readProgress(): Record<string, LessonProgress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!v || typeof v !== "object") return {};
    const out: Record<string, LessonProgress> = {};
    for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
      const r = (p ?? {}) as Record<string, unknown>;
      if (typeof r.best === "number" && typeof r.runs === "number")
        out[k] = {
          best: Math.max(0, Math.min(100, r.best)),
          runs: r.runs,
          completedAt: typeof r.completedAt === "number" ? r.completedAt : 0,
        };
    }
    return out;
  } catch {
    return {};
  }
}

function writeProgress(p: Record<string, LessonProgress>) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* 이번 세션만 */
  }
}

export const useCurriculum = create<CurriculumState>((set, get) => ({
  status: "idle",
  file: null,
  error: null,
  progress: typeof localStorage === "undefined" ? {} : readProgress(),

  load: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading", error: null });
    try {
      const res = await fetch(CURRICULUM_URL);
      if (!res.ok) throw new Error(String(res.status));
      const clean = cleanCurriculum(await res.json());
      if (!clean) {
        set({ status: "error", error: msg("공식 커리큘럼 파일의 형식이 맞지 않습니다") });
        return;
      }
      set({ status: "ready", file: clean.file });
    } catch {
      set({ status: "error", error: msg("공식 커리큘럼을 받지 못했습니다") });
    }
  },

  record: (lessonId, score, now = Date.now()) => {
    const prev = get().progress[lessonId];
    const next = {
      ...get().progress,
      [lessonId]: {
        best: Math.max(prev?.best ?? 0, score),
        runs: (prev?.runs ?? 0) + 1,
        completedAt: now,
      },
    };
    writeProgress(next);
    set({ progress: next });
  },

  resetProgress: () => {
    writeProgress({});
    set({ progress: {} });
  },
}));
