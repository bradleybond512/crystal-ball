/**
 * Tests for cognition/embedding-cache.ts
 *
 * Static fixtures, no real IDB/DOM/fetch — injectable storage + embedFn.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const _store: Record<string, string> = {};
const stubStorage = {
  getItem: (k: string): string | null => _store[k] ?? null,
  setItem: (k: string, v: string): void => { _store[k] = v; },
};

const {
  cachedEmbed,
  getEmbeddingCacheSize,
  configureEmbeddingCacheForTests,
  resetEmbeddingCacheForTests,
  MAX_CACHE_ENTRIES,
  __internals,
} = await import('../embedding-cache.ts');

const noopGetMemory = async <T>(_key: string): Promise<T | null> => null;
const noopPutMemory = async <T>(_key: string, _val: T): Promise<void> => undefined;
/** Run the deferred save immediately so persistence assertions don't need
 *  to wait on a real idle-callback/setTimeout tick. */
const syncSchedule = (task: () => void): void => task();

function setupTests(): void {
  for (const k of Object.keys(_store)) delete _store[k];
  resetEmbeddingCacheForTests();
  configureEmbeddingCacheForTests({
    storage: stubStorage,
    getMemoryFn: noopGetMemory,
    putMemoryFn: noopPutMemory,
    scheduleIdleWorkFn: syncSchedule,
  });
}

function fakeVector(seed: number): Float32Array {
  return new Float32Array([seed, seed * 2, seed * 3]);
}

test('cachedEmbed: calls embedFn on a miss and returns its result', async () => {
  setupTests();
  let calls = 0;
  const embedFn = async (_text: string) => {
    calls += 1;
    return { vector: fakeVector(1), tier: 'hashed' as const, dim: 3 };
  };

  const result = await cachedEmbed('hello world', { embedFn });
  assert.equal(calls, 1);
  assert.deepEqual(Array.from(result.vector), [1, 2, 3]);
  assert.equal(result.tier, 'hashed');
});

test('cachedEmbed: identical text is never re-embedded twice', async () => {
  setupTests();
  let calls = 0;
  const embedFn = async (_text: string) => {
    calls += 1;
    return { vector: fakeVector(calls), tier: 'hashed' as const, dim: 3 };
  };

  const r1 = await cachedEmbed('Black Sea wheat shortage', { embedFn });
  const r2 = await cachedEmbed('Black Sea wheat shortage', { embedFn });

  assert.equal(calls, 1, 'embedFn should only run once for identical text');
  assert.deepEqual(Array.from(r1.vector), Array.from(r2.vector));
});

test('cachedEmbed: different text produces independent cache entries', async () => {
  setupTests();
  let calls = 0;
  const embedFn = async (_text: string) => {
    calls += 1;
    return { vector: fakeVector(calls), tier: 'hashed' as const, dim: 3 };
  };

  await cachedEmbed('text A', { embedFn });
  await cachedEmbed('text B', { embedFn });

  assert.equal(calls, 2);
  assert.equal(getEmbeddingCacheSize(), 2);
});

test('cachedEmbed: returned vector is a fresh copy (mutating it does not corrupt the cache)', async () => {
  setupTests();
  const embedFn = async (_text: string) => ({ vector: fakeVector(1), tier: 'hashed' as const, dim: 3 });

  const r1 = await cachedEmbed('shared text', { embedFn });
  r1.vector[0] = 999;
  const r2 = await cachedEmbed('shared text', { embedFn });

  assert.equal(r2.vector[0], 1, 'mutating a returned vector must not affect the cached entry');
});

