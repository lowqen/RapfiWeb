import { downloadBlob } from "../../app/download";
import { useThemeStore } from "../../app/theme";
import { overlayWeb, webFromDesktop, type WebSettings } from "../../core/settings/desktop-bridge";
import {
  DESKTOP_DEFAULTS,
  FILE_NAME,
  detectFile,
  parse,
  render,
  type DesktopValues,
  type SettingsFile,
} from "../../core/settings/desktop-settings";
import { useBoardStore } from "../board/boardStore";
import { useGameStore } from "../board/gameStore";
import { useDbStore } from "../database/dbStore";
import { useProveStore } from "../research/prove/proveStore";
import { useReviewStore } from "../research/review/reviewStore";
import { deviceCores, resolveThreads, useSettingsStore } from "./settingsStore";

/**
 * 데스크톱 `settings.txt` · `settings_dev.txt` 가져오기 · 내보내기(W5b) — 앱 `SettingsCodec` 의 웹판.
 *
 * 무엇이 어느 웹 값이 되는지는 `core/settings/desktop-bridge.ts` 가 정한다. 여기는 스토어에서 지금
 * 값을 모으고(`readWeb`), 가져온 값을 스토어에 넣고(`applyWeb`), 웹이 모르는 칸을 들고 있는다
 * (`localStorage["rapfi.desktop"]` — 가져온 파일의 67칸. 내보낼 때 그 위에 웹 값을 얹는다).
 */

const BASE_KEY = "rapfi.desktop";

function loadBase(): DesktopValues {
  try {
    const raw = localStorage.getItem(BASE_KEY);
    return raw ? { ...DESKTOP_DEFAULTS, ...(JSON.parse(raw) as DesktopValues) } : DESKTOP_DEFAULTS;
  } catch {
    return DESKTOP_DEFAULTS;
  }
}

function saveBase(v: DesktopValues) {
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify(v));
  } catch {
    /* 이번 세션만 */
  }
}

const effectiveDark = (): boolean => {
  const mode = useThemeStore.getState().mode;
  if (mode !== "system") return mode === "dark";
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
};

/** 웹의 지금 값. */
export function readWeb(): WebSettings {
  const s = useSettingsStore.getState();
  const g = useGameStore.getState();
  const r = useReviewStore.getState().settings;
  const p = useProveStore.getState().options;
  const d = useDbStore.getState().settings;
  return {
    opening: g.opening,
    computerSide: g.computerSide,
    maxDepth: s.maxDepth,
    maxNode: s.maxNode,
    style: s.style,
    threads: s.threads,
    threadsResolved: resolveThreads(s.threads, deviceCores()),
    hashMb: s.hashMb,
    multiPv: s.multiPv,
    vcThread: s.vcThread,
    hashAutoClear: s.hashAutoClear,
    showEvalBar: s.showEvalBar,
    showNumbers: useBoardStore.getState().render.showNumbers,
    dark: effectiveDark(),
    showForbidden: g.showForbidden,
    preset: r.preset,
    review: { byDepth: r.budget.byDepth, depth: r.budget.depth, skipOpening: r.skipOpening },
    prove: {
      budget0Sec: p.budget0Sec,
      budgetMaxSec: p.budgetMaxSec,
      nbest: p.nbest,
      bestFirst: p.bestFirst,
      probe: p.probe,
      byDepth: p.byDepth,
      depth0: p.depth0,
      depthMax: p.depthMax,
    },
    db: { ...d },
  };
}

/** 가져온 값을 스토어에 넣는다. 못 넣은 것은 메모로. */
export async function applyWeb(w: WebSettings): Promise<string[]> {
  const notes: string[] = [];
  useSettingsStore.getState().update({
    maxDepth: w.maxDepth,
    maxNode: w.maxNode,
    style: w.style,
    threads: w.threads,
    hashMb: w.hashMb,
    multiPv: w.multiPv,
    vcThread: w.vcThread,
    hashAutoClear: w.hashAutoClear,
    showEvalBar: w.showEvalBar,
  });

  const g = useGameStore.getState();
  if (g.computerSide !== w.computerSide) g.setComputerSide(w.computerSide);
  if (g.showForbidden !== w.showForbidden) g.toggleForbidden();
  if (g.opening !== w.opening) {
    // 개시를 바꾸면 새 대국이다 — 둔 판을 지우지 않게 빈 판에서만.
    if (useBoardStore.getState().render.stones.length === 0) g.setOpening(w.opening);
    else notes.push("판에 돌이 있어 개시는 그대로 둡니다(새 판에서 바꾸세요)");
  }
  if (useBoardStore.getState().render.showNumbers !== w.showNumbers)
    useBoardStore.getState().toggleNumbers();
  // 27행은 테마 오라클이다 — 시스템 따름을 이기고 고정한다(theme.ts).
  useThemeStore.getState().setFromDesktopSettings(w.dark);

  const r = useReviewStore.getState();
  r.setPreset(w.preset);
  r.setBudget({ byDepth: w.review.byDepth, depth: w.review.depth });
  r.setSkipOpening(w.review.skipOpening);

  useProveStore.getState().setOptions(w.prove);
  const dbNote = await useDbStore.getState().setSettings(w.db);
  if (dbNote) notes.push(`데이터베이스: ${dbNote}`);
  return notes;
}

export interface ImportResult {
  files: { name: string; file: SettingsFile | null }[];
  notes: string[];
}

/** 파일 하나 이상(보통 settings.txt + settings_dev.txt)을 가져온다. */
export async function importDesktopFiles(files: readonly File[]): Promise<ImportResult> {
  let values = loadBase();
  const seen: ImportResult["files"] = [];
  for (const f of files) {
    const text = await f.text();
    const which = detectFile(f.name, text);
    seen.push({ name: f.name, file: which });
    if (which) values = parse(text, which, values);
  }
  if (!seen.some((s) => s.file)) return { files: seen, notes: ["settings.txt 형식이 아닙니다"] };
  saveBase(values);
  const { web, notes } = webFromDesktop(values, readWeb());
  notes.push(...(await applyWeb(web)));
  return { files: seen, notes };
}

/** 지금 값을 두 파일로 — 웹이 모르는 칸은 마지막으로 가져온 값(없으면 데스크톱 기본값). */
export function exportDesktopFiles(): void {
  const values = overlayWeb(loadBase(), readWeb());
  saveBase(values);
  // 데스크톱은 CRLF 도 LF 도 읽는다. 메모장에서 열 사람을 위해 CRLF 로 낸다.
  for (const f of ["main", "dev"] as const)
    downloadBlob(FILE_NAME[f], render(values, f).replace(/\n/g, "\r\n"), "text/plain");
}
