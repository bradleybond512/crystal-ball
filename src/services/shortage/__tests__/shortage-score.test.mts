import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scoreOverallShortage,
  deriveConfidence,
  freshnessFor,
  buildDriver,
  inverseLinear,
  directLinear,
  detectGaps,
  uniqueSourceCount,
} from '../shortage-score.ts';
import type { ShortageDriver, ShortageInput } from '../shortage-types.ts';

const NOW = 1_745_000_000_000;

function driver(kind: ShortageDriver['kind'], score: number, source = 'src'): ShortageDriver {
  return { kind, score, label: `${kind}=${score}`, sources: [source] };
}

// ── Bucket math ─────────────────────────────────────────────────────────

test('scoreOverallShortage: weights buckets per defaults', () => {
  // 100 in production (weight 0.25) + nothing else → 100 normalized.
  const r = scoreOverallShortage([driver('production', 100)]);
  assert.equal(r.riskScore, 100);
  assert.equal(r.weightUsed, 0.25);
});

test('scoreOverallShortage: averages within a bucket', () => {
  const r = scoreOverallShortage([
    driver('production', 80),
    driver('production', 40),
  ]);
  // Bucket avg = 60; only one bucket used → normalized = 60.
  assert.equal(r.riskScore, 60);
});

test('scoreOverallShortage: protective drivers subtract', () => {
  const r = scoreOverallShortage([
    driver('inventory', 80),
    { ...driver('inventory', 60), polarity: 'protective' },
  ]);
  // (80 - 60) / 2 = 10
  assert.equal(r.riskScore, 10);
});

test('scoreOverallShortage: missing buckets reduce weightUsed but do not zero score', () => {
  // Only inventory and price provided; no production. Score stays
  // representative of the inputs given.
  const r = scoreOverallShortage([
    driver('inventory', 80),
    driver('price', 60),
  ]);
  // weight used = 0.2 + 0.15 = 0.35
  assert.equal(Math.round(r.weightUsed * 100) / 100, 0.35);
  // weighted = 80*0.2 + 60*0.15 = 16 + 9 = 25; normalized = 25/0.35 ≈ 71.4 → 71
  assert.equal(r.riskScore, 71);
});

test('scoreOverallShortage: clamps to 0-100', () => {
  // Force a custom weight so a runaway score can be tested.
  const r = scoreOverallShortage(
    [driver('production', 100)],
    { weights: { production: 1, inventory: 0, transport: 0, policy: 0, demand: 0, price: 0, cross_domain: 0 } },
  );
  assert.equal(r.riskScore, 100);
  assert.ok(r.riskScore <= 100);
});

// ── Driver building ─────────────────────────────────────────────────────

test('buildDriver: applies toRisk and rounds + clamps', () => {
  const d = buildDriver({
    kind: 'production',
    value: 50,
    toRisk: inverseLinear(40, 100),
    label: 'rainfall',
  });
  // (100 - 50) / (100 - 40) * 100 = 83.33 → 83
  assert.equal(d.score, 83);
  assert.equal(d.kind, 'production');
});

test('buildDriver: clamps below 0 and above 100', () => {
  const lo = buildDriver({ kind: 'price', value: 0, toRisk: inverseLinear(0, 100), label: 'x' });
  assert.equal(lo.score, 100);
  const hi = buildDriver({ kind: 'price', value: 200, toRisk: directLinear(0, 100), label: 'y' });
  assert.equal(hi.score, 100);
});

test('inverseLinear: at edges returns extremes', () => {
  const f = inverseLinear(40, 100);
  assert.equal(f(40), 100);
  assert.equal(f(100), 0);
  assert.equal(f(20), 100); // below low: still 100
  assert.equal(f(120), 0);  // above high: still 0
});

test('directLinear: at edges returns extremes', () => {
  const f = directLinear(0, 30);
  assert.equal(f(0), 0);
  assert.equal(f(30), 100);
  assert.equal(f(-5), 0);
  assert.equal(f(60), 100);
});

