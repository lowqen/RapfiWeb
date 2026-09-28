import { create } from "zustand";
import { useEngineStore, MULTI_PV, type EngineConfig } from "../../engine/engine-state";
import type { EngineCommand } from "../../engine/engine-types";
import { DEFAULT_SIZE } from "../../core/model/move";

/**
 * 설정 화면이 **소유하는** 값들 — 엔진 파라미터·분석·표시.
 *
 * 대국 값(개시·컴퓨터 색·시간 제한·금수 표시)은 여기 두지 않는다. 그것들은 이미
 * `gameStore` 가 주인이고, 설정 화면은 그 스토어를 직접 만진다 — 같은 값을 두 곳에
 * 두면 어느 쪽이 참인지 매번 맞춰야 한다. 테마도 `theme.ts` 가 주인이다.
 *
 * 엔진 쪽 값은 앱의 `EngineParams.infoPairs()` 순서와 철자를 따른다(main.c 의
 * `set_cautionfactor`·`set_hashsize` …). 시간 키(`timeout_turn` 등)는 여기서 보내지
 * 않는다 — 워커가 분석 조각과 대국 착수마다 스스로 세운다.
 *
 * `localStorage` 에 남긴다. 사생활 보호 모드처럼 저장이 안 되는 곳에서는 기본값으로
 * 돌고, 이번 세션 동안만 기억한다.
 */

/** 스타일 = `caution_factor`. 0 성급함 … 5 신중함(데스크톱 settings.txt 11행). */
export const STYLE_RANGE = { min: 0, max: 5 } as const;

/**
 * 해시 크기(MB). 상한 512 는 앱의 `LocalEngineProfile.MAX_HASH_MB` 와 같다 —
 * 32비트 WASM 은 선형 메모리가 4GB 를 넘지 못하고, 브라우저 탭은 그보다 훨씬 먼저
 * 죽는다. 데스크톱 기본값(8192MB)은 여기서 곧장 탭을 죽인다.
 */
export const HASH_CHOICES_MB = [16, 32, 64, 128, 256, 512] as const;

/** 최대 노드 — `-1` 은 무제한(main.c `set_level` 의 level 0 과 같다). */
export const MAX_NODE_CHOICES = [-1, 100_000, 1_000_000, 10_000_000, 100_000_000] as const;

/** 최대 깊이 상한. 데스크톱은 무제한 레벨에서 보드 칸 수(15² = 225)를 보낸다. */
export const MAX_DEPTH_LIMIT = DEFAULT_SIZE * DEFAULT_SIZE;
export const MIN_DEPTH = 2;

/** 추가 위협 확인(`vcthread`): 0 없음 · 1 VCT · 2 VC2. */
export type VcThread = 0 | 1 | 2;

/** 분석 한 번의 예산(초). 0 = 무제한 — 정지나 새 국면까지 읽는다. */
export const ANALYSIS_SEC_CHOICES = [0, 5, 10, 30, 60] as const;

export interface Settings {
  // ── 엔진 ──
  style: number;
  hashMb: number;
  maxDepth: number;
  maxNode: number;
  vcThread: VcThread;
  hashAutoClear: boolean;
  // ── 분석 ──
  multiPv: number;
  analysisSec: number;
  // ── 표시 ──
  /** 보드 옆 평가 바(앱 settings_dev 의 `showEvalBar`). */
  showEvalBar: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  style: 3,
  hashMb: 128,
  maxDepth: MAX_DEPTH_LIMIT,
  maxNode: -1,
  vcThread: 0,
  hashAutoClear: false,
  // 5 는 W3 부터 분석이 보내 온 `YXNBEST 5` 그대로다 — 스모크가 그 줄로 조각을 센다.
  multiPv: MULTI_PV.initial,
  analysisSec: 0,
  showEvalBar: true,
};

