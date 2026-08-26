import assert from 'node:assert/strict';
import test from 'node:test';

interface ExactTile {
  url: string;
  cacheKey: string;
  sha256: string;
  generationId: string;
  byteLength: number;
  verified: true;
}

interface CleanupCoordinator {
  prepareCapture(cache: ExactCache): Promise<{ ok: boolean; reason?: string }>;
  stageGeneration(generationId: string, cacheKeys: string[]): void;
  adoptGeneration(generationId: string, cacheKeys: string[]): void;
}

interface OfflineMapApi {
  captureOfflineMapTilesExact?: (input: {
    generationId: string;
    tileUrls: string[];
    cache: ExactCache;
    cleanup: CleanupCoordinator;
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
  verifyOfflineMapGenerationExact?: (input: {
    generationId: string;
    tiles: ExactTile[];
    cache: ExactCache;
  }) => Promise<{ ok: boolean; reason?: string }>;
  deleteOfflineMapGenerationExact?: (input: {
    generationId: string;
    tiles: ExactTile[];
    retainedCacheKeys?: string[];
    cache: ExactCache;
    cleanup: CleanupCoordinator;
  }) => Promise<{ ok: boolean; deleted: number; retained: number; reason?: string }>;
  createExactOfflineMapCleanupCoordinator?: (input: {
    metadata: MemoryMetadata;
  }) => CleanupCoordinator;
  validateOfflineMapCaptureBounds?: (tiles: Array<{ url: string; byteLength: number; verified: boolean }>) => {
    ok: boolean;
    reason?: string;
  };
  planOfflineMapTileCleanup?: (
    targetRegionId: string,
    regions: Array<{ id: string; tileUrls: string[] }>,
  ) => { deleteUrls: string[]; remainingRegionIds: string[] };
  planOfflineMapTileUrls?: (
    lat: number,
    lon: number,
    radiusKm: number,
    zoomLevels?: number[],
  ) => { ok: boolean; tileUrls: string[]; reason?: string };
  deleteRegion?: (id: string) => Promise<void>;
}

function requestKey(request: RequestInfo | URL): string {
  if (typeof request === 'string') return request;
  if (request instanceof URL) return request.href;
  return request.url;
}

class ExactCache {
  readonly values = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  drop = new Set<string>();
  corrupt = new Set<string>();
  failDelete = new Set<string>();

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
      ? new Uint8Array(stored.map((value, index) => index === 0 ? value ^ 0xff : value))
      : stored;
    return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } });
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    const key = requestKey(request);
    this.deleted.push(key);
    if (this.failDelete.has(key)) return false;
    return this.values.delete(key);
  }
}

