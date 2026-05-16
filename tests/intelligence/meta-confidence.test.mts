/**
 * Tests for MetaConfidenceService (Phase 4).
 *
 * Pure service tests. localStorage is stubbed at module load so the
 * persistence + hydration paths are reachable without a DOM.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// localStorage stub — must be installed before importing the service.
const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  MetaConfidenceService,
  __internals,
  __resetMetaConfidenceSingleton,
  getMetaConfidenceService,
  type ConfidenceReliability,
  type MetaConfidenceEstimate,
} from '../../src/services/intelligence/meta-confidence.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/services/intelligence/observation-adapters.ts';
import type { Assumption } from '../../src/services/intelligence/assumption-tracker.ts';

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function makeObservation(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'test',
    domain: 'weather',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'Test',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeAssumption(overrides: Partial<Assumption> = {}): Assumption {
  return {
    id: 'a',
    category: 'data-completeness',
    statement: 'placeholder',
    confidence: 0.8,
    isCritical: false,
    violationRisk: 'low',
    affectedOutputIds: [],
    detectedAt: new Date(NOW),
    ...overrides,
  } as Assumption;
}

function freshService(): MetaConfidenceService {
  __storage.clear();
  return new MetaConfidenceService({ clock: () => NOW });
}

function uniformObservations(
  count: number,
  severity: ObservationSeverity,
  domains: readonly string[] = ['weather'],
): ObservationEvent[] {
  const out: ObservationEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(makeObservation({
      id: `obs-${i}`,
      domain: domains[i % domains.length]!,
      sourceId: `src-${i % domains.length}`,
      severity,
    }));
  }
  return out;
}

// ── Sample-size driven reliability ───────────────────────────────────

test('single observation yields provisional or speculative reliability', () => {
  const svc = freshService();
  const est = svc.estimate({
    targetId: 't1',
    targetType: 'situation',
    reportedConfidence: 0.8,
    observations: [makeObservation()],
  });
  assert.ok(['provisional', 'speculative'].includes(est.reliability), `got ${est.reliability}`);
  assert.equal(est.sampleSize, 1);
});

test('10 consistent observations across many domains → anchored', () => {
  const svc = freshService();
  // 10 obs, uniform CRITICAL severity, across 10 distinct domains
  // → breadth=1, consistency=1, stability=0.5
  // metaConfidence = 1*0.35 + 1*0.35 + 0.5*0.3 = 0.85 → anchored
  const obs = uniformObservations(
    10,
    'CRITICAL',
    ['weather', 'earthquake', 'cyber', 'maritime', 'aviation', 'biosurveillance', 'space', 'conflict', 'infra', 'finance'],
  );
  const est = svc.estimate({
    targetId: 't2',
    targetType: 'situation',
    reportedConfidence: 0.9,
    observations: obs,
  });
  assert.equal(est.reliability, 'anchored');
});

// ── Critical-assumption penalty ──────────────────────────────────────

test('one critical+high-risk assumption knocks 10% off metaConfidence', () => {
  const svc = freshService();
  const obs = uniformObservations(10, 'HIGH', ['weather', 'earthquake', 'cyber', 'maritime', 'aviation']);
  const without = svc.estimate({
    targetId: 't3',
    targetType: 'score',
    reportedConfidence: 0.8,
    observations: obs,
  });
  const with1Assumption = svc.estimate({
    targetId: 't3a',
    targetType: 'score',
    reportedConfidence: 0.8,
    observations: obs,
    assumptions: [makeAssumption({ isCritical: true, violationRisk: 'high' })],
  });
  // Penalty applied multiplicatively: meta * (1 - 0.1)
  const expected = Number((without.metaConfidence * 0.9).toFixed(4));
  assert.equal(with1Assumption.metaConfidence, expected);
});

test('non-critical assumptions do not penalize', () => {
  const svc = freshService();
  const obs = uniformObservations(5, 'MEDIUM', ['weather', 'cyber']);
  const baseline = svc.estimate({
    targetId: 't4',
    targetType: 'score',
    reportedConfidence: 0.6,
    observations: obs,
  });
  const withNoise = svc.estimate({
    targetId: 't4b',
    targetType: 'score',
    reportedConfidence: 0.6,
    observations: obs,
    assumptions: [
      makeAssumption({ isCritical: false, violationRisk: 'high' }),
      makeAssumption({ isCritical: true, violationRisk: 'low' }),
      makeAssumption({ isCritical: true, violationRisk: 'medium' }),
    ],
  });
  assert.equal(withNoise.metaConfidence, baseline.metaConfidence);
});

test('multiple critical+high-risk assumptions compound', () => {
  const svc = freshService();
  const obs = uniformObservations(5, 'MEDIUM', ['weather', 'cyber']);
  const est = svc.estimate({
    targetId: 't5',
    targetType: 'score',
    reportedConfidence: 0.6,
    observations: obs,
    assumptions: [
      makeAssumption({ isCritical: true, violationRisk: 'high' }),
      makeAssumption({ isCritical: true, violationRisk: 'high' }),
    ],
  });
  // Both penalties summed = 0.2 → multiplier 0.8
  const baseline = svc.estimate({
    targetId: 't5b',
    targetType: 'score',
    reportedConfidence: 0.6,
    observations: obs,
  });
  assert.equal(est.metaConfidence, Number((baseline.metaConfidence * 0.8).toFixed(4)));
});

// ── Component math ──────────────────────────────────────────────────

test('evidenceBreadth = unique domains / 10', () => {
  const obs = [
    makeObservation({ domain: 'a' }),
    makeObservation({ domain: 'a' }),
    makeObservation({ domain: 'b' }),
    makeObservation({ domain: 'c' }),
  ];
  const breadth = __internals.computeBreadth(obs);
  // 3 unique / 10
  assert.equal(breadth, 0.3);
});

test('evidenceBreadth caps at 1.0 when domains exceed the denominator', () => {
  const obs = Array.from({ length: 15 }, (_, i) => makeObservation({ domain: `d${i}` }));
  assert.equal(__internals.computeBreadth(obs), 1);
});

test('evidenceConsistency near 1.0 for uniform severities', () => {
  const obs = uniformObservations(5, 'MEDIUM');
  assert.equal(__internals.computeConsistency(obs), 1);
});

test('evidenceConsistency lower for mixed severities', () => {
  const obs = [
    makeObservation({ severity: 'CRITICAL' }),
    makeObservation({ severity: 'CRITICAL' }),
    makeObservation({ severity: 'LOW' }),
    makeObservation({ severity: 'LOW' }),
  ];
  const uniform = uniformObservations(4, 'MEDIUM');
  assert.ok(__internals.computeConsistency(obs) < __internals.computeConsistency(uniform));
});

test('evidenceConsistency is discounted by sample size (1 obs cannot claim consistency)', () => {
  // 1 obs → consistency = 1 * (1 / MIN_OBS_FOR_FULL_CONSISTENCY) = 0.333
  const oneObs = __internals.computeConsistency([makeObservation()]);
  // 3+ obs → full consistency
  const threeObs = __internals.computeConsistency(uniformObservations(3, 'MEDIUM'));
  assert.ok(oneObs < threeObs, `oneObs=${oneObs} threeObs=${threeObs}`);
  assert.equal(threeObs, 1);
});

test('temporalStability = 0.5 when no prior estimates', () => {
  assert.equal(__internals.computeStability(0.7, undefined), 0.5);
  assert.equal(__internals.computeStability(0.7, []), 0.5);
});

test('temporalStability near 1.0 for stable prior series', () => {
  const s = __internals.computeStability(0.7, [0.7, 0.71, 0.69, 0.7]);
  assert.ok(s > 0.95, `expected > 0.95, got ${s}`);
});

test('temporalStability lower for volatile prior series', () => {
  const volatile = __internals.computeStability(0.7, [0.1, 0.9, 0.2, 0.95]);
  const stable = __internals.computeStability(0.7, [0.7, 0.71, 0.69]);
  assert.ok(volatile < stable);
});

// ── Confidence interval ────────────────────────────────────────────

test('confidence interval narrows as metaConfidence increases', () => {
  const wide = __internals.confidenceIntervalFor(0.5, 0.1);
  const narrow = __internals.confidenceIntervalFor(0.5, 0.9);
  assert.ok((wide[1] - wide[0]) > (narrow[1] - narrow[0]));
});

test('confidence interval clamped to [0, 1]', () => {
  const lo = __internals.confidenceIntervalFor(0, 0);
  const hi = __internals.confidenceIntervalFor(1, 0);
  assert.ok(lo[0] >= 0 && lo[1] <= 1);
  assert.ok(hi[0] >= 0 && hi[1] <= 1);
});

test('confidence interval is symmetric around reportedConfidence in the interior', () => {
  const [lo, hi] = __internals.confidenceIntervalFor(0.5, 0.5);
  // width = (1 - 0.5) * 0.4 = 0.2, half = 0.1
  assert.equal(Number((0.5 - lo).toFixed(4)), Number((hi - 0.5).toFixed(4)));
});

// ── Reliability band thresholds ─────────────────────────────────────

test('reliability band: >= 0.75 → anchored', () => {
  assert.equal(__internals.deriveReliability(0.75), 'anchored');
  assert.equal(__internals.deriveReliability(0.9), 'anchored');
});

test('reliability band: [0.5, 0.75) → moderate', () => {
  assert.equal(__internals.deriveReliability(0.5), 'moderate');
  assert.equal(__internals.deriveReliability(0.74), 'moderate');
});

test('reliability band: [0.25, 0.5) → provisional', () => {
  assert.equal(__internals.deriveReliability(0.25), 'provisional');
  assert.equal(__internals.deriveReliability(0.49), 'provisional');
});

test('reliability band: < 0.25 → speculative', () => {
  assert.equal(__internals.deriveReliability(0.24), 'speculative');
  assert.equal(__internals.deriveReliability(0), 'speculative');
});

// ── Filtering / stats ──────────────────────────────────────────────

test('getByReliability filters to the requested band', () => {
  const svc = freshService();
  svc.estimate({
    targetId: 'anchored-1',
    targetType: 'situation',
    reportedConfidence: 0.9,
    observations: uniformObservations(10, 'CRITICAL',
      ['weather', 'earthquake', 'cyber', 'maritime', 'aviation', 'biosurveillance', 'space', 'conflict', 'infra', 'finance']),
  });
  svc.estimate({
    targetId: 'speculative-1',
    targetType: 'situation',
    reportedConfidence: 0.2,
    observations: [makeObservation()],
    // 1 obs + 2 critical+high-risk assumptions pushes meta below the
    // speculative ceiling (0.25).
    assumptions: [
      makeAssumption({ isCritical: true, violationRisk: 'high' }),
      makeAssumption({ isCritical: true, violationRisk: 'high' }),
    ],
  });
  const anchored = svc.getByReliability('anchored');
  const speculative = svc.getByReliability('speculative');
  assert.equal(anchored.length, 1);
  assert.equal(anchored[0]!.targetId, 'anchored-1');
  assert.equal(speculative.length, 1);
});

test('getByTargetType filters by score / situation / hypothesis', () => {
  const svc = freshService();
  svc.estimate({ targetId: 'h1', targetType: 'hypothesis', reportedConfidence: 0.5, observations: [makeObservation()] });
  svc.estimate({ targetId: 'sc1', targetType: 'score', reportedConfidence: 0.5, observations: [makeObservation()] });
  assert.equal(svc.getByTargetType('hypothesis').length, 1);
  assert.equal(svc.getByTargetType('score').length, 1);
  assert.equal(svc.getByTargetType('situation').length, 0);
});

test('stats() counts totals and per-reliability buckets', () => {
  const svc = freshService();
  svc.estimate({
    targetId: 'a',
    targetType: 'situation',
    reportedConfidence: 0.5,
    observations: [makeObservation()],
  });
  svc.estimate({
    targetId: 'b',
    targetType: 'situation',
    reportedConfidence: 0.9,
    observations: uniformObservations(10, 'CRITICAL',
      ['weather', 'earthquake', 'cyber', 'maritime', 'aviation', 'biosurveillance', 'space', 'conflict', 'infra', 'finance']),
  });
  const stats = svc.stats();
  assert.equal(stats.totalEstimates, 2);
  const bucketSum = stats.byReliability.anchored + stats.byReliability.moderate
    + stats.byReliability.provisional + stats.byReliability.speculative;
  assert.equal(bucketSum, 2);
  assert.ok(stats.avgReportedConfidence > 0);
});

test('stats() returns zeroes for an empty service', () => {
  const svc = freshService();
  const stats = svc.stats();
  assert.equal(stats.totalEstimates, 0);
  assert.equal(stats.avgMetaConfidence, 0);
  assert.equal(stats.avgReportedConfidence, 0);
});

// ── Persistence ────────────────────────────────────────────────────

test('estimates persist across service instances', () => {
  __storage.clear();
  const a = new MetaConfidenceService({ clock: () => NOW });
  a.estimate({ targetId: 't', targetType: 'score', reportedConfidence: 0.7, observations: [makeObservation()] });
  const b = new MetaConfidenceService({ clock: () => NOW });
  assert.ok(b.getEstimate('t'));
});

test('corrupt persisted payload is ignored', () => {
  __storage.clear();
  __storage.set('wm-meta-confidence', 'not-json');
  const svc = new MetaConfidenceService({ clock: () => NOW });
  assert.equal(svc.getAllEstimates().length, 0);
});

test('re-estimating an existing targetId replaces the prior estimate (no duplicate)', () => {
  const svc = freshService();
  svc.estimate({ targetId: 't', targetType: 'score', reportedConfidence: 0.5, observations: [makeObservation()] });
  svc.estimate({ targetId: 't', targetType: 'score', reportedConfidence: 0.9, observations: [makeObservation()] });
  assert.equal(svc.getAllEstimates().length, 1);
  assert.equal(svc.getEstimate('t')!.reportedConfidence, 0.9);
});

// ── Subscribe ──────────────────────────────────────────────────────

test('subscribe fires the listener on every estimate', () => {
  const svc = freshService();
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.estimate({ targetId: 't1', targetType: 'score', reportedConfidence: 0.5, observations: [makeObservation()] });
  svc.estimate({ targetId: 't2', targetType: 'score', reportedConfidence: 0.5, observations: [makeObservation()] });
  assert.equal(calls, 2);
});

test('subscribe returns an unsubscribe fn', () => {
  const svc = freshService();
  let calls = 0;
  const unsubscribe = svc.subscribe(() => { calls += 1; });
  svc.estimate({ targetId: 't1', targetType: 'score', reportedConfidence: 0.5, observations: [makeObservation()] });
  unsubscribe();
  svc.estimate({ targetId: 't2', targetType: 'score', reportedConfidence: 0.5, observations: [makeObservation()] });
  assert.equal(calls, 1);
});

test('listener exceptions do not break further dispatch', () => {
  const svc = freshService();
  let second = false;
  svc.subscribe(() => { throw new Error('boom'); });
  svc.subscribe(() => { second = true; });
  svc.estimate({ targetId: 't', targetType: 'score', reportedConfidence: 0.5, observations: [makeObservation()] });
  assert.equal(second, true);
});

// ── Defensive copy + singleton ─────────────────────────────────────

test('getEstimate returns a defensive copy', () => {
  const svc = freshService();
  svc.estimate({ targetId: 't', targetType: 'score', reportedConfidence: 0.5, observations: [makeObservation()] });
  const e = svc.getEstimate('t')!;
  e.metaConfidence = 999;
  assert.notEqual(svc.getEstimate('t')!.metaConfidence, 999);
});

test('getMetaConfidenceService returns a stable singleton', () => {
  __resetMetaConfidenceSingleton();
  const a = getMetaConfidenceService();
  const b = getMetaConfidenceService();
  assert.equal(a, b);
});

test('teardown — references unused types so strict tsconfig stays clean', () => {
  __resetMetaConfidenceSingleton();
  const _r: ConfidenceReliability = 'moderate';
  const _e: MetaConfidenceEstimate | undefined = undefined;
  void _r; void _e;
  assert.ok(true);
});
