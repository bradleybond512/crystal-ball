// src/services/survival/__tests__/world-branches.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldBranches } from '../world-branches.ts';
import type { AxisBranchSet, BranchKind } from '../world-branches.ts';
import type { AxisProjection, PostureTrajectory, TrajectoryHorizon } from '../posture-trajectory.ts';
import type { SurvivalAxis } from '../survival-types.ts';

function proj(p: Partial<AxisProjection> = {}): AxisProjection {
  return {
    axis: 'physical_safety',
    horizonId: '24h',
    horizonMins: 1440,
    currentLevel: 50,
    projectedLevel: 50,
    projectedBand: 'elevated',
    delta: 0,
    direction: 'steady',
    confidence: 0.7,
    drivers: [],
    rationale: '',
    ...p,
  };
}

function traj(
  projections: AxisProjection[],
  horizons: TrajectoryHorizon[] = [{ id: '24h', mins: 1440 }],
): PostureTrajectory {
  return {
    capturedAtMs: 1_700_000_000_000,
    horizons,
    projections,
    peakAxis: null,
    peakLevel: 0,
    peakHorizonId: null,
    headline: '',
  };
}

function setFor(w: ReturnType<typeof buildWorldBranches>, axis: SurvivalAxis, horizonId: string): AxisBranchSet {
  return w.axisSets.find((s) => s.axis === axis && s.horizonId === horizonId)!;
}

function kind(s: AxisBranchSet, k: BranchKind) {
  return s.branches.find((b) => b.kind === k)!;
}

