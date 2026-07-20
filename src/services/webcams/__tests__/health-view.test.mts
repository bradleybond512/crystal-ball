import assert from 'node:assert/strict';
import test from 'node:test';

import { healthSummary } from '../health-view.ts';
import type { WebcamSourceHealth } from '../webcam-types.ts';

function h(overrides: Partial<WebcamSourceHealth> & Pick<WebcamSourceHealth, 'source' | 'status'>): WebcamSourceHealth {
  return { count: 0, needsKey: false, lastChecked: 1, ...overrides };
}

test('missing_key WINDY → cta includes WINDY_WEBCAMS_API_KEY', () => {
  const result = healthSummary([h({ source: 'WINDY', status: 'missing_key', needsKey: true })]);
  assert.ok(result.cta.some(s => s.includes('WINDY_WEBCAMS_API_KEY')));
});

test('down source → appears in degraded', () => {
  const result = healthSummary([h({ source: 'FAA', status: 'down' })]);
  assert.ok(result.degraded.some(d => d.source === 'FAA'));
});

test('ok source → not in degraded, counted in ok', () => {
  const result = healthSummary([h({ source: 'FAA', status: 'ok' })]);
  assert.equal(result.ok, 1);
  assert.equal(result.degraded.length, 0);
});

test('empty source → not in degraded', () => {
  const result = healthSummary([h({ source: 'NPS', status: 'empty' })]);
  assert.equal(result.degraded.length, 0);
});

test('missing_key NPS → cta includes NPS_API_KEY', () => {
  const result = healthSummary([h({ source: 'NPS', status: 'missing_key', needsKey: true })]);
  assert.ok(result.cta.some(s => s.includes('NPS_API_KEY')));
});

test('missing_key source without env hint → no cta entry', () => {
  const result = healthSummary([h({ source: 'FAA', status: 'missing_key', needsKey: true })]);
  assert.equal(result.cta.length, 0);
});
