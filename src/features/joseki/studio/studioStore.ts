import { create } from "zustand";
import { downloadBlob } from "../../../app/download";
import {
  addCourse,
  addLesson,
  duplicateLesson,
  emptyFile,
  lessonFromTree,
  lessonIds,
  lessonOf,
  moveCourse,
  moveLesson,
  moveLessonTo,
  nextVersion,
  removeCourse,
  removeLesson,
  updateCourse,
  updateLesson,
} from "../../../core/curriculum/edit";
import { formatCurriculum } from "../../../core/curriculum/format";
import {
  cleanCurriculum,
  withLang,
  type Course,
  type CurriculumFile,
  type CurriculumNode,
  type Lesson,
} from "../../../core/curriculum/schema";
import { parseMoveText } from "../../../core/joseki/parse";
import {
  addLine,
  addMove,
  illegal,
  mainLineFrom,
  moveSibling,
  nodeAt,
  promoteLine,
  removeAt,
  replaceAt,
  setMark,
  setRole,
  stepForward,
  type JosekiMark,
  type JosekiRole,
  type JosekiTree,
} from "../../../core/joseki/tree";
import { sameMove, type Move } from "../../../core/model/move";
import { CURRICULUM_URL, useCurriculum } from "../../../data/curriculum";
import { t } from "../../../i18n/i18n";
import { useBoardStore } from "../../board/boardStore";

/**
 * 커리큘럼 스튜디오(관리자 도구)의 상태 — 커리큘럼 **전체**를 초안으로 들고 고친다.
 *
 *   - 처음에는 배포본(`public/joseki/curriculum.json`)을 받아 초안으로 삼는다. 고칠 때마다 초안이 이 브라우저
 *     (`localStorage`)에 저절로 남아, 창을 닫았다 열어도 이어서 고친다. «배포본으로 되돌리기»가 초안을 버린다.
 *   - 고치기는 모두 `core/curriculum/edit.ts` · `core/joseki/tree.ts` 의 순수 함수로 새 파일을 만든다 —
 *     되돌리기 · 다시 하기는 파일 50벌까지.
 *   - 내보내기는 둘: 파일 내려받기(어디서나), 그리고 **저장소에 바로 쓰기**(`pnpm studio` 로 띄운 개발 서버일
 *     때만 — `scripts/studio-plugin.ts`). 배포는 `pnpm curriculum:publish` 가 검사 · 커밋 · push 한다.
 */

const DRAFT_KEY = "rapfi.curriculum.studio";
const UNDO_LIMIT = 50;
const DRAFT_DELAY_MS = 400;
/** 같은 마디의 해설을 이 시간 안에 이어 치면 되돌리기 한 칸으로 묶는다. */
const TYPE_COALESCE_MS = 1500;
export const STUDIO_ENDPOINT = `${import.meta.env.BASE_URL}__studio/curriculum`;

export type Sel =
  { kind: "home" } | { kind: "course"; id: string } | { kind: "lesson"; id: string };

interface StudioState {
  status: "idle" | "loading" | "ready";
  file: CurriculumFile;
  /** 지금 배포된(또는 저장소에 쓴) 커리큘럼 — 바뀐 것 · 사라질 링크를 견줄 바탕. */
  published: CurriculumFile | null;
  sel: Sel;
  /** 고른 레슨의 트리 안 커서. */
  path: number[];
  undo: CurriculumFile[];
  redo: CurriculumFile[];
  /** 초안이 이 브라우저에 마지막으로 남은 때. */
  draftAt: number | null;
  /** 개발 서버의 저장소 쓰기 길이 열려 있나. */
  repo: "unknown" | "yes" | "no";
  notice: string | null;

  load: () => Promise<void>;
  select: (sel: Sel) => void;
  undoEdit: () => void;
  redoEdit: () => void;
  tell: (notice: string | null) => void;

  // 코스
  newCourse: () => void;
  patchCourse: (id: string, patch: Partial<Omit<Course, "lessons">>) => void;
  deleteCourse: (id: string) => void;
  shiftCourse: (id: string, dir: -1 | 1) => void;

  // 레슨
  newLesson: (courseId: string) => void;
  patchLesson: (id: string, patch: Partial<Lesson>) => void;
  deleteLesson: (id: string) => void;
  shiftLesson: (id: string, dir: -1 | 1) => void;
  moveLessonToCourse: (id: string, courseId: string) => void;
  copyLesson: (id: string) => void;
  importTree: (tree: JosekiTree, courseId: string) => void;

