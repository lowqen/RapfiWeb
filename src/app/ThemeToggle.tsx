import { useThemeStore, type ThemeMode } from "./theme";

const ORDER: readonly ThemeMode[] = ["system", "light", "dark"];
const LABEL: Record<ThemeMode, string> = {
  system: "시스템",
  light: "밝게",
  dark: "어둡게",
};

/** 3상태 순환. 설정 화면이 생기면(W5) 그쪽이 정식 자리고 여기는 지름길로 남는다. */
export function ThemeToggle() {
  const mode = useThemeStore((s) => s.mode);
  const set = useThemeStore((s) => s.set);
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;

  return (
    <button
      type="button"
      className="themetoggle"
      onClick={() => set(next)}
      title={`테마: ${LABEL[mode]} → ${LABEL[next]}`}
    >
      {LABEL[mode]}
    </button>
  );
}
