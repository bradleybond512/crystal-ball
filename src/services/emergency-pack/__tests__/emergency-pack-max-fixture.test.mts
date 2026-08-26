import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { NOW, PLACE_ID, PROFILE, requireFunction } from './test-support.mts';

interface CaptureApi {
  validateEmergencyPackArtifact?: (input: {
    kind: string;
    placeId: string;
    profileFingerprint: string;
    byteLength: number;
    capturedAt: number;
    payload: unknown;
  }) => { ok: boolean };
}

const api = await import('../emergency-pack-capture.ts').catch(() => ({} as CaptureApi)) as CaptureApi;

test('documented maximum fixtures validate synchronously within a coarse renderer-safe budget', () => {
  const validate = requireFunction(api, 'validateEmergencyPackArtifact');
  const route = {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    from: { lat: 41.6111, lon: -86.7225 },
    to: { lat: 41.7, lon: -86.8 },
    geometry: {
      type: 'LineString',
      coordinates: Array.from({ length: 5_000 }, (_, index) => [
        -86.7225 - (0.0775 * index / 4_999),
        41.6111 + (0.0889 * index / 4_999),
      ]),
    },
    steps: Array.from({ length: 1_000 }, (_, index) => ({
      instruction: `Continue ${index}`,
      distanceKm: 0.01,
      durationMinutes: 0.01,
    })),
    cachedAt: NOW - 60_000,
  };
  const generationId = 'max-fixture';
  const map = {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    generationId,
    tiles: Array.from({ length: 512 }, (_, index) => ({
      url: `https://a.basemaps.cartocdn.com/dark_all/12/${index}/95@2x.png`,
      cacheKey: `https://offline-map.crystalball.invalid/exact/${generationId}/${index}`,
      sha256: index.toString(16).padStart(64, '0'),
      generationId,
      byteLength: 32_000,
      verified: true,
    })),
    totalBytes: 512 * 32_000,
  };
  const alerts = {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    alerts: Array.from({ length: 100 }, (_, index) => ({ id: `alert-${index}`, headline: 'Warning' })),
    sourceFetchedAt: NOW - 60_000,
  };

  const startedAt = performance.now();
  assert.equal(validate({
    kind: 'route-primary', placeId: PLACE_ID, profileFingerprint: PROFILE,
    byteLength: new TextEncoder().encode(JSON.stringify(route)).byteLength, capturedAt: NOW, payload: route,
  }).ok, true);
  assert.equal(validate({
    kind: 'offline-map', placeId: PLACE_ID, profileFingerprint: PROFILE,
    byteLength: new TextEncoder().encode(JSON.stringify(map)).byteLength, capturedAt: NOW, payload: map,
  }).ok, true);
  assert.equal(validate({
    kind: 'alerts', placeId: PLACE_ID, profileFingerprint: PROFILE,
    byteLength: new TextEncoder().encode(JSON.stringify(alerts)).byteLength, capturedAt: NOW, payload: alerts,
  }).ok, true);
  assert.ok(performance.now() - startedAt < 1_000, 'bounded fixtures should not consume a one-second renderer task');
});