test('cachedEmbed: evicts the true least-recently-used entry at the real 5,000 cap', async () => {
  setupTests();
  // Bulk-fill without persisting on every miss (irrelevant to this test,
  // and would be redundant given scheduleSave's own coalescing) — use a
  // no-op scheduler so the fill isn't paying for 5,000 individual flushes.
  configureEmbeddingCacheForTests({
    storage: stubStorage, getMemoryFn: noopGetMemory, putMemoryFn: noopPutMemory,
    scheduleIdleWorkFn: () => { /* never flush during the bulk fill */ },
  });
  let calls = 0;
  const embedFn = async (_text: string) => {
    calls += 1;
    return { vector: fakeVector(calls), tier: 'hashed' as const, dim: 3 };
  };

  assert.equal(MAX_CACHE_ENTRIES, 5000);
  for (let i = 0; i < MAX_CACHE_ENTRIES; i++) await cachedEmbed(`key-${i}`, { embedFn });
  assert.equal(getEmbeddingCacheSize(), MAX_CACHE_ENTRIES);

  // Touch key-0 so it becomes most-recently-used; key-1 is now the true LRU.
  await cachedEmbed('key-0', { embedFn });
  assert.equal(calls, MAX_CACHE_ENTRIES, 'key-0 should be served from cache, not re-embedded');

  // One more distinct entry pushes the cache 1 over cap, evicting exactly one.
  await cachedEmbed('key-new', { embedFn });
  assert.equal(getEmbeddingCacheSize(), MAX_CACHE_ENTRIES, 'cache stays at cap after eviction');

  // key-0 (touched) must survive; key-1 (true LRU) must be gone.
  const beforeKey0Calls = calls;
  await cachedEmbed('key-0', { embedFn });
  assert.equal(calls, beforeKey0Calls, 'key-0 (touched) should still be cached, not re-embedded');

  const beforeKey1Calls = calls;
  await cachedEmbed('key-1', { embedFn });
  assert.equal(calls, beforeKey1Calls + 1, 'key-1 (true LRU) should have been evicted and re-embedded');
});

test('cachedEmbed: coalesces multiple misses in a burst into a single deferred save', async () => {
  setupTests();
  const scheduled: (() => void)[] = [];
  let putMemCalls = 0;
  configureEmbeddingCacheForTests({
    storage: stubStorage,
    getMemoryFn: noopGetMemory,
    putMemoryFn: async () => { putMemCalls += 1; },
    // Capture instead of running — simulates several misses landing before
    // the browser/Node idle callback actually fires.
    scheduleIdleWorkFn: (task) => { scheduled.push(task); },
  });
  let calls = 0;
  const embedFn = async (_text: string) => {
    calls += 1;
    return { vector: fakeVector(calls), tier: 'hashed' as const, dim: 3 };
  };

  await cachedEmbed('burst-a', { embedFn });
  await cachedEmbed('burst-b', { embedFn });
  await cachedEmbed('burst-c', { embedFn });

  assert.equal(scheduled.length, 3, 'each miss schedules a flush attempt');
  assert.equal(putMemCalls, 0, 'nothing should be written until a scheduled flush actually runs');

  // Run every scheduled task, simulating all 3 idle callbacks eventually firing.
  for (const task of scheduled) task();

  assert.equal(putMemCalls, 1, 'only the first scheduled flush to run should perform the write — the dirty flag short-circuits the rest');
  const raw = stubStorage.getItem('crystalball-cognition-embed-cache-v1');
  const parsed = JSON.parse(raw!) as Record<string, unknown>;
  assert.equal(Object.keys(parsed).length, 3, 'the single flush must capture all 3 misses, not just the first');
});

test('cachedEmbed: persists to storage on a miss', async () => {
  setupTests();
  const embedFn = async (_text: string) => ({ vector: fakeVector(1), tier: 'neural' as const, dim: 3 });
  await cachedEmbed('persisted text', { embedFn, storage: stubStorage });
  const raw = stubStorage.getItem('crystalball-cognition-embed-cache-v1');
  assert.ok(raw !== null, 'cache should be written to storage');
  const parsed = JSON.parse(raw!) as Record<string, unknown>;
  assert.equal(Object.keys(parsed).length, 1);
});

test('hashText: deterministic and distinguishes different inputs', () => {
  const a = __internals.hashText('foo');
  const b = __internals.hashText('foo');
  const c = __internals.hashText('bar');
  assert.equal(a, b, 'hash must be deterministic');
  assert.notEqual(a, c, 'different text should (almost always) hash differently');
});

test('cachedEmbed: preserves tier and dim through the cache round-trip', async () => {
  setupTests();
  const embedFn = async (_text: string) => ({ vector: fakeVector(1), tier: 'neural' as const, dim: 768 });
  await cachedEmbed('neural text', { embedFn });
  const embedFn2 = async (_t: string): Promise<never> => { throw new Error('should not be called'); };
  const result = await cachedEmbed('neural text', { embedFn: embedFn2 });
  assert.equal(result.tier, 'neural');
  assert.equal(result.dim, 768);
});
