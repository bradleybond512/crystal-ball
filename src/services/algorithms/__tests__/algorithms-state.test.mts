/**
 * Coverage for `algorithms-state.ts` — verifies that the diagnostic
 * catalog is now derived from `algorithm-registry.ts` (single source
 * of truth) and that the projection onto the health-aggregator's
 * AlgorithmDefinition shape is total + lossless.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAlgorithmDefinitions,
  getAlgorithmEvaluationLedger,
  resetAlgorithmsState,
  toHealthDefinition,
} from '../algorithms-state.ts';
import { listAlgorithms, registerAlgorithm, resetAlgorithmRegistry } from '../algorithm-registry.ts';

test.beforeEach(() => {
  resetAlgorithmRegistry();
  resetAlgorithmsState();
});

test('getAlgorithmDefinitions: derives one entry per registered algorithm', () => {
  const defs = getAlgorithmDefinitions();
  const reg = listAlgorithms();
  assert.equal(defs.length, reg.length, 'state catalog matches registry size');
});

test('getAlgorithmDefinitions: ids are stable (no hidden -v1 suffix)', () => {
  const defs = getAlgorithmDefinitions();
  for (const d of defs) {
    assert.ok(!/-v\d+$/.test(d.algorithmId), `id "${d.algorithmId}" must not have a -v1 suffix`);
  }
  // Spot-check a known entry.
  const truth = defs.find((d) => d.algorithmId === 'truth-score');
  assert.ok(truth, 'truth-score should be present');
  assert.equal(truth?.domain, 'truth_score');
  assert.equal(truth?.version, '1.0.0');
});

test('getAlgorithmDefinitions: every entry has a non-empty label + valid criticality', () => {
  const validCriticalities = new Set(['safety', 'high', 'medium', 'low']);
  for (const d of getAlgorithmDefinitions()) {
    assert.ok(d.label.length > 0, `${d.algorithmId} label`);
    assert.ok(validCriticalities.has(d.criticality), `${d.algorithmId} criticality`);
  }
});

test('getAlgorithmDefinitions: weather chain stays safety-critical', () => {
  const defs = getAlgorithmDefinitions();
  const weather = defs.filter((d) => d.algorithmId.startsWith('nws-') || d.algorithmId.startsWith('weather-') || d.algorithmId === 'personal-storm-mode');
  assert.ok(weather.length >= 3, 'expected at least nws-polygon-match + weather-urgency + personal-storm-mode');
  for (const d of weather) {
    assert.equal(d.criticality, 'safety', `${d.algorithmId} should remain safety-critical`);
  }
});

test('getAlgorithmDefinitions: ids are unique', () => {
  const defs = getAlgorithmDefinitions();
  const ids = new Set(defs.map((d) => d.algorithmId));
  assert.equal(ids.size, defs.length, 'no duplicate ids');
});

test('toHealthDefinition: registry entry without healthDomain projects to "other"', () => {
  registerAlgorithm({
    id: 'experimental-ranker',
    label: 'Experimental ranker',
    version: '0.1.0',
    domain: 'experimental',
    ownerFeature: 'experimental',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['ranking'],
    criticality: 'low',
  });
  const reg = listAlgorithms().find((r) => r.id === 'experimental-ranker');
  const proj = toHealthDefinition(reg!);
  assert.equal(proj.domain, 'other');
  assert.equal(proj.algorithmId, 'experimental-ranker');
  assert.equal(proj.version, '0.1.0');
});

test('regression: all previously-tracked health domains are still represented', () => {
  // Health domains that MUST stay represented in the derived catalog —
  // every domain that has at least one live (call-site-backed) algorithm.
  // The B1-cleanup (audit 2026-06-07) intentionally dropped the orphaned
  // evidence-graph, situation-clustering, baseline-deviation and
  // forecast-calibration algorithms (zero live call sites — keeping them
  // would only fabricate ledger entries), so their domains are no longer
  // expected here. Kept in sync with algorithm-registry.test.mts
  // "registers all live algorithms".
  const required = new Set([
    'truth_score',
    'compound_risk',
    'watchlist_relevance',
    'negative_evidence',
    'shortage_score',
    'weather_polygon',
    'weather_urgency',
    'reasoning_hypothesis',
  ]);
  const present = new Set(getAlgorithmDefinitions().map((d) => d.domain));
  for (const dom of required) {
    assert.ok(present.has(dom), `health domain "${dom}" must remain represented in the derived catalog`);
  }
});

test('runtime-registered algorithms surface in getAlgorithmDefinitions after a reset', () => {
  registerAlgorithm({
    id: 'late-registered',
    label: 'Late-registered',
    version: '1.0.0',
    domain: 'misc',
    ownerFeature: 'misc',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['ranking'],
    criticality: 'low',
  });
  // The state singleton may already be cached; resetAlgorithmsState
  // forces a re-derive. This guards against the previous bug where
  // the state catalog was hand-maintained and would silently skip
  // newly registered algorithms.
  resetAlgorithmsState();
  const defs = getAlgorithmDefinitions();
  assert.ok(defs.some((d) => d.algorithmId === 'late-registered'));
});

test('ledger singleton: resetAlgorithmsState resets the ledger too', () => {
  const ledger = getAlgorithmEvaluationLedger();
  ledger.recordEvaluation({ algorithmId: 'truth-score', domain: 'truth_score', at: Date.now(), durationMs: 1, score: 0.5 });
  assert.equal(ledger.all().length, 1);
  resetAlgorithmsState();
  const fresh = getAlgorithmEvaluationLedger();
  assert.equal(fresh.all().length, 0, 'reset gives a fresh ledger');
});
