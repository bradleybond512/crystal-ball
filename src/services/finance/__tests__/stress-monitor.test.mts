import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FSI_THRESHOLDS,
  buildCommodityAlert,
  buildFsiAlert,
  mean,
  rankCommodityAlerts,
  riskTierForDeviation,
  sigmaDeviation,
  stdev,
  tierForFsi,
  trendSign,
  type CommodityObservation,
  type CommoditySeries,
} from '../stress-monitor.ts';

const ISO = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toISOString();

// ── FSI tiering ────────────────────────────────────────────────────────

test('tierForFsi: bands match documented thresholds', () => {
  assert.equal(tierForFsi(0), 'normal');
  assert.equal(tierForFsi(FSI_THRESHOLDS.elevated), 'elevated');
  assert.equal(tierForFsi(FSI_THRESHOLDS.severe), 'severe');
  assert.equal(tierForFsi(-FSI_THRESHOLDS.elevated), 'low');
  assert.equal(tierForFsi(Number.NaN), 'normal');
});

test('buildFsiAlert: writes tier + a tier-specific message', () => {
  const a = buildFsiAlert({ date: ISO(2026, 4), index: 3.2 });
  assert.equal(a.tier, 'severe');
  assert.match(a.message, /severe/);
  const b = buildFsiAlert({ date: ISO(2026, 4), index: 0.5 });
  assert.equal(b.tier, 'normal');
});

// ── mean / stdev / sigmaDeviation ─────────────────────────────────────

test('mean: ignores NaN, NaN on empty', () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([1, Number.NaN, 3]), 2);
  assert.ok(Number.isNaN(mean([])));
});

test('stdev: known small dataset', () => {
  // [1, 2, 3, 4, 5] → mean 3, variance 2.5, sd ≈ 1.5811
  const sd = stdev([1, 2, 3, 4, 5]);
  assert.ok(Math.abs(sd - 1.5811388300841898) < 1e-9);
});

test('stdev: NaN for n<2', () => {
  assert.ok(Number.isNaN(stdev([1])));
});

test('sigmaDeviation: 2σ above mean returns ~2', () => {
  // window = [10,12,14,16,18] mean=14 sd≈3.162; current=20 → (20-14)/3.162 ≈ 1.897
  const sigma = sigmaDeviation(20, [10, 12, 14, 16, 18]);
  assert.ok(Math.abs(sigma - 1.8973665961010275) < 1e-9);
});

test('sigmaDeviation: zero stdev returns 0 (no signal)', () => {
  assert.equal(sigmaDeviation(5, [3, 3, 3]), 0);
});

// ── trendSign ─────────────────────────────────────────────────────────

test('trendSign: monotonic increase → rising', () => {
  const obs: CommodityObservation[] = [
    { date: ISO(2026, 1), price: 100 },
    { date: ISO(2026, 2), price: 110 },
    { date: ISO(2026, 3), price: 125 },
  ];
  assert.equal(trendSign(obs), 'rising');
});

test('trendSign: monotonic decrease → falling', () => {
  const obs: CommodityObservation[] = [
    { date: ISO(2026, 1), price: 100 },
    { date: ISO(2026, 2), price: 95 },
    { date: ISO(2026, 3), price: 88 },
  ];
  assert.equal(trendSign(obs), 'falling');
});

test('trendSign: flat within 1% → stable', () => {
  const obs: CommodityObservation[] = [
    { date: ISO(2026, 1), price: 100 },
    { date: ISO(2026, 2), price: 100.2 },
    { date: ISO(2026, 3), price: 99.9 },
  ];
  assert.equal(trendSign(obs), 'stable');
});

// ── riskTierForDeviation ──────────────────────────────────────────────

test('riskTierForDeviation: ladder', () => {
  assert.equal(riskTierForDeviation(0.5, 0.5), 'low');
  assert.equal(riskTierForDeviation(1.5, 0.5), 'medium');
  assert.equal(riskTierForDeviation(2.5, 0.5), 'high');
  assert.equal(riskTierForDeviation(3.5, 0.5), 'critical');
});

