import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

// localStorage shim with a configurable byte budget so we can force
// QuotaExceededError deterministically. setItem throws a DOMException named
// 'QuotaExceededError' once the total stored bytes would exceed `budget`.
const store = new Map<string, string>();
let budget = Infinity;

function totalBytes(skipKey?: string): number {
  let n = 0;
  for (const [k, v] of store) {
    if (k === skipKey) continue;
    n += k.length + v.length;
  }
  return n;
}

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => {
    if (totalBytes(k) + k.length + v.length > budget) {
      throw new DOMException('quota', 'QuotaExceededError');
    }
    store.set(k, v);
  },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

const { safeSetItem, EVICTABLE_CACHE_PREFIXES, _resetQuotaLatchForTest } =
  await import('../safe-storage.ts');

const { isStorageQuotaExceeded, isIndexedDbQuotaExceeded } = await import('../storage-quota.ts');

beforeEach(() => {
  store.clear();
  budget = Infinity;
  _resetQuotaLatchForTest();
});

describe('safeSetItem — happy path', () => {
  it('writes the value and returns true when there is room', () => {
    assert.equal(safeSetItem('wm-settings', 'hello'), true);
    assert.equal(localStorage.getItem('wm-settings'), 'hello');
  });
});

describe('safeSetItem — quota recovery', () => {
  it('evicts evictable cache and retries once, succeeding', () => {
    // Fill storage with evictable cache, staying within budget (real
    // localStorage can never exceed quota).
    store.set('crystalball-persistent-cache:markets', 'x'.repeat(40)); // 33 + 40 = 73
    store.set('api-response:etf', 'y'.repeat(5));                      // 15 + 5  = 20
    budget = 100; // currently at 93 bytes

    // A precious write of 48 bytes (18 + 30) doesn't fit until cache is evicted.
    const ok = safeSetItem('wm-installation-id', 'z'.repeat(30));
    assert.equal(ok, true);
    assert.equal(localStorage.getItem('wm-installation-id'), 'z'.repeat(30));
  });

  it('evicts the LARGEST evictable entry first', () => {
    store.set('api-response:small', 's'.repeat(10));                // 18 + 10  = 28
    store.set('crystalball-persistent-cache:big', 'b'.repeat(200)); // 31 + 200 = 231
    budget = 280; // currently at 259 bytes; +36 write overflows

    const ok = safeSetItem('wm-new', 'n'.repeat(30)); // 6 + 30 = 36
    assert.equal(ok, true);
    // Largest-first: the big cache entry is gone, the small one survives.
    assert.equal(localStorage.getItem('crystalball-persistent-cache:big'), null);
    assert.equal(localStorage.getItem('api-response:small'), 's'.repeat(10));
  });

  it('never evicts precious (non-cache) keys', () => {
    store.set('wm-settings', 'p'.repeat(200));  // 11 + 200 = 211
    store.set('cb-watchlist', 'w'.repeat(200)); // 12 + 200 = 212
    budget = 423; // exactly full — no evictable cache present

    const ok = safeSetItem('wm-new', 'n'.repeat(30));
    assert.equal(ok, false); // can't free space without touching precious keys
    // Precious keys untouched.
    assert.equal(localStorage.getItem('wm-settings'), 'p'.repeat(200));
    assert.equal(localStorage.getItem('cb-watchlist'), 'w'.repeat(200));
  });
});

