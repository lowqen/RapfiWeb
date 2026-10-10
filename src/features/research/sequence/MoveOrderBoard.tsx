import type { MoveOrderChild, MoveOrderGhost } from "../../../core/moveorder/move-order";
import { formatPlies } from "../../../core/moveorder/move-order";
import { t } from "../../../i18n/i18n";

/**
 * 수순 탐색기의 판(`mo_board_draw`) — 파고든 길은 번호 단 단단한 돌, 남은 돌은 «몇 수째가 될 수
 * 있나»를 단 반투명 돌(모든 배치가 같은 자리일 때)이나 작은 점, 후보는 반투명 다음 돌에 그 갈래의
 * 몫만큼 굵은 고리.
 *
 * 메인 판의 렌더러를 쓰지 않는 까닭: 그림의 문법이 다르다(돌마다 수 번호 집합 · 몫 고리). 대신
 * 색은 같은 판 토큰(`--c-board-*`)이라 두 판이 한 재료로 보인다 — 앱이 「다른 재료의 판 둘은 두
 * 프로그램처럼 보였다」고 적은 그 이유다.
 */

const STEP = 40;
const PAD = 30;
const R = STEP * 0.45;

export interface CandidateRow extends MoveOrderChild {
  readonly share: number;
  readonly actual: boolean;
}

export function MoveOrderBoard({
  size,
  prefix,
  ghosts,
  rows,
  selected,
  onTap,
}: {
  size: number;
  prefix: readonly number[];
  ghosts: readonly MoveOrderGhost[];
  rows: readonly CandidateRow[];
  selected: number | null;
  onTap: (cell: number) => void;
}) {
  const W = PAD * 2 + STEP * (size - 1);
  const cx = (cell: number) => PAD + STEP * (cell % size);
  const cy = (cell: number) => PAD + STEP * Math.floor(cell / size);
  const candidates = new Set(rows.map((r) => r.cell));
  const inPrefix = new Set(prefix);
  const stars = size === 15 ? [3 * 15 + 3, 3 * 15 + 11, 7 * 15 + 7, 11 * 15 + 3, 11 * 15 + 11] : [];
  const ink = (black: boolean) =>
    black ? "var(--c-board-black-low)" : "var(--c-board-white-high)";
  const textInk = (black: boolean) =>
    black ? "var(--c-board-white-high)" : "var(--c-board-black-low)";

  return (
    <svg
      className="moboard"
      viewBox={`0 0 ${W} ${W}`}
      role="img"
      aria-label={t("수순 탐색 판: 파고든 {n}수, 다음 후보 {k}곳", {
        n: prefix.length,
        k: rows.length,
      })}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const x = Math.round((((e.clientX - box.left) / box.width) * W - PAD) / STEP);
        const y = Math.round((((e.clientY - box.top) / box.height) * W - PAD) / STEP);
        if (x >= 0 && y >= 0 && x < size && y < size) onTap(y * size + x);
      }}
    >
      <rect className="moboard__wood" x={0} y={0} width={W} height={W} rx={STEP * 0.5} />
      {Array.from({ length: size }, (_, i) => (
        <g key={i} className="moboard__grid">
          <line x1={PAD} x2={W - PAD} y1={PAD + STEP * i} y2={PAD + STEP * i} />
          <line y1={PAD} y2={W - PAD} x1={PAD + STEP * i} x2={PAD + STEP * i} />
        </g>
      ))}
      {stars.map((c) => (
        <circle key={c} className="moboard__star" cx={cx(c)} cy={cy(c)} r={STEP * 0.1} />
      ))}

      {/* 남은 돌 */}
      {ghosts
        .filter((g) => !candidates.has(g.cell) && !inPrefix.has(g.cell))
        .map((g) =>
          g.common ? (
            <g key={g.cell}>
              <circle
                cx={cx(g.cell)}
                cy={cy(g.cell)}
                r={R}
                fill={ink(g.color === 1)}
                opacity={g.color === 1 ? 0.35 : 0.5}
                stroke="var(--c-board-black-rim)"
                strokeOpacity={0.4}
              />
              <text className="moboard__plies" x={cx(g.cell)} y={cy(g.cell)}>
                {formatPlies(g.plies)}
              </text>
            </g>
          ) : (
            <circle
              key={g.cell}
              className="moboard__dot"
              cx={cx(g.cell)}
              cy={cy(g.cell)}
              r={STEP * 0.13}
            />
          ),
        )}

      {/* 파고든 길 */}
      {prefix.map((c, i) => (
        <g key={c}>
          <circle
            cx={cx(c)}
            cy={cy(c)}
            r={R}
            fill={ink(i % 2 === 0)}
            stroke={i % 2 === 0 ? "var(--c-board-black-rim)" : "var(--c-board-white-rim)"}
          />
          <text className="moboard__num" x={cx(c)} y={cy(c)} fill={textInk(i % 2 === 0)}>
            {i + 1}
          </text>
        </g>
      ))}

      {/* 후보 */}
      {rows.map((r) => {
        const black = r.color === 1;
        const ring =
          selected === r.cell
            ? "var(--c-primary)"
            : r.actual
              ? "var(--c-board-last-move)"
              : "var(--c-board-forbid)";
        return (
          <g key={r.cell} className="moboard__cand">
            <circle
              cx={cx(r.cell)}
              cy={cy(r.cell)}
              r={R}
              fill={ink(black)}
              opacity={black ? 0.6 : 0.7}
            />
            <circle
              cx={cx(r.cell)}
              cy={cy(r.cell)}
              r={R * 0.9}
              fill="none"
              stroke={ring}
              strokeOpacity={selected === r.cell || r.actual ? 1 : 0.35 + 0.65 * r.share}
              strokeWidth={1.5 + 3.5 * r.share}
            />
            <text className="moboard__share" x={cx(r.cell)} y={cy(r.cell)} fill={textInk(black)}>
              {Math.round(r.share * 100)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
