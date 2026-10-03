/**
 * stats.mjs 검사 —  node --test bench/sprt/
 * (vitest 는 src/ 만 본다 — vite.config.ts 의 test.include)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PENTA_VALUES,
  TRI_VALUES,
  eloToScore,
  llr,
  llrApprox,
  normalQuantile,
  phi,
  scoreToElo,
  sprtBounds,
  summarize,
} from "./stats.mjs";

const close = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} ≉ ${b} (±${eps})`);

test("Elo ↔ 점수는 서로 역이고 기준점이 맞다", () => {
  close(eloToScore(0), 0.5, 1e-12);
  close(eloToScore(400), 10 / 11, 1e-12);
  for (const e of [-300, -5, 0, 5, 120]) close(scoreToElo(eloToScore(e)), e, 1e-9);
  assert.equal(scoreToElo(1), Infinity);
  assert.equal(scoreToElo(0), -Infinity);
});

test("Φ · Φ⁻¹ 가 표값과 맞는다", () => {
  close(phi(0), 0.5, 1e-7);
  close(phi(1.959964), 0.975, 1e-6);
  close(phi(-1), 0.158655, 1e-6);
  close(normalQuantile(0.975), 1.959964, 1e-6);
  close(normalQuantile(0.01), -2.326348, 1e-6);
  for (const p of [0.001, 0.2, 0.5, 0.9, 0.999]) close(phi(normalQuantile(p)), p, 2e-7);
});

test("Wald 경계 — α=β=0.05 는 ±ln 19", () => {
  const b = sprtBounds(0.05, 0.05);
  close(b.upper, Math.log(19), 1e-12);
  close(b.lower, -Math.log(19), 1e-12);
});

test("비김 없는 결과에서 GSPRT 는 베르누이 Wald LLR 그 자체다(근사도 가깝다)", () => {
  // 베르누이(이김/짐)의 정확한 Wald LLR: W·ln(s1/s0) + L·ln((1−s1)/(1−s0))
  const s0 = eloToScore(0);
  const s1 = eloToScore(5);
  for (const [W, L] of [
    [1, 0],
    [7, 3],
    [520, 480],
    [500, 500],
    [5100, 4900],
  ]) {
    const wald = W * Math.log(s1 / s0) + L * Math.log((1 - s1) / (1 - s0));
    close(llr(TRI_VALUES, [L, 0, W], 0, 5), wald, 1e-3, `정확 W=${W} L=${L}`);
    if (W + L >= 1000)
      close(
        llrApprox(TRI_VALUES, [L, 0, W], 0, 5),
        wald,
        Math.max(0.02, Math.abs(wald) * 0.01),
        `근사 W=${W} L=${L}`,
      );
  }
});

test("판이 많으면 정확 LLR 과 분산 근사가 같은 값으로 모인다(비김 · 오각 포함)", () => {
  for (const [values, counts] of [
    [TRI_VALUES, [3000, 4000, 3150]],
    [PENTA_VALUES, [200, 1300, 2500, 1400, 250]],
  ]) {
    const a = llr(values, counts);
    close(llrApprox(values, counts), a, Math.max(0.05, Math.abs(a) * 0.02), JSON.stringify(counts));
  }
});

test("한 판 · 한 쌍으로는 LLR 이 거의 움직이지 않는다(근사는 여기서 발산한다)", () => {
  assert.ok(Math.abs(llr(TRI_VALUES, [0, 0, 1])) < 0.05, String(llr(TRI_VALUES, [0, 0, 1])));
  assert.ok(
    Math.abs(llr(PENTA_VALUES, [0, 0, 0, 0, 1])) < 0.1,
    String(llr(PENTA_VALUES, [0, 0, 0, 0, 1])),
  );
  assert.ok(Math.abs(llr(TRI_VALUES, [0, 1, 0])) < 0.05); // 비김 하나
  assert.ok(llrApprox(TRI_VALUES, [0, 0, 1]) > 2, "근사의 초반 발산 — 정확한 쪽을 쓰는 까닭");
});

test("대칭 결과는 H0 쪽으로, 강한 결과는 H1 쪽으로 간다", () => {
  assert.ok(llr(TRI_VALUES, [300, 400, 300]) < 0);
  assert.ok(llr(TRI_VALUES, [250, 400, 350]) > 0);
  // 같은 평균이면 표본이 많을수록 |LLR| 이 커진다
  assert.ok(llr(TRI_VALUES, [500, 800, 700]) > llr(TRI_VALUES, [250, 400, 350]));
});

test("빈 분포 · 한 칸만 찬 분포에서도 유한하다(정칙화)", () => {
  assert.equal(llr(TRI_VALUES, [0, 0, 0]), 0);
  for (const counts of [
    [0, 10, 0],
    [0, 0, 10],
    [0, 0, 7, 0, 0],
  ]) {
    const v = counts.length === 3 ? TRI_VALUES : PENTA_VALUES;
    assert.ok(Number.isFinite(llr(v, counts)), JSON.stringify(counts));
  }
});

test("summarize — 오각이 있으면 오각으로 판정하고, 경계를 넘으면 결정한다", () => {
  const even = summarize({ wins: 10, draws: 0, losses: 10, penta: [0, 0, 10, 0, 0] });
  assert.equal(even.sprt.basis, "pentanomial");
  assert.equal(even.games, 20);
  close(even.pentanomial.score, 0.5, 1e-12);
  close(even.pentanomial.elo, 0, 1e-9);

  const strong = summarize({ wins: 1500, draws: 0, losses: 500, penta: [0, 0, 0, 500, 500] });
  assert.equal(strong.sprt.decision, "H1");
  assert.ok(strong.pentanomial.eloLow > 0 && strong.pentanomial.eloLow < strong.pentanomial.elo);

  const weak = summarize({ wins: 500, draws: 0, losses: 1500, penta: [500, 500, 0, 0, 0] });
  assert.equal(weak.sprt.decision, "H0");

  const fresh = summarize({ wins: 1, draws: 0, losses: 0, penta: [0, 0, 0, 0, 0] });
  assert.equal(fresh.sprt.basis, "trinomial");
  assert.equal(fresh.sprt.decision, null);
});

test("신뢰구간은 점수 ± z·se 를 Elo 로 옮긴 것이다", () => {
  const s = summarize({ wins: 60, draws: 20, losses: 20, penta: [0, 0, 0, 0, 0] }).trinomial;
  const mean = 0.7;
  const variance = (20 * 0.7 ** 2 + 20 * 0.2 ** 2 + 60 * 0.3 ** 2) / 100;
  const se = Math.sqrt(variance / 100);
  close(s.score, mean, 1e-12);
  close(s.eloLow, scoreToElo(mean - 1.959964 * se), 1e-3);
  close(s.eloHigh, scoreToElo(mean + 1.959964 * se), 1e-3);
});
