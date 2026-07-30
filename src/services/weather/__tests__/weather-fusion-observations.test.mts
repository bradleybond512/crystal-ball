import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempToObservations, type TempReading } from '../weather-fusion-observations.ts';
import { ingestDomain } from '../../providers/fusion-ingest.ts';
import { recordFetchOutcome, emptyProviderHealthState } from '../../providers/provider-health.ts';
import type { ProviderHealthState } from '../../providers/provider-health.ts';

const NOW = 1_745_000_000_000;

function reading(o: Partial<TempReading> = {}): TempReading {
  return { lat: 41.61, lon: -86.72, tempC: 20, observedAt: NOW, ...o };
}

function healthyBoth(): ProviderHealthState {
  let s = emptyProviderHealthState();
  for (const id of ['open-meteo-forecast', 'met-norway']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, at: NOW });
  }
  return s;
}

test('tempToObservations maps a reading to a DomainObservation', () => {
  const obs = tempToObservations('met-norway', [reading({ tempC: 12.3 })]);
  assert.equal(obs.length, 1);
  assert.deepEqual(obs[0], { providerId: 'met-norway', value: 12.3, lat: 41.61, lon: -86.72, occurredAt: NOW });
});

test('tempToObservations drops non-finite tempC, non-finite coords, and non-positive/non-finite observedAt', () => {
  assert.equal(tempToObservations('met-norway', [reading({ tempC: Number.NaN })]).length, 0);
  assert.equal(tempToObservations('met-norway', [reading({ lat: Number.NaN })]).length, 0);
  assert.equal(tempToObservations('met-norway', [reading({ lon: Number.NaN })]).length, 0);
  assert.equal(tempToObservations('met-norway', [reading({ observedAt: Number.NaN })]).length, 0);
  assert.equal(tempToObservations('met-norway', [reading({ observedAt: 0 })]).length, 0, 'observedAt must be positive');
  assert.equal(tempToObservations('met-norway', [reading({ observedAt: -5 })]).length, 0);
});

test('tempToObservations drops physically implausible temperatures', () => {
  assert.equal(tempToObservations('met-norway', [reading({ tempC: -96 })]).length, 0, 'below -95C bound');
  assert.equal(tempToObservations('met-norway', [reading({ tempC: 66 })]).length, 0, 'above 65C bound');
  assert.equal(tempToObservations('met-norway', [reading({ tempC: -89 })]).length, 1, 'Vostok-record cold is kept');
  assert.equal(tempToObservations('met-norway', [reading({ tempC: 57 })]).length, 1, 'Death-Valley-record heat is kept');
});

test('two readings 1C apart at the same coordinate fuse into one fact with no disagreement', () => {
  const r = ingestDomain('surface_temp', [
    ...tempToObservations('open-meteo-forecast', [reading({ tempC: 20.0, observedAt: NOW })]),
    ...tempToObservations('met-norway', [reading({ tempC: 21.0, observedAt: NOW + 60_000 })]),
  ], healthyBoth(), NOW);

  assert.equal(r.facts.length, 1, 'same place/time collapses to one fact');
  const f = r.facts[0]!;
  assert.equal(f.providerIds.length, 2);
  assert.equal(f.fusion.disagreements.length, 0);
  assert.equal(r.providerFingerprints['open-meteo-forecast'], r.providerFingerprints['met-norway']);
});

test('two readings 5C apart surface a disagreement naming both providers', () => {
  const r = ingestDomain('surface_temp', [
    ...tempToObservations('open-meteo-forecast', [reading({ tempC: 15.0, observedAt: NOW })]),
    ...tempToObservations('met-norway', [reading({ tempC: 20.0, observedAt: NOW })]),
  ], healthyBoth(), NOW);

  const f = r.facts[0]!;
  assert.ok(f.fusion.disagreements.length >= 1, 'disagreement surfaces');
  assert.ok(f.fusion.confidenceMultiplier <= 0.6, 'capped at disagreement ceiling');
  // The per-fact fingerprint map is keyed by every provider in the cluster —
  // both provider ids are named, one tagged as consensus and one as the
  // outlier, with distinct fingerprint values.
  assert.ok('open-meteo-forecast' in f.fingerprints, 'fingerprint map names open-meteo-forecast');
  assert.ok('met-norway' in f.fingerprints, 'fingerprint map names met-norway');
  assert.notEqual(f.fingerprints['open-meteo-forecast'], f.fingerprints['met-norway'], 'the two providers get distinct fingerprints');
  assert.notEqual(r.providerFingerprints['open-meteo-forecast'], r.providerFingerprints['met-norway']);
});

test('readings beyond 25km apart do not fuse into one fact', () => {
  const r = ingestDomain('surface_temp', [
    ...tempToObservations('open-meteo-forecast', [reading({ tempC: 20, lat: 41.61, lon: -86.72, observedAt: NOW })]),
    // ~32km north of the first reading — outside the 25km match window.
    ...tempToObservations('met-norway', [reading({ tempC: 20, lat: 41.90, lon: -86.72, observedAt: NOW })]),
  ], healthyBoth(), NOW);

  assert.equal(r.facts.length, 2, 'distant readings stay distinct facts');
});
