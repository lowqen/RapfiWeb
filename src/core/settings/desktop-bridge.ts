import type { ComputerSide, OpeningProtocol } from "../model/game";
import type { GradingPreset } from "../review/move-quality";
import { DESKTOP_DEFAULTS, type DesktopValues } from "./desktop-settings";

/**
 * settings.txt 67행 ↔ 웹 설정 — 무엇이 웹의 어느 값이 되고, 무엇이 안 되는가(W5b).
 *
 * 웹이 뜻을 가진 칸만 옮긴다. 나머지(언어 · 툴바 · 글꼴 · 시계 …)는 웹에 그 기능이 없으므로
 * **가져온 값을 그대로 들고 있다가** 내보낼 때 돌려준다 — PC 에서 가져와 PC 로 돌려보내도 그 칸이
 * 기본값으로 덮이지 않는다. 그 «들고 있는 값»이 `base` 다.
 *
 * 순수 함수만 둔다. 스토어에서 읽고 쓰는 일은 `features/settings/desktopBridge.ts`.
 */

/** 웹의 지금 값 — 데스크톱 칸에 대응하는 것만. */
export interface WebSettings {
  opening: OpeningProtocol;
  computerSide: ComputerSide;
  maxDepth: number;
  /** -1 = 무제한. */
  maxNode: number;
  style: number;
  /** 0 = 자동. */
  threads: number;
  /** 자동일 때 실제로 쓰는 수(모르면 null). */
  threadsResolved: number | null;
  hashMb: number;
  multiPv: number;
  vcThread: 0 | 1 | 2;
  hashAutoClear: boolean;
  showEvalBar: boolean;
  showNumbers: boolean;
  /** 화면에 실제로 보이는 테마(시스템 따름이면 그 결과). */
  dark: boolean;
  showForbidden: boolean;
  preset: GradingPreset;
  review: { byDepth: boolean; depth: number; skipOpening: boolean };
  prove: {
    budget0Sec: number;
    budgetMaxSec: number;
    nbest: number;
    bestFirst: boolean;
    probe: boolean;
    byDepth: boolean;
    depth0: number;
    depthMax: number;
  };
  db: {
    enabled: boolean;
    readonly: boolean;
    autoSave: boolean;
    autoSaveMinutes: number;
    showBoardText: boolean;
    confirmDeleteAll: boolean;
  };
}

/** 웹 한계 — 스토어의 sanitize 와 같은 값. 여기서 미리 묶어야 «무엇이 바뀌었나»를 바로 말한다. */
export const WEB_LIMITS = {
  hashChoices: [16, 32, 64, 128, 256, 512] as readonly number[],
  maxDepth: 225,
  multiPv: 10,
  threads: 16,
  /** 이 이상이면 웹의 «무제한»(-1)으로 읽는다 — 데스크톱 기본 10억은 사실상 무제한이다. */
  unlimitedNodes: 1_000_000_000,
};

// 데스크톱 rule 칸(main.c) ↔ 웹 개시. 0·1·5·6 은 웹에 없다(렌주 전용 · Soosorv/스왑2 내림).
const RULE_TO_OPENING: Record<number, OpeningProtocol> = { 2: "none", 3: "swapFirst", 4: "rif" };
const OPENING_TO_RULE: Record<OpeningProtocol, number> = { none: 2, swapFirst: 3, rif: 4 };
const RULE_NAME: Record<number, string> = {
  0: "프리스타일",
  1: "스탠다드",
  5: "Soosorv-8",
  6: "스왑2",
};
const PRESETS: readonly GradingPreset[] = ["strict", "default", "lenient"];

const sideOf = (black: boolean, white: boolean): ComputerSide =>
  black && white ? "both" : black ? "black" : white ? "white" : "none";

/** 가장 가까운(넘지 않는) 해시 선택지. 더 작으면 가장 작은 것. */
export function hashChoice(mb: number): number {
  const c = WEB_LIMITS.hashChoices;
  let best = c[0]!;
  for (const v of c) if (v <= mb) best = v;
  return best;
}

