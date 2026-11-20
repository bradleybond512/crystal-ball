import test from 'node:test';
import assert from 'node:assert/strict';

const ORIGIN = 'https://crystalball-main-bradleybond512.vercel.app';
const request = (query = '', init = {}) => new Request(`${ORIGIN}/api/ukpn-outages${query}`, {
  headers: { origin: ORIGIN }, ...init,
});
const freshHandler = async () => (await import(`./ukpn-outages.js?test=${Math.random()}`)).default;
const metadata = (at = Date.now() - 1000) => ({ metas: { default: { data_processed: new Date(at).toISOString(), records_count: 1 } } });
const records = { total_count: 1, results: [{ incidentreference: 'TEST', powercuttype: 'Unplanned', nocustomeraffected: 0, restoreddatetime: null }] };

test('UKPN edge rejects disallowed origins, methods and caller query before fetching', async () => {
  const handler = await freshHandler(); const original = globalThis.fetch;
  let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error('unexpected fetch'); };
  try {
    assert.equal((await handler(request('', { headers: { origin: 'https://evil.example' } }))).status, 403);
    assert.equal((await handler(request('', { method: 'POST' }))).status, 405);
    assert.equal((await handler(request('', { method: 'OPTIONS' }))).status, 204);
    for (const query of ['?url=https://evil.example', '?limit=1', '?x', '?x=1&x=2']) assert.equal((await handler(request(query))).status, 400);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('UKPN edge exposes normalized success without shared HTTP caching', async () => {
  const handler = await freshHandler(); const original = globalThis.fetch;
  const m = metadata(); let calls = 0;
  globalThis.fetch = async (_url, options) => { calls += 1; assert.equal(options.redirect, 'error'); return Response.json(calls === 2 ? records : m); };
  try {
    const response = await handler(request());
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
    const result = await response.json(); assert.equal(result.state, 'reported');
    assert.deepEqual(result.incidents, [{ id: 'TEST', customersAffected: 0 }]);
    assert.equal((await handler(request())).status, 200); assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

test('UKPN edge returns parseable stale and unavailable envelopes with no incidents', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of ['stale', 'rate_limited', 'malformed_response']) {
      const handler = await freshHandler(); let calls = 0; const m = metadata(Date.now() - 900_001);
      globalThis.fetch = async () => {
        calls += 1;
        if (status === 'rate_limited') return new Response('', { status: 429 });
        if (status === 'malformed_response') return Response.json({ maintenance: true });
        return Response.json(calls === 2 ? records : m);
      };
      const response = await handler(request()); assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json(); assert.deepEqual(result.incidents, []);
      assert.equal(result.reasonCode, status === 'stale' ? 'publication_stale' : status);
    }
  } finally { globalThis.fetch = original; }
});

test('UKPN edge cancelled caller does not issue upstream requests', async () => {
  const handler = await freshHandler(); const controller = new AbortController(); controller.abort();
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('unexpected'); };
  try { assert.equal((await handler(request('', { signal: controller.signal }))).status, 499); assert.equal(calls, 0); }
  finally { globalThis.fetch = original; }
});
