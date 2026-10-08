import { create } from "zustand";

/**
 * 테마 3상태 — `system`(기본) / `light` / `dark`.
 *
 * **데스크톱 `settings.txt` 27행이 오라클이다.** 사용자가 PC 설정을 불러오면 그
 * 값이 `light`/`dark` 로 **고정**되고 시스템 설정을 이긴다 — 앱과 같은 규칙이고,
 * 이유도 같다: PC 설정을 가져온 사람은 앱이 자기 PC 처럼 보이기를 기대한다.
 * (불러오기는 W5b. 여기서는 그 진입점만 `setFromDesktopSettings` 로 열어 둔다.)
 *
 * Material You(동적 색)는 앱이 의도적으로 거부했으므로 웹에도 없다.
 */
export type ThemeMode = "system" | "light" | "dark";

const KEY = "rapfi.theme";

function load(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    // 사생활 보호 모드 등에서는 접근 자체가 던진다. system 이 안전한 기본값이다.
    return "system";
  }
}

function apply(mode: ThemeMode) {
  const el = document.documentElement;
  if (mode === "system") delete el.dataset.theme;
  else el.dataset.theme = mode;
  try {
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* 저장이 안 돼도 이번 세션은 정상 동작한다 */
  }
}

interface ThemeState {
  mode: ThemeMode;
  set: (mode: ThemeMode) => void;
  /** settings.txt 27행 → 명시 고정. W5b 가 이 함수를 부른다. */
  setFromDesktopSettings: (darkFromLine27: boolean) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: load(),
  set: (mode) => {
    apply(mode);
    set({ mode });
  },
  setFromDesktopSettings: (dark) => {
    const mode: ThemeMode = dark ? "dark" : "light";
    apply(mode);
    set({ mode });
  },
}));
