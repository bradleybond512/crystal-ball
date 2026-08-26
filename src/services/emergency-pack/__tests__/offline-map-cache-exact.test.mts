import assert from 'node:assert/strict';
import test from 'node:test';

interface ExactTile {
  url: string;
  byteLength: number;
  verified: true;
}

interface OfflineMapApi {
  captureOfflineMapTilesExact?: (input: {
    tileUrls: string[];
    cache: ExactCache;
    fetchTile: (url: string) => Promise<Response>;
    concurrency?: number;
  }) => Promise<{
    ok: boolean;
    total: number;
    downloaded: number;
    totalBytes: number;
    tiles: ExactTile[];
    reason?: string;
  }>;
  validateOfflineMapCaptureBounds?: (tiles: Array<{ url: string; byteLength: number; verified: boolean }>) => {
    ok: boolean;
    reason?: string;
  };
  planOfflineMapTileCleanup?: (
    targetRegionId: string,
    regions: Array<{ id: string; tileUrls: string[] }>,
  ) => { deleteUrls: string[]; remainingRegionIds: string[] };
}

function requestKey(request: RequestInfo | URL): string {
  if (typeof request === 'string') return request;
  if (request instanceof URL) return request.href;
  return request.url;
}

class ExactCache {
  readonly values = new Map<string, Uint8Array>();
  drop = new Set<string>();
  corrupt = new Set<string>();

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const key = requestKey(request);
    if (this.drop.has(key)) return;
    this.values.set(key, new Uint8Array(await response.arrayBuffer()));
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const key = requestKey(request);
    const stored = this.values.get(key);
    if (!stored) return undefined;
    const bytes = this.corrupt.has(key)
      ? new Uint8Array([...stored, 0xff])
      : stored;
    return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } });
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.values.delete(requestKey(request));
  }
}

const api = await import('../../offline-map-cache.ts').catch(() => ({} as OfflineMapApi)) as OfflineMapApi;

function requireFunction<K extends keyof OfflineMapApi>(name: K): NonNullable<OfflineMapApi[K]> {
  const value = api[name];
  assert.equal(typeof value, 'function', `${String(name)} should be exported`);
  return value as NonNullable<OfflineMapApi[K]>;
}

function tileUrls(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `https://a.basemaps.cartocdn.com/dark_all/12/${index}/95@2x.png`);
}

test('exact tile capture never exceeds four concurrent fetches and verifies every CacheStorage readback', async () => {
  const capture = requireFunction('captureOfflineMapTilesExact');
  let active = 0;
  let maximumActive = 0;
  const result = await capture({
    tileUrls: tileUrls(12),
    cache: new ExactCache(),
    concurrency: 4,
    fetchTile: async (url) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 4));
      active -= 1;
      return new Response(`tile:${url}`, { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.total, 12);
  assert.equal(result.downloaded, 12);
  assert.equal(result.tiles.length, 12);
  assert.ok(maximumActive > 1, 'capture should use bounded concurrency');
  assert.ok(maximumActive <= 4, 'capture must never exceed four in-flight tiles');
  assert.ok(result.tiles.every((tile) => tile.verified && tile.byteLength > 0));
});

test('failed, dropped, or corrupt tiles never inflate success or publish a complete region', async () => {
  const capture = requireFunction('captureOfflineMapTilesExact');
  const urls = tileUrls(5);
  const cache = new ExactCache();
  cache.drop.add(urls[2]!);
  cache.corrupt.add(urls[3]!);
  const result = await capture({
    tileUrls: urls,
    cache,
    fetchTile: async (url) => {
      if (url === urls[1]) return new Response('failed', { status: 503 });
      return new Response(`tile:${url}`, { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.total, 5);
  assert.equal(result.downloaded, 2);
  assert.equal(result.tiles.length, 2);
  assert.equal(result.reason, 'tile-verification-incomplete');
  assert.equal(result.totalBytes, result.tiles.reduce((sum, tile) => sum + tile.byteLength, 0));
});

test('tile count, per-tile bytes, and total bytes fail closed at 512, 1 MiB, and 50 MiB', () => {
  const validate = requireFunction('validateOfflineMapCaptureBounds');
  const tile = (index: number, byteLength: number) => ({
    url: `https://tiles.example/${index}.png`, byteLength, verified: true,
  });

  assert.deepEqual(validate(Array.from({ length: 513 }, (_, index) => tile(index, 1))), {
    ok: false, reason: 'tile-count-limit',
  });
  assert.deepEqual(validate([tile(1, 1024 * 1024 + 1)]), {
    ok: false, reason: 'tile-size-limit',
  });
  assert.deepEqual(validate(Array.from({ length: 51 }, (_, index) => tile(index, 1024 * 1024))), {
    ok: false, reason: 'total-size-limit',
  });
  assert.deepEqual(validate(Array.from({ length: 50 }, (_, index) => tile(index, 1024 * 1024))), { ok: true });
});

test('overlapping-region cleanup deletes only tiles no remaining region references', () => {
  const plan = requireFunction('planOfflineMapTileCleanup');
  assert.deepEqual(plan('home', [
    { id: 'home', tileUrls: ['tile:a', 'tile:shared', 'tile:also-shared'] },
    { id: 'work', tileUrls: ['tile:shared', 'tile:work'] },
    { id: 'family', tileUrls: ['tile:also-shared'] },
  ]), {
    deleteUrls: ['tile:a'],
    remainingRegionIds: ['work', 'family'],
  });
});
