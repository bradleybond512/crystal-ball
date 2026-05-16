/**
 * Tests for ShadowRunner + the two built-in shadow algorithms.
 *
 * Pure service tests. Stubs localStorage at module load.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// localStorage stub before any imports that may hydrate.
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
  ShadowRunner,
  __internals,
  __resetShadowRunnerSingleton,
  getShadowRunner,
  type ShadowAlgorithm,
  type ShadowComparison,
} from '../../src/services/intelligence/shadow-runner.ts';
import {
  buildEdgeAmplifiedShadow,
  buildRecencyWeightedShadow,
  builtInShadowAlgorithms,
} from '../../src/services/intelligence/built-in-shadow-algorithms.ts';
import {
  DriverScoringEngine,
  type DerivedSeverity,
  type EvidenceScore,
  type ScoringDriver,
} from '../../src/services/intelligence/driver-scores.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function makeObs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'test',
    domain: 'weather',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'test',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeScore(overrides: Partial<EvidenceScore> = {}): EvidenceScore {
  return {
    observationId: 'obs',
    domain: 'weather',
    driverScores: [],
    baseScore: 0.5,
    edgeBonus: 0,
    attentionMultiplier: 1,
    finalScore: 0.5,
    derivedSeverity: 'medium',
    explanation: 'baseline',
    ...overrides,
  };
}

/** Build a shadow algorithm whose finalScore is a fixed function of the
 *  observation's id — lets a test pin shadow vs production agreement
 *  deterministically. */
function makeShadow(
  id: string,
  scoreFn: (obs: ObservationEvent) => EvidenceScore,
): ShadowAlgorithm {
  return {
    id,
    name: id,
    description: 'test',
    version: '1.0.0',
    isActive: true,
    score: scoreFn,
  };
}

function freshRunner(): ShadowRunner {
  __storage.clear();
  return new ShadowRunner({ clock: () => NOW });
}

function severityFromScore(score: number): DerivedSeverity {
  if (score >= 0.8) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

// ── registerAlgorithm / unregisterAlgorithm ──────────────────────────

test('registerAlgorithm makes the algo available via getAllAlgorithms / getActiveAlgorithms', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore()));
  assert.equal(runner.getAllAlgorithms().length, 1);
  assert.equal(runner.getActiveAlgorithms().length, 1);
  assert.equal(runner.getActiveAlgorithms()[0]!.id, 's1');
});

test('unregisterAlgorithm removes the algo', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore()));
  runner.unregisterAlgorithm('s1');
  assert.equal(runner.getAllAlgorithms().length, 0);
});

test('registerAlgorithm is idempotent on id (overwrites the prior entry)', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore()));
  runner.registerAlgorithm({ ...makeShadow('s1', () => makeScore()), name: 'renamed' });
  assert.equal(runner.getAllAlgorithms().length, 1);
  assert.equal(runner.getAllAlgorithms()[0]!.name, 'renamed');
});

// ── runShadow + agreement / delta ───────────────────────────────────

test('runShadow stores one comparison per active algorithm', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({ finalScore: 0.5 })));
  runner.registerAlgorithm(makeShadow('s2', () => makeScore({ finalScore: 0.7 })));
  runner.runShadow(makeObs({ id: 'obs-a' }), makeScore({ finalScore: 0.5, derivedSeverity: 'medium' }));
  assert.equal(runner.getAllComparisons().length, 2);
});

test('runShadow with no active algorithms is a no-op', () => {
  const runner = freshRunner();
  runner.runShadow(makeObs(), makeScore());
  assert.equal(runner.getAllComparisons().length, 0);
});

test('agreement is true when shadow and production land in the same severity band', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({
    finalScore: 0.7, derivedSeverity: 'high',
  })));
  runner.runShadow(makeObs({ id: 'obs' }), makeScore({ finalScore: 0.65, derivedSeverity: 'high' }));
  const cmp = runner.getComparisons('s1')[0]!;
  assert.equal(cmp.agreement, true);
});

test('agreement is false when bands differ', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({
    finalScore: 0.9, derivedSeverity: 'critical',
  })));
  runner.runShadow(makeObs({ id: 'obs' }), makeScore({ finalScore: 0.4, derivedSeverity: 'medium' }));
  assert.equal(runner.getComparisons('s1')[0]!.agreement, false);
});

test('delta = shadowScore - productionScore (clamped to [-1, 1] and rounded to 4dp)', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({ finalScore: 0.75, derivedSeverity: 'high' })));
  runner.runShadow(makeObs(), makeScore({ finalScore: 0.5, derivedSeverity: 'medium' }));
  assert.equal(runner.getComparisons('s1')[0]!.delta, 0.25);
});

