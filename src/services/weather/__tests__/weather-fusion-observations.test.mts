import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempToObservations, tempVote, type TempReading } from '../weather-fusion-observations.ts';
import { ingestDomain } from '../../providers/fusion-ingest.ts';
import { recordFetchOutcome, emptyProviderHealthState } from '../../providers/provider-health.ts';
import type { ProviderHealthState } from '../../providers/provider-health.ts';

const NOW = 1_745_000_000_000;

function reading(o: Partial<TempReading> = {}): TempReading {
  return { lat: 41.61, lon: -86.72, tempC: 20, observedAt: NOW, placeId: 'place-a', ...o };
}

function healthyBoth(): ProviderHealthState {
  let s = emptyProviderHealthState();
  for (const id of ['open-meteo-forecast', 'met-norway']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, at: NOW });
  }
  return s;
}

test('tempToObservations maps a reading to a DomainObservation', () => {
  const obs = tempToObservations('met-norway', [reading({ tempC: 12.3, placeId: 'place-a' })]);
  assert.equal(obs.length, 1);
  assert.deepEqual(obs[0], { providerId: 'met-norway', value: 12.3, lat: 41.61, lon: -86.72, occurredAt: NOW, key: 'place-a' });
});

test('tempToObservations drops non-finite tempC, non-finite coords, and non-positive/non-finite observedAt', () => {
  assert.equal(tempToObservations('met-norway', [reading({ tempC: Number.NaN })]).length, 0);
  assert.equal(tempToObservations('met-norway', [reading({ lat: Number.NaN })]).length, 0);
  assert.equal(tempToObservations('met-norway', [reading({ lon: Number.NaN })]).length, 0);
  assert.equal(tempToObservations('met-norway', [reading({ observedAt: Number.NaN })]).length, 0);
  assert.equal(tempToObservations('met-norway', [reading({ observedAt: 0 })]).length, 0, 'observedAt must be positive');
  assert.equal(tempToObservations('met-norway', [reading({ observedAt: -5 })]).length, 0);
});

test('tempToObservations drops readings with a missing or empty placeId', () => {
  assert.equal(tempToObservations('met-norway', [reading({ placeId: '' })]).length, 0, 'empty placeId is dropped');
  assert.equal(
    tempToObservations('met-norway', [{ lat: 41.61, lon: -86.72, tempC: 20, observedAt: NOW } as TempReading]).length,
    0,
    'missing placeId is dropped, not emitted keyless',
  );
});

test('tempToObservations drops physically implausible temperatures', () => {
  assert.equal(tempToObservations('met-norway', [reading({ tempC: -96 })]).length, 0, 'below -95C bound');
  assert.equal(tempToObservations('met-norway', [reading({ tempC: 66 })]).length, 0, 'above 65C bound');
  assert.equal(tempToObservations('met-norway', [reading({ tempC: -89 })]).length, 1, 'Vostok-record cold is kept');
  assert.equal(tempToObservations('met-norway', [reading({ tempC: 57 })]).length, 1, 'Death-Valley-record heat is kept');
});

// ── tempVote: health derived from the adapter output, not the raw readings ───

test('tempVote fails a provider whose only reading the adapter drops', () => {
  // Upstream answers 200 with tempC 999. `readings.length > 0` is true, so a
  // health check built on the RAW array records ok:true — while the adapter
  // drops the row and records []. That is a phantom healthy vote: the provider
  // counts toward "verified by N independent sources" having contributed
  // nothing, and the domain silently runs single-source.
  const sentinel = tempVote('open-meteo-forecast', [reading({ tempC: 999 })]);
  assert.deepEqual(sentinel.observations, [], 'the sentinel reading is dropped');
  assert.equal(sentinel.ok, false, 'and the provider is recorded down, not green');

  // Every other adapter-only drop must fail the vote the same way.
  assert.equal(tempVote('met-norway', [reading({ placeId: '' })]).ok, false, 'empty placeId');
  assert.equal(tempVote('met-norway', [reading({ lon: Number.NaN })]).ok, false, 'non-finite lon');
  assert.equal(tempVote('met-norway', [reading({ observedAt: 0 })]).ok, false, 'unusable observedAt');
});

test('tempVote passes when at least one reading survives, and fails on no readings', () => {
  const mixed = tempVote('met-norway', [reading({ tempC: 999 }), reading({ tempC: 12.3, placeId: 'place-b' })]);
  assert.deepEqual(mixed.observations.map((o) => o.key), ['place-b'], 'the junk row is dropped, the good one kept');
  assert.equal(mixed.ok, true, 'one usable reading is a healthy vote');
  assert.equal(tempVote('met-norway', []).ok, false, 'nothing fetched is not a healthy vote');
});

test('two readings 1C apart at the same place fuse into one fact with no disagreement', () => {
  const r = ingestDomain('surface_temp', [
    ...tempToObservations('open-meteo-forecast', [reading({ tempC: 20.0, observedAt: NOW, placeId: 'home' })]),
    ...tempToObservations('met-norway', [reading({ tempC: 21.0, observedAt: NOW + 60_000, placeId: 'home' })]),
  ], healthyBoth(), NOW);

  assert.equal(r.facts.length, 1, 'same place/time collapses to one fact');
  const f = r.facts[0]!;
  assert.equal(f.providerIds.length, 2);
  assert.equal(f.fusion.disagreements.length, 0);
  assert.equal(r.providerFingerprints['open-meteo-forecast'], r.providerFingerprints['met-norway']);
});

test('two readings 5C apart surface a disagreement naming both providers', () => {
  const r = ingestDomain('surface_temp', [
    ...tempToObservations('open-meteo-forecast', [reading({ tempC: 15.0, observedAt: NOW, placeId: 'home' })]),
    ...tempToObservations('met-norway', [reading({ tempC: 20.0, observedAt: NOW, placeId: 'home' })]),
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

test('two saved places 17.8km apart each fuse independently — no cross-place aliasing', () => {
  // La Porte, IN and Michigan City, IN are ~17.8km apart, well inside the old
  // spatial matchDistanceKm:25 radius. Matching by placeId (not geography)
  // must keep them as two separate facts even though each place's two
  // providers agree closely with each other — the regression that would have
  // caught the pre-fix bug, where the two places silently blended into one
  // fact and manufactured a false disagreement.
  const laPorte = { lat: 41.6106, lon: -86.7228, placeId: 'la-porte' };
  const michiganCity = { lat: 41.7075, lon: -86.8950, placeId: 'michigan-city' };

  const r = ingestDomain('surface_temp', [
    ...tempToObservations('open-meteo-forecast', [reading({ ...laPorte, tempC: 20.0, observedAt: NOW })]),
    ...tempToObservations('met-norway', [reading({ ...laPorte, tempC: 20.2, observedAt: NOW })]),
    ...tempToObservations('open-meteo-forecast', [reading({ ...michiganCity, tempC: 24.0, observedAt: NOW })]),
    ...tempToObservations('met-norway', [reading({ ...michiganCity, tempC: 24.1, observedAt: NOW })]),
  ], healthyBoth(), NOW);

  assert.equal(r.facts.length, 2, 'each saved place is its own fact');
  const totalDisagreements = r.facts.reduce((n, f) => n + f.fusion.disagreements.length, 0);
  assert.equal(totalDisagreements, 0, 'agreeing-per-place readings must not manufacture a cross-place disagreement');
  for (const f of r.facts) {
    assert.ok(f.fusion.confidenceMultiplier > 0.6, 'not capped at the disagreement ceiling');
  }
});
