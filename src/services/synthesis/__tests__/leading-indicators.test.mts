import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeAllPairs,
  buildAlert,
  buildGrangerDesign,
  fSurvival,
  grangerTest,
  mean,
  ols,
  rss,
  type TimeSeries,
} from '../leading-indicators.ts';

// ── mean / rss ─────────────────────────────────────────────────────────

test('mean: ignores NaN and skips empty arrays', () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([1, Number.NaN, 3]), 2);
  assert.ok(Number.isNaN(mean([])));
});

test('rss: zero residual on identical arrays', () => {
  assert.equal(rss([1, 2, 3], [1, 2, 3]), 0);
});

test('rss: throws on length mismatch', () => {
  assert.throws(() => rss([1, 2], [1, 2, 3]), /length mismatch/);
});

// ── ols ────────────────────────────────────────────────────────────────

test('ols: recovers linear coefficients on a clean fit', () => {
  // y = 2 + 3*x + 0.5*x^2 — fit with intercept + x + x^2.
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const x = i / 5;
    X.push([1, x, x * x]);
    y.push(2 + 3 * x + 0.5 * x * x);
  }
  const beta = ols(X, y);
  assert.ok(Math.abs(beta[0]! - 2) < 1e-6, `intercept ${beta[0]}`);
  assert.ok(Math.abs(beta[1]! - 3) < 1e-6, `slope ${beta[1]}`);
  assert.ok(Math.abs(beta[2]! - 0.5) < 1e-6, `quadratic ${beta[2]}`);
});

test('ols: singular system returns zero coefficients (no throw)', () => {
  // Two identical columns → rank-deficient.
  const X: number[][] = [[1, 2, 2], [1, 4, 4], [1, 6, 6]];
  const y = [1, 2, 3];
  const beta = ols(X, y);
  assert.equal(beta.length, 3);
  for (const b of beta) assert.ok(Number.isFinite(b));
});

// ── F-distribution survival ───────────────────────────────────────────

test('fSurvival: F=0 returns 1', () => {
  assert.equal(fSurvival(0, 5, 30), 1);
});

test('fSurvival: large F returns near 0', () => {
  const p = fSurvival(20, 5, 30);
  assert.ok(p < 0.01, `p=${p} should be tiny`);
});

test('fSurvival: F at typical critical value (~2.5 for df1=5,df2=30) yields p≈0.05', () => {
  const p = fSurvival(2.534, 5, 30);
  // Lookup table says ~0.05; our continued-fraction approximation
  // should land within 10% of that.
  assert.ok(p > 0.045 && p < 0.055, `p=${p}`);
});

// ── buildGrangerDesign ────────────────────────────────────────────────

test('buildGrangerDesign: emits y + restricted + unrestricted aligned', () => {
  const cause = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const effect = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const design = buildGrangerDesign(cause, effect, 2);
  assert.ok(design);
  assert.equal(design!.y.length, 8);
  // Restricted row layout: [1, y_{t-1}, y_{t-2}].
  assert.equal(design!.restricted[0]!.length, 3);
  // Unrestricted: [1, y_{t-1}, y_{t-2}, x_{t-1}, x_{t-2}].
  assert.equal(design!.unrestricted[0]!.length, 5);
});

test('buildGrangerDesign: NaN in lagged window drops that observation', () => {
  const cause = [1, 2, Number.NaN, 4, 5];
  const effect = [10, 11, 12, 13, 14];
  const design = buildGrangerDesign(cause, effect, 1);
  assert.ok(design);
  // t=2 references cause[1] (ok), t=3 refs cause[2]=NaN (drop), t=4 refs cause[3] (ok).
  assert.equal(design!.y.length, 3);
});

test('buildGrangerDesign: empty result returns null', () => {
  assert.equal(buildGrangerDesign([Number.NaN], [Number.NaN], 1), null);
});

test('buildGrangerDesign: throws on length mismatch', () => {
  assert.throws(() => buildGrangerDesign([1, 2], [1], 1), /length mismatch/);
});

test('buildGrangerDesign: throws on lag < 1', () => {
  assert.throws(() => buildGrangerDesign([1, 2], [1, 2], 0), /lag must be/);
});

// ── grangerTest ───────────────────────────────────────────────────────