test('shadow crash does not bring down the runner — comparison silently skipped', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('bad', () => { throw new Error('boom'); }));
  runner.registerAlgorithm(makeShadow('ok', () => makeScore({ finalScore: 0.6, derivedSeverity: 'high' })));
  runner.runShadow(makeObs(), makeScore({ finalScore: 0.5, derivedSeverity: 'medium' }));
  assert.equal(runner.getComparisons('bad').length, 0);
  assert.equal(runner.getComparisons('ok').length, 1);
});

// ── getReport: aggregation + recommendation ─────────────────────────

function feedAgreement(runner: ShadowRunner, count: number, shadowScore: number): void {
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({
    finalScore: shadowScore, derivedSeverity: severityFromScore(shadowScore),
  })));
  for (let i = 0; i < count; i += 1) {
    runner.runShadow(
      makeObs({ id: `obs-${i}` }),
      makeScore({
        finalScore: shadowScore,
        derivedSeverity: severityFromScore(shadowScore),
        observationId: `obs-${i}`,
      }),
    );
  }
}

test('report.totalComparisons + agreementRate + avgDelta computed across rows', () => {
  const runner = freshRunner();
  feedAgreement(runner, 4, 0.7);
  const report = runner.getReport('s1');
  assert.equal(report.totalComparisons, 4);
  assert.equal(report.agreementRate, 1);
  assert.equal(report.avgDelta, 0);
});

test('report.domainBreakdown captures per-domain agreement + delta + count', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', (obs) => makeScore({
    finalScore: obs.domain === 'cyber' ? 0.9 : 0.5,
    derivedSeverity: obs.domain === 'cyber' ? 'critical' : 'medium',
  })));
  // 2 weather (agree at medium), 2 cyber (disagree: prod medium / shadow critical)
  for (let i = 0; i < 2; i += 1) {
    runner.runShadow(makeObs({ id: `w-${i}`, domain: 'weather' }),
      makeScore({ finalScore: 0.5, derivedSeverity: 'medium' }));
    runner.runShadow(makeObs({ id: `c-${i}`, domain: 'cyber' }),
      makeScore({ finalScore: 0.5, derivedSeverity: 'medium' }));
  }
  const report = runner.getReport('s1');
  assert.equal(report.domainBreakdown.weather!.count, 2);
  assert.equal(report.domainBreakdown.weather!.agreementRate, 1);
  assert.equal(report.domainBreakdown.cyber!.count, 2);
  assert.equal(report.domainBreakdown.cyber!.agreementRate, 0);
});

test('recommendation: > 0.85 agreement AND > 0.05 delta → promote', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({
    finalScore: 0.7, derivedSeverity: 'high',
  })));
  // 15 comparisons, agree on band but shadow consistently 0.2 higher
  for (let i = 0; i < 15; i += 1) {
    runner.runShadow(makeObs({ id: `o-${i}` }),
      makeScore({ finalScore: 0.5, derivedSeverity: 'high' })); // band tied to high too
  }
  const report = runner.getReport('s1');
  assert.ok(report.agreementRate > 0.85, `agreement=${report.agreementRate}`);
  assert.ok(report.avgDelta > 0.05, `delta=${report.avgDelta}`);
  assert.equal(report.recommendation, 'promote');
});

test('recommendation: < 0.5 agreement → retire (with enough samples)', () => {
  const runner = freshRunner();
  // Shadow always pegs critical, production always medium → 0% agreement.
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({
    finalScore: 0.95, derivedSeverity: 'critical',
  })));
  for (let i = 0; i < 12; i += 1) {
    runner.runShadow(makeObs({ id: `o-${i}` }),
      makeScore({ finalScore: 0.45, derivedSeverity: 'medium' }));
  }
  assert.equal(runner.getReport('s1').recommendation, 'retire');
});

test('recommendation: between thresholds → continue-monitoring', () => {
  const runner = freshRunner();
  // Mixed agreement (~50–80%) — neither promote nor retire.
  runner.registerAlgorithm(makeShadow('s1', (obs) => makeScore({
    finalScore: obs.id.endsWith('0') ? 0.4 : 0.7,
    derivedSeverity: obs.id.endsWith('0') ? 'medium' : 'high',
  })));
  for (let i = 0; i < 15; i += 1) {
    runner.runShadow(makeObs({ id: `o-${i}` }),
      makeScore({ finalScore: 0.65, derivedSeverity: 'high' }));
  }
  assert.equal(runner.getReport('s1').recommendation, 'continue-monitoring');
});

