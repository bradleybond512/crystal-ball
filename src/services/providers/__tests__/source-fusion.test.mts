import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseObservations } from '../source-fusion.ts';
import { emptyProviderHealthState, recordFetchOutcome } from '../provider-health.ts';

const T0 = 1_750_000_000_000;
const obs = (providerId: string, value: number | string, observedAt = T0) => ({ providerId, value, observedAt });

function healthyState(ids: string[]) {
  let s = emptyProviderHealthState();
  for (const id of ids) s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, httpStatus: 200, at: T0 });
  return s;
}

test('empty observations → very_low with zero independent sources', () => {
  const r = fuseObservations({ observations: [], healthState: emptyProviderHealthState(), now: T0 });
  assert.equal(r.label, 'very_low');
  assert.equal(r.independentSourceCount, 0);
  assert.match(r.components.corroboration.reason, /no observations/i);
});

test('same independence group counts as one source', () => {
  const state = healthyState(['adsb-lol', 'adsb-fi', 'airplanes-live']);
  const r = fuseObservations({
    observations: [obs('adsb-lol', 42), obs('adsb-fi', 42), obs('airplanes-live', 42)],
    healthState: state, now: T0, numericTolerance: 1,
  });
  assert.equal(r.independentSourceCount, 1);
});

test('independent agreement raises corroboration and label', () => {
  const state = healthyState(['adsbexchange', 'opensky', 'airplanes-live']);
  const r = fuseObservations({
    observations: [obs('adsbexchange', 42), obs('opensky', 42), obs('airplanes-live', 42)],
    healthState: state, now: T0, numericTolerance: 1,
  });
  assert.equal(r.independentSourceCount, 3);
  assert.ok(r.confidenceMultiplier > 0.8, `expected > 0.8, got ${r.confidenceMultiplier}`);
  assert.equal(r.label, 'very_high');
});

test('disagreement surfaces and caps the multiplier', () => {
  const state = healthyState(['adsbexchange', 'opensky']);
  const r = fuseObservations({
    observations: [obs('adsbexchange', 42), obs('opensky', 99)],
    healthState: state, now: T0, numericTolerance: 1,
  });
  assert.equal(r.disagreements.length, 1);
  assert.equal(r.disagreements[0].value, 99);
  assert.ok(r.confidenceMultiplier <= 0.6, `disagreement must cap at 0.6, got ${r.confidenceMultiplier}`);
});

test('categorical disagreement detected without tolerance', () => {
  const state = healthyState(['nws-alerts', 'open-meteo-forecast']);
  const r = fuseObservations({
    observations: [obs('nws-alerts', 'tornado_warning'), obs('open-meteo-forecast', 'clear')],
    healthState: state, now: T0,
  });
  assert.equal(r.disagreements.length, 1);
});

test('freshness decays linearly against provider TTL', () => {
  const state = healthyState(['nws-alerts']); // TTL 10 min
  const fresh = fuseObservations({ observations: [obs('nws-alerts', 1, T0)], healthState: state, now: T0 });
  const half = fuseObservations({ observations: [obs('nws-alerts', 1, T0)], healthState: state, now: T0 + 5 * 60_000 });
  const dead = fuseObservations({ observations: [obs('nws-alerts', 1, T0)], healthState: state, now: T0 + 20 * 60_000 });
  assert.equal(fresh.components.freshness.score, 1);
  assert.ok(Math.abs(half.components.freshness.score - 0.5) < 0.01);
  assert.equal(dead.components.freshness.score, 0);
});

test('future observedAt is clamped, never scores above 1', () => {
  const state = healthyState(['nws-alerts']);
  const r = fuseObservations({ observations: [obs('nws-alerts', 1, T0 + 60_000)], healthState: state, now: T0 });
  assert.equal(r.components.freshness.score, 1);
});

test('observations from unknown providers are dropped with a reason', () => {
  const r = fuseObservations({ observations: [obs('made-up', 1)], healthState: emptyProviderHealthState(), now: T0 });
  assert.equal(r.independentSourceCount, 0);
  assert.equal(r.label, 'very_low');
});