  // 레슨 트리(고른 레슨)
  go: (path: number[]) => void;
  back: () => void;
  forward: () => void;
  first: () => void;
  last: () => void;
  play: (m: Move) => void;
  addText: (text: string) => boolean;
  addBoardLine: () => void;
  deleteNode: () => void;
  promote: () => void;
  shift: (dir: -1 | 1) => void;
  setNodeMark: (mark: JosekiMark | null) => void;
  setNodeRole: (role: JosekiRole | null) => void;
  setNodeText: (lang: "ko" | "en", value: string) => void;

  // 파일
  importFile: (text: string) => boolean;
  resetToPublished: () => void;
  /** 버전을 올린, 내보낼 파일. */
  outgoing: () => CurriculumFile;
  download: () => void;
  saveToRepo: () => Promise<boolean>;
  probeRepo: () => Promise<void>;
}

interface Draft {
  file: CurriculumFile;
  savedAt: number;
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { file?: unknown; savedAt?: unknown };
    const clean = cleanCurriculum(d.file);
    if (!clean) return null;
    return { file: clean.file, savedAt: typeof d.savedAt === "number" ? d.savedAt : 0 };
  } catch {
    return null;
  }
}

let draftTimer: ReturnType<typeof setTimeout> | null = null;
let lastType: { key: string; at: number } | null = null;

/** 버전을 뺀 내용 — 바뀌었는지 견줄 때. */
export const contentOf = (f: CurriculumFile) => formatCurriculum({ ...f, version: "" });

