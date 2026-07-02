import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForecastProvenanceLines } from '../forecast-provenance-view.ts';
import type { HypothesisForecast } from '@/services/intelligence/hypothesis-forecast';

const base: HypothesisForecast = {
  hypothesisId: 'h1',
  probability: 0.62,
  trend: 'rising',
  horizon: '24h',
  components: { baseConfidence: 0.5, pciBoost: 0.05, analogBoost: 0.04, providerMultiplier: 1, calibrationMultiplier: 1 },
};

test('shows base + non-zero adjustments only', () => {
  const l = buildForecastProvenanceLines(base);
  assert.ok(l.some(x => x.includes('Base') && x.includes('50%')));
  assert.ok(l.some(x => x.toLowerCase().includes('analog') && x.includes('+4%')));
  assert.ok(!l.some(x => x.toLowerCase().includes('provider')));
});

test('surfaces calibration explanation when present', () => {
  const l = buildForecastProvenanceLines({
    ...base,
    components: { ...base.components, recalibratedP: 0.6, calibrationAdjustment: -0.02, calibrationExplanation: 'reliability curve pulled 64%→60% (n=42)' },
  });
  assert.ok(l.some(x => x.includes('reliability curve pulled')));
});

test('identity forecast still yields the base line', () => {
  const l = buildForecastProvenanceLines({
    ...base,
    components: { baseConfidence: 0.5, pciBoost: 0, analogBoost: 0, providerMultiplier: 1, calibrationMultiplier: 1 },
  });
  assert.equal(l.length >= 1, true);
});
