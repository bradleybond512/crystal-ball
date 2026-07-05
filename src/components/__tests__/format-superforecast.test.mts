import assert from 'node:assert/strict';
import test from 'node:test';

import { formatSuperForecast } from '../format-superforecast.ts';
import type { SuperForecast } from '@/services/cognition/superforecast.ts';

function makeForecast(overrides: Partial<SuperForecast> = {}): SuperForecast {
  return {
    hypothesisId: 'hyp-1',
    probability: 0.62,
    estimates: [],
    spread: 0.2,
    explanation: 'x',
    llmTier: 'deterministic-only',
    ...overrides,
  };
}

test('summary line carries probability, spread, and llmTier; no interval line when absent', () => {
  const lines = formatSuperForecast(makeForecast());
  assert.ok(lines[0]!.includes('62%'));
  assert.ok(lines[0]!.includes('20pts'));
  assert.ok(lines[0]!.includes('deterministic-only'));
  assert.ok(!lines.some((l) => l.startsWith('Interval:')));
  assert.equal(lines[lines.length - 1], 'x');
});

test('interval line appears when a ForecastInterval is present', () => {
  const lines = formatSuperForecast(
    makeForecast({
      interval: { p: 0.62, lo: 0.4, hi: 0.8, alpha: 0.2, n: 40, explanation: 'ok' },
    }),
  );
  assert.ok(lines.some((l) => l === 'Interval: 40–80%'));
});

test('explanation is always the final line', () => {
  const withInterval = formatSuperForecast(
    makeForecast({
      explanation: 'the reasoning trail',
      interval: { p: 0.62, lo: 0.4, hi: 0.8, alpha: 0.2, n: 40, explanation: 'ok' },
    }),
  );
  assert.equal(withInterval[withInterval.length - 1], 'the reasoning trail');

  const withoutInterval = formatSuperForecast(makeForecast({ explanation: 'plain trail' }));
  assert.equal(withoutInterval[withoutInterval.length - 1], 'plain trail');
});
