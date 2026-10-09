import { DEFAULT_SIZE, type Move } from "../../../core/model/move";

/**
 * 개시 썸네일 — 천원 둘레 7×7 만 그린 작은 판(SVG). 3수 · 5수 개시는 늘 그 안에 있다(벗어난 돌은
 * 가장자리에 붙인다). 캔버스 보드를 줄 수십 개에 띄우면 무겁고, 이 크기에서는 돌과 격자만 읽히면 된다.
 */
const R = 3; // 천원에서 위아래 · 좌우로 몇 칸
const N = 2 * R + 1;
const STEP = 10;
const PAD = 6;
const SIDE = PAD * 2 + STEP * (N - 1);

export function MiniBoard({
  moves,
  className,
  size = DEFAULT_SIZE,
}: {
  moves: readonly Move[];
  className?: string;
  size?: number;
}) {
  const c = size >> 1;
  const clamp = (v: number) => Math.min(R, Math.max(-R, v - c)) + R;
  const lines = Array.from({ length: N }, (_, i) => PAD + i * STEP);
  return (
    <svg
      className={"miniboard" + (className ? ` ${className}` : "")}
      viewBox={`0 0 ${SIDE} ${SIDE}`}
      role="img"
      aria-label={`${moves.length}수 개시`}
    >
      <rect className="miniboard__wood" x="0" y="0" width={SIDE} height={SIDE} rx="3" />
      {lines.map((p) => (
        <g key={p} className="miniboard__grid">
          <line x1={PAD} y1={p} x2={SIDE - PAD} y2={p} />
          <line x1={p} y1={PAD} x2={p} y2={SIDE - PAD} />
        </g>
      ))}
      {moves.map((m, i) => (
        <circle
          key={i}
          cx={PAD + clamp(m.x) * STEP}
          cy={PAD + clamp(m.y) * STEP}
          r={STEP * 0.42}
          className={i % 2 === 0 ? "miniboard__black" : "miniboard__white"}
        />
      ))}
    </svg>
  );
}
