import type { EvalView } from "../../engine/eval-view";

/** 그래프의 한 점 — 기보의 `ply` 수째 국면에서 흑의 승률. */
export interface SeriesPoint {
  ply: number;
  pct: number;
}

/**
 * 형세 그래프가 그릴 점들 — 평가가 있는 국면만, 수 순서대로.
 *
 * **비어 있는 국면을 건너 이어 긋는다.** 처음에는 이웃한 수끼리만 이었는데, 대국에서는
 * 엔진이 **제 차례의 국면만** 읽으므로(사람 차례는 비어 있다) 점이 한 수 걸러 하나씩 서고,
 * 어느 구간도 두 점이 되지 않아 선이 한 줄도 그려지지 않았다 — 축만 남은 그래프였다.
 * 분석을 띄엄띄엄 돌린 기보도 같았다. 이제 아는 점끼리 잇고, 점이 드물면 점 표시(`markers`)를
 * 함께 그려 **어디가 실제로 읽은 국면인지** 보이게 한다.
 */
export function buildSeries(points: readonly (EvalView | null)[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  points.forEach((p, ply) => {
    if (p) out.push({ ply, pct: p.blackPct });
  });
  return out;
}

/** 점 표시를 그릴 만큼 드문가 — 많으면 점이 선을 덮어 오히려 읽히지 않는다. */
export const MARKER_LIMIT = 30;
export const showMarkers = (series: readonly SeriesPoint[]): boolean =>
  series.length > 0 && series.length <= MARKER_LIMIT;

/** `ply` 의 평가 — 없으면 그 앞에서 가장 가까운 평가(형세는 다음 평가까지 이어진다고 읽는다). */
export function evalAtOrBefore(
  points: readonly (EvalView | null)[],
  ply: number,
): { view: EvalView; ply: number } | null {
  for (let i = Math.min(ply, points.length - 1); i >= 0; i--) {
    const v = points[i];
    if (v) return { view: v, ply: i };
  }
  return null;
}