test('each axis-horizon yields exactly three branches whose DISPLAYED probabilities sum to exactly 1', () => {
  const w = buildWorldBranches(traj([proj({ projectedLevel: 60, delta: 10, direction: 'escalating' })]));
  const s = setFor(w, 'physical_safety', '24h');
  assert.equal(s.branches.length, 3);
  const sum = s.branches.reduce((m, b) => m + b.probability, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
  assert.deepEqual(s.branches.map((b) => b.kind), ['escalate', 'hold', 'ease']);
});

test('rounded probabilities sum to exactly 1 even when independent rounding would drift (hold absorbs residual)', () => {
  // confidence 0.02, delta 0 → raw pHold 0.408, tails 0.296 each; naive
  // rounding gives 0.41 + 0.30 + 0.30 = 1.01. hold must absorb the residual.
  const s = setFor(buildWorldBranches(traj([proj({ confidence: 0.02, delta: 0 })])), 'physical_safety', '24h');
  const sum = s.branches.reduce((m, b) => m + b.probability, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
});

test('high confidence collapses the spread toward the central path', () => {
  const s = setFor(buildWorldBranches(traj([proj({ projectedLevel: 55, confidence: 1 })])), 'physical_safety', '24h');
  assert.equal(kind(s, 'escalate').level, 55);
  assert.equal(kind(s, 'hold').level, 55);
  assert.equal(kind(s, 'ease').level, 55);
  assert.equal(kind(s, 'hold').probability, 0.8); // 0.4 + 0.4*1
});

test('low confidence widens the spread to the full one-sided swing', () => {
  const s = setFor(buildWorldBranches(traj([proj({ projectedLevel: 50, confidence: 0 })])), 'physical_safety', '24h');
  assert.equal(kind(s, 'escalate').level, 85); // 50 + 35
  assert.equal(kind(s, 'ease').level, 15); // 50 - 35
  assert.equal(kind(s, 'hold').probability, 0.4); // floor
});

test('an escalating projection tilts probability mass toward escalate', () => {
  const s = setFor(buildWorldBranches(traj([proj({ projectedLevel: 60, delta: 30, direction: 'escalating' })])), 'physical_safety', '24h');
  assert.ok(kind(s, 'escalate').probability > kind(s, 'ease').probability);
});

test('an easing projection tilts probability mass toward ease', () => {
  const s = setFor(buildWorldBranches(traj([proj({ projectedLevel: 40, delta: -30, direction: 'easing' })])), 'physical_safety', '24h');
  assert.ok(kind(s, 'ease').probability > kind(s, 'escalate').probability);
});

test('a steady projection splits the residual mass evenly', () => {
  const s = setFor(buildWorldBranches(traj([proj({ projectedLevel: 50, delta: 0, direction: 'steady' })])), 'physical_safety', '24h');
  assert.equal(kind(s, 'escalate').probability, kind(s, 'ease').probability);
});

test('mostLikely is hold under confidence, but can flip to escalate under a strong low-confidence climb', () => {
  const calm = setFor(buildWorldBranches(traj([proj({ confidence: 0.7, delta: 0 })])), 'physical_safety', '24h');
  assert.equal(calm.mostLikely, 'hold');
  const volatile = setFor(buildWorldBranches(traj([proj({ confidence: 0, delta: 50, direction: 'escalating' })])), 'physical_safety', '24h');
  assert.equal(volatile.mostLikely, 'escalate'); // pEscalate 0.57 > pHold 0.4
});

test('mostLikely is decided on un-rounded probabilities so a sub-cent gap does not flip it', () => {
  // confidence 0, delta 16.5 → pHold 0.400, pEscalate 0.6*(0.5+0.5*0.33)=0.399.
  // Both round to 0.40; hold is genuinely likelier and must win the tie-break.
  const s = setFor(buildWorldBranches(traj([proj({ confidence: 0, delta: 16.5, direction: 'escalating' })])), 'physical_safety', '24h');
  assert.equal(kind(s, 'hold').probability, kind(s, 'escalate').probability); // both display 0.40
  assert.equal(s.mostLikely, 'hold');
});

test('expected level is the probability-weighted mean of the three branch levels', () => {
  const s = setFor(buildWorldBranches(traj([proj({ projectedLevel: 60, confidence: 0.5, delta: 20, direction: 'escalating' })])), 'physical_safety', '24h');
  const weighted = s.branches.reduce((m, b) => m + b.probability * b.level, 0);
  // branch probabilities are rounded to 2dp, so allow a small reconstruction gap.
  assert.ok(Math.abs(s.expectedLevel - weighted) < 0.6, `expected=${s.expectedLevel} weighted=${weighted}`);
});

test('branch levels are clamped to 0..100 even at the widest spread', () => {
  const hi = setFor(buildWorldBranches(traj([proj({ projectedLevel: 95, confidence: 0 })])), 'physical_safety', '24h');
  assert.equal(kind(hi, 'escalate').level, 100); // 95 + 35 clamped
  const lo = setFor(buildWorldBranches(traj([proj({ projectedLevel: 10, confidence: 0 })])), 'physical_safety', '24h');
  assert.equal(kind(lo, 'ease').level, 0); // 10 - 35 clamped
});

test('bands are derived from each branch level', () => {
  const s = setFor(buildWorldBranches(traj([proj({ projectedLevel: 50, confidence: 0 })])), 'physical_safety', '24h');
  assert.equal(kind(s, 'escalate').band, 'critical'); // 85 -> critical
  assert.equal(kind(s, 'hold').band, 'elevated'); // 50 -> elevated
  assert.equal(kind(s, 'ease').band, 'secure'); // 15 -> secure
});

test('axis sets are horizon-major, worst-expected-first within each horizon', () => {
  const w = buildWorldBranches(traj(
    [
      proj({ axis: 'supply', horizonId: '6h', projectedLevel: 20 }),
      proj({ axis: 'physical_safety', horizonId: '6h', projectedLevel: 80 }),
      proj({ axis: 'comms', horizonId: '6h', projectedLevel: 50 }),
    ],
    [{ id: '6h', mins: 360 }],
  ));
  assert.deepEqual(w.axisSets.map((s) => s.axis), ['physical_safety', 'comms', 'supply']);
});

test('headline names the most consequential escalation branch', () => {
  const w = buildWorldBranches(traj(
    [
      proj({ axis: 'physical_safety', horizonId: '72h', projectedLevel: 40, confidence: 0.6 }),
      proj({ axis: 'supply', horizonId: '72h', projectedLevel: 85, confidence: 0.3, delta: 40, direction: 'escalating' }),
    ],
    [{ id: '72h', mins: 4320 }],
  ));
  assert.ok(w.headline.includes('Supply'), w.headline);
  assert.ok(w.headline.includes('72h'), w.headline);
  assert.ok(/\d+% branch/.test(w.headline), w.headline);
});

test('empty trajectory yields no branches and an honest headline', () => {
  const w = buildWorldBranches(traj([]));
  assert.deepEqual(w.axisSets, []);
  assert.equal(w.headline, 'No posture data to branch.');
});

test('an all-low posture reports no material escalation branch', () => {
  const w = buildWorldBranches(traj([proj({ projectedLevel: 5, confidence: 0.9 })]));
  assert.equal(w.headline, 'No material escalation branch across the projection window.');
});

test('headline filters materiality BEFORE ranking so a genuine critical branch is not hidden behind a high-prob sub-20 winner', () => {
  const w = buildWorldBranches(traj(
    [
      // Immaterial escalate (level 19.8 < 20) but the higher prob*level score (~3.2).
      proj({ axis: 'supply', horizonId: '72h', projectedLevel: 10, confidence: 0.72, delta: 0, direction: 'steady' }),
      // Material CRITICAL escalate (level 86.75) but a lower prob*level score (~1.7).
      proj({ axis: 'security', horizonId: '72h', projectedLevel: 85, confidence: 0.95, delta: -40, direction: 'easing' }),
    ],
    [{ id: '72h', mins: 4320 }],
  ));
  assert.ok(w.headline.includes('Security'), w.headline);
  assert.ok(w.headline.includes('critical'), w.headline);
  assert.ok(!/No material/.test(w.headline), w.headline);
});

test('custom maxSpread option is respected', () => {
  const s = setFor(buildWorldBranches(traj([proj({ projectedLevel: 50, confidence: 0 })]), { maxSpread: 10 }), 'physical_safety', '24h');
  assert.equal(kind(s, 'escalate').level, 60); // 50 + 10
  assert.equal(kind(s, 'ease').level, 40); // 50 - 10
});

test('maxSpread 0 removes divergence even at zero confidence', () => {
  const s = setFor(buildWorldBranches(traj([proj({ projectedLevel: 50, confidence: 0 })]), { maxSpread: 0 }), 'physical_safety', '24h');
  assert.equal(kind(s, 'escalate').level, 50);
  assert.equal(kind(s, 'ease').level, 50);
});

test('non-finite confidence / level never leak NaN into output', () => {
  const w = buildWorldBranches(traj([proj({ projectedLevel: Number.NaN, confidence: Number.NaN, delta: Number.POSITIVE_INFINITY })]));
  const s = setFor(w, 'physical_safety', '24h');
  for (const b of s.branches) {
    assert.ok(Number.isFinite(b.level) && b.level >= 0 && b.level <= 100);
    assert.ok(Number.isFinite(b.probability) && b.probability >= 0 && b.probability <= 1);
  }
  assert.ok(Number.isFinite(s.expectedLevel));
});