test('grangerTest: cause leading effect by 5 days produces low p-value', () => {
  // Deterministic pseudo-random walk so the test is reproducible.
  // mulberry32 PRNG seeded with 42; values mapped to [-1, 1).
  let s = 42;
  const rng = (): number => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0xFFFFFFFF * 2 - 1;
  };
  const N = 250;
  const cause: number[] = [];
  // Random walk with fresh innovations — not periodic, so AR can't fit it perfectly.
  let prev = 0;
  for (let t = 0; t < N; t += 1) {
    prev = 0.7 * prev + rng();
    cause.push(prev);
  }
  // Effect = lagged cause + smaller independent noise.
  const effect: number[] = [];
  for (let t = 0; t < N; t += 1) {
    if (t < 5) effect.push(rng() * 0.5);
    else effect.push(cause[t - 5]! + 0.3 * rng());
  }
  const result = grangerTest(cause, effect, 5, { minObservations: 50 });
  assert.ok(result, 'should return result');
  assert.ok(result!.pValue < 0.01, `p=${result!.pValue} should be < 0.01`);
  assert.ok(result!.strength > 0.5, `strength=${result!.strength} should be substantial`);
});

test('grangerTest: independent series yield non-significant p-values', () => {
  const N = 200;
  const a: number[] = [];
  const b: number[] = [];
  // Two unrelated sines with different frequencies.
  for (let t = 0; t < N; t += 1) {
    a.push(Math.sin(t / 7));
    b.push(Math.cos(t / 3.7));
  }
  const result = grangerTest(a, b, 5, { minObservations: 50 });
  // p-value should NOT be tiny (no causal lag here).
  assert.ok(result === null || result.pValue > 0.05, `p=${result?.pValue}`);
});

test('grangerTest: insufficient observations returns null', () => {
  const series = Array.from({ length: 30 }, (_, i) => i);
  assert.equal(grangerTest(series, series, 5, { minObservations: 100 }), null);
});

// ── analyzeAllPairs ───────────────────────────────────────────────────

test('analyzeAllPairs: returns the strongest pair with its lag', () => {
  const N = 200;
  const aValues: number[] = [];
  const bValues: number[] = [];
  for (let t = 0; t < N; t += 1) aValues.push(Math.sin(t / 8));
  for (let t = 0; t < N; t += 1) {
    if (t < 7) bValues.push(0);
    else bValues.push(aValues[t - 7]! + 0.005 * Math.cos(t / 5));
  }
  const series: TimeSeries[] = [
    { key: 'bdi', startDate: '2025-01-01', values: aValues },
    { key: 'commodity_wheat', startDate: '2025-01-01', values: bValues },
  ];
  const out = analyzeAllPairs(series, { minLag: 1, maxLag: 14, minObservations: 50 });
  // The bdi → wheat direction should be strongly significant. We don't
  // pin the exact lag because periodic/autoregressive series let
  // multiple lag values fit well — the engine picks the lowest p, and
  // for sine-like data that may not be the structural lag.
  const bdiToWheat = out.find((r) => r.cause === 'bdi' && r.effect === 'commodity_wheat');
  assert.ok(bdiToWheat, 'bdi → wheat should be present');
  assert.ok(bdiToWheat!.pValue < 0.001, `p=${bdiToWheat!.pValue} should be very low`);
  assert.ok(bdiToWheat!.lagDays >= 1 && bdiToWheat!.lagDays <= 14);
});

test('analyzeAllPairs: filters at p-value threshold', () => {
  const N = 200;
  const a = Array.from({ length: N }, (_, t) => Math.sin(t / 7));
  const b = Array.from({ length: N }, (_, t) => Math.cos(t / 3.7));
  const series: TimeSeries[] = [
    { key: 'bdi', startDate: '2025-01-01', values: a },
    { key: 'commodity_oil', startDate: '2025-01-01', values: b },
  ];
  // Strict threshold should drop the (likely-noisy) pair.
  const out = analyzeAllPairs(series, { minLag: 1, maxLag: 14, pValueThreshold: 1e-10, minObservations: 50 });
  assert.equal(out.length, 0);
});

// ── buildAlert ────────────────────────────────────────────────────────

test('buildAlert: builds human-readable narrative', () => {
  const alert = buildAlert({
    cause: 'bdi', effect: 'commodity_wheat', lagDays: 56,
    fStatistic: 12.4, pValue: 0.002, strength: 0.42, observations: 200,
  });
  assert.match(alert.message, /Baltic Dry Index/);
  assert.match(alert.message, /wheat prices/);
  assert.match(alert.message, /56 days/);
  assert.equal(alert.lagDays, 56);
});