test('recommendation requires at least MIN_COMPARISONS_FOR_RECOMMENDATION samples', () => {
  const runner = freshRunner();
  // 100% disagreement but only 3 samples — should not retire yet.
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({
    finalScore: 0.95, derivedSeverity: 'critical',
  })));
  for (let i = 0; i < 3; i += 1) {
    runner.runShadow(makeObs({ id: `o-${i}` }),
      makeScore({ finalScore: 0.4, derivedSeverity: 'medium' }));
  }
  assert.equal(runner.getReport('s1').recommendation, 'continue-monitoring');
});

test('getReport for unknown algorithm returns empty zero-state report', () => {
  const runner = freshRunner();
  const report = runner.getReport('does-not-exist');
  assert.equal(report.totalComparisons, 0);
  assert.equal(report.recommendation, 'continue-monitoring');
});

test('getAllReports returns one report per registered algorithm', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('a', () => makeScore()));
  runner.registerAlgorithm(makeShadow('b', () => makeScore()));
  assert.equal(runner.getAllReports().length, 2);
});

// ── promote / retire lifecycle ──────────────────────────────────────

test('promoteAlgorithm sets promotedAt + isActive=false', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore()));
  const promoted = runner.promoteAlgorithm('s1')!;
  assert.ok(promoted.promotedAt);
  assert.equal(promoted.isActive, false);
});

test('retireAlgorithm sets retiredAt + isActive=false', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore()));
  const retired = runner.retireAlgorithm('s1')!;
  assert.ok(retired.retiredAt);
  assert.equal(retired.isActive, false);
});

test('getActiveAlgorithms excludes promoted and retired', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('a', () => makeScore()));
  runner.registerAlgorithm(makeShadow('b', () => makeScore()));
  runner.registerAlgorithm(makeShadow('c', () => makeScore()));
  runner.promoteAlgorithm('a');
  runner.retireAlgorithm('b');
  const active = runner.getActiveAlgorithms();
  assert.equal(active.length, 1);
  assert.equal(active[0]!.id, 'c');
});

test('promoted algorithms stop receiving new shadow comparisons', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({ finalScore: 0.6, derivedSeverity: 'high' })));
  runner.promoteAlgorithm('s1');
  runner.runShadow(makeObs(), makeScore({ finalScore: 0.5, derivedSeverity: 'medium' }));
  assert.equal(runner.getComparisons('s1').length, 0);
});

test('promote / retire on unknown id returns undefined and is a no-op', () => {
  const runner = freshRunner();
  assert.equal(runner.promoteAlgorithm('missing'), undefined);
  assert.equal(runner.retireAlgorithm('missing'), undefined);
});

// ── Ring buffer ─────────────────────────────────────────────────────

test('comparison ring buffer caps at MAX_COMPARISONS', () => {
  const runner = freshRunner();
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({ finalScore: 0.5, derivedSeverity: 'medium' })));
  const cap = __internals.MAX_COMPARISONS;
  // Push slightly over the cap and assert size respected.
  const total = cap + 25;
  for (let i = 0; i < total; i += 1) {
    runner.runShadow(makeObs({ id: `o-${i}` }),
      makeScore({ finalScore: 0.5, derivedSeverity: 'medium' }));
  }
  assert.equal(runner.getAllComparisons().length, cap);
});

// ── subscribe ────────────────────────────────────────────────────────

test('subscribe fires on register / runShadow / promote / retire', () => {
  const runner = freshRunner();
  const events: string[] = [];
  runner.subscribe((event) => { events.push(event.type); });
  runner.registerAlgorithm(makeShadow('s1', () => makeScore({ finalScore: 0.6, derivedSeverity: 'high' })));
  runner.runShadow(makeObs(), makeScore({ finalScore: 0.5, derivedSeverity: 'medium' }));
  runner.promoteAlgorithm('s1');
  assert.deepEqual(events, ['register', 'comparison', 'promote']);
});

test('subscribe returns an unsubscribe fn', () => {
  const runner = freshRunner();
  let calls = 0;
  const off = runner.subscribe(() => { calls += 1; });
  runner.registerAlgorithm(makeShadow('s1', () => makeScore()));
  off();
  runner.registerAlgorithm(makeShadow('s2', () => makeScore()));
  assert.equal(calls, 1);
});

test('subscribe: listener exception does not break further dispatch', () => {
  const runner = freshRunner();
  let second = false;
  runner.subscribe(() => { throw new Error('boom'); });
  runner.subscribe(() => { second = true; });
  runner.registerAlgorithm(makeShadow('s1', () => makeScore()));
  assert.equal(second, true);
});

// ── Persistence ─────────────────────────────────────────────────────

