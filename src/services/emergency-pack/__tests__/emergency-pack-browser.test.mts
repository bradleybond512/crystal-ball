import assert from 'node:assert/strict';
import test from 'node:test';

import { requireFunction } from './test-support.mts';

interface BrowserApi {
  createEmergencyPackBrowserAdapters?: (input: {
    cacheStorage: MemoryCacheStorage;
    metadataStorage: MemoryStorage;
    cacheName?: string;
  }) => {
    metadata: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
      removeItem: (key: string) => void;
      keys: () => string[];
    };
    bodies: {
      put: (key: string, body: string) => Promise<void>;
      get: (key: string) => Promise<string | null>;
      delete: (key: string) => Promise<void>;
    };
    digest: (body: string) => Promise<string>;
  };
}

class MemoryStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('metadata quota exceeded');
    this.values.set(key, value);
  }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

function requestKey(request: RequestInfo | URL): string {
  if (typeof request === 'string') return request;
  if (request instanceof URL) return request.href;
  return request.url;
}

class MemoryCache {
  readonly values = new Map<string, Response>();
  matchOverride: ((request: string) => Response | undefined) | null = null;

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.values.set(requestKey(request), response.clone());
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    if (this.matchOverride) return this.matchOverride(requestKey(request));
    return this.values.get(requestKey(request))?.clone();
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.values.delete(requestKey(request));
  }
}

class MemoryCacheStorage {
  readonly caches = new Map<string, MemoryCache>();
  failOpen = false;

  async open(name: string): Promise<MemoryCache> {
    if (this.failOpen) throw new Error('cache unavailable');
    const existing = this.caches.get(name);
    if (existing) return existing;
    const cache = new MemoryCache();
    this.caches.set(name, cache);
    return cache;
  }
}

const api = await import('../emergency-pack-browser.ts').catch(() => ({} as BrowserApi)) as BrowserApi;
const CONTACTS_KEY = 'wm-emergency-pack-v2:body:pack-1:contacts';

function controlledResponse(
  chunks: Uint8Array[],
  options: { contentLength?: string; failAt?: number } = {},
): { response: Response; cancelled: () => number } {
  let index = 0;
  let cancelCount = 0;
  const reader = {
    async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
      if (options.failAt === index) throw new Error('stream failed');
      const value = chunks[index];
      index += 1;
      return value ? { done: false, value } : { done: true, value: undefined };
    },
    async cancel(): Promise<void> {
      cancelCount += 1;
    },
    releaseLock(): void {},
  };
  const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength);
  return {
    response: {
      status: 200,
      headers,
      body: { getReader: () => reader },
    } as unknown as Response,
    cancelled: () => cancelCount,
  };
}

test('browser adapters preserve exact UTF-8 bodies and expose only their metadata namespace', async () => {
  const create = requireFunction(api, 'createEmergencyPackBrowserAdapters');
  const cacheStorage = new MemoryCacheStorage();
  const metadataStorage = new MemoryStorage();
  metadataStorage.setItem('unrelated-user-key', 'preserve me');
  const adapters = create({ cacheStorage, metadataStorage, cacheName: 'wm-emergency-pack-v2' });

  adapters.metadata.setItem('wm-emergency-pack-v2:manifest:pack-1', '{"ok":true}');
  adapters.metadata.setItem('wm-emergency-pack-v2:head:home', 'pack-1');
  await adapters.bodies.put(CONTACTS_KEY, 'Family: Jos\u00e9 \ud83d\udcf1');

  assert.equal(await adapters.bodies.get(CONTACTS_KEY), 'Family: Jos\u00e9 \ud83d\udcf1');
  assert.deepEqual(adapters.metadata.keys().sort(), [
    'wm-emergency-pack-v2:head:home',
    'wm-emergency-pack-v2:manifest:pack-1',
  ]);
  await adapters.bodies.delete(CONTACTS_KEY);
  assert.equal(await adapters.bodies.get(CONTACTS_KEY), null);
  assert.equal(metadataStorage.getItem('unrelated-user-key'), 'preserve me');
});