class MemoryMetadata {
  readonly values = new Map<string, string>();
  failSet = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error('metadata unavailable');
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
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

function exactCacheKey(generationId: string, index: number): string {
  return `https://offline-map.crystalball.invalid/exact/${encodeURIComponent(generationId)}/${index}`;
}

function cleanupCoordinator(metadata = new MemoryMetadata()): CleanupCoordinator {
  const create = requireFunction('createExactOfflineMapCleanupCoordinator');
  return create({ metadata });
}

test('exact tile capture never exceeds four concurrent fetches and verifies every CacheStorage readback', async () => {
  const capture = requireFunction('captureOfflineMapTilesExact');
  let active = 0;
  let maximumActive = 0;
  const result = await capture({
    generationId: 'generation-concurrency',
    tileUrls: tileUrls(12),
    cache: new ExactCache(),
    cleanup: cleanupCoordinator(),
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
  cache.drop.add(exactCacheKey('generation-incomplete', 2));
  cache.corrupt.add(exactCacheKey('generation-incomplete', 3));
  const result = await capture({
    generationId: 'generation-incomplete',
    tileUrls: urls,
    cache,
    cleanup: cleanupCoordinator(),
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

test('oversized streamed response is cancelled before unbounded buffering and leaves no staged tile', async () => {
  const capture = requireFunction('captureOfflineMapTilesExact');
  const cache = new ExactCache();
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(64 * 1024));
      if (pulls > 20) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(body, { status: 200, headers: { 'content-type': 'image/png' } });
  Object.defineProperty(response, 'arrayBuffer', {
    value: () => { throw new Error('unbounded arrayBuffer must not be used'); },
  });

  const result = await capture({
    generationId: 'generation-stream-cap',
    tileUrls: tileUrls(1),
    cache,
    cleanup: cleanupCoordinator(),
    fetchTile: async () => response,
  });

  assert.equal(result.ok, false);
  assert.equal(result.downloaded, 0);
  assert.equal(result.reason, 'tile-verification-incomplete');
  assert.equal(cancelled, true);
  assert.equal(pulls <= 18, true, 'reader must stop as soon as 1 MiB is exceeded');
  assert.equal(cache.values.size, 0);
});

test('successful capture stores immutable generation-scoped keys and SHA-256 evidence', async () => {
  const capture = requireFunction('captureOfflineMapTilesExact');
  const verify = requireFunction('verifyOfflineMapGenerationExact');
  const cache = new ExactCache();
  const metadata = new MemoryMetadata();
  const cleanup = cleanupCoordinator(metadata);
  const result = await capture({
    generationId: 'pack candidate / home',
    tileUrls: tileUrls(2),
    cache,
    cleanup,
    fetchTile: async (url) => new Response(`tile:${url}`, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.tiles.length, 2);
  assert.ok(result.tiles.every((tile) => (
    tile.generationId === 'pack candidate / home'
    && tile.cacheKey !== tile.url
    && tile.cacheKey.startsWith('https://offline-map.crystalball.invalid/exact/')
    && /^[a-f0-9]{64}$/.test(tile.sha256)
    && cache.values.has(tile.cacheKey)
    && !cache.values.has(tile.url)
  )));
  assert.deepEqual(await verify({
    generationId: 'pack candidate / home',
    tiles: result.tiles,
    cache,
  }), { ok: true });
  assert.equal(metadata.values.size, 1, 'provisional ownership must remain durable until adoption');
  let overlappingFetches = 0;
  const overlapping = await capture({
    generationId: 'overlapping-generation',
    tileUrls: tileUrls(1),
    cache,
    cleanup,
    fetchTile: async () => {
      overlappingFetches += 1;
      return new Response('overlap', { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });
  assert.equal(overlapping.reason, 'generation-cleanup-pending');
  assert.equal(overlappingFetches, 0);
  cleanup.adoptGeneration('pack candidate / home', result.tiles.map(({ cacheKey }) => cacheKey));
  assert.equal(metadata.values.size, 0, 'durable pack ownership may clear its matching tombstone');
  assert.doesNotThrow(() => cleanup.adoptGeneration(
    'pack candidate / home',
    result.tiles.map(({ cacheKey }) => cacheKey),
  ), 'later verified reads must treat an already adopted generation as owned');

  cache.corrupt.add(result.tiles[0]!.cacheKey);
  assert.deepEqual(await verify({
    generationId: 'pack candidate / home',
    tiles: result.tiles,
    cache,
  }), { ok: false, reason: 'tile-readback-mismatch' });
});

test('cleanup tombstones reject extra fields and more than 512 allowlisted generation keys', async () => {
  const capture = requireFunction('captureOfflineMapTilesExact');
  const metadata = new MemoryMetadata();
  const cache = new ExactCache();
  const cleanup = cleanupCoordinator(metadata);
  assert.throws(() => cleanup.stageGeneration(
    'generation-too-large',
    Array.from({ length: 513 }, (_, index) => exactCacheKey('generation-too-large', index)),
  ), /tombstone invalid/i);
  assert.equal(metadata.values.size, 0);

  const captured = await capture({
    generationId: 'generation-strict-tombstone',
    tileUrls: tileUrls(1),
    cache,
    cleanup,
    fetchTile: async (url) => new Response(`tile:${url}`, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  });
  assert.equal(captured.ok, true);
  const [key, encoded] = [...metadata.values.entries()][0]!;
  metadata.values.set(key, JSON.stringify({ ...JSON.parse(encoded), extra: true }));
  let fetches = 0;
  const refused = await capture({
    generationId: 'generation-after-malformed',
    tileUrls: tileUrls(1),
    cache,
    cleanup: cleanupCoordinator(metadata),
    fetchTile: async () => {
      fetches += 1;
      return new Response('bad', { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });
  assert.equal(refused.reason, 'cleanup-tombstone-invalid');
  assert.equal(fetches, 0);
});

test('persistent cleanup failure survives restart and refuses a second capture until drain succeeds', async () => {
  const capture = requireFunction('captureOfflineMapTilesExact');
  const metadata = new MemoryMetadata();
  const cache = new ExactCache();
  const failedKey = exactCacheKey('generation-persistent-cleanup', 0);
  cache.corrupt.add(failedKey);
  cache.failDelete.add(failedKey);

  const failed = await capture({
    generationId: 'generation-persistent-cleanup',
    tileUrls: tileUrls(1),
    cache,
    cleanup: cleanupCoordinator(metadata),
    fetchTile: async (url) => new Response(`tile:${url}`, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'generation-cleanup-pending');
  assert.equal(metadata.values.size, 1);
  const encoded = [...metadata.values.values()][0]!;
  assert.deepEqual(JSON.parse(encoded), {
    schemaVersion: 1,
    generationId: 'generation-persistent-cleanup',
    cacheKeys: [failedKey],
  });

  let secondFetches = 0;
  const refused = await capture({
    generationId: 'generation-refused',
    tileUrls: tileUrls(1),
    cache,
    cleanup: cleanupCoordinator(metadata),
    fetchTile: async () => {
      secondFetches += 1;
      return new Response('second', { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'generation-cleanup-pending');
  assert.equal(secondFetches, 0);
  assert.equal(cache.values.size, 1, 'a refused capture must not accumulate another generation');

  cache.failDelete.clear();
  cache.corrupt.clear();
  const restarted = cleanupCoordinator(metadata);
  const recovered = await capture({
    generationId: 'generation-after-drain',
    tileUrls: tileUrls(1),
    cache,
    cleanup: restarted,
    fetchTile: async (url) => new Response(`tile:${url}`, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  });
  assert.equal(recovered.ok, true);
  assert.equal(cache.values.has(failedKey), false);
  restarted.adoptGeneration('generation-after-drain', recovered.tiles.map(({ cacheKey }) => cacheKey));
  assert.equal(metadata.values.size, 0);
});

test('tombstone persistence failure aborts release before generation ownership can be discarded', async () => {
  const capture = requireFunction('captureOfflineMapTilesExact');
  const remove = requireFunction('deleteOfflineMapGenerationExact');
  const metadata = new MemoryMetadata();
  const cleanup = cleanupCoordinator(metadata);
  const cache = new ExactCache();
  const captured = await capture({
    generationId: 'generation-retained-body',
    tileUrls: tileUrls(1),
    cache,
    cleanup,
    fetchTile: async (url) => new Response(`tile:${url}`, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  });
  assert.equal(captured.ok, true);
  cleanup.adoptGeneration('generation-retained-body', captured.tiles.map(({ cacheKey }) => cacheKey));
  metadata.failSet = true;

  await assert.rejects(remove({
    generationId: 'generation-retained-body',
    tiles: captured.tiles,
    cache,
    cleanup,
  }), /tombstone/i);
  assert.equal(cache.values.has(captured.tiles[0]!.cacheKey), true);
});

test('failed capture deletes every staged generation key without deleting a colliding prior generation', async () => {
  const capture = requireFunction('captureOfflineMapTilesExact');
  const cache = new ExactCache();
  const cleanup = cleanupCoordinator();
  const first = await capture({
    generationId: 'generation-collision',
    tileUrls: tileUrls(1),
    cache,
    cleanup,
    fetchTile: async (url) => new Response(`tile:${url}`, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  });
  assert.equal(first.ok, true);
  cleanup.adoptGeneration('generation-collision', first.tiles.map(({ cacheKey }) => cacheKey));
  const retainedKey = first.tiles[0]!.cacheKey;
  const retainedBytes = cache.values.get(retainedKey);

  const collision = await capture({
    generationId: 'generation-collision',
    tileUrls: tileUrls(1),
    cache,
    cleanup,
    fetchTile: async () => new Response('replacement', {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  });
  assert.equal(collision.ok, false);
  assert.equal(collision.reason, 'generation-collision');
  assert.deepEqual(cache.values.get(retainedKey), retainedBytes);
  assert.equal(cache.deleted.includes(retainedKey), false);

  const incomplete = await capture({
    generationId: 'generation-cleanup',
    tileUrls: tileUrls(2),
    cache,
    cleanup,
    fetchTile: async (url) => url === tileUrls(2)[1]
      ? new Response('no', { status: 503 })
      : new Response(`tile:${url}`, { status: 200, headers: { 'content-type': 'image/png' } }),
  });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.reason, 'tile-verification-incomplete');
  assert.equal(cache.values.size, 1, 'only the prior successful generation may remain');
});

test('generation deletion removes only owned unretained keys and fails closed on foreign keys', async () => {
  const capture = requireFunction('captureOfflineMapTilesExact');
  const remove = requireFunction('deleteOfflineMapGenerationExact');
  const cache = new ExactCache();
  const cleanup = cleanupCoordinator();
  const result = await capture({
    generationId: 'generation-prune',
    tileUrls: tileUrls(2),
    cache,
    cleanup,
    fetchTile: async (url) => new Response(`tile:${url}`, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  });
  assert.equal(result.ok, true);
  cleanup.adoptGeneration('generation-prune', result.tiles.map(({ cacheKey }) => cacheKey));

  assert.deepEqual(await remove({
    generationId: 'generation-prune',
    tiles: result.tiles,
    retainedCacheKeys: [result.tiles[1]!.cacheKey],
    cache,
    cleanup,
  }), { ok: true, deleted: 1, retained: 1 });
  assert.equal(cache.values.has(result.tiles[0]!.cacheKey), false);
  assert.equal(cache.values.has(result.tiles[1]!.cacheKey), true);

  const foreign = { ...result.tiles[1]!, cacheKey: 'https://offline-map.crystalball.invalid/exact/foreign/0' };
  assert.deepEqual(await remove({
    generationId: 'generation-prune',
    tiles: [foreign],
    cache,
    cleanup,
  }), { ok: false, deleted: 0, retained: 0, reason: 'generation-key-mismatch' });
  assert.equal(cache.values.has(result.tiles[1]!.cacheKey), true);
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

test('tile planning returns bounded unique HTTPS URLs and handles both sides of the dateline', () => {
  const plan = requireFunction('planOfflineMapTileUrls');
  const result = plan(0, 179.9, 100, [8, 8]);

  assert.equal(result.ok, true);
  assert.ok(result.tileUrls.length > 0 && result.tileUrls.length <= 512);
  assert.equal(new Set(result.tileUrls).size, result.tileUrls.length);
  assert.ok(result.tileUrls.every((value) => new URL(value).protocol === 'https:'));
  const xCoordinates = result.tileUrls.map((value) => Number(new URL(value).pathname.split('/')[3]));
  assert.ok(xCoordinates.includes(0), 'eastward wrap must include the western edge');
  assert.ok(xCoordinates.includes(255), 'eastward wrap must include the eastern edge');
});

test('tile planning fails closed before capture when a valid region exceeds 512 tiles', () => {
  const plan = requireFunction('planOfflineMapTileUrls');
  assert.deepEqual(plan(0, 0, 100, [14]), {
    ok: false,
    tileUrls: [],
    reason: 'tile-count-limit',
  });
});

test('tile planning enforces finite Web Mercator coordinates, radius bounds, and integer zoom allowlists', () => {
  const plan = requireFunction('planOfflineMapTileUrls');
  for (const [lat, lon, radiusKm, zoomLevels] of [
    [Number.NaN, 0, 25, [8]],
    [85.05112879, 0, 25, [8]],
    [0, 180.0001, 25, [8]],
    [0, 0, 0, [8]],
    [0, 0, 100.0001, [8]],
    [0, 0, 25, []],
    [0, 0, 25, [-1]],
    [0, 0, 25, [23]],
    [0, 0, 25, [8.5]],
  ] as Array<[number, number, number, number[]]>) {
    assert.deepEqual(plan(lat, lon, radiusKm, zoomLevels), {
      ok: false,
      tileUrls: [],
      reason: 'tile-region-invalid',
    });
  }

  assert.equal(plan(-85.05112878, -180, 100, [0]).ok, true);
  assert.equal(plan(85.05112878, 180, 100, [0, 22]).reason, 'tile-count-limit');
});

test('legacy deleteRegion keeps tiles shared by an overlapping retained region', async () => {
  const deleteRegion = requireFunction('deleteRegion');
  const regions = [
    {
      id: 'home', label: 'Home', lat: 41.6111, lon: -86.7225, radiusKm: 25,
      zoomLevels: [4, 6], tileCount: 8, sizeMB: 1, cachedAt: 1,
    },
    {
      id: 'work', label: 'Work', lat: 41.6111, lon: -86.7225, radiusKm: 25,
      zoomLevels: [4, 6], tileCount: 8, sizeMB: 1, cachedAt: 2,
    },
  ];
  const values = new Map([['wm-offline-map-regions', JSON.stringify(regions)]]);
  const deleted: string[] = [];
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      open: async () => ({
        delete: async (request: Request) => { deleted.push(request.url); return true; },
      }),
    },
  });

  try {
    await deleteRegion('home');
    assert.deepEqual(deleted, []);
    assert.deepEqual(JSON.parse(values.get('wm-offline-map-regions') ?? '[]'), [regions[1]]);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else Reflect.deleteProperty(globalThis, 'caches');
  }
});