export const useStudio = create<StudioState>((set, get) => {
  const writeDraft = () => {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const savedAt = Date.now();
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ file: get().file, savedAt }));
        set({ draftAt: savedAt });
      } catch {
        set({ notice: t("초안을 이 브라우저에 남기지 못했습니다. 파일로 내려받아 두세요") });
      }
    }, DRAFT_DELAY_MS);
  };

  /** 새 파일로 — 되돌리기 칸에 지금 것을 쌓고(묶을 때는 빼고) 초안을 남긴다. */
  const apply = (
    file: CurriculumFile,
    opts: { sel?: Sel; path?: number[]; coalesce?: boolean } = {},
  ) => {
    const prev = get().file;
    if (file === prev) return;
    set((s) => ({
      file,
      undo: opts.coalesce ? s.undo : [...s.undo, prev].slice(-UNDO_LIMIT),
      redo: [],
      sel: opts.sel ?? s.sel,
      path: opts.path ?? s.path,
    }));
    if (!opts.coalesce) lastType = null;
    writeDraft();
  };

  const lesson = (): Lesson | null => {
    const sel = get().sel;
    return sel.kind === "lesson" ? (lessonOf(get().file, sel.id)?.lesson ?? null) : null;
  };

  /** 고른 레슨의 트리를 바꾼다. */
  const editRoot = (
    fn: (root: CurriculumNode, path: number[]) => { root: CurriculumNode; path: number[] } | null,
    coalesce = false,
  ) => {
    const l = lesson();
    if (!l) return;
    const r = fn(l.root, get().path);
    if (!r) return;
    if (r.root === l.root) {
      set({ path: r.path });
      return;
    }
    apply(updateLesson(get().file, l.id, { root: r.root }), { path: r.path, coalesce });
  };

  const tell = (notice: string | null) => set({ notice });

  return {
    status: "idle",
    file: emptyFile(),
    published: null,
    sel: { kind: "home" },
    path: [],
    undo: [],
    redo: [],
    draftAt: null,
    repo: "unknown",
    notice: null,

    load: async () => {
      if (get().status !== "idle") return;
      set({ status: "loading" });
      let published: CurriculumFile | null = null;
      try {
        // 캐시를 건너뛴다 — 방금 저장소에 쓴 파일을 다시 받아야 한다.
        const res = await fetch(CURRICULUM_URL, { cache: "no-cache" });
        if (res.ok) published = cleanCurriculum(await res.json())?.file ?? null;
      } catch {
        /* 배포본 없이도 연다 */
      }
      const draft = readDraft();
      const fromDraft = draft && (!published || contentOf(draft.file) !== contentOf(published));
      set({
        status: "ready",
        published,
        file: fromDraft ? draft.file : (published ?? emptyFile()),
        draftAt: fromDraft ? draft.savedAt : null,
        notice: fromDraft
          ? t("이 브라우저에 남은 초안에서 이어서 고칩니다")
          : published
            ? null
            : t("배포본을 받지 못해 빈 커리큘럼에서 시작합니다"),
      });
      void get().probeRepo();
    },

    select: (sel) => {
      lastType = null;
      set({ sel, path: [] });
    },
    tell,

    undoEdit: () => {
      const { undo, file, redo } = get();
      const prev = undo.at(-1);
      if (!prev) return;
      lastType = null;
      set({ file: prev, undo: undo.slice(0, -1), redo: [...redo, file].slice(-UNDO_LIMIT) });
      // 고른 것이 사라졌으면 위로.
      const sel = get().sel;
      if (sel.kind === "lesson" && !lessonOf(prev, sel.id)) set({ sel: { kind: "home" } });
      if (sel.kind === "course" && !prev.courses.some((c) => c.id === sel.id))
        set({ sel: { kind: "home" } });
      const l = lesson();
      if (l && !nodeAt(l.root, get().path)) set({ path: [] });
      writeDraft();
    },
    redoEdit: () => {
      const { undo, file, redo } = get();
      const next = redo.at(-1);
      if (!next) return;
      lastType = null;
      set({ file: next, redo: redo.slice(0, -1), undo: [...undo, file].slice(-UNDO_LIMIT) });
      const l = lesson();
      if (l && !nodeAt(l.root, get().path)) set({ path: [] });
      writeDraft();
    },

    // ── 코스 ──
    newCourse: () => {
      const r = addCourse(get().file);
      apply(r.file, { sel: { kind: "course", id: r.id }, path: [] });
    },
    patchCourse: (id, patch) => {
      const file = updateCourse(get().file, id, patch);
      const sel = get().sel;
      apply(file, {
        sel:
          patch.id && sel.kind === "course" && sel.id === id
            ? { kind: "course", id: patch.id }
            : sel,
      });
    },
    deleteCourse: (id) => apply(removeCourse(get().file, id), { sel: { kind: "home" }, path: [] }),
    shiftCourse: (id, dir) => apply(moveCourse(get().file, id, dir)),

    // ── 레슨 ──
    newLesson: (courseId) => {
      const sel = get().sel;
      const after = sel.kind === "lesson" ? sel.id : undefined;
      const inCourse = after && lessonOf(get().file, after)?.course.id === courseId;
      const r = addLesson(get().file, courseId, undefined, inCourse ? after : undefined);
      apply(r.file, { sel: { kind: "lesson", id: r.id }, path: [] });
    },
    patchLesson: (id, patch) => {
      const sel = get().sel;
      apply(updateLesson(get().file, id, patch), {
        sel:
          patch.id && sel.kind === "lesson" && sel.id === id
            ? { kind: "lesson", id: patch.id }
            : sel,
      });
    },
    deleteLesson: (id) => {
      const found = lessonOf(get().file, id);
      apply(removeLesson(get().file, id), {
        sel: found ? { kind: "course", id: found.course.id } : { kind: "home" },
        path: [],
      });
    },
    shiftLesson: (id, dir) => apply(moveLesson(get().file, id, dir)),
    moveLessonToCourse: (id, courseId) => apply(moveLessonTo(get().file, id, courseId)),
    copyLesson: (id) => {
      const r = duplicateLesson(get().file, id);
      if (r) apply(r.file, { sel: { kind: "lesson", id: r.id }, path: [] });
    },
    importTree: (tree, courseId) => {
      const l = lessonFromTree(tree, lessonIds(get().file));
      const r = addLesson(get().file, courseId, l);
      apply(r.file, { sel: { kind: "lesson", id: r.id }, path: [] });
      tell(
        t("«{title}» 을(를) 레슨으로 넣었습니다. 영어 해설과 요약을 채우세요", {
          title: tree.title,
        }),
      );
    },

    // ── 트리 ──
    go: (path) => {
      const l = lesson();
      if (l && nodeAt(l.root, path)) {
        lastType = null;
        set({ path });
      }
    },
    back: () => get().go(get().path.slice(0, -1)),
    forward: () => {
      const l = lesson();
      if (l) get().go(stepForward(l.root, get().path));
    },
    first: () => get().go([]),
    last: () => {
      const l = lesson();
      if (l) get().go(mainLineFrom(l.root, get().path));
    },
    play: (m) => {
      const l = lesson();
      if (!l) return;
      const at = nodeAt(l.root, get().path);
      if (at && !at.children.some((c) => sameMove(c.move, m))) {
        const why = illegal(l.root, get().path, m);
        if (why) {
          tell(why);
          return;
        }
      }
      editRoot((root, path) => addMove(root, path, m));
    },
    addText: (text) => {
      const p = parseMoveText(text);
      if (!p.ok) {
        tell(p.error);
        return false;
      }
      const out = { stopped: null as number | null };
      editRoot((root, path) => {
        const r = addLine(root, p.moves, path);
        out.stopped = r.stoppedAt;
        return r;
      });
      if (out.stopped !== null)
        tell(t("{n}번째 수에서 멈췄습니다(이미 돌이 있거나 판 밖)", { n: out.stopped + 1 }));
      return out.stopped === null;
    },
    addBoardLine: () => {
      const stones = useBoardStore.getState().render.stones;
      if (stones.length === 0) {
        tell(t("보드에 둔 수가 없습니다"));
        return;
      }
      editRoot((root) => addLine(root, stones, []));
      tell(t("보드의 {n}수를 뿌리부터 넣었습니다(있는 수는 따라갔습니다)", { n: stones.length }));
    },
    deleteNode: () => editRoot((root, path) => removeAt(root, path)),
    promote: () => editRoot((root, path) => promoteLine(root, path)),
    shift: (dir) => editRoot((root, path) => moveSibling(root, path, dir)),
    setNodeMark: (mark) => editRoot((root, path) => ({ root: setMark(root, path, mark), path })),
    setNodeRole: (role) => editRoot((root, path) => ({ root: setRole(root, path, role), path })),
    setNodeText: (lang, value) => {
      const l = lesson();
      if (!l) return;
      const key = `${l.id}:${get().path.join(".")}:${lang}`;
      const now = Date.now();
      const coalesce = lastType?.key === key && now - lastType.at < TYPE_COALESCE_MS;
      lastType = { key, at: now };
      editRoot(
        (root, path) => ({
          root: replaceAt(root, path, (n) => ({ ...n, comment: withLang(n.comment, lang, value) })),
          path,
        }),
        coalesce,
      );
    },

    // ── 파일 ──
    importFile: (text) => {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        tell(t("JSON 이 아닙니다"));
        return false;
      }
      const clean = cleanCurriculum(raw);
      if (!clean) {
        tell(t("커리큘럼 파일(rapfiweb-curriculum)이 아닙니다"));
        return false;
      }
      apply(clean.file, { sel: { kind: "home" }, path: [] });
      tell(
        clean.problems.length
          ? t("불러왔지만 {n}곳을 버렸습니다: {first}", {
              n: clean.problems.length,
              first: clean.problems[0] ?? "",
            })
          : t("파일을 불러왔습니다"),
      );
      return true;
    },
    resetToPublished: () => {
      const p = get().published;
      apply(p ?? emptyFile(), { sel: { kind: "home" }, path: [] });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* 없으면 그만 */
      }
      if (draftTimer) clearTimeout(draftTimer);
      set({ draftAt: null });
      tell(t("배포본으로 되돌렸습니다. 되돌리기로 초안을 다시 살릴 수 있습니다"));
    },
    outgoing: () => {
      const { file, published } = get();
      return { ...file, version: nextVersion(published?.version ?? file.version) };
    },
    download: () => {
      const out = get().outgoing();
      downloadBlob("curriculum.json", formatCurriculum(out), "application/json");
      tell(
        t("curriculum.json 을 내려받았습니다(버전 {v}). pnpm curriculum:publish 로 싣습니다", {
          v: out.version,
        }),
      );
    },
    saveToRepo: async () => {
      const out = get().outgoing();
      try {
        const res = await fetch(STUDIO_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: formatCurriculum(out),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !body.ok) {
          tell(t("저장소에 쓰지 못했습니다: {e}", { e: body.error ?? String(res.status) }));
          return false;
        }
      } catch {
        tell(t("개발 서버에 닿지 못했습니다. pnpm studio 로 띄웠는지 보세요"));
        return false;
      }
      set({ file: out, published: out });
      // 이 브라우저의 공식 커리큘럼 화면도 새 파일을 읽게.
      useCurriculum.setState({ status: "ready", file: out });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* 없으면 그만 */
      }
      set({ draftAt: null });
      tell(
        t("저장소 파일에 썼습니다(버전 {v}). pnpm curriculum:publish 로 커밋 · push 합니다", {
          v: out.version,
        }),
      );
      return true;
    },
    probeRepo: async () => {
      try {
        const res = await fetch(STUDIO_ENDPOINT, { cache: "no-store" });
        const ok =
          res.ok &&
          (res.headers.get("content-type") ?? "").includes("application/json") &&
          ((await res.json()) as { studio?: boolean }).studio === true;
        set({ repo: ok ? "yes" : "no" });
      } catch {
        set({ repo: "no" });
      }
    },
  };
});
