import assert from 'node:assert/strict';
import test from 'node:test';

import { createBaselineStore } from '../baseline-deviation.ts';

const NOW = 1_745_000_000_000;

function fillFlat(store: ReturnType<typeof createBaselineStore>, metric: string, n: number, value: number, startT = NOW - n * 60_000): void {
  for (let i = 0; i < n; i += 1) {
    store.record(metric, { t: startT + i * 60_000, v: value });
  }
}

function fillRandom(store: ReturnType<typeof createBaselineStore>, metric: string, n: number, mean: number, jitter: number): void {
  // Deterministic LCG so tests don't flap.
  let seed = 42;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffff_ffff;
  };
  for (let i = 0; i < n; i += 1) {
    const v = mean + (rand() - 0.5) * 2 * jitter;
    store.record(metric, { t: NOW - (n - i) * 60_000, v });
  }
}

// ── Recording + summary ─────────────────────────────────────────────────

test('record + summary: basic stats', () => {
  const s = createBaselineStore();
  s.record('m', { t: NOW, v: 10 });
  s.record('m', { t: NOW + 1, v: 20 });
  s.record('m', { t: NOW + 2, v: 30 });
  const sum = s.summary('m')!;
  assert.equal(sum.windowSize, 3);
  assert.equal(sum.mean, 20);
  assert.equal(sum.min, 10);
  assert.equal(sum.max, 30);
});

test('summary: returns undefined when no samples', () => {
  const s = createBaselineStore();
  assert.equal(s.summary('nonexistent'), undefined);
});

test('store: maxSamplesPerMetric drops oldest beyond cap', () => {
  const s = createBaselineStore({ maxSamplesPerMetric: 5 });
  for (let i = 0; i < 10; i += 1) {
    s.record('m', { t: NOW + i, v: i });
  }
  assert.equal(s.size('m'), 5);
  const sum = s.summary('m')!;
  // Should hold last 5 (values 5..9).
  assert.equal(sum.min, 5);
  assert.equal(sum.max, 9);
});

// ── Deviation: z-score + label ──────────────────────────────────────────

test('deviation: insufficient_data when below minSamplesForZ', () => {
  const s = createBaselineStore({ minSamplesForZ: 12 });
  fillFlat(s, 'm', 5, 100);
  const r = s.deviation('m', 200);
  assert.equal(r.label, 'insufficient_data');
  assert.equal(r.confidence, 0);
});

test('deviation: flat history → z=0 (zero stdDev guard)', () => {
  const s = createBaselineStore();
  fillFlat(s, 'm', 30, 100);
  const r = s.deviation('m', 100);
  assert.equal(r.zScore, 0);
  assert.equal(r.label, 'normal');
});

test('deviation: 2σ above mean → "high" label', () => {
  const s = createBaselineStore();
  fillRandom(s, 'm', 50, 100, 10); // mean ~100, stdDev ~5-6
  const sum = s.summary('m')!;
  // Use 2.1σ to land safely past the >=2 threshold in the face of FP rounding.
  const target = sum.mean + 2.1 * sum.stdDev;
  const r = s.deviation('m', target);
  assert.equal(r.label, 'high');
  assert.ok(r.zScore >= 2 && r.zScore < 3);
});

test('deviation: 3σ above mean → "extreme_high"', () => {
  const s = createBaselineStore();
  fillRandom(s, 'm', 50, 100, 10);
  const sum = s.summary('m')!;
  const target = sum.mean + 3.5 * sum.stdDev;
  const r = s.deviation('m', target);
  assert.equal(r.label, 'extreme_high');
});

test('deviation: -2σ below mean → "low"', () => {
  const s = createBaselineStore();
  fillRandom(s, 'm', 50, 100, 10);
  const sum = s.summary('m')!;
  const target = sum.mean - 2.2 * sum.stdDev;
  const r = s.deviation('m', target);
  assert.equal(r.label, 'low');
  assert.ok(r.zScore < -2);
});

test('deviation: percentile reflects rank in window', () => {
  const s = createBaselineStore();
  // 100 samples uniformly 0..99. Value 50 sits at percentile 0.51.
  for (let i = 0; i < 100; i += 1) {
    s.record('m', { t: NOW + i, v: i });
  }
  const r = s.deviation('m', 50);
  assert.ok(r.percentile >= 0.5 && r.percentile <= 0.55, `got ${r.percentile}`);
});

test('deviation: confidence rises with sample count, falls with zero variance', () => {
  const small = createBaselineStore();
  fillFlat(small, 'm', 15, 100);
  const flatLow = small.deviation('m', 100).confidence;
  // Zero variance even with samples → confidence 0.
  assert.equal(flatLow, 0);

  const big = createBaselineStore();
  fillRandom(big, 'm', 60, 100, 10);
  const variedHigh = big.deviation('m', 100).confidence;
  assert.ok(variedHigh > 0.5);
});