/** 웹 값을 `base` 위에 얹는다 — 내보내기. 웹이 표현하지 못하는 값은 `base` 를 지킨다. */
export function overlayWeb(base: DesktopValues, w: WebSettings): DesktopValues {
  const n = (id: string) => Number(base[id] ?? DESKTOP_DEFAULTS[id]);
  // 웹의 상한(무제한 · 225 · 10)에 닿아 있으면 base 가 더 크더라도 그대로 둔다 — 웹 쪽에서 «더»를
  // 말할 수 없으니 PC 가 고른 값을 깎을 까닭이 없다.
  const capped = (id: string, web: number, cap: number) =>
    web >= cap && n(id) >= cap ? n(id) : web;
  const threads = w.threads > 0 ? w.threads : (w.threadsResolved ?? n("threadNum"));
  const out: Record<string, number | boolean | string> = { ...base };
  Object.assign(out, {
    rule: OPENING_TO_RULE[w.opening],
    computerBlack: w.computerSide === "black" || w.computerSide === "both",
    computerWhite: w.computerSide === "white" || w.computerSide === "both",
    maxDepth: capped("maxDepth", w.maxDepth, WEB_LIMITS.maxDepth),
    maxNode:
      w.maxNode <= 0
        ? Math.max(n("maxNode"), WEB_LIMITS.unlimitedNodes)
        : Math.max(1_000, Math.min(2_000_000_000, w.maxNode)),
    style: w.style,
    threadNum: capped("threadNum", threads, WEB_LIMITS.threads),
    // 해시는 웹 선택지 상한(512)이 탭 메모리 한도라 PC 의 8GB 를 깎지 않는다 — 웹이 상한이면 base.
    hashSizeMb: capped("hashSizeMb", w.hashMb, WEB_LIMITS.hashChoices.at(-1)!),
    multiPv: capped("multiPv", w.multiPv, WEB_LIMITS.multiPv),
    vcThread: w.vcThread,
    hashAutoClear: w.hashAutoClear,
    showNumber: w.showNumbers,
    darkMode: w.dark,
    showForbidden: w.showForbidden,
    useDatabase: w.db.enabled,
    databaseReadonly: w.db.readonly,
    showBoardText: w.db.showBoardText,
    showDbDelConfirm: w.db.confirmDeleteAll,
    showEvalBar: w.showEvalBar,
    mqPreset: PRESETS.indexOf(w.preset),
    proveBudget0Sec: w.prove.budget0Sec,
    proveBudgetMaxSec: w.prove.budgetMaxSec,
    proveNbest: w.prove.nbest,
    proveBestFirst: w.prove.bestFirst,
    proveProbe: w.prove.probe,
    proveByDepth: w.prove.byDepth,
    proveDepth0: w.prove.depth0,
    proveDepthMax: w.prove.depthMax,
    dbAutoSave: w.db.autoSave,
    dbAutoSaveMinutes: w.db.autoSaveMinutes,
    reviewByDepth: w.review.byDepth,
    reviewDepth: w.review.depth,
    skipOpening: w.review.skipOpening,
  });
  return out;
}

/** 가져오기가 웹에 할 일 — 바꿀 값과 사람이 읽을 메모. */
export interface WebPatch {
  web: WebSettings;
  /** 웹이 그대로 받지 못한 칸 — «무엇이 왜 다른가». */
  notes: string[];
}

