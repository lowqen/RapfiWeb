/** 아이콘 하나 — 경로 문자열은 `icon-paths.ts` 의 `ICON`. */
export function Icon({ d, className = "icon" }: { d: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
