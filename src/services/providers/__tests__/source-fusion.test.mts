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
  const state = healthyState(['wingbits', 'opensky', 'airplanes-live']);
  const r = fuseObservations({
    observations: [obs('wingbits', 42), obs('opensky', 42), obs('airplanes-live', 42)],
    healthState: state, now: T0, numericTolerance: 1,
  });
  assert.equal(r.independentSourceCount, 3);
  assert.ok(r.confidenceMultiplier > 0.8, `expected > 0.8, got ${r.confidenceMultiplier}`);
  assert.equal(r.label, 'very_high');
});

test('disagreement surfaces and caps the multiplier', () => {
  const state = healthyState(['wingbits', 'opensky']);
  const r = fuseObservations({
    observations: [obs('wingbits', 42), obs('opensky', 99)],
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

// Finding 2: reliability must incorporate a status factor so a 'down'
// provider contributes 0 reliability even if its successRate history is high.

test('provider with 3 consecutive failures contributes 0 reliability', () => {
  let s = emptyProviderHealthState();
  for (let i = 0; i < 3; i++) {
    s = recordFetchOutcome(s, 'nws-alerts', { ok: false, latencyMs: 0, at: T0 - (2 - i) * 1000 });
  }
  const r = fuseObservations({ observations: [obs('nws-alerts', 1, T0)], healthState: s, now: T0 });
  assert.equal(r.components.reliability.score, 0,
    `expected 0 reliability for down provider, got ${r.components.reliability.score}`);
  assert.match(r.components.reliability.reason, /status factor/i);
});

test('provider with no recorded outcomes (stale status) is penalized to 0.5x', () => {
  const s = emptyProviderHealthState(); // no outcomes → stale
  const r = fuseObservations({ observations: [obs('nws-alerts', 1, T0)], healthState: s, now: T0 });
  // reliabilityWeight for nws-alerts = 0.95, successRate for stale = 1, factor = 0.5
  // expected = 0.95 * 1 * 0.5 = 0.475
  const expected = 0.95 * 1 * 0.5;
  assert.ok(
    Math.abs(r.components.reliability.score - expected) < 0.01,
    `expected reliability ~${expected}, got ${r.components.reliability.score}`,
  );
});

// Finding 3: splitConsensus must rank by distinct independence groups, not
// raw observation count.

test('two providers from one group do NOT outvote two providers from two groups', () => {
  // adsb-lol + adsb-fi both independenceGroup='community-adsb' → value 99
  // opensky independenceGroup='opensky' + airplanes-live independenceGroup='community-adsb'
  // wait — let's use opensky (group opensky) + wingbits (group wingbits) → value 42
  // vs adsb-lol + adsb-fi (both community-adsb) → value 99
  // community-adsb (1 group, 2 obs) vs opensky+wingbits (2 groups, 2 obs)
  // Result: opensky+wingbits cluster has MORE distinct independence groups → wins consensus
  let s = emptyProviderHealthState();
  for (const id of ['adsb-lol', 'adsb-fi', 'opensky', 'wingbits']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, at: T0 });
  }
  const r = fuseObservations({
    observations: [
      obs('adsb-lol', 99), obs('adsb-fi', 99),         // 1 group
      obs('opensky', 42), obs('wingbits', 42),           // 2 groups
    ],
    healthState: s, now: T0,
  });
  // The 42-cluster (opensky + wingbits: 2 distinct groups) should win consensus.
  // The 99-cluster should be in disagreements.
  assert.equal(r.disagreements.length, 1);
  assert.equal(r.disagreements[0]!.value, 99,
    `expected 99 (single-group cluster) to be the disagreement, not the consensus`);
});

test('NaN observedAt fails safe to very_low, not very_high', () => {
  // A NaN timestamp poisons freshness → multiplier; it must not slip past the
  // labelFor comparisons and display as maximum trust.
  const state = healthyState(['wingbits', 'opensky']);
  const r = fuseObservations({
    observations: [obs('wingbits', 42, NaN), obs('opensky', 42, NaN)],
    healthState: state, now: T0, numericTolerance: 1,
  });
  assert.ok(Number.isFinite(r.confidenceMultiplier),
    `confidenceMultiplier must be finite, got ${r.confidenceMultiplier}`);
  assert.equal(r.confidenceMultiplier, 0);
  assert.equal(r.label, 'very_low');
});
