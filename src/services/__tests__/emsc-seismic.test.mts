import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchEmscSeismic } from '../emsc-seismic.ts';

/** Run `fn` with globalThis.fetch stubbed, always restoring the original. */
async function withFetch(stub: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

const EVENT = {
  id: 'ev1',
  magnitude: 5.1,
  magnitudeType: 'mb',
  depth: 10,
  lat: 41.27,
  lon: 129.08,
  region: 'North Korea',
  time: '2026-07-29T00:00:00Z',
  source: 'EMSC',
  suspectedNuclearTest: true,
  nearTestSite: { label: 'Punggye-ri', country: 'North Korea' },
};

test('fetchEmscSeismic returns events on a successful array payload', async () => {
  await withFetch(
    (async () => ({ ok: true, json: async () => [EVENT] })) as unknown as typeof fetch,
    async () => {
      const events = await fetchEmscSeismic();
      assert.equal(events.length, 1);
      assert.equal(events[0]!.suspectedNuclearTest, true);
    },
  );
});

test('fetchEmscSeismic throws on HTTP error so the loader records a failing fetch', async () => {
  await withFetch(
    (async () => ({ ok: false, status: 502, json: async () => ({ error: 'emsc-seismic error: upstream' }) })) as unknown as typeof fetch,
    async () => {
      await assert.rejects(fetchEmscSeismic(), /502/);
    },
  );
});

test('fetchEmscSeismic propagates network/timeout errors instead of swallowing them', async () => {
  await withFetch(
    (async () => { throw new Error('TimeoutError: signal timed out'); }) as unknown as typeof fetch,
    async () => {
      await assert.rejects(fetchEmscSeismic(), /timed out/);
    },
  );
});

test('fetchEmscSeismic throws on a malformed (non-array) payload', async () => {
  await withFetch(
    (async () => ({ ok: true, json: async () => ({ error: 'not an array' }) })) as unknown as typeof fetch,
    async () => {
      await assert.rejects(fetchEmscSeismic(), /malformed/);
    },
  );
});
