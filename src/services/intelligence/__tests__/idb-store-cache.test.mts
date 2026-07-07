import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

// localStorage shim (node has none). Backed by a plain Map.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

const {
  preloadIdbBackedStores, installIdbStorageRouting, IDB_BACKED_STORE_KEYS,
  _resetIdbStoreCacheForTest, _mirrorGetForTest,
} = await import('../idb-store-cache.ts');

// A representative IDB-backed key and a non-backed one.
const BACKED = 'wm-safety-case';
const PLAIN = 'wm-basemap';

beforeEach(() => {
  store.clear();
  _resetIdbStoreCacheForTest();
  // Restore the shim's own methods (routing patches them in place).
  (globalThis as unknown as { localStorage: Storage }).localStorage.getItem = (k: string) => (store.has(k) ? store.get(k)! : null);
  (globalThis as unknown as { localStorage: Storage }).localStorage.setItem = (k: string, v: string) => { store.set(k, v); };
  (globalThis as unknown as { localStorage: Storage }).localStorage.removeItem = (k: string) => { store.delete(k); };
});

describe('idb-store-cache — key set', () => {
  it('backs the large reasoning stores, never precious config keys', () => {
    assert.ok(IDB_BACKED_STORE_KEYS.includes('wm-safety-case'));
    assert.ok(IDB_BACKED_STORE_KEYS.includes('wm-cognitive-bias-detections'));
    for (const precious of ['wm-basemap', 'wm_saved_places_v1', 'wm-country-watchlist-v1']) {
      assert.ok(!IDB_BACKED_STORE_KEYS.includes(precious), `${precious} must stay in localStorage`);
    }
  });
});

describe('preloadIdbBackedStores — migration', () => {
  it('adopts a localStorage copy into the mirror and frees the localStorage slot', async () => {
    store.set(BACKED, 'SITUATION-DATA');
    await preloadIdbBackedStores();
    // Mirror now holds it…
    assert.equal(_mirrorGetForTest(BACKED), 'SITUATION-DATA');
    // …and the localStorage slot is freed (before routing patches getItem).
    assert.equal(store.has(BACKED), false);
  });

  it('is idempotent + concurrency-safe (one preload)', async () => {
    store.set(BACKED, 'A');
    await Promise.all([preloadIdbBackedStores(), preloadIdbBackedStores()]);
    assert.equal(_mirrorGetForTest(BACKED), 'A');
  });
});

describe('installIdbStorageRouting', () => {
  it('routes backed-key reads/writes to the mirror, leaving localStorage untouched', async () => {
    store.set(BACKED, 'ORIG');
    await preloadIdbBackedStores();
    installIdbStorageRouting();

    // Read comes from the mirror.
    assert.equal(localStorage.getItem(BACKED), 'ORIG');
    // Write updates the mirror, NOT native localStorage (no quota consumed).
    localStorage.setItem(BACKED, 'UPDATED');
    assert.equal(localStorage.getItem(BACKED), 'UPDATED');
    assert.equal(store.has(BACKED), false);
    // Remove clears the mirror.
    localStorage.removeItem(BACKED);
    assert.equal(localStorage.getItem(BACKED), null);
  });

  it('passes non-backed keys straight through to localStorage', async () => {
    await preloadIdbBackedStores();
    installIdbStorageRouting();

    localStorage.setItem(PLAIN, 'satellite');
    assert.equal(localStorage.getItem(PLAIN), 'satellite');
    assert.equal(store.get(PLAIN), 'satellite'); // really in native localStorage
    localStorage.removeItem(PLAIN);
    assert.equal(store.has(PLAIN), false);
  });

  it('is idempotent (double install is a no-op)', async () => {
    await preloadIdbBackedStores();
    installIdbStorageRouting();
    installIdbStorageRouting();
    localStorage.setItem(BACKED, 'X');
    assert.equal(localStorage.getItem(BACKED), 'X');
  });
});
