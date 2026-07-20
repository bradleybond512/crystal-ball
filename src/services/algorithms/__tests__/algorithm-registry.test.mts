import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAlgorithm,
  listAlgorithms,
  listByDomain,
  listByCriticality,
  listByOutput,
  listByOwnerFeature,
  registerAlgorithm,
  resetAlgorithmRegistry,
} from '../algorithm-registry.ts';
import type {
  AlgorithmStatus,
  AlgorithmAdjustment,
  AlgorithmHealth,
} from '../algorithm-health-types.ts';

// Reset between tests so registerAlgorithm() side effects don't bleed.
test.beforeEach(() => resetAlgorithmRegistry());

// ── Initial registry coverage ──────────────────────────────────────────

test('initial: registers all live algorithms (orphaned algos with no call sites removed)', () => {
  const ids = listAlgorithms().map((a) => a.id).sort();
  // 6 algos dropped (B1-cleanup): baseline-deviation, evidence-graph, forecast-calibration,
  // situation-clustering, watchlist-relevance, what-changed-digest — all had zero live
  // call sites (confirmed by audit 2026-06-07). No recordAlgorithmEvaluation would ever
  // fire for them; keeping them would only pollute the ledger with fabricated entries.
  // Cognitive Enhancement work registered 4 new live algorithms (2026-06):
  // bias-detector, cognitive-bias-detector, counterfactual-reasoning, meta-confidence.
  // Cognition PR 12 registered 5 more, graded deterministically by
  // cognition/self-tuning.ts: episodic-analog, recalibration, superforecast,
  // operator-ranking, entity-trajectory.
  const expected = [
    'bias-detector', 'big-event-detector', 'cognitive-bias-detector', 'competitive-hypothesis',
    'compound-risk', 'confidence-urgency-matrix', 'correlation-feedback', 'counterfactual-reasoning',
    'entity-trajectory', 'episodic-analog', 'hypothesis-accuracy', 'meta-confidence',
    'negative-evidence', 'nws-polygon-match', 'operator-ranking', 'personal-storm-mode',
    'recalibration', 'relevance-learner', 'shortage-diesel', 'shortage-wheat',
    'source-feedback', 'superforecast', 'threat-classifier', 'truth-score', 'weather-urgency',
  ];
  assert.deepEqual(ids, expected);
});

test('initial: every entry has nonempty label / version / domain / outputs / criticality', () => {
  for (const a of listAlgorithms()) {
    assert.ok(a.label.length > 0, `${a.id} label`);
    assert.match(a.version, /^\d+\.\d+\.\d+$/);
    assert.ok(a.domain.length > 0);
    assert.ok(a.outputs.length > 0);
    assert.ok(['low', 'medium', 'high', 'safety'].includes(a.criticality));
  }
});

test('initial: weather warning chain is all safety-critical', () => {
  for (const id of ['nws-polygon-match', 'weather-urgency', 'personal-storm-mode']) {
    assert.equal(getAlgorithm(id)?.criticality, 'safety', id);
  }
});

test('initial: ownerFeature joins with diagnostics feature ids', () => {
  // Sanity check: each algorithm's ownerFeature should be a non-empty
  // string. PR 2 (Algorithm Evaluation Ledger) joins on this.
  for (const a of listAlgorithms()) {
    assert.ok(a.ownerFeature.length > 0, a.id);
  }
});

// ── Lookup helpers ─────────────────────────────────────────────────────

test('getAlgorithm: returns undefined for unknown id', () => {
  assert.equal(getAlgorithm('does-not-exist'), undefined);
});

test('getAlgorithm: returns the registered definition', () => {
  const def = getAlgorithm('truth-score');
  assert.ok(def);
  assert.equal(def!.label, 'Truth scoring');
});

test('listByDomain: filters on domain', () => {
  const weather = listByDomain('weather');
  assert.equal(weather.length, 3);
  assert.ok(weather.every((a) => a.domain === 'weather'));
});

test('listByCriticality: safety tier returns weather chain', () => {
  const safety = listByCriticality('safety');
  const ids = safety.map((a) => a.id).sort();
  assert.deepEqual(ids, ['nws-polygon-match', 'personal-storm-mode', 'weather-urgency']);
});

