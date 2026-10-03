/**
 * SPRT · Elo 통계 — 엔진 A(시험) 대 B(기준)의 결과를 A 쪽에서 본다(이김 1 · 비김 ½ · 짐 0).
 *
 * ## SPRT
 * Wald 의 순차 확률비 검정을 **일반화(GSPRT)** 한 것을 쓴다 — fishtest 와 같은 방식이다.
 * 가설은 로지스틱 Elo 로 준다: H0 = elo0, H1 = elo1(기본 0 · 5). 각 Elo 를 기대 점수
 * s = 1 / (1 + 10^(−elo/400)) 로 바꾼다. 결과 분포(삼항 · 오각)는 평균만으로 정해지지 않으므로, 각 가설마다
 * **평균이 s 인 분포 중 관측에 가장 그럴듯한 것**(제약 MLE: p_i = p̂_i / (1 + λ(v_i − s)), λ 는 평균 조건의
 * 해)을 고르고 그 둘의 우도비를 쌓는다:
 *
 *     LLR = Σ n_i · [ln(1 + λ0(v_i − s0)) − ln(1 + λ1(v_i − s1))]
 *
 * 비김이 없으면 이것은 정확히 베르누이 Wald 값 W·ln(s1/s0) + L·ln((1−s1)/(1−s0)) 이 된다(stats.test.mjs).
 * 한 판이 움직이는 LLR 은 작다(이김 하나 ≈ +0.014). 흔히 쓰는 분산 근사
 * N·(s1 − s0)(2μ̂ − s0 − s1)/(2σ̂²)(`llrApprox`)는 판이 쌓이면 같은 값으로 수렴하지만, 초반에 분산이 0 에
 * 가까우면 발산한다 — 첫 판 이김 하나로 2.87(경계 2.944 턱밑)이 나온 것을 보고 정확한 쪽으로 바꿨다.
 * 경계는 Wald 그대로 A = ln(β/(1−α)) · B = ln((1−β)/α) — α=β=0.05 면 ±2.944. LLR ≥ B 이면 H1 채택,
 * ≤ A 이면 H0 채택.
 *
 * ## 표본 단위 — 오각(pentanomial)
 * 러너는 같은 개시를 색을 바꿔 두 판 둔다(쌍 대국). 두 판은 독립이 아니다(개시가 한쪽에 유리하면 둘 다
 * 그쪽으로 기운다). 그래서 **쌍 하나를 표본 하나**로 본다: 쌍 점수 = 두 판 점수 합 / 2 ∈ {0, ¼, ½, ¾, 1},
 * N = 끝난 쌍 수. 판 단위(삼항 W/D/L)는 참고로 같이 낸다 — 개시 편향이 크면 삼항 분산이 쌍 상관을 놓쳐
 * 과대·과소 판정할 수 있다.
 *
 * ## 정칙화
 * 칸이 0 인 분포(예: 처음 몇 판이 모두 비김)는 평균 조건을 만족하는 분포가 없을 수 있다(점수가 한쪽 끝에만
 * 있으면). LLR 계산에만 빈 칸을 1e-3 으로 채운다(fishtest 의 regularize). Elo · 신뢰구간 · LOS 는 원래 숫자로.
 */

/** 로지스틱 Elo → 기대 점수 */
export const eloToScore = (elo) => 1 / (1 + 10 ** (-elo / 400));

/** 기대 점수 → 로지스틱 Elo. 0 · 1 은 ±∞ */
export function scoreToElo(s) {
  if (s <= 0) return -Infinity;
  if (s >= 1) return Infinity;
  return -400 * Math.log10(1 / s - 1);
}

/** 표준 정규 누적분포 Φ — erf 를 Abramowitz–Stegun 7.1.26 으로(오차 < 1.5e-7) */
export function phi(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** 표준 정규 분위수 Φ⁻¹(p) — Acklam 의 유리 근사(상대 오차 < 1.2e-9) */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new RangeError(`p 는 (0, 1) 안이어야 합니다: ${p}`);
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** Wald 경계 */
export function sprtBounds(alpha = 0.05, beta = 0.05) {
  return { lower: Math.log(beta / (1 - alpha)), upper: Math.log((1 - beta) / alpha) };
}

/** 값 · 개수 → N · 평균 · 분산(표본 하나당, 모분산 꼴 — MLE) */
function moments(values, counts) {
  const n = counts.reduce((a, b) => a + b, 0);
  if (n <= 0) return { n: 0, mean: NaN, variance: NaN };
  const mean = values.reduce((acc, v, i) => acc + v * counts[i], 0) / n;
  const variance = values.reduce((acc, v, i) => acc + counts[i] * (v - mean) ** 2, 0) / n;
  return { n, mean, variance };
}

const regularize = (counts) => counts.map((c) => (c > 0 ? c : 1e-3));

/**
 * 평균이 s 인 분포 중 관측 확률 p̂ 에 가장 가까운(우도 최대) 것의 λ — Σ p̂_i a_i / (1 + λ a_i) = 0,
 * a_i = v_i − s. 좌변은 λ 에 대해 감소하므로 허용 구간(모든 1 + λ a_i > 0) 안에서 이분법으로 푼다.
 */
function mleLambda(values, probs, s) {
  const a = values.map((v) => v - s);
  const aMax = Math.max(...a);
  const aMin = Math.min(...a);
  if (!(aMax > 0 && aMin < 0)) return null; // s 가 값 범위 밖 — 그런 분포가 없다
  let lo = -1 / aMax;
  let hi = -1 / aMin;
  const f = (lam) => a.reduce((acc, ai, i) => acc + (probs[i] * ai) / (1 + lam * ai), 0);
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-15) break;
  }
  return (lo + hi) / 2;
}

