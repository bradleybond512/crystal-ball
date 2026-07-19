import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCachedDiseaseIntel, fetchDiseaseIntel } from '../disease-intel.ts';

// getCachedDiseaseIntel() gives the survival health axis a synchronous read of
// the warm disease-intel cache. These tests cover the cold (null) and warm paths.

test('getCachedDiseaseIntel() returns null before any fetch (cold, fail-safe)', () => {
  // This runs first in the file, before fetchDiseaseIntel populates the cache.
  assert.equal(getCachedDiseaseIntel(), null);
});

test('after a successful fetch, the getter reflects the warm cache', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      nextstrain: null,
      covidCountries: [],
      reliefweb: [],
      whoDon: [],
      crossReferencedWithPromed: [],
    }),
  })) as typeof globalThis.fetch;
  try {
    const fetched = await fetchDiseaseIntel();
    const cached = getCachedDiseaseIntel();
    assert.notEqual(cached, null);
    // The getter returns the exact same object the fetch resolved (cache identity).
    assert.equal(cached, fetched);
    assert.ok(Array.isArray(cached!.whoDon));
    assert.ok(cached!.fetchedAt instanceof Date);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getter keeps returning cached data on subsequent reads (no refetch)', () => {
  const a = getCachedDiseaseIntel();
  const b = getCachedDiseaseIntel();
  assert.notEqual(a, null);
  assert.equal(a, b);
});

test('getter returns null once the cache ages past the 30-min TTL (fail-safe)', () => {
  // Cache was populated above; reading far in the future must not surface stale
  // outbreak intel — the survival health axis fails safe rather than asserting it.
  const fresh = getCachedDiseaseIntel();
  assert.notEqual(fresh, null);
  const wayLater = Date.now() + 31 * 60 * 1000;
  assert.equal(getCachedDiseaseIntel(wayLater), null);
  // Just inside the window still returns data.
  const almost = Date.now() + 29 * 60 * 1000;
  assert.notEqual(getCachedDiseaseIntel(almost), null);
});
