/**
 * 보드 화면의 아이콘 — Material Symbols 24px 경로를 그대로 옮긴 것.
 *
 * 레일·하단 탭이 `destinations.ts` 의 경로 문자열을 `<svg><path/>` 로 그리는 것과
 * 같은 방식이다. 아이콘 폰트를 받지 않는 이유도 같다(`tokens.ts` 의 폰트 주석).
 */
export const ICON = {
  first: "M18.41 16.59 13.82 12l4.59-4.59L17 6l-6 6 6 6zM6 6h2v12H6z",
  prev: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  play: "M8 5v14l11-7z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  next: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  last: "M5.59 7.41 10.18 12l-4.59 4.59L7 18l6-6-6-6zM16 6h2v12h-2z",
  expand: "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z",
  minus: "M19 13H5v-2h14v2z",
  plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
} as const;

export function Icon({ d, className = "icon" }: { d: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