// ── Freshness ───────────────────────────────────────────────────────────

test('freshnessFor: 1.0 fresh, 0.5 at window, 0 at 2× window', () => {
  const week = 7 * 24 * 60 * 60 * 1000;
  const fresh: ShortageInput = { value: 1, observedAt: NOW };
  assert.equal(freshnessFor(fresh, week, NOW), 1);
  const atWindow: ShortageInput = { value: 1, observedAt: NOW - week };
  assert.equal(freshnessFor(atWindow, week, NOW), 0.5);
  const stale: ShortageInput = { value: 1, observedAt: NOW - 3 * week };
  assert.equal(freshnessFor(stale, week, NOW), 0);
});

test('freshnessFor: undefined input returns 0', () => {
  assert.equal(freshnessFor(undefined, 1000, NOW), 0);
});

// ── Confidence ──────────────────────────────────────────────────────────

test('deriveConfidence: low when weightUsed < 0.5', () => {
  assert.equal(
    deriveConfidence({ gapCount: 0, uniqueSourceCount: 3, worstFreshness: 1, weightUsed: 0.3 }),
    'low',
  );
});

test('deriveConfidence: low when 4+ data gaps', () => {
  assert.equal(
    deriveConfidence({ gapCount: 4, uniqueSourceCount: 3, worstFreshness: 1, weightUsed: 0.9 }),
    'low',
  );
});

test('deriveConfidence: low with zero sources', () => {
  assert.equal(
    deriveConfidence({ gapCount: 0, uniqueSourceCount: 0, worstFreshness: 1, weightUsed: 0.9 }),
    'low',
  );
});

test('deriveConfidence: medium with single source even if everything else is good', () => {
  assert.equal(
    deriveConfidence({ gapCount: 0, uniqueSourceCount: 1, worstFreshness: 1, weightUsed: 0.9 }),
    'medium',
  );
});

test('deriveConfidence: medium with stale data', () => {
  assert.equal(
    deriveConfidence({ gapCount: 0, uniqueSourceCount: 3, worstFreshness: 0.2, weightUsed: 0.9 }),
    'medium',
  );
});

test('deriveConfidence: high requires diverse sources, fresh data, and ≥75% weight coverage', () => {
  assert.equal(
    deriveConfidence({ gapCount: 0, uniqueSourceCount: 3, worstFreshness: 0.8, weightUsed: 0.85 }),
    'high',
  );
});

// ── Data gaps ───────────────────────────────────────────────────────────

test('detectGaps: returns missing keys', () => {
  const gaps = detectGaps(
    { a: { value: 1, observedAt: NOW } },
    [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }],
    NOW,
  );
  assert.deepEqual(gaps, ['Missing B', 'Missing C']);
});

test('detectGaps: flags stale inputs', () => {
  const week = 7 * 24 * 60 * 60 * 1000;
  const gaps = detectGaps(
    { a: { value: 1, observedAt: NOW - 2 * week } },
    [{ key: 'a', label: 'A', staleAfterMs: week }],
    NOW,
  );
  assert.equal(gaps.length, 1);
  assert.match(gaps[0]!, /Stale A/);
});

test('detectGaps: clean when everything is fresh', () => {
  const gaps = detectGaps(
    { a: { value: 1, observedAt: NOW } },
    [{ key: 'a', label: 'A', staleAfterMs: 1000 }],
    NOW,
  );
  assert.deepEqual(gaps, []);
});

// ── Source counting ─────────────────────────────────────────────────────

test('uniqueSourceCount: dedupes across drivers', () => {
  const ds: ShortageDriver[] = [
    { kind: 'production', score: 50, label: 'a', sources: ['src1', 'src2'] },
    { kind: 'price', score: 50, label: 'b', sources: ['src1'] },
    { kind: 'inventory', score: 50, label: 'c' }, // no sources
  ];
  assert.equal(uniqueSourceCount(ds), 2);
});
