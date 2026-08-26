import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { createEmergencyPackBrowserAdapters } from '../emergency-pack-browser';
import { createEmergencyPackOfflineMapLifecycle, createEmergencyPackOfflineMapTileResolver } from '../emergency-pack-runtime';
import { EMERGENCY_PACK_OPTIONAL_KINDS, EMERGENCY_PACK_REQUIRED_KINDS } from '../emergency-pack-schema';
import type { EmergencyPackArtifactKind } from '../emergency-pack-schema';
import { createEmergencyPackStore } from '../emergency-pack-store';

const NOW = Date.parse('2026-08-25T15:00:00.000Z');
const TILE_COUNT = 512;

class SyntheticStorage implements Storage {
  readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }

  clear(): void { this.values.clear(); }

  getItem(key: string): string | null { return this.values.get(key) ?? null; }

  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }

  removeItem(key: string): void { this.values.delete(key); }

  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class SyntheticCache {
  readonly entries = new Map<string, Response>();
  matchCalls = 0;

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(String(request), response.clone());
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    this.matchCalls += 1;
    return this.entries.get(String(request))?.clone();
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(String(request));
  }
}

class SyntheticCacheStorage {
  readonly caches = new Map<string, SyntheticCache>();

  async open(name: string): Promise<SyntheticCache> {
    const cache = this.caches.get(name) ?? new SyntheticCache();
    this.caches.set(name, cache);
    return cache;
  }
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? Infinity;
}

