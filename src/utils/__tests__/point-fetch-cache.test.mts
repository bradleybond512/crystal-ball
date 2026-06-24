import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJsonCached } from '../point-fetch-cache.ts';

const realFetch = globalThis.fetch;
function stubFetch(impl: typeof globalThis.fetch): void { globalThis.fetch = impl; }
test.after(() => { globalThis.fetch = realFetch; });

test('caches a successful response within TTL (single network call)', async () => {
  let calls = 0;
  stubFetch((async () => { calls++; return new Response(JSON.stringify({ v: calls }), { status: 200 }); }) as typeof fetch);
  const a = await fetchJsonCached<{ v: number }>('https://x/cache-1', 60_000);
  const b = await fetchJsonCached<{ v: number }>('https://x/cache-1', 60_000);
  assert.equal(calls, 1);
  assert.deepEqual(a, { v: 1 });
  assert.deepEqual(b, { v: 1 });
});

test('refetches once the TTL has elapsed', async () => {
  let calls = 0;
  stubFetch((async () => { calls++; return new Response(JSON.stringify({ v: calls }), { status: 200 }); }) as typeof fetch);
  await fetchJsonCached('https://x/cache-2', 0);
  await fetchJsonCached('https://x/cache-2', 0);
  assert.equal(calls, 2);
});

test('does not cache non-ok responses', async () => {
  let calls = 0;
  stubFetch((async () => { calls++; return new Response('err', { status: 500 }); }) as typeof fetch);
  assert.equal(await fetchJsonCached('https://x/cache-3', 60_000), null);
  assert.equal(await fetchJsonCached('https://x/cache-3', 60_000), null);
  assert.equal(calls, 2);
});

test('returns null when fetch throws', async () => {
  stubFetch((async () => { throw new Error('network down'); }) as typeof fetch);
  assert.equal(await fetchJsonCached('https://x/cache-4', 60_000), null);
});
