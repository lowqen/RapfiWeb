/** 차트 · 화면 공용 숫자 형식 */

/** 깔끔한 눈금 — 1 · 2 · 5 × 10^k */
export function ticks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step)
    out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** 부호를 붙인 숫자 — 음수는 진짜 빼기표(−) */
export const signed = (v: number, d = 1) =>
  (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