function distribution(values: readonly number[]) {
  return {
    min: Math.min(...values),
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

test('five-scope verified source index bounds cold and warm hit and miss paths', async () => {
  const cacheStorage = new SyntheticCacheStorage();
  const metadataStorage = new SyntheticStorage();
  const adapters = createEmergencyPackBrowserAdapters({ cacheStorage, metadataStorage });
  let digestCalls = 0;
  let packSequence = 0;
  const lifecycle = createEmergencyPackOfflineMapLifecycle(cacheStorage);
  const store = createEmergencyPackStore({
    ...adapters,
    digest: async (body) => {
      digestCalls += 1;
      return adapters.digest(body);
    },
    now: () => NOW,
    createPackId: () => `benchmark-pack-${packSequence += 1}`,
    verifyArtifactBody: lifecycle.verifyArtifactBody,
  });
  const tileBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const digestBuffer = await crypto.subtle.digest('SHA-256', tileBytes);
  const tileSha256 = [...new Uint8Array(digestBuffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const scopes = Array.from({ length: 5 }, (_, placeIndex) => ({
    placeId: `benchmark-place-${placeIndex}`,
    profileFingerprint: `benchmark-profile-${placeIndex}`,
    now: NOW,
  }));
  const mapCache = await cacheStorage.open('wm-offline-maps');
  let targetUrl = '';

  for (let placeIndex = 0; placeIndex < scopes.length; placeIndex += 1) {
    const scope = scopes[placeIndex]!;
    const generationId = `benchmark-generation-${placeIndex}`;
    const tiles = Array.from({ length: TILE_COUNT }, (_, tileIndex) => {
      const url = `https://a.basemaps.cartocdn.com/dark_all/12/${placeIndex * TILE_COUNT + tileIndex}/${placeIndex}@2x.png`;
      const cacheKey = `https://offline-map.crystalball.invalid/exact/${generationId}/${tileIndex}`;
      return { url, cacheKey, sha256: tileSha256, generationId, byteLength: tileBytes.byteLength, verified: true };
    });
    await Promise.all(tiles.map(({ cacheKey }) => mapCache.put(
      cacheKey,
      new Response(tileBytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } }),
    )));
    if (placeIndex === scopes.length - 1) targetUrl = tiles.at(-1)!.url;
    const offlineMapBody = JSON.stringify({
      kind: 'offline-map',
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
      capturedAt: NOW,
      generationId,
      tiles,
      totalBytes: tiles.length * tileBytes.byteLength,
    });
    const artifacts = EMERGENCY_PACK_REQUIRED_KINDS.map((kind: EmergencyPackArtifactKind) => ({
      kind,
      body: kind === 'offline-map'
        ? offlineMapBody
        : JSON.stringify({
          kind,
          placeId: scope.placeId,
          profileFingerprint: scope.profileFingerprint,
          capturedAt: NOW,
        }),
      capturedAt: NOW,
      expiresAt: NOW + 60 * 60_000,
      semanticState: 'verified' as const,
      summary: `${kind} benchmark evidence`,
      itemCount: 1,
    }));
    const committed = await store.commitGeneration({
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
      requiredKinds: EMERGENCY_PACK_REQUIRED_KINDS,
      optionalKinds: EMERGENCY_PACK_OPTIONAL_KINDS,
      artifacts,
    });
    assert.equal(committed.ok, true, JSON.stringify(committed));
  }

  let verifiedReads = 0;
  const makeResolver = () => createEmergencyPackOfflineMapTileResolver({
    getScopes: () => scopes,
    getScopeRevision: (scope) => store.readOfflineMapRevision(scope),
    readVerifiedOfflineMapArtifact: async (scope) => {
      verifiedReads += 1;
      return store.readVerifiedOfflineMapArtifact(scope);
    },
    openCache: (name) => cacheStorage.open(name),
  });
  const missUrl = 'https://a.basemaps.cartocdn.com/dark_all/12/4095/4095@2x.png';
  const measure = async (url: string, runs: number, cold: boolean): Promise<number[]> => {
    const shared = makeResolver();
    const samples: number[] = [];
    for (let index = 0; index < runs; index += 1) {
      const resolver = cold ? makeResolver() : shared;
      const startedAt = performance.now();
      await resolver(url);
      samples.push(performance.now() - startedAt);
    }
    return samples;
  };

  const coldHit = await measure(targetUrl, 7, true);
  const coldMiss = await measure(missUrl, 7, true);
  verifiedReads = 0;
  digestCalls = 0;
  const warmResolver = makeResolver();
  const primed = await warmResolver(targetUrl);
  assert.deepEqual(new Uint8Array(primed?.data ?? new ArrayBuffer(0)), tileBytes);
  const readsAfterPrime = verifiedReads;
  const digestsAfterPrime = digestCalls;
  const warmHit: number[] = [];
  const warmMiss: number[] = [];
  for (let index = 0; index < 21; index += 1) {
    let startedAt = performance.now();
    const hit = await warmResolver(targetUrl);
    warmHit.push(performance.now() - startedAt);
    assert.deepEqual(new Uint8Array(hit?.data ?? new ArrayBuffer(0)), tileBytes);
    startedAt = performance.now();
    assert.equal(await warmResolver(missUrl), null);
    warmMiss.push(performance.now() - startedAt);
  }
  assert.equal(readsAfterPrime, 5);
  assert.equal(verifiedReads, readsAfterPrime, 'warm requests must not re-read five verified artifacts');
  assert.equal(digestCalls, digestsAfterPrime, 'warm requests must not re-hash manifests or artifact bodies');

  const result = {
    coldHit: distribution(coldHit),
    coldMiss: distribution(coldMiss),
    warmHit: distribution(warmHit),
    warmMiss: distribution(warmMiss),
  };
  console.info('offline-map-five-scope-index-ms', result);
  assert.ok(result.coldHit.p95 < 300, `cold hit p95 ${result.coldHit.p95.toFixed(2)}ms exceeds 300ms`);
  assert.ok(result.coldMiss.p95 < 300, `cold miss p95 ${result.coldMiss.p95.toFixed(2)}ms exceeds 300ms`);
  assert.ok(result.warmHit.p95 < 100, `warm hit p95 ${result.warmHit.p95.toFixed(2)}ms exceeds 100ms`);
  assert.ok(result.warmMiss.p95 < 25, `warm miss p95 ${result.warmMiss.p95.toFixed(2)}ms exceeds 25ms`);
});