/**
 * GSPRT LLR(정확 — 제약 MLE 두 분포의 우도비).
 * @param {number[]} values 표본 하나의 가능한 점수(삼항 [0, ½, 1] · 오각 [0, ¼, ½, ¾, 1])
 * @param {number[]} counts 각 점수의 개수
 */
export function llr(values, counts, elo0 = 0, elo1 = 5) {
  if (counts.reduce((x, y) => x + y, 0) <= 0) return 0;
  const reg = regularize(counts);
  const n = reg.reduce((x, y) => x + y, 0);
  const probs = reg.map((c) => c / n);
  const s0 = eloToScore(elo0);
  const s1 = eloToScore(elo1);
  const l0 = mleLambda(values, probs, s0);
  const l1 = mleLambda(values, probs, s1);
  if (l0 === null || l1 === null) return 0;
  return reg.reduce(
    (acc, c, i) =>
      acc + c * (Math.log1p(l0 * (values[i] - s0)) - Math.log1p(l1 * (values[i] - s1))),
    0,
  );
}

/** 흔한 분산 근사 N·(s1 − s0)(2μ̂ − s0 − s1)/(2σ̂²) — 검사에서 정확한 값과 맞대 보는 용도로만 */
export function llrApprox(values, counts, elo0 = 0, elo1 = 5) {
  if (counts.reduce((x, y) => x + y, 0) <= 0) return 0;
  const { n, mean, variance } = moments(values, regularize(counts));
  if (!(variance > 0)) return 0;
  const s0 = eloToScore(elo0);
  const s1 = eloToScore(elo1);
  return (n * (s1 - s0) * (2 * mean - s0 - s1)) / (2 * variance);
}

/**
 * 한 분포의 Elo · 신뢰구간 · LOS · LLR.
 * @param {number[]} values
 * @param {number[]} counts
 */
export function analyze(values, counts, { elo0 = 0, elo1 = 5, confidence = 0.95 } = {}) {
  const { n, mean, variance } = moments(values, counts);
  if (n === 0) return { n, score: NaN, elo: NaN, eloLow: NaN, eloHigh: NaN, los: NaN, llr: 0 };
  const se = Math.sqrt(variance / n);
  const z = normalQuantile(0.5 + confidence / 2);
  return {
    n,
    score: mean,
    elo: scoreToElo(mean),
    eloLow: scoreToElo(mean - z * se),
    eloHigh: scoreToElo(mean + z * se),
    los: se > 0 ? phi((mean - 0.5) / se) : mean > 0.5 ? 1 : mean < 0.5 ? 0 : 0.5,
    llr: llr(values, counts, elo0, elo1),
  };
}

export const TRI_VALUES = [0, 0.5, 1];
export const PENTA_VALUES = [0, 0.25, 0.5, 0.75, 1];

/**
 * 러너가 쌓은 숫자 → 보고 묶음. SPRT 판정은 쌍이 하나라도 끝났으면 오각, 아니면 삼항으로 한다.
 * @param {{ wins: number, draws: number, losses: number, penta: number[] }} tally
 *        wins/draws/losses 는 A 쪽 판 수, penta[k] 는 쌍 점수 합(0~2, ½ 단위) × 2 = k 인 쌍 수
 */
export function summarize(
  tally,
  { elo0 = 0, elo1 = 5, alpha = 0.05, beta = 0.05, confidence = 0.95 } = {},
) {
  const bounds = sprtBounds(alpha, beta);
  const games = tally.wins + tally.draws + tally.losses;
  const trinomial = analyze(TRI_VALUES, [tally.losses, tally.draws, tally.wins], {
    elo0,
    elo1,
    confidence,
  });
  const pentanomial = analyze(PENTA_VALUES, tally.penta, { elo0, elo1, confidence });
  const basis = pentanomial.n > 0 ? "pentanomial" : "trinomial";
  const value = basis === "pentanomial" ? pentanomial.llr : trinomial.llr;
  const decision = value >= bounds.upper ? "H1" : value <= bounds.lower ? "H0" : null;
  return {
    games,
    wins: tally.wins,
    draws: tally.draws,
    losses: tally.losses,
    drawRatio: games ? tally.draws / games : NaN,
    trinomial,
    pentanomial,
    sprt: { elo0, elo1, alpha, beta, ...bounds, basis, llr: value, decision },
  };
}