test('browser digest is exact SHA-256 and storage failures propagate instead of claiming persistence', async () => {
  const create = requireFunction(api, 'createEmergencyPackBrowserAdapters');
  const cacheStorage = new MemoryCacheStorage();
  const adapters = create({ cacheStorage, metadataStorage: new MemoryStorage() });
  assert.equal(
    await adapters.digest('Crystal Ball'),
    'a4a863612bd4ab69110ad39fa3f17693391c0f4b1b50ee21170e4e2ba07ab102',
  );

  cacheStorage.failOpen = true;
  await assert.rejects(() => adapters.bodies.put(CONTACTS_KEY, 'data'), /cache unavailable/);
  await assert.rejects(() => adapters.bodies.get(CONTACTS_KEY), /cache unavailable/);

  const metadataStorage = new MemoryStorage();
  const metadata = create({ cacheStorage: new MemoryCacheStorage(), metadataStorage }).metadata;
  metadataStorage.failWrites = true;
  assert.throws(() => metadata.setItem('wm-emergency-pack-v2:head:home', 'pack-1'), /metadata quota exceeded/);
});

test('browser body reads require an exact successful text response and declared byte length', async () => {
  const create = requireFunction(api, 'createEmergencyPackBrowserAdapters');
  const cacheStorage = new MemoryCacheStorage();
  const adapters = create({ cacheStorage, metadataStorage: new MemoryStorage() });
  const cache = await cacheStorage.open('wm-emergency-pack-v2');

  cache.matchOverride = () => new Response('ok', {
    status: 201,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
  await assert.rejects(() => adapters.bodies.get(CONTACTS_KEY), /invalid emergency pack body response/);

  cache.matchOverride = () => new Response('ok', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(() => adapters.bodies.get(CONTACTS_KEY), /invalid emergency pack body response/);

  cache.matchOverride = () => new Response('exact', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
  assert.equal(await adapters.bodies.get(CONTACTS_KEY), 'exact');

  const forged = controlledResponse([new TextEncoder().encode('exact')], { contentLength: '1' });
  cache.matchOverride = () => forged.response;
  await assert.rejects(() => adapters.bodies.get(CONTACTS_KEY), /body length mismatch/);
  assert.equal(forged.cancelled(), 1);
});

test('browser body reads cancel and fail closed on missing or forged length overflow and stream failure', async () => {
  const create = requireFunction(api, 'createEmergencyPackBrowserAdapters');
  const cacheStorage = new MemoryCacheStorage();
  const adapters = create({ cacheStorage, metadataStorage: new MemoryStorage() });
  const cache = await cacheStorage.open('wm-emergency-pack-v2');
  const oversized = new Uint8Array(128 * 1024 + 1);

  for (const contentLength of [undefined, '1']) {
    const candidate = controlledResponse([oversized], { contentLength });
    cache.matchOverride = () => candidate.response;
    await assert.rejects(() => adapters.bodies.get(CONTACTS_KEY), /body byte cap exceeded/);
    assert.equal(candidate.cancelled(), 1, contentLength ?? 'missing');
  }

  const failed = controlledResponse([new TextEncoder().encode('partial')], { failAt: 1 });
  cache.matchOverride = () => failed.response;
  await assert.rejects(() => adapters.bodies.get(CONTACTS_KEY), /body stream failed/);
  assert.equal(failed.cancelled(), 1);

  const invalidUtf8 = controlledResponse([Uint8Array.of(0xff)]);
  cache.matchOverride = () => invalidUtf8.response;
  await assert.rejects(() => adapters.bodies.get(CONTACTS_KEY), /body stream failed/);
  assert.equal(invalidUtf8.cancelled(), 1);

  const invalidLength = controlledResponse([new TextEncoder().encode('exact')], { contentLength: '01' });
  cache.matchOverride = () => invalidLength.response;
  await assert.rejects(() => adapters.bodies.get(CONTACTS_KEY), /body byte cap exceeded/);
  assert.equal(invalidLength.cancelled(), 1);

  await assert.rejects(
    () => adapters.bodies.put(CONTACTS_KEY, 'x'.repeat(128 * 1024 + 1)),
    /body byte cap exceeded/,
  );
});
