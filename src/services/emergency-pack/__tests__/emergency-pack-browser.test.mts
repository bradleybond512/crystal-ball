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

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.values.set(requestKey(request), response.clone());
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
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

test('browser adapters preserve exact UTF-8 bodies and expose only their metadata namespace', async () => {
  const create = requireFunction(api, 'createEmergencyPackBrowserAdapters');
  const cacheStorage = new MemoryCacheStorage();
  const metadataStorage = new MemoryStorage();
  metadataStorage.setItem('unrelated-user-key', 'preserve me');
  const adapters = create({ cacheStorage, metadataStorage, cacheName: 'wm-emergency-pack-v2' });

  adapters.metadata.setItem('wm-emergency-pack-v2:manifest:pack-1', '{"ok":true}');
  adapters.metadata.setItem('wm-emergency-pack-v2:head:home', 'pack-1');
  await adapters.bodies.put('wm-emergency-pack:pack-1:contacts', 'Family: Jos\u00e9 \ud83d\udcf1');

  assert.equal(await adapters.bodies.get('wm-emergency-pack:pack-1:contacts'), 'Family: Jos\u00e9 \ud83d\udcf1');
  assert.deepEqual(adapters.metadata.keys().sort(), [
    'wm-emergency-pack-v2:head:home',
    'wm-emergency-pack-v2:manifest:pack-1',
  ]);
  await adapters.bodies.delete('wm-emergency-pack:pack-1:contacts');
  assert.equal(await adapters.bodies.get('wm-emergency-pack:pack-1:contacts'), null);
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
  await assert.rejects(() => adapters.bodies.put('pack/body', 'data'), /cache unavailable/);
  await assert.rejects(() => adapters.bodies.get('pack/body'), /cache unavailable/);

  const metadataStorage = new MemoryStorage();
  const metadata = create({ cacheStorage: new MemoryCacheStorage(), metadataStorage }).metadata;
  metadataStorage.failWrites = true;
  assert.throws(() => metadata.setItem('wm-emergency-pack-v2:head:home', 'pack-1'), /metadata quota exceeded/);
});
