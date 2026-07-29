import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUSION_DOMAINS, fusionConfigFor } from '../provider-domain-map.ts';
import { getProviderDefinition } from '../provider-registry.ts';

test('earthquakes domain maps to USGS + EMSC + GEOFON', () => {
  const cfg = fusionConfigFor('earthquakes');
  assert.ok(cfg, 'earthquakes config must exist');
  assert.deepEqual([...cfg!.providerIds].sort(), ['emsc-seismic', 'geofon-seismic', 'usgs-earthquakes']);
  assert.equal(cfg!.numericTolerance, 0.5);
  assert.equal(cfg!.match.maxDistanceKm, 50);
  assert.equal(cfg!.match.maxTimeDeltaMs, 120_000);
});

test('unknown fact-type returns undefined', () => {
  assert.equal(fusionConfigFor('nope'), undefined);
});

test('every fusion-domain provider id is registered', () => {
  for (const cfg of Object.values(FUSION_DOMAINS)) {
    for (const id of cfg.providerIds) {
      assert.ok(getProviderDefinition(id), `${id} must be in the provider registry`);
    }
  }
});
