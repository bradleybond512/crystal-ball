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
  preloadIdbBackedStores, installIdbStorageRouting, getIdbBackedStorage, IDB_BACKED_STORE_KEYS,
  _resetIdbStoreCacheForTest, _mirrorGetForTest, _setMemoryBackendForTest,
  _flushPendingForTest,
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
  it('adopts a localStorage copy into the mirror', async () => {
    store.set(BACKED, 'SITUATION-DATA');
    await preloadIdbBackedStores();
    assert.equal(_mirrorGetForTest(BACKED), 'SITUATION-DATA');
  });

  it('preserves the localStorage copy when the IDB write fails (P1 fallback)', async () => {
    // node has no IndexedDB, so putMemory fails → the durable localStorage copy
    // MUST NOT be deleted (else the only copy is lost across restart).
    store.set(BACKED, 'DURABLE');
    await preloadIdbBackedStores();
    assert.equal(store.get(BACKED), 'DURABLE');
  });

  it('is idempotent + concurrency-safe (one preload)', async () => {
    store.set(BACKED, 'A');
    await Promise.all([preloadIdbBackedStores(), preloadIdbBackedStores()]);
    assert.equal(_mirrorGetForTest(BACKED), 'A');
  });
});

describe('installIdbStorageRouting', () => {
  it('routes backed-key reads/writes through the mirror, not native localStorage', async () => {
    store.set(BACKED, 'ORIG');
    await preloadIdbBackedStores();
    installIdbStorageRouting();

    // Read comes from the mirror.
    assert.equal(localStorage.getItem(BACKED), 'ORIG');
    // Write updates the mirror and is reflected on read…
    localStorage.setItem(BACKED, 'UPDATED');
    assert.equal(localStorage.getItem(BACKED), 'UPDATED');
    // …but the routed write never lands the NEW value in native localStorage.
    assert.notEqual(store.get(BACKED), 'UPDATED');
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

  it('patches Storage.prototype, not the instance, for a real Storage-like (WKWebView fix)', async () => {
    // WKWebView's localStorage is an exotic object: `localStorage.setItem = fn`
    // on the INSTANCE is silently inert, so routing must patch the prototype.
    const backing = new Map<string, string>();
    class FakeStorage {
      getItem(k: string): string | null { return backing.has(k) ? backing.get(k)! : null; }
      setItem(k: string, v: string): void { backing.set(k, v); }
      removeItem(k: string): void { backing.delete(k); }
    }
    const proto = FakeStorage.prototype;
    const origGet = proto.getItem, origSet = proto.setItem, origRemove = proto.removeItem;
    const gt = globalThis as unknown as { localStorage: unknown };
    const savedLs = gt.localStorage;
    const fake = new FakeStorage();
    gt.localStorage = fake;
    try {
      await preloadIdbBackedStores();
      installIdbStorageRouting();

      // The PROTOTYPE method is replaced; the instance gets no own shadow property.
      assert.notEqual(proto.setItem, origSet, 'Storage.prototype.setItem must be patched');
      assert.equal(Object.prototype.hasOwnProperty.call(fake, 'setItem'), false, 'instance patch would be inert on WKWebView');

      // A routed-key write lands in the mirror, NOT the native backing store.
      fake.setItem(BACKED, 'ROUTED');
      assert.equal(backing.has(BACKED), false, 'routed write must not reach native storage');
      assert.equal(_mirrorGetForTest(BACKED), 'ROUTED');

      // A non-routed key falls through to the native backing store.
      fake.setItem(PLAIN, 'native');
      assert.equal(backing.get(PLAIN), 'native');
    } finally {
      proto.getItem = origGet; proto.setItem = origSet; proto.removeItem = origRemove;
      gt.localStorage = savedLs;
    }
  });
});

describe('preloadIdbBackedStores — orphaned localStorage cleanup (quota drain)', () => {
  it('removes a localStorage copy already durable in IDB (drains the orphan)', async () => {
    // Reproduces the field bug: an earlier boot persisted the store to IDB but
    // its one-shot removeItem was skipped, so the localStorage copy is orphaned.
    // On any later boot getMemory() returns the value and the function must
    // still free the redundant localStorage slot — else localStorage never
    // drops below WebKit's quota and the renderer wedges on sync-localStorage.
    const idb = new Map<string, unknown>([['store-cache/' + BACKED, 'DURABLE-IN-IDB']]);
    _setMemoryBackendForTest({
      getMemory: async (k: string) => (idb.has(k) ? idb.get(k) : null),
      putMemory: async (k: string, v: unknown) => { idb.set(k, v); },
      deleteMemory: async (k: string) => { idb.delete(k); },
    });
    store.set(BACKED, 'DURABLE-IN-IDB'); // orphaned legacy copy lingering

    await preloadIdbBackedStores();

    assert.equal(store.has(BACKED), false, 'orphaned localStorage copy must be removed');
    assert.equal(_mirrorGetForTest(BACKED), 'DURABLE-IN-IDB', 'value stays available via the mirror');
  });

  it('persists a DIVERGENT localStorage copy to IDB before draining it (no data loss)', async () => {
    // localStorage holds a value that never reached IDB (e.g. a pre-routing
    // write). The drain must NOT discard it — it migrates it to IDB first.
    const idb = new Map<string, unknown>([['store-cache/' + BACKED, 'STALE-IN-IDB']]);
    _setMemoryBackendForTest({
      getMemory: async (k: string) => (idb.has(k) ? idb.get(k) : null),
      putMemory: async (k: string, v: unknown) => { idb.set(k, v); },
      deleteMemory: async (k: string) => { idb.delete(k); },
    });
    store.set(BACKED, 'NEWER-ONLY-IN-LOCALSTORAGE');

    await preloadIdbBackedStores();

    assert.equal(store.has(BACKED), false, 'localStorage slot is freed');
    assert.equal(idb.get('store-cache/' + BACKED), 'NEWER-ONLY-IN-LOCALSTORAGE', 'divergent value migrated to IDB, not lost');
  });

  it('keeps the localStorage copy when IDB has no durable value (P1 durability)', async () => {
    // IDB miss AND write failure — the localStorage copy is the only durable one
    // and must never be deleted.
    _setMemoryBackendForTest({
      getMemory: async () => null,
      putMemory: async () => { throw new Error('idb down'); },
      deleteMemory: async () => {},
    });
    store.set(BACKED, 'ONLY-COPY');
    await preloadIdbBackedStores();
    assert.equal(store.get(BACKED), 'ONLY-COPY', 'must preserve the sole durable copy');
  });
});

describe('persistThenDrain — TOCTOU guard (#1370)', () => {
  it('adopts a concurrent newer value instead of clobbering it or serving stale (mid-migration write)', async () => {
    // Migration path (IDB miss → persist → drain). A concurrent writer lands a
    // NEWER localStorage value during the async persist window, AFTER we read
    // the value we migrated. The drain must (a) not clobber the newer value and
    // (b) serve the newer value from the mirror this session, not the stale one.
    let firstPut = true;
    const idb = new Map<string, unknown>();
    _setMemoryBackendForTest({
      getMemory: async (k: string) => (idb.has(k) ? idb.get(k) : null),
      putMemory: async (k: string, v: unknown) => {
        idb.set(k, v);
        // Simulate the concurrent write landing between migration-read and drain,
        // only on the first (stale-value) persist.
        if (firstPut && k === 'store-cache/' + BACKED) {
          firstPut = false;
          store.set(BACKED, 'NEWER-CONCURRENT');
        }
      },
      deleteMemory: async (k: string) => { idb.delete(k); },
    });
    store.set(BACKED, 'MIGRATED-VALUE');

    await preloadIdbBackedStores();

    // Newer native value survives (not deleted)…
    assert.equal(store.get(BACKED), 'NEWER-CONCURRENT', 'concurrent newer value must survive the drain');
    // …the mirror serves the NEWER value this session, not the stale migrated one…
    assert.equal(_mirrorGetForTest(BACKED), 'NEWER-CONCURRENT', 'mirror must adopt the newer value, not serve stale');
    // …and the newer value is what got re-persisted to IDB.
    assert.equal(idb.get('store-cache/' + BACKED), 'NEWER-CONCURRENT', 'newer value re-persisted to IDB');
  });

  it('DOES free the slot after a clean migration when the value is unchanged (guard does not over-block)', async () => {
    const idb = new Map<string, unknown>();
    _setMemoryBackendForTest({
      getMemory: async (k: string) => (idb.has(k) ? idb.get(k) : null),
      putMemory: async (k: string, v: unknown) => { idb.set(k, v); },
      deleteMemory: async (k: string) => { idb.delete(k); },
    });
    store.set(BACKED, 'CLEAN');

    await preloadIdbBackedStores();

    assert.equal(store.has(BACKED), false, 'unchanged value drains normally');
    assert.equal(idb.get('store-cache/' + BACKED), 'CLEAN', 'value persisted to IDB');
  });
});

describe('idb-store-cache — extension keys (quota headroom)', () => {
  it('backs the large, still-growing, lazily-hydrated stores', () => {
    for (const k of ['wm-algo-eval-ledger', 'crystalball-notification-digests', 'crystalball-alert-lifecycle-v1']) {
      assert.ok(IDB_BACKED_STORE_KEYS.includes(k), `${k} should be IDB-backed`);
    }
  });
  it('leaves eager module-load stores in localStorage (hydration-order safety)', () => {
    // These construct + read localStorage at import, before the mirror is warm;
    // routing them would hydrate them empty after migration. Keep until refactored.
    for (const k of ['wm-situations-v1', 'wm-unified-alerts-v1']) {
      assert.ok(!IDB_BACKED_STORE_KEYS.includes(k), `${k} must stay in localStorage`);
    }
  });
});

describe('idb-store-cache — coordinated flushes', () => {
  it('keeps IDB writes single-flight and applies a newer generation last', async () => {
    let active = 0;
    let maxActive = 0;
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const writes: string[] = [];
    _setMemoryBackendForTest({
      getMemory: async () => null,
      putMemory: async (_key: string, value: unknown) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        writes.push(String(value));
        if (value === 'generation-1') {
          firstStarted();
          await blocked;
        }
        active -= 1;
      },
      deleteMemory: async () => {},
    });
    const routed = getIdbBackedStorage();
    routed.setItem(BACKED, 'generation-1');
    const firstFlush = _flushPendingForTest();
    await started;
    routed.setItem(BACKED, 'generation-2');
    const secondFlush = _flushPendingForTest();
    await Promise.resolve();
    assert.equal(maxActive, 1);

    releaseFirst();
    await Promise.all([firstFlush, secondFlush]);
    assert.equal(maxActive, 1);
    assert.deepEqual(writes, ['generation-1', 'generation-2']);
  });

  it('skips a same-value write once that value is durable', async () => {
    const writes: string[] = [];
    _setMemoryBackendForTest({
      getMemory: async () => null,
      putMemory: async (_key: string, value: unknown) => { writes.push(String(value)); },
      deleteMemory: async () => {},
    });
    const routed = getIdbBackedStorage();
    routed.setItem(BACKED, 'same');
    await _flushPendingForTest();
    routed.setItem(BACKED, 'same');
    await _flushPendingForTest();
    assert.deepEqual(writes, ['same']);
  });

  it('bounds retries when the IDB backend keeps failing', async () => {
    let writes = 0;
    _setMemoryBackendForTest({
      getMemory: async () => null,
      putMemory: async () => {
        writes += 1;
        throw new Error('persistent failure');
      },
      deleteMemory: async () => {},
    });
    getIdbBackedStorage().setItem(BACKED, 'never-durable');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await _flushPendingForTest();
    }

    assert.equal(writes, 3);

    const recovered: string[] = [];
    _setMemoryBackendForTest({
      getMemory: async () => null,
      putMemory: async (_key: string, value: unknown) => { recovered.push(String(value)); },
      deleteMemory: async () => {},
    });
    getIdbBackedStorage().setItem(BACKED, 'never-durable');
    await _flushPendingForTest();
    assert.deepEqual(recovered, ['never-durable']);
  });
});