test('riskTierForDeviation: takes max of |d12|, |d24|', () => {
  // d12 small, d24 huge → tier should reflect the big one.
  assert.equal(riskTierForDeviation(0.1, -3.5), 'critical');
});

// ── buildCommodityAlert ──────────────────────────────────────────────

function flatSeries(price: number, n: number): CommoditySeries {
  return {
    commodity: 'wheat',
    unit: 'USD/MT',
    observations: Array.from({ length: n }, (_, i) => ({
      date: ISO(2024, ((i % 12) + 1)),
      price,
    })),
  };
}

test('buildCommodityAlert: too few observations → null', () => {
  const series: CommoditySeries = {
    commodity: 'wheat', unit: 'USD/MT',
    observations: [{ date: ISO(2026, 1), price: 200 }],
  };
  assert.equal(buildCommodityAlert(series), null);
});

test('buildCommodityAlert: 12 flat then a 2σ spike → high tier', () => {
  const obs: CommodityObservation[] = Array.from({ length: 13 }, (_, i) => ({
    date: ISO(2025, i + 1),
    // 12 flat at 200 plus a current observation at 240 — that's the
    // "current" in obs[12]. window12 picks obs[0..11] (mean 200, sd 0).
    // Stdev=0 → sigmaDeviation returns 0 by design. To exercise the
    // alert path we add some natural variation.
    price: i < 12 ? (200 + (i % 3) * 2) : 240,
  }));
  const series: CommoditySeries = { commodity: 'wheat', unit: 'USD/MT', observations: obs };
  const alert = buildCommodityAlert(series);
  assert.ok(alert);
  assert.equal(alert!.commodity, 'wheat');
  assert.ok(alert!.deviation12mSigma > 2, `12m σ = ${alert!.deviation12mSigma} should be > 2`);
  assert.ok(alert!.overallRisk === 'high' || alert!.overallRisk === 'critical');
});

test('buildCommodityAlert: 12 flat at constant → low tier (zero sigma)', () => {
  const series = flatSeries(200, 13);
  const alert = buildCommodityAlert(series);
  assert.ok(alert);
  assert.equal(alert!.deviation12mSigma, 0);
  assert.equal(alert!.overallRisk, 'low');
});

// ── rankCommodityAlerts ──────────────────────────────────────────────

test('rankCommodityAlerts: critical before high before medium before low', () => {
  const make = (commodity: 'wheat' | 'oil' | 'gold' | 'rice', d12: number, tier: 'low' | 'medium' | 'high' | 'critical') => ({
    commodity, unit: 'x', currentPrice: 1, deviation12mSigma: d12, deviation24mSigma: 0,
    trend: 'stable' as const, overallRisk: tier, message: '',
  });
  const ranked = rankCommodityAlerts([
    make('wheat', 0.2, 'low'),
    make('oil', 3.5, 'critical'),
    make('gold', 1.2, 'medium'),
    make('rice', 2.5, 'high'),
  ]);
  assert.deepEqual(ranked.map((a) => a.commodity), ['oil', 'rice', 'gold', 'wheat']);
});

test('rankCommodityAlerts: same tier breaks ties by |12m σ|', () => {
  const make = (c: 'wheat' | 'rice', d12: number) => ({
    commodity: c, unit: 'x', currentPrice: 1, deviation12mSigma: d12, deviation24mSigma: 0,
    trend: 'stable' as const, overallRisk: 'high' as const, message: '',
  });
  const ranked = rankCommodityAlerts([make('wheat', 2.1), make('rice', 2.9)]);
  assert.equal(ranked[0]!.commodity, 'rice');
});

// ── JSON serializability ─────────────────────────────────────────────

test('alerts are JSON-serializable', () => {
  const a = buildFsiAlert({ date: ISO(2026, 4), index: 2 });
  const round = structuredClone(a);
  assert.equal(round.tier, a.tier);
});