/** 데스크톱 값 → 웹 값. `current` 는 지금 웹 값(웹에 없는 규칙이면 개시를 그대로 둔다). */
export function webFromDesktop(v: DesktopValues, current: WebSettings): WebPatch {
  const notes: string[] = [];
  const n = (id: string) => Number(v[id] ?? DESKTOP_DEFAULTS[id]);
  const b = (id: string) => Boolean(v[id] ?? DESKTOP_DEFAULTS[id]);

  let opening = current.opening;
  const rule = n("rule");
  if (RULE_TO_OPENING[rule]) opening = RULE_TO_OPENING[rule];
  else notes.push(`규칙 ${rule}(${RULE_NAME[rule] ?? "?"})은 웹에 없어 개시를 그대로 둡니다`);

  const hashMb = hashChoice(n("hashSizeMb"));
  if (hashMb !== n("hashSizeMb")) notes.push(`해시 ${n("hashSizeMb")}MB → ${hashMb}MB(웹 선택지)`);
  const maxDepth = Math.max(2, Math.min(WEB_LIMITS.maxDepth, n("maxDepth")));
  if (maxDepth !== n("maxDepth")) notes.push(`최대 깊이 ${n("maxDepth")} → ${maxDepth}`);
  const threads = Math.max(1, Math.min(WEB_LIMITS.threads, n("threadNum")));
  if (threads !== n("threadNum")) notes.push(`스레드 ${n("threadNum")} → ${threads}`);
  const multiPv = Math.max(1, Math.min(WEB_LIMITS.multiPv, n("multiPv")));
  if (multiPv !== n("multiPv")) notes.push(`멀티 PV ${n("multiPv")} → ${multiPv}`);
  const nodes = n("maxNode");

  return {
    notes,
    web: {
      opening,
      computerSide: sideOf(b("computerBlack"), b("computerWhite")),
      maxDepth,
      maxNode: nodes >= WEB_LIMITS.unlimitedNodes ? -1 : nodes,
      style: n("style"),
      threads,
      threadsResolved: current.threadsResolved,
      hashMb,
      multiPv,
      vcThread: (n("vcThread") === 1 || n("vcThread") === 2 ? n("vcThread") : 0) as 0 | 1 | 2,
      hashAutoClear: b("hashAutoClear"),
      showEvalBar: b("showEvalBar"),
      showNumbers: b("showNumber"),
      dark: b("darkMode"),
      showForbidden: b("showForbidden"),
      preset: PRESETS[n("mqPreset")] ?? "default",
      review: {
        byDepth: b("reviewByDepth"),
        depth: n("reviewDepth"),
        skipOpening: b("skipOpening"),
      },
      prove: {
        budget0Sec: n("proveBudget0Sec"),
        budgetMaxSec: n("proveBudgetMaxSec"),
        nbest: n("proveNbest"),
        bestFirst: b("proveBestFirst"),
        probe: b("proveProbe"),
        byDepth: b("proveByDepth"),
        depth0: n("proveDepth0"),
        depthMax: n("proveDepthMax"),
      },
      db: {
        enabled: b("useDatabase"),
        readonly: b("databaseReadonly"),
        autoSave: b("dbAutoSave"),
        autoSaveMinutes: n("dbAutoSaveMinutes"),
        showBoardText: b("showBoardText"),
        confirmDeleteAll: b("showDbDelConfirm"),
      },
    },
  };
}

/** 웹이 뜻을 가진 칸 — 화면이 «67칸 중 N칸이 웹에 반영»을 말할 때. */
export const MAPPED_IDS: readonly string[] = [
  "rule",
  "computerBlack",
  "computerWhite",
  "maxDepth",
  "maxNode",
  "style",
  "showNumber",
  "threadNum",
  "hashSizeMb",
  "multiPv",
  "vcThread",
  "hashAutoClear",
  "darkMode",
  "showForbidden",
  "useDatabase",
  "databaseReadonly",
  "showBoardText",
  "showDbDelConfirm",
  "showEvalBar",
  "mqPreset",
  "proveBudget0Sec",
  "proveBudgetMaxSec",
  "proveNbest",
  "dbAutoSave",
  "dbAutoSaveMinutes",
  "proveBestFirst",
  "proveProbe",
  "reviewByDepth",
  "reviewDepth",
  "proveByDepth",
  "proveDepth0",
  "proveDepthMax",
  "skipOpening",
];