// ── Warmup mode ─────────────────────────────────────────────────────────

test('warmup: confidence is non-zero and ramps within the warmup window', () => {
  // 5 varied samples: above WARMUP_MIN_SAMPLES (3), below minSamplesForZ (12).
  const early = createBaselineStore({ minSamplesForZ: 12, warmupMode: true });
  fillRandom(early, 'm', 5, 100, 10);
  const r5 = early.deviation('m', 130);
  // Regression guard: the pre-fix code multiplied a floored-to-0 confidence by
  // the warmup scale, pinning warmup confidence to 0 forever.
  assert.notEqual(r5.label, 'insufficient_data');
  assert.ok(r5.confidence > 0, `expected >0, got ${r5.confidence}`);
  assert.ok(r5.confidence <= 0.5, `expected <=0.5 cap, got ${r5.confidence}`);

  // More samples (still in warmup) → higher confidence.
  const later = createBaselineStore({ minSamplesForZ: 12, warmupMode: true });
  fillRandom(later, 'm', 10, 100, 10);
  const r10 = later.deviation('m', 130);
  assert.ok(r10.confidence > r5.confidence, `expected ramp ${r10.confidence} > ${r5.confidence}`);
});

test('warmup: flat history still yields zero confidence (no variance)', () => {
  const s = createBaselineStore({ minSamplesForZ: 12, warmupMode: true });
  fillFlat(s, 'm', 6, 100);
  assert.equal(s.deviation('m', 100).confidence, 0);
});

test('deviation: summary string mentions sigma direction', () => {
  const s = createBaselineStore();
  fillRandom(s, 'm', 50, 100, 10);
  const sum = s.summary('m')!;
  const r = s.deviation('m', sum.mean + 2.5 * sum.stdDev);
  assert.match(r.summary, /σ above/);
});

// ── Pruning ────────────────────────────────────────────────────────────

test('prune: removes samples older than cutoff', () => {
  const s = createBaselineStore();
  s.record('m', { t: NOW - 60 * 60 * 1000, v: 1 });
  s.record('m', { t: NOW, v: 2 });
  const removed = s.prune(NOW - 30 * 60 * 1000);
  assert.equal(removed, 1);
  assert.equal(s.size('m'), 1);
});

test('prune: drops empty metrics', () => {
  const s = createBaselineStore();
  s.record('m', { t: NOW - 10_000, v: 1 });
  s.prune(NOW);
  assert.ok(!s.metrics().includes('m'));
});

// ── Multi-metric isolation ─────────────────────────────────────────────

test('metrics: each metric is independent', () => {
  const s = createBaselineStore();
  fillRandom(s, 'aircraft:US-CA', 30, 50, 10);
  fillRandom(s, 'aircraft:US-NY', 30, 200, 30);
  const ca = s.summary('aircraft:US-CA')!;
  const ny = s.summary('aircraft:US-NY')!;
  assert.notEqual(ca.mean, ny.mean);
  assert.equal(s.metrics().length, 2);
});

// ── Serialize / load ───────────────────────────────────────────────────

test('serialize: roundtrip preserves samples and stats', () => {
  const a = createBaselineStore();
  fillRandom(a, 'm', 30, 100, 10);
  const json = a.toJson();
  const b = createBaselineStore();
  b.loadJson(json);
  assert.equal(b.size('m'), 30);
  const aSum = a.summary('m')!;
  const bSum = b.summary('m')!;
  assert.equal(aSum.mean, bSum.mean);
  assert.equal(aSum.stdDev, bSum.stdDev);
});

// ── Determinism ────────────────────────────────────────────────────────

test('determinism: same seeded inputs produce same deviation result', () => {
  const a = createBaselineStore();
  const b = createBaselineStore();
  fillRandom(a, 'm', 50, 100, 10);
  fillRandom(b, 'm', 50, 100, 10);
  const ra = a.deviation('m', 130);
  const rb = b.deviation('m', 130);
  assert.deepEqual(ra, rb);
});

// ── Plan-listed metric domains ─────────────────────────────────────────

test('plan domains: all 7 metric types from PR 4 work the same', () => {
  // Sanity check that nothing in the implementation depends on a
  // specific metric vocabulary.
  const s = createBaselineStore();
  const metrics = [
    'aviation:aircraft-count:US-CA',
    'maritime:vessel-count:Hormuz',
    'alerts:per-region:US-IN',
    'cyber:cve-publications:CVE-2026',
    'markets:vix:close',
    'weather:tornado-warnings:US-IN',
    'infra:power-outages:US',
  ];
  for (const m of metrics) {
    fillRandom(s, m, 30, 100, 10);
    const r = s.deviation(m, 130);
    assert.notEqual(r.label, 'insufficient_data', `${m} failed`);
  }
});
