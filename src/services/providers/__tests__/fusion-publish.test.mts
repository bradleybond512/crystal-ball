import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordDomainObservations,
  getFusionProviderSnapshots,
  getLatestEarthquakeFusion,
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
  assert.equal(snaps.length, 2);
  const fps = new Set(snaps.map((s) => s.recentFactFingerprint));
  assert.equal(fps.size, 1, 'both providers share one fingerprint');

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
