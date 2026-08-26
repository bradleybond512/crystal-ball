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

interface RuntimeApi {
  createEmergencyPackOfflineMapTileResolver?: (dependencies: Record<string, unknown>) => (
    url: string,
  ) => Promise<{ data: ArrayBuffer; contentType: string } | null>;
}

const api = await import('../emergency-pack-capture.ts').catch(() => ({} as CaptureApi)) as CaptureApi;
const runtimeApi = await import('../emergency-pack-runtime.ts').catch(() => ({} as RuntimeApi)) as RuntimeApi;

function percentile(values: readonly number[], value: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ?? Infinity;
}

test('documented maximum fixtures validate synchronously within a coarse renderer-safe budget', () => {
  const validate = requireFunction(api, 'validateEmergencyPackArtifact');
  const route = {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    capturedAt: NOW - 60_000,
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
    capturedAt: NOW,
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
    capturedAt: NOW - 60_000,
    alerts: Array.from({ length: 100 }, (_, index) => ({ id: `alert-${index}`, headline: 'Warning' })),
    sourceFetchedAt: NOW - 60_000,
  };

  const startedAt = performance.now();
  assert.equal(validate({
    kind: 'route-primary', placeId: PLACE_ID, profileFingerprint: PROFILE,
    byteLength: new TextEncoder().encode(JSON.stringify(route)).byteLength, capturedAt: NOW - 60_000, payload: route,
  }).ok, true);
  assert.equal(validate({
    kind: 'offline-map', placeId: PLACE_ID, profileFingerprint: PROFILE,
    byteLength: new TextEncoder().encode(JSON.stringify(map)).byteLength, capturedAt: NOW, payload: map,
  }).ok, true);
  assert.equal(validate({
    kind: 'alerts', placeId: PLACE_ID, profileFingerprint: PROFILE,
    byteLength: new TextEncoder().encode(JSON.stringify(alerts)).byteLength, capturedAt: NOW - 60_000, payload: alerts,
  }).ok, true);
  assert.ok(performance.now() - startedAt < 1_000, 'bounded fixtures should not consume a one-second renderer task');
});

test('maximum offline generation cold and warm tile reads stay within the renderer-safe budget', async () => {
  const create = requireFunction(runtimeApi, 'createEmergencyPackOfflineMapTileResolver');
  const generationId = 'max-runtime-fixture';
  const tileBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const digestBuffer = await crypto.subtle.digest('SHA-256', tileBytes);
  const sha256 = [...new Uint8Array(digestBuffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const tiles = Array.from({ length: 512 }, (_, index) => ({
    url: `https://a.basemaps.cartocdn.com/dark_all/12/${index}/95@2x.png`,
    cacheKey: `https://offline-map.crystalball.invalid/exact/${generationId}/${index}`,
    sha256,
    generationId,
    byteLength: tileBytes.byteLength,
    verified: true,
  }));
  const body = JSON.stringify({
    kind: 'offline-map',
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    generationId,
    tiles,
    totalBytes: tiles.length * tileBytes.byteLength,
  });
  const target = tiles.at(-1)!;
  const cache = {
    put: async () => undefined,
    delete: async () => true,
    match: async (key: RequestInfo | URL) => String(key) === target.cacheKey
      ? new Response(tileBytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } })
      : undefined,
  };
  const makeResolver = () => create({
    getScopes: () => [{ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }],
    readVerifiedOfflineMapArtifact: async () => body,
    openCache: async () => cache,
  });
  const measure = async (runs: number, cold: boolean): Promise<number[]> => {
    const shared = makeResolver();
    const samples: number[] = [];
    for (let index = 0; index < runs; index++) {
      const resolver = cold ? makeResolver() : shared;
      const startedAt = performance.now();
      const resolved = await resolver(target.url);
      samples.push(performance.now() - startedAt);
      assert.deepEqual(new Uint8Array(resolved?.data ?? new ArrayBuffer(0)), tileBytes);
    }
    return samples;
  };
  const cold = await measure(7, true);
  const warm = await measure(21, false);
  const distribution = {
    cold: { min: Math.min(...cold), median: percentile(cold, 0.5), p95: percentile(cold, 0.95), max: Math.max(...cold) },
    warm: { min: Math.min(...warm), median: percentile(warm, 0.5), p95: percentile(warm, 0.95), max: Math.max(...warm) },
  };
  console.info('offline-map-max-fixture-ms', distribution);
  assert.ok(distribution.cold.p95 < 250, `cold p95 ${distribution.cold.p95.toFixed(2)}ms exceeds 250ms`);
  assert.ok(distribution.warm.p95 < 100, `warm p95 ${distribution.warm.p95.toFixed(2)}ms exceeds 100ms`);
});