test('listByOutput: ranking includes the expected algorithms', () => {
  const rankers = listByOutput('ranking');
  const ids = rankers.map((a) => a.id);
  assert.ok(ids.includes('big-event-detector'));
  assert.ok(ids.includes('compound-risk'));
  // watchlist-relevance was dropped (B1-cleanup: no live call site)
});

test('listByOwnerFeature: weather_warning groups all weather algorithms', () => {
  const weather = listByOwnerFeature('weather_warning');
  const ids = weather.map((a) => a.id).sort();
  assert.deepEqual(ids, ['nws-polygon-match', 'personal-storm-mode', 'weather-urgency']);
});

// ── registerAlgorithm ───────────────────────────────────────────────────

test('registerAlgorithm: adds new algorithm to lookup', () => {
  registerAlgorithm({
    id: 'custom-algo',
    label: 'Custom test algorithm',
    version: '0.1.0',
    domain: 'test',
    ownerFeature: 'test_feature',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['ranking'],
    criticality: 'low',
  });
  assert.equal(getAlgorithm('custom-algo')?.label, 'Custom test algorithm');
});

test('registerAlgorithm: throws on collision without replace', () => {
  assert.throws(
    () => registerAlgorithm({
      id: 'truth-score', // already registered
      label: 'X',
      version: '0.0.1',
      domain: 'x',
      ownerFeature: 'x',
      dependencies: { sources: [], providers: [], services: [] },
      outputs: ['ranking'],
      criticality: 'low',
    }),
    /already registered/i,
  );
});

test('registerAlgorithm: replace=true overrides', () => {
  registerAlgorithm({
    id: 'truth-score',
    label: 'Truth scoring v2',
    version: '2.0.0',
    domain: 'intelligence',
    ownerFeature: 'intelligence',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['risk_score'],
    criticality: 'high',
  }, { replace: true });
  assert.equal(getAlgorithm('truth-score')?.version, '2.0.0');
});

// ── resetAlgorithmRegistry ──────────────────────────────────────────────

test('reset: undoes runtime registrations', () => {
  registerAlgorithm({
    id: 'temp',
    label: 'Temp',
    version: '0.0.1',
    domain: 'x',
    ownerFeature: 'x',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['ranking'],
    criticality: 'low',
  });
  assert.ok(getAlgorithm('temp'));
  resetAlgorithmRegistry();
  assert.equal(getAlgorithm('temp'), undefined);
  // Initial entries restored.
  assert.ok(getAlgorithm('truth-score'));
});

// ── algorithm-health-types ──────────────────────────────────────────────

test('AlgorithmStatus: 5 statuses are valid string-literal types', () => {
  const valid: AlgorithmStatus[] = ['healthy', 'watch', 'degraded', 'unsafe', 'unknown'];
  for (const status of valid) {
    const record: AlgorithmHealth = {
      algorithmId: 'x',
      status,
      explanation: ['test'],
    };
    assert.equal(record.status, status);
  }
});

test('AlgorithmAdjustment: shape is JSON-serializable', () => {
  const adj: AlgorithmAdjustment = {
    algorithmId: 'truth-score',
    kind: 'source_multiplier',
    value: 1.1,
    direction: 'tighten',
    reason: 'Source brier improved over 50 samples',
    proposedAt: Date.now(),
    sampleSize: 50,
  };
  const round = JSON.parse(JSON.stringify(adj)) as AlgorithmAdjustment;
  assert.deepEqual(round, adj);
});

test('AlgorithmHealth: explanation is always present', () => {
  // Plan invariant: every health record explains itself.
  const record: AlgorithmHealth = {
    algorithmId: 'x',
    status: 'degraded',
    explanation: ['Brier rose to 0.32 over last 30 samples'],
  };
  assert.ok(record.explanation.length > 0);
});

// ── Determinism ────────────────────────────────────────────────────────

test('determinism: list order is stable across calls', () => {
  const a = listAlgorithms().map((x) => x.id);
  const b = listAlgorithms().map((x) => x.id);
  assert.deepEqual(a, b);
});
