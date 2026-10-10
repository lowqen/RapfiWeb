import { useThemeStore, type ThemeMode } from "./theme";
import { msg, t } from "../i18n/i18n";

const ORDER: readonly ThemeMode[] = ["system", "light", "dark"];
const LABEL: Record<ThemeMode, string> = {
  system: msg("시스템"),
  light: msg("밝게"),
  dark: msg("어둡게"),
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
      title={t("테마: {now} → {next}", { now: t(LABEL[mode]), next: t(LABEL[next]) })}
    >
      {t(LABEL[mode])}
    </button>
  );
}
