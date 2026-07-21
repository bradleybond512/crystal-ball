import { test } from 'node:test';
import assert from 'node:assert';
import { buildLivePairRows } from '../correlation-map-view';

const pair = (over: Record<string, unknown> = {}) => ({
  ruleId: 'quake-infra', edgeType: 'causal-candidate',
  eventA: { domain: 'seismic', title: 'M6 quake', entityIds: [], timestamp: 1000 },
  eventB: { domain: 'infrastructure', title: 'outage', entityIds: [], timestamp: 2000 },
  confidence: 0.62,
  confidenceDetail: {
    value: 0.62,
    factors: { base: 0.8, temporal: 0.9, spatial: 1, entity: 1.15, reliability: 1.2, regime: 1.1 },
    explanation: 'reliability ×1.20 (learned from outcomes) · regime ×1.10',
  },
  detectedAt: new Date(60_000),
  ...over,
});

test('rows carry learned badge, regime flag, factor chips', () => {
  const rows = buildLivePairRows([pair({ ruleId: 'learned:cyber->markets' }) as never], 120_000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].learned, true);
  assert.equal(rows[0].regimeBoosted, true);
  assert.equal(rows[0].reliabilityLearned, true);
  assert.equal(rows[0].ageMs, 60_000);
  assert.ok(rows[0].factorChips.some((c) => c.key === 'regime' && c.value === 1.1));
});

test('sorted newest-first and capped at 30', () => {
  const pairs = Array.from({ length: 40 }, (_, i) => pair({ detectedAt: new Date(i * 1000) }) as never);
  const rows = buildLivePairRows(pairs, 100_000);
  assert.equal(rows.length, 30);
  assert.ok(rows[0].ageMs <= rows[1].ageMs);
});

test('missing confidenceDetail degrades gracefully', () => {
  const rows = buildLivePairRows([pair({ confidenceDetail: undefined }) as never], 100_000);
  assert.equal(rows[0].factorChips.length, 0);
  assert.equal(rows[0].regimeBoosted, false);
});