const KEY = "rapfi.settings";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** 저장된 값을 믿지 않는다 — 손으로 고친 값·옛 판의 값이 범위를 벗어날 수 있다. */
export function sanitize(raw: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const hash = num(raw.hashMb, d.hashMb);
  const node = num(raw.maxNode, d.maxNode);
  const sec = num(raw.analysisSec, d.analysisSec);
  const vct = num(raw.vcThread, d.vcThread);
  return {
    style: clamp(num(raw.style, d.style), STYLE_RANGE.min, STYLE_RANGE.max),
    hashMb: (HASH_CHOICES_MB as readonly number[]).includes(hash) ? hash : d.hashMb,
    maxDepth: clamp(num(raw.maxDepth, d.maxDepth), MIN_DEPTH, MAX_DEPTH_LIMIT),
    maxNode: node <= 0 ? -1 : Math.round(node),
    vcThread: (vct === 1 || vct === 2 ? vct : 0) as VcThread,
    hashAutoClear: typeof raw.hashAutoClear === "boolean" ? raw.hashAutoClear : d.hashAutoClear,
    multiPv: clamp(num(raw.multiPv, d.multiPv), MULTI_PV.min, MULTI_PV.max),
    analysisSec: sec > 0 ? Math.round(sec) : 0,
    showEvalBar: typeof raw.showEvalBar === "boolean" ? raw.showEvalBar : d.showEvalBar,
  };
}

function load(): Settings {
  try {
    const text = localStorage.getItem(KEY);
    return text ? sanitize(JSON.parse(text) as Partial<Settings>) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장이 안 돼도 이번 세션은 정상 동작한다 */
  }
}

/**
 * 엔진에 밀어 넣을 명령. 앱 `EngineParams.infoPairs()` 의 순서에서 시간·규칙·DB 를
 * 뺀 것이다 — 규칙은 워커가 START 앞에서 렌주로 고정하고(가중치가 렌주뿐이다),
 * DB 는 DB 화면(W6)이 열릴 때 붙는다.
 *
 * `thread_num` 은 언제나 1 이다 — 배포 변형이 단일 스레드 빌드라서다. 실측(0.43.02
 * single-simd128): 이 빌드는 `INFO THREAD_NUM 4`·`8` 을 오류 없이 **받고 무시한다**
 * (속도·출력이 1 과 같다). 그러니 1 이 아닌 값은 해롭지는 않지만 거짓 설정이 된다.
 * 스레드 조절은 멀티 변형이 브라우저에서 살아난 뒤의 일이다(W0c).
 */
export function engineInfo(s: Settings): EngineCommand[] {
  const info = (key: string, value: string | number): EngineCommand => ({
    kind: "info",
    key,
    value,
  });
  return [
    info("caution_factor", s.style),
    info("thread_num", 1),
    // main.c `set_hashsize`: 메가바이트를 킬로바이트로 밀어 보낸다(MB << 10).
    info("hash_size", s.hashMb * 1024),
    info("max_depth", s.maxDepth),
    info("max_node", s.maxNode),
    info("vcthread", s.vcThread),
  ];
}

export const toEngineConfig = (s: Settings): EngineConfig => ({
  info: engineInfo(s),
  hashAutoClear: s.hashAutoClear,
});

/** 엔진 스토어로 흘려보낸다. 엔진이 놀고 있으면 곧바로, 아니면 다음 탐색 직전에 닿는다. */
function push(s: Settings) {
  const e = useEngineStore.getState();
  e.configure(toEngineConfig(s));
  e.setMultiPv(s.multiPv);
  e.setAnalysisMs(s.analysisSec > 0 ? s.analysisSec * 1000 : Infinity);
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const initial = load();
push(initial);

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,
  update: (patch) => {
    const next = sanitize({ ...pick(get()), ...patch });
    set(next);
    save(next);
    push(next);
  },
  reset: () => {
    set(DEFAULT_SETTINGS);
    save(DEFAULT_SETTINGS);
    push(DEFAULT_SETTINGS);
  },
}));

/** 스토어 상태에서 설정 값만 — 함수는 저장하지 않는다. */
function pick(s: SettingsState): Settings {
  return {
    style: s.style,
    hashMb: s.hashMb,
    maxDepth: s.maxDepth,
    maxNode: s.maxNode,
    vcThread: s.vcThread,
    hashAutoClear: s.hashAutoClear,
    multiPv: s.multiPv,
    analysisSec: s.analysisSec,
    showEvalBar: s.showEvalBar,
  };
}
