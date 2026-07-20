import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForecastProvenanceLines, buildSuperforecastLines } from '../forecast-provenance-view.ts';
import type { HypothesisForecast } from '@/services/intelligence/hypothesis-forecast';
import type { SuperForecast } from '@/services/cognition/superforecast';

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

const sfBase: SuperForecast = {
  hypothesisId: 'h1',
  probability: 0.44,
  estimates: [
    { source: 'base-rate', p: 0.3, weight: 1 },
    { source: 'persona-analyst', p: 0.55, weight: 1 },
  ],
  spread: 0.25,
  explanation: '[outside] test',
  llmTier: 'partial',
};

test('superforecast lines lead with probability and tier', () => {
  const l = buildSuperforecastLines(sfBase);
  assert.ok(l[0]!.includes('44%'));
  assert.ok(l[0]!.includes('partial LLM pipeline'));
});

test('superforecast lines include every estimate with weight, plus spread', () => {
  const l = buildSuperforecastLines(sfBase);
  assert.ok(l.some(x => x.includes('base-rate 30%')));
  assert.ok(l.some(x => x.includes('persona-analyst 55%')));
  assert.ok(l.some(x => x.includes('spread 25%')));
});

test('superforecast interval renders coverage and bounds when present', () => {
  const l = buildSuperforecastLines({
    ...sfBase,
    interval: { p: 0.44, lo: 0.3, hi: 0.6, alpha: 0.2, n: 57, explanation: 'global pool n=57' },
  });
  assert.ok(l.some(x => x.includes('80% interval 30%–60% (n=57)')));
});

test('deterministic-only single-estimate forecast omits spread and interval', () => {
  const l = buildSuperforecastLines({
    ...sfBase,
    llmTier: 'deterministic-only',
    estimates: [{ source: 'base-rate', p: 0.3, weight: 1 }],
    spread: 0,
  });
  assert.ok(l[0]!.includes('deterministic floor'));
  assert.ok(!l.some(x => x.includes('spread')));
  assert.ok(!l.some(x => x.includes('interval')));
});
