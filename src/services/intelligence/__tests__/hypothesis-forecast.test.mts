import assert from 'node:assert/strict';
import test from 'node:test';

import { forecastHypothesis, forecastAll } from '../hypothesis-forecast.ts';
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
