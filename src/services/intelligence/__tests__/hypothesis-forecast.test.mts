import assert from 'node:assert/strict';
import test from 'node:test';

import {
  forecastHypothesis,
  forecastAll,
  maybePushRecalibrationPair,
  _resetRecalPushForTests,
} from '../hypothesis-forecast.ts';
import type { Hypothesis } from '../../analyst-loop.ts';
import type { PCIScore } from '../predictive-crisis-index.ts';

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: 'h1',
    kind: 'alert-burst',
    statement: 'Test hypothesis',
    confidence: 0.5,
    risk: 'moderate',
    evidence: [],
    timestamp: 1_000_000,
    ...overrides,
  };
}

function makePCI(index: number): PCIScore {
  return {
    index,
    level: 'moderate',
    trend: 'stable',
    trendDelta: 0,
    domainBreakdown: [],
    topThreats: [],
    computedAt: 1_000_000,
    windowMs: 6 * 60 * 60 * 1000,
  };
}

test('high confidence + high PCI → probability > baseConfidence', () => {
  const h = makeHypothesis({ confidence: 0.6 });
  const pci = makePCI(80);
  const result = forecastHypothesis(h, pci, null);
  assert.ok(result.probability > 0.6);
  assert.strictEqual(result.components.baseConfidence, 0.6);
  assert.ok(result.components.pciBoost > 0);
});

test('no PCI, no analog → probability equals baseConfidence exactly', () => {
  const h = makeHypothesis({ confidence: 0.7 });
  const result = forecastHypothesis(h, null, null);
  assert.strictEqual(result.probability, 0.7);
  assert.strictEqual(result.components.pciBoost, 0);
  assert.strictEqual(result.components.analogBoost, 0);
});

test('probability is clamped to [0, 1]', () => {
  const h = makeHypothesis({ confidence: 0.99 });
  const pci = makePCI(100);
  const result = forecastHypothesis(h, pci, 1.0);
  assert.ok(result.probability <= 1);
  assert.ok(result.probability >= 0);

  const h2 = makeHypothesis({ confidence: 0 });
  const result2 = forecastHypothesis(h2, null, null);
  assert.ok(result2.probability >= 0);
});

test('critical riskLevel → horizon 6h', () => {
  const h = makeHypothesis({ risk: 'critical' });
  const result = forecastHypothesis(h, null, null);
  assert.strictEqual(result.horizon, '6h');
});

test('high risk → horizon 24h', () => {
  const h = makeHypothesis({ risk: 'high' });
  const result = forecastHypothesis(h, null, null);
  assert.strictEqual(result.horizon, '24h');
});

test('low/moderate risk → horizon 72h', () => {
  assert.strictEqual(forecastHypothesis(makeHypothesis({ risk: 'low' }), null, null).horizon, '72h');
  assert.strictEqual(forecastHypothesis(makeHypothesis({ risk: 'moderate' }), null, null).horizon, '72h');
});

test('trend is rising when PCI boost is significant', () => {
  const h = makeHypothesis({ confidence: 0.5 });
  const pci = makePCI(100);
  const result = forecastHypothesis(h, pci, null);
  assert.strictEqual(result.trend, 'rising');
});

test('trend is stable when no boost', () => {
  const h = makeHypothesis({ confidence: 0.5 });
  const result = forecastHypothesis(h, null, null);
  assert.strictEqual(result.trend, 'stable');
});

test('providerMultiplier=0.5 halves the probability (clamped)', () => {
  const h = makeHypothesis({ confidence: 0.6 });
  const result = forecastHypothesis(h, null, null, 0.5);
  assert.strictEqual(result.probability, 0.3);
  assert.strictEqual(result.components.providerMultiplier, 0.5);
});

test('providerMultiplier defaults to 1.0 (no effect)', () => {
  const h = makeHypothesis({ confidence: 0.6 });
  const withDefault = forecastHypothesis(h, null, null);
  const withExplicit = forecastHypothesis(h, null, null, 1.0);
  assert.strictEqual(withDefault.probability, withExplicit.probability);
  assert.strictEqual(withDefault.components.providerMultiplier, 1.0);
});