describe('safeSetItem — fail-closed', () => {
  it('returns false and never throws when eviction cannot free enough', () => {
    budget = 5;
    let threw = false;
    let result = true;
    try {
      result = safeSetItem('wm-too-big', 'x'.repeat(50));
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
    assert.equal(result, false);
  });

  it('trips the localStorage quota latch so other writers can bail early', () => {
    budget = 5;
    safeSetItem('wm-too-big', 'x'.repeat(50));
    assert.equal(isStorageQuotaExceeded(), true);
  });

  it('does NOT trip the IndexedDB latch — a full localStorage must not disable healthy IDB writes', () => {
    budget = 5;
    safeSetItem('wm-too-big', 'x'.repeat(50));
    assert.equal(isStorageQuotaExceeded(), true);
    assert.equal(isIndexedDbQuotaExceeded(), false);
  });

  it('swallows non-quota errors and returns false without evicting', () => {
    store.set('crystalball-persistent-cache:keep', 'keep');
    const original = localStorage.setItem;
    (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = () => {
      throw new DOMException('nope', 'SecurityError');
    };
    let threw = false;
    let result = true;
    try {
      result = safeSetItem('whatever', 'value');
    } catch {
      threw = true;
    } finally {
      (localStorage as unknown as { setItem: typeof original }).setItem = original;
    }
    assert.equal(threw, false);
    assert.equal(result, false);
    // Non-quota error must NOT trigger eviction.
    assert.equal(localStorage.getItem('crystalball-persistent-cache:keep'), 'keep');
  });
});

describe('EVICTABLE_CACHE_PREFIXES', () => {
  it('covers the known disposable cache namespaces', () => {
    // `crystalball-persistent-cache:` also covers proxy `api-response:` entries —
    // proxy.ts writes them through setPersistentCache, which nests them under this
    // prefix rather than storing a raw top-level `api-response:` key.
    assert.ok(EVICTABLE_CACHE_PREFIXES.includes('crystalball-persistent-cache:'));
    // offline-alert-cache.ts last-known snapshots (saved-place-weather, place-briefs,
    // local-logistics, …) all write under the `wm_offline_<serviceId>` prefix.
    assert.ok(EVICTABLE_CACHE_PREFIXES.includes('wm_offline_'));
  });

  it('covers the high-frequency / rolling-buffer log-spam sources', () => {
    assert.ok(EVICTABLE_CACHE_PREFIXES.includes('wm-analytics-offline-queue'));
    assert.ok(EVICTABLE_CACHE_PREFIXES.includes('crystalball-pressure-history-v1'));
    assert.ok(EVICTABLE_CACHE_PREFIXES.includes('crystalball-snapshot-archive-v1'));
    assert.ok(EVICTABLE_CACHE_PREFIXES.includes('crystalball-briefing-archive-v1'));
  });

  it('evicts a high-frequency-writer entry to make room for a precious write', () => {
    store.set('wm-analytics-offline-queue', 'q'.repeat(200));
    budget = 230; // only fits the new write once the queue is dropped
    const ok = safeSetItem('wm-installation-id', 'i'.repeat(30));
    assert.equal(ok, true);
    assert.equal(localStorage.getItem('wm-analytics-offline-queue'), null);
  });

  it('never evicts the encrypted web-secret vault', () => {
    store.set('web-secret-vault/v1', 'v'.repeat(200));
    budget = 230; // not enough room, and the vault is NOT evictable
    const ok = safeSetItem('wm-new', 'n'.repeat(30));
    assert.equal(ok, false);
    assert.equal(localStorage.getItem('web-secret-vault/v1'), 'v'.repeat(200));
  });

  it('covers the large re-derivable reasoning/cognition stores (the quota hogs)', () => {
    // These are the keys that grew to 4.9 MB and exhausted the localStorage
    // quota, seizing the renderer. They must be evictable so the boot-wired
    // localStorage patch can reclaim them under pressure.
    for (const key of [
      'wm-assumption-annotations', 'wm-quality-debt', 'wm-cognitive-bias-detections',
      'wm-safety-case', 'wm-intelligence-health', 'wm-mission-control',
      'wm-situation-store-v2', 'wm-counterfactuals', 'wm-meta-confidence',
      'wm-world-narrative', 'wm-hypothesis-sets', 'wm-unified-alerts-v1',
    ]) {
      assert.ok(
        EVICTABLE_CACHE_PREFIXES.some((p) => key.startsWith(p)),
        `${key} must be evictable`,
      );
    }
  });

  it('evicts a large reasoning store to make room, sparing precious user data', () => {
    // A bloated reasoning cache alongside the user's saved places + watchlist.
    store.set('wm-assumption-annotations', 'a'.repeat(400)); // evictable hog
    store.set('wm_saved_places_v1', 'p'.repeat(50));         // PRECIOUS
    store.set('wm-country-watchlist-v1', 'w'.repeat(50));    // PRECIOUS
    store.set('wm-basemap', 'satellite');                    // PRECIOUS
    budget = 600; // full enough that the new write needs the hog gone

    const ok = safeSetItem('wm-situation-store-v2', 's'.repeat(100));
    assert.equal(ok, true);
    // The re-derivable reasoning cache was dropped…
    assert.equal(localStorage.getItem('wm-assumption-annotations'), null);
    // …but every precious user key survived.
    assert.equal(localStorage.getItem('wm_saved_places_v1'), 'p'.repeat(50));
    assert.equal(localStorage.getItem('wm-country-watchlist-v1'), 'w'.repeat(50));
    assert.equal(localStorage.getItem('wm-basemap'), 'satellite');
  });

  it('never evicts precious small wm-* keys even when nothing else can free space', () => {
    // No evictable entries present — only precious wm-* config/identity keys.
    store.set('wm_saved_places_v1', 'p'.repeat(200));
    store.set('wm-basemap', 'terrain');
    store.set('wm_proximity_config', 'c'.repeat(100));
    budget = totalBytes(); // exactly full — no room for any new write

    const ok = safeSetItem('wm-new', 'n'.repeat(30));
    assert.equal(ok, false); // can't free space without touching precious keys
    assert.equal(localStorage.getItem('wm_saved_places_v1'), 'p'.repeat(200));
    assert.equal(localStorage.getItem('wm-basemap'), 'terrain');
    assert.equal(localStorage.getItem('wm_proximity_config'), 'c'.repeat(100));
  });
});