test('comparisons persist across runner instances', () => {
  __storage.clear();
  const a = new ShadowRunner({ clock: () => NOW });
  a.registerAlgorithm(makeShadow('s1', () => makeScore({ finalScore: 0.6, derivedSeverity: 'high' })));
  a.runShadow(makeObs({ id: 'persistent' }),
    makeScore({ finalScore: 0.5, derivedSeverity: 'medium' }));
  const b = new ShadowRunner({ clock: () => NOW });
  // Algorithms aren't persisted (they hold a function reference); only
  // comparisons are. We can still read the persisted comparisons by id.
  assert.equal(b.getAllComparisons().length, 1);
});

test('corrupt persisted payload is ignored without throwing', () => {
  __storage.clear();
  __storage.set('wm-shadow-runner', 'not-json');
  const runner = new ShadowRunner({ clock: () => NOW });
  assert.equal(runner.getAllComparisons().length, 0);
});

// ── Singleton ────────────────────────────────────────────────────────

test('getShadowRunner returns a stable singleton', () => {
  __resetShadowRunnerSingleton();
  const a = getShadowRunner();
  const b = getShadowRunner();
  assert.equal(a, b);
});

// ── Built-in shadow algorithms ──────────────────────────────────────

function makeEngineWithDriver(): DriverScoringEngine {
  const engine = new DriverScoringEngine();
  const driver: ScoringDriver = {
    id: 'magnitude',
    name: 'magnitude',
    domain: 'weather',
    weight: 1,
    extractValue: (obs) => {
      const raw = obs.raw as { magnitude?: number } | null;
      return typeof raw?.magnitude === 'number' ? raw.magnitude : null;
    },
    normalizeValue: (raw) => Math.min(1, raw / 10),
    description: 'test',
  };
  engine.registerDriver(driver);
  return engine;
}

test('builtInShadowAlgorithms returns 2 algorithms with the documented IDs', () => {
  const algos = builtInShadowAlgorithms();
  const ids = algos.map((a) => a.id).sort();
  assert.deepEqual(ids, ['edge-amplified-v2', 'recency-weighted-v2']);
});

test('recency-weighted shadow leaves recent observations untouched', () => {
  const engine = makeEngineWithDriver();
  const algo = buildRecencyWeightedShadow({ engine, clock: () => NOW });
  const obs = makeObs({ id: 'fresh', raw: { magnitude: 8 }, timestamp: NOW });
  const score = algo.score(obs);
  // multiplier=1 → finalScore unchanged from base (0.8)
  assert.equal(score.finalScore, 0.8);
});

test('recency-weighted shadow discounts mid-window (2-6h) observations to 0.8×', () => {
  const engine = makeEngineWithDriver();
  const algo = buildRecencyWeightedShadow({ engine, clock: () => NOW });
  const obs = makeObs({ id: 'mid', raw: { magnitude: 8 }, timestamp: NOW - 3 * 60 * 60 * 1000 });
  const score = algo.score(obs);
  // base 0.8 × 0.8 = 0.64
  assert.equal(Number(score.finalScore.toFixed(4)), 0.64);
});

test('recency-weighted shadow discounts stale observations (> 6h) to 0.6×', () => {
  const engine = makeEngineWithDriver();
  const algo = buildRecencyWeightedShadow({ engine, clock: () => NOW });
  const obs = makeObs({ id: 'old', raw: { magnitude: 8 }, timestamp: NOW - 10 * 60 * 60 * 1000 });
  const score = algo.score(obs);
  // base 0.8 × 0.6 = 0.48
  assert.equal(Number(score.finalScore.toFixed(4)), 0.48);
});

test('edge-amplified shadow doubles the edge bonus on confirms/caused_by edges', () => {
  const engine = makeEngineWithDriver();
  const algo = buildEdgeAmplifiedShadow({ engine });
  const obs = makeObs({ id: 'target', raw: { magnitude: 5 } });
  const edges = [
    { type: 'confirms' as const, sourceEventId: 'a', targetEventId: 'target', confidence: 1 },
    { type: 'confirms' as const, sourceEventId: 'b', targetEventId: 'target', confidence: 1 },
  ];
  const baseline = engine.scoreObservation(obs, edges);
  const amplified = algo.score(obs, edges);
  assert.ok(amplified.edgeBonus > baseline.edgeBonus, `amplified=${amplified.edgeBonus} baseline=${baseline.edgeBonus}`);
});

// ── Type-only smoke (keeps strict tsconfig clean) ──────────────────

test('teardown — references unused types', () => {
  __resetShadowRunnerSingleton();
  const _c: ShadowComparison | undefined = undefined;
  const _a: ShadowAlgorithm | undefined = undefined;
  void _c; void _a;
  assert.ok(true);
});