// ── maybePushRecalibrationPair flood control (Prediction Uplift PR A3) ──────

test('a second push within the hourly window for the same signature is suppressed', () => {
  _resetRecalPushForTests();
  const calls: Array<[unknown, number, number]> = [];
  const push = (input: unknown, liveP: number, shadowP: number) => { calls.push([input, liveP, shadowP]); };

  maybePushRecalibrationPair('sig-a', 0.6, 0.5, 1_000, push);
  maybePushRecalibrationPair('sig-a', 0.65, 0.55, 1_000 + 60_000, push); // 1 min later — still within the hour
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['sig-a', 0.6, 0.5]);
});

test('different signatures each get their own push', () => {
  _resetRecalPushForTests();
  const calls: Array<[unknown, number, number]> = [];
  const push = (input: unknown, liveP: number, shadowP: number) => { calls.push([input, liveP, shadowP]); };

  maybePushRecalibrationPair('sig-a', 0.6, 0.5, 1_000, push);
  maybePushRecalibrationPair('sig-b', 0.7, 0.4, 1_000, push);
  assert.equal(calls.length, 2);
});

test('after the cooldown window elapses, a push fires again for the same signature', () => {
  _resetRecalPushForTests();
  const calls: Array<[unknown, number, number]> = [];
  const push = (input: unknown, liveP: number, shadowP: number) => { calls.push([input, liveP, shadowP]); };

  maybePushRecalibrationPair('sig-a', 0.6, 0.5, 1_000, push);
  maybePushRecalibrationPair('sig-a', 0.62, 0.52, 1_000 + 3_600_000, push); // exactly at the boundary — still suppressed (< strictly)
  maybePushRecalibrationPair('sig-a', 0.63, 0.53, 1_000 + 3_600_001, push); // one ms past — fires
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ['sig-a', 0.63, 0.53]);
});

test('_resetRecalPushForTests clears the cooldown so a push fires again immediately', () => {
  const calls: Array<[unknown, number, number]> = [];
  const push = (input: unknown, liveP: number, shadowP: number) => { calls.push([input, liveP, shadowP]); };

  maybePushRecalibrationPair('sig-reset', 0.6, 0.5, 1_000, push);
  _resetRecalPushForTests();
  maybePushRecalibrationPair('sig-reset', 0.6, 0.5, 1_001, push);
  assert.equal(calls.length, 2);
});

test('a throwing push function never propagates out of maybePushRecalibrationPair', () => {
  _resetRecalPushForTests();
  const push = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => {
    maybePushRecalibrationPair('sig-throw', 0.6, 0.5, 1_000, push);
  });
});

test('forecastHypothesis wires its shadow push at the real call site without affecting its own output or throwing', () => {
  _resetRecalPushForTests();
  const h = makeHypothesis({ confidence: 0.55 });
  // The call site uses the real pushRecalibrationPair (fail-safe, kill-switch
  // gated) — this is a smoke test that wiring it in did not change forecast
  // output determinism or leak an exception through forecastHypothesis.
  const first = forecastHypothesis(h, null, null);
  const second = forecastHypothesis(h, null, null);
  assert.strictEqual(first.probability, second.probability);
  assert.strictEqual(first.components.recalibratedP, second.components.recalibratedP);
});

test('forecastAll returns one forecast per hypothesis with analogBoost=0', () => {
  const hypotheses = [
    makeHypothesis({ id: 'a', confidence: 0.4 }),
    makeHypothesis({ id: 'b', confidence: 0.6 }),
  ];
  const results = forecastAll(hypotheses, null);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].hypothesisId, 'a');
  assert.strictEqual(results[1].hypothesisId, 'b');
  assert.strictEqual(results[0].components.analogBoost, 0);
});
