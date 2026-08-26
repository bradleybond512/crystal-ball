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
