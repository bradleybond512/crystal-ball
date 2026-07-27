import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestDomain, type DomainObservation } from '../fusion-ingest.ts';
import { recordFetchOutcome, emptyProviderHealthState } from '../provider-health.ts';
import type { ProviderHealthState } from '../provider-health.ts';
import { snapshotsFromRegistry } from '../provider-bridge.ts';
import { assessProviderRedundancy } from '../../diagnostics/provider-redundancy.ts';

const NOW = 1_745_000_000_000;

/** A health state where both quake providers are healthy. */
function healthyBoth(): ProviderHealthState {
  let s = emptyProviderHealthState();
  for (const id of ['usgs-earthquakes', 'emsc-seismic']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, at: NOW });
  }
  return s;
}

function healthyStocks(): ProviderHealthState {
  let s = emptyProviderHealthState();
  for (const id of ['yahoo-finance', 'finnhub']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, at: NOW });
  }
  return s;
}

function obs(providerId: string, o: Partial<DomainObservation> = {}): DomainObservation {
  return { providerId, value: 6.0, lat: 35.0, lon: 139.0, occurredAt: NOW, ...o };
}

test('two providers see the same quake → matched, corroborated, agreeing fingerprints', () => {
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.1, lat: 35.00, lon: 139.00, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 6.0, lat: 35.10, lon: 139.05, occurredAt: NOW + 30_000 }),
  ], healthyBoth(), NOW);

  assert.equal(r.facts.length, 1, 'same quake collapses to one fact');
  const f = r.facts[0]!;
  assert.equal(f.providerIds.length, 2);
  assert.equal(f.fusion.independentSourceCount, 2);
  assert.equal(f.fusion.disagreements.length, 0);
  assert.ok(f.fusion.confidenceMultiplier > 0.6, 'corroborated, not disagreement-capped');
  // headline fingerprints agree across both providers
  assert.equal(r.providerFingerprints['usgs-earthquakes'], r.providerFingerprints['emsc-seismic']);
});

test('providers disagree on magnitude beyond tolerance → disagreement, distinct fingerprints, capped', () => {
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.1, lat: 35.0, lon: 139.0, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 7.4, lat: 35.0, lon: 139.0, occurredAt: NOW }),
  ], healthyBoth(), NOW);

  const f = r.facts[0]!;
  assert.ok(f.fusion.disagreements.length >= 1, 'disagreement surfaces');
  assert.ok(f.fusion.confidenceMultiplier <= 0.6, 'capped at disagreement ceiling');
  assert.notEqual(r.providerFingerprints['usgs-earthquakes'], r.providerFingerprints['emsc-seismic']);
});

test('only one provider sees a quake → single source, no corroboration', () => {
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 5.5, lat: 10, lon: 10, occurredAt: NOW }),
  ], healthyBoth(), NOW);

  const f = r.facts[0]!;
  assert.equal(f.fusion.independentSourceCount, 1);
  assert.equal(Object.keys(r.providerFingerprints).length, 1);
});

test('magnitudes within tolerance but across a raw bucket boundary still agree', () => {
  // 6.2 → round(6.2/0.5)=12, 6.4 → round(6.4/0.5)=13 under naive per-value
  // bucketing, yet |6.2-6.4|=0.2 <= tolerance 0.5 so fusion treats them as
  // consensus. The fingerprints MUST still match (no false disagreement).
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.2, lat: 35, lon: 139, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 6.4, lat: 35, lon: 139, occurredAt: NOW }),
  ], healthyBoth(), NOW);
  const f = r.facts[0]!;
  assert.equal(f.fusion.disagreements.length, 0, 'within tolerance → fusion sees no disagreement');
  assert.equal(
    r.providerFingerprints['usgs-earthquakes'],
    r.providerFingerprints['emsc-seismic'],
    'consensus providers share one fingerprint regardless of bucket boundary',
  );
});

test('clustering is independent of input order', () => {
  const a = obs('usgs-earthquakes', { value: 6.0, lat: 35.0, lon: 139.0, occurredAt: NOW });
  const b = obs('emsc-seismic', { value: 6.0, lat: 35.1, lon: 139.0, occurredAt: NOW + 10_000 }); // ~11 km from a
  const c = obs('usgs-earthquakes', { value: 5.0, lat: 36.0, lon: 139.0, occurredAt: NOW + 5_000 }); // ~111 km from a
  const r1 = ingestDomain('earthquakes', [a, b, c], healthyBoth(), NOW);
  const r2 = ingestDomain('earthquakes', [c, b, a], healthyBoth(), NOW);
  assert.equal(r1.facts.length, 2, '{a,b} cluster + c separate');
  assert.equal(r2.facts.length, r1.facts.length, 'result independent of input order');
});

test('quakes far apart in space do NOT match', () => {
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.0, lat: 35, lon: 139, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 6.0, lat: -35, lon: -70, occurredAt: NOW }),
  ], healthyBoth(), NOW);
  assert.equal(r.facts.length, 2, 'distinct quakes stay distinct');
});

test('unknown fact-type returns empty', () => {
  const r = ingestDomain('nope', [obs('usgs-earthquakes')], healthyBoth(), NOW);
  assert.equal(r.facts.length, 0);
  assert.deepEqual(r.providerFingerprints, {});
});

test('key-matched fused facts retain their symbol and consensus price', () => {
  const r = ingestDomain('stocks', [
    obs('finnhub', { key: 'AAPL', value: 200.5, lat: 0, lon: 0 }),
    obs('yahoo-finance', { key: 'AAPL', value: 200, lat: 0, lon: 0 }),
  ], healthyStocks(), NOW);

  assert.equal(r.facts.length, 1);
  assert.equal(r.facts[0]?.key, 'AAPL');
  assert.equal(r.facts[0]?.value, 200.25);
  assert.equal(r.facts[0]?.fusion.independentSourceCount, 2);
});

test('end to end: agreeing quakes → redundant_agreement for disasters', () => {
  const health = healthyBoth();
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.1, lat: 35, lon: 139, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 6.0, lat: 35.05, lon: 139.02, occurredAt: NOW + 20_000 }),
  ], health, NOW);

  const snaps = snapshotsFromRegistry(health, NOW, 'disasters', r.providerFingerprints);
  const report = assessProviderRedundancy({ generatedAt: NOW, snapshots: snaps });
  const disasters = report.domains.find((d) => d.domain === 'disasters')!;
  assert.equal(disasters.verdict, 'redundant_agreement');
  assert.equal(disasters.confidenceMultiplier, 1);
});

test('end to end: disagreeing quakes → redundant_disagreement for disasters', () => {
  const health = healthyBoth();
  const r = ingestDomain('earthquakes', [
    obs('usgs-earthquakes', { value: 6.1, lat: 35, lon: 139, occurredAt: NOW }),
    obs('emsc-seismic',     { value: 7.6, lat: 35, lon: 139, occurredAt: NOW }),
  ], health, NOW);
  const snaps = snapshotsFromRegistry(health, NOW, 'disasters', r.providerFingerprints);
  const report = assessProviderRedundancy({ generatedAt: NOW, snapshots: snaps });
  const disasters = report.domains.find((d) => d.domain === 'disasters')!;
  assert.equal(disasters.verdict, 'redundant_disagreement');
});
