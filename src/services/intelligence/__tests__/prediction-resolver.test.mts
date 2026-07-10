import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runResolutionPass,
  alertSeverityObservable,
  toLadderSeverity,
  type SeverityObservable,
} from '../prediction-resolver.ts';
import type { AlgorithmPrediction } from '../algo-eval-ledger.ts';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-07-10T12:00:00Z');

function pred(over: Partial<AlgorithmPrediction> & Pick<AlgorithmPrediction, 'id'>): AlgorithmPrediction {
  return {
    algorithmId: 'driver-scorer',
    domain: 'weather',
    inputHash: `weather:${over.id}`,
    predictedValue: 'low',
    predictedAt: new Date(NOW - 24 * HOUR),
    ...over,
  };
}

const OPTS = { resolveAfterMs: 12 * HOUR, expireAfterMs: 48 * HOUR, now: NOW };

test('too-early predictions stay pending', () => {
  const p = pred({ id: 'a', predictedAt: new Date(NOW - 1 * HOUR) });
  const out = runResolutionPass([p], () => 'high', OPTS);
  assert.deepEqual(out, { resolutions: [], expirations: [] });
});

test('resolvable prediction is resolved with the observed peak severity', () => {
  const p = pred({ id: 'a', predictedValue: 'low', predictedAt: new Date(NOW - 24 * HOUR) });
  const out = runResolutionPass([p], () => 'high', OPTS);
  assert.deepEqual(out.resolutions, [{ id: 'a', value: 'high' }]);
  assert.deepEqual(out.expirations, []);
});

test('predictions past expireAfter are expired, not resolved', () => {
  const p = pred({ id: 'old', predictedAt: new Date(NOW - 72 * HOUR) });
  const out = runResolutionPass([p], () => 'high', OPTS);
  assert.deepEqual(out.resolutions, []);
  assert.deepEqual(out.expirations, ['old']);
});

test('already-resolved / already-expired predictions are skipped', () => {
  const resolved = pred({ id: 'r', resolvedAt: new Date(NOW) });
  const expired = pred({ id: 'e', expiredAt: new Date(NOW), predictedAt: new Date(NOW - 72 * HOUR) });
  const out = runResolutionPass([resolved, expired], () => 'high', OPTS);
  assert.deepEqual(out, { resolutions: [], expirations: [] });
});

test('null observable leaves the prediction pending (retry later)', () => {
  const p = pred({ id: 'a' });
  const observe: SeverityObservable = () => null;
  const out = runResolutionPass([p], observe, OPTS);
  assert.deepEqual(out, { resolutions: [], expirations: [] });
});

test('alertSeverityObservable: peak severity in domain+window; quiet ⇒ low', () => {
  const alerts = [
    { source: 'weather', severity: 'medium', timestamp: NOW - 20 * HOUR },
    { source: 'weather', severity: 'high', timestamp: NOW - 18 * HOUR },
    { source: 'earthquake', severity: 'critical', timestamp: NOW - 18 * HOUR }, // wrong domain
    { source: 'weather', severity: 'critical', timestamp: NOW - 2 * HOUR },      // outside window
  ];
  const obs = alertSeverityObservable(() => alerts, (s) => s);
  // window [NOW-24h, NOW-12h] over 'weather' → peak = high
  assert.equal(obs('weather', NOW - 24 * HOUR, NOW - 12 * HOUR), 'high');
  // no cyber alerts → stayed low
  assert.equal(obs('cyber', NOW - 24 * HOUR, NOW - 12 * HOUR), 'low');
});

test('toLadderSeverity folds info/unknown onto low', () => {
  assert.equal(toLadderSeverity('info'), 'low');
  assert.equal(toLadderSeverity('critical'), 'critical');
  assert.equal(toLadderSeverity('bogus'), 'low');
});
