import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordDomainObservations,
  getFusionProviderSnapshots,
  getLatestEarthquakeFusion,
  getLatestFusion,
  resetFusionPublishForTest,
} from '../fusion-publish.ts';
import type { DomainObservation } from '../fusion-ingest.ts';
import { assessProviderRedundancy } from '../../diagnostics/provider-redundancy.ts';
import { resetProvidersStateForTest } from '../providers-state.ts';

const NOW = 1_745_000_000_000;

function ob(providerId: string, value: number): DomainObservation {
  return { providerId, value, lat: 35.6, lon: 139.7, occurredAt: NOW };
}

test('both providers agree → snapshots carry equal fingerprints → redundant_agreement', () => {
  resetProvidersStateForTest();
  resetFusionPublishForTest();
  recordDomainObservations('usgs-earthquakes', [ob('usgs-earthquakes', 6.1)], true, NOW);
  recordDomainObservations('emsc-seismic', [ob('emsc-seismic', 6.0)], true, NOW);

  const snaps = getFusionProviderSnapshots(NOW);
  // earthquakes is now a 3-provider domain (USGS + EMSC + GEOFON); GEOFON
  // still surfaces as a silent (no-data) snapshot once the domain is active.
  assert.equal(snaps.length, 3);
  const reporting = snaps.filter((s) => s.recentFactFingerprint);
  assert.equal(reporting.length, 2, 'only the two providers that actually reported carry a fingerprint');
  const fps = new Set(reporting.map((s) => s.recentFactFingerprint));
  assert.equal(fps.size, 1, 'both reporting providers share one fingerprint');

  const report = assessProviderRedundancy({ generatedAt: NOW, snapshots: snaps });
  assert.equal(report.domains[0]!.verdict, 'redundant_agreement');
  // and the fused fact corroborates across 2 independent sources
  assert.equal(getLatestEarthquakeFusion(NOW).facts[0]!.fusion.independentSourceCount, 2);
});

test('a failed fetch records an outcome and degrades health, never silently drops', () => {
  resetProvidersStateForTest();
  resetFusionPublishForTest();
  recordDomainObservations('usgs-earthquakes', [ob('usgs-earthquakes', 6.0)], true, NOW);
  // EMSC fetch fails 3x → down
  for (let i = 0; i < 3; i++) recordDomainObservations('emsc-seismic', [], false, NOW + i);
  const snaps = getFusionProviderSnapshots(NOW + 3);
  const emsc = snaps.find((s) => s.providerId === 'emsc-seismic');
  assert.ok(emsc, 'emsc still surfaces (fail-closed, not dropped)');
  assert.equal(emsc!.level, 'failing');
});

test('no observations recorded → no snapshots', () => {
  resetProvidersStateForTest();
  resetFusionPublishForTest();
  assert.equal(getFusionProviderSnapshots(NOW).length, 0);
});

test('multiple domains fuse independently (earthquakes + air_quality)', () => {
  resetProvidersStateForTest();
  resetFusionPublishForTest();
  recordDomainObservations('usgs-earthquakes', [ob('usgs-earthquakes', 6.1)], true, NOW);
  recordDomainObservations('emsc-seismic', [ob('emsc-seismic', 6.0)], true, NOW);
  recordDomainObservations('open-meteo-aqi', [ob('open-meteo-aqi', 120)], true, NOW);
  recordDomainObservations('openaq-v3', [ob('openaq-v3', 130)], true, NOW); // within ±25 AQI

  const snaps = getFusionProviderSnapshots(NOW);
  // earthquakes now has 3 registered providers (USGS + EMSC + GEOFON) + air_quality's 2.
  assert.equal(snaps.length, 5, 'both active fused domains surface their providers');

  const report = assessProviderRedundancy({ generatedAt: NOW, snapshots: snaps });
  const disasters = report.domains.find((d) => d.domain === 'disasters')!;
  const aq = report.domains.find((d) => d.domain === 'air_quality')!;
  assert.equal(disasters.verdict, 'redundant_agreement');
  assert.equal(aq.verdict, 'redundant_agreement');
  assert.equal(getLatestFusion('air_quality', NOW).facts[0]!.fusion.independentSourceCount, 2);
});

test('only active domains surface — air_quality stays hidden until it flows', () => {
  resetProvidersStateForTest();
  resetFusionPublishForTest();
  recordDomainObservations('usgs-earthquakes', [ob('usgs-earthquakes', 6.0)], true, NOW);
  const domains = new Set(getFusionProviderSnapshots(NOW).map((s) => s.domain));
  assert.ok(domains.has('disasters'));
  assert.ok(!domains.has('air_quality'), 'air_quality not surfaced before any of its providers report');
});
