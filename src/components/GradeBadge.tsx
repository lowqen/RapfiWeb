import { gradeLabel, gradeName, type Grade } from "../core/opening/tables";
import { t } from "../i18n/i18n";

/**
 * 흑 5수 유불리 등급 표식 — 앱 `MiniBoard.drawGradeMark` 의 모양 다섯(원 · 오각 · 사각 ·
 * 삼각 · 엑스)을 SVG 로.
 *
 * 엔진 승률 사다리 색을 **쓰지 않는다**(앱과 같은 원칙): 이것은 사람이 적은 값이라
 * 엔진이 계산한 값과 같은 색이면 둘을 가를 수 없다. 모양이 뜻을 나르고 색은 거든다.
 */
export function GradeMarkIcon({ grade, size = 14 }: { grade: Grade; size?: number }) {
  const stroke = "var(--c-outline)";
  const sw = 1;
  let shape;
  switch (grade.mark) {
    case "circle":
      shape = <circle cx="8" cy="8" r="6.5" fill={grade.fill} stroke={stroke} strokeWidth={sw} />;
      break;
    case "pentagon":
      shape = (
        <polygon points={polygon(5, 7, -90)} fill={grade.fill} stroke={stroke} strokeWidth={sw} />
      );
      break;
    case "square":
      shape = (
        <rect
          x="2"
          y="2"
          width="12"
          height="12"
          fill={grade.fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
      break;
    case "triangle":
      shape = (
        <polygon
          points={polygon(3, 7.5, -90, 9)}
          fill={grade.fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
      break;
    case "cross":
      shape = (
        <path
          d="M3 3 13 13 M13 3 3 13"
          stroke={grade.fill}
          strokeWidth={3.2}
          strokeLinecap="round"
        />
      );
      break;
  }
  return (
    <svg className="grademark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {shape}
      {grade.dot && <circle cx="8" cy="8" r="2" fill={grade.dot} />}
    </svg>
  );
}

/** 정다각형 꼭짓점 — 중심 (8, cy), 반지름 r, 첫 꼭짓점 각도 start(도). */
function polygon(n: number, r: number, start: number, cy = 8): string {
  return Array.from({ length: n }, (_, i) => {
    const a = ((start + (360 / n) * i) * Math.PI) / 180;
    return `${(8 + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

/** 표식 + `+3 흑 매우 유리`. `compact` 면 이름을 빼고 부호 숫자만. */
export function GradeBadge({ grade, compact = false }: { grade: Grade; compact?: boolean }) {
  return (
    <span className="gradebadge" title={t("흑 5수 유불리: {g}", { g: gradeName(grade) })}>
      <GradeMarkIcon grade={grade} />
      <span className="tnum">{gradeLabel(grade)}</span>
      {!compact && <span className="gradebadge__name">{gradeName(grade)}</span>}
    </span>
  );
}
