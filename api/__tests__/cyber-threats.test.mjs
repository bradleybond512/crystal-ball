/**
 * Route-level coverage for api/cyber-threats.js
 *
 * The aggregator is sidecar-only. The cloud (Vercel edge) path must
 * NOT make 127.0.0.1 fetches; it must short-circuit to a degraded
 * payload with a clear reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler } from './_test-utils.mjs';

const handler = (await import('../cyber-threats.js')).default;

test('cyber-threats: OPTIONS returns 204', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('cyber-threats: cloud mode (LOCAL_API_PORT unset) does not call 127.0.0.1', async () => {
  const original = process.env.LOCAL_API_PORT;
  delete process.env.LOCAL_API_PORT;
  let attemptedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    attemptedUrls.push(typeof url === 'string' ? url : url.url);
    return new Response('{}', { status: 500 });
  };
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.equal(res.body.totalCount, 0);
    assert.equal(attemptedUrls.length, 0, `cloud aggregator must not fetch 127.0.0.1, got ${attemptedUrls.join(', ')}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (original !== undefined) process.env.LOCAL_API_PORT = original;
  }
});

test('cyber-threats: sidecar mode aggregates per-source results', async () => {
  const originalPort = process.env.LOCAL_API_PORT;
  process.env.LOCAL_API_PORT = '46123';
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = typeof url === 'string' ? url : url.url;
    seen.push(u);
    if (u.includes('cisa-kev')) {
      return new Response(JSON.stringify([{ id: 'cisa-kev-1', source: 'cisa_kev' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('threatfox-iocs')) {
      return new Response(JSON.stringify({ iocs: [{ id: 't1' }, { id: 't2' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('urlhaus-feed')) {
      return new Response(JSON.stringify({ items: [{ url: 'https://bad.example' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('otx-pulses')) {
      return new Response(JSON.stringify({ pulses: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(seen.length, 4, 'sidecar mode hits all 4 sources');
    assert.ok(seen.every((u) => u.startsWith('http://127.0.0.1:46123/')), 'all calls go to local sidecar');
    assert.equal(res.body.totalCount, 4); // 1 + 2 + 1 + 0
    assert.equal(res.body.degradedSources, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPort === undefined) delete process.env.LOCAL_API_PORT;
    else process.env.LOCAL_API_PORT = originalPort;
  }
});

test('cyber-threats: sidecar source HTTP error marks that source degraded but keeps others', async () => {
  const originalPort = process.env.LOCAL_API_PORT;
  process.env.LOCAL_API_PORT = '46123';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = typeof url === 'string' ? url : url.url;
    if (u.includes('cisa-kev')) {
      return new Response('{}', { status: 503 });
    }
    if (u.includes('threatfox-iocs')) {
      return new Response(JSON.stringify({ iocs: [{ id: 't1' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ items: [], pulses: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 200);
    const cisa = res.body.sources.find((s) => s.source === 'CISA KEV');
    assert.equal(cisa.degraded, true);
    assert.equal(cisa.count, 0);
    assert.ok(res.body.degradedSources >= 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPort === undefined) delete process.env.LOCAL_API_PORT;
    else process.env.LOCAL_API_PORT = originalPort;
  }
});
