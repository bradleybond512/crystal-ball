import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearUrlscanCache,
  fetchUrlscanThreats,
  submitUrlscan,
} from '../urlscan-service';

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  Reflect.set(globalThis, 'fetch', (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : (input as { url: string }).url;
    return Promise.resolve(handler(url, init));
  });
}

function restoreFetch(): void {
  Reflect.set(globalThis, 'fetch', ORIGINAL_FETCH);
}

beforeEach(() => clearUrlscanCache());
afterEach(() => restoreFetch());

const SEARCH_ENVELOPE_BODY = () => new Response(
  JSON.stringify({
    results: [
      { _id: '1', task: { url: 'http://evil', uuid: '1' }, page: { domain: 'evil' }, verdicts: { overall: { malicious: true, score: 90, categories: ['phishing'] } } },
    ],
    total: 1,
    fetchedAt: Date.now(),
    degraded: false,
    source: 'urlscan.io',
  }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

describe('fetchUrlscanThreats', () => {
  it('parses + classifies sidecar response into the envelope', async () => {
    mockFetch(SEARCH_ENVELOPE_BODY);
    const env = await fetchUrlscanThreats();
    assert.equal(env.threats.length, 1);
    assert.equal(env.threats[0]!.verdict, 'malicious');
    assert.equal(env.stats.byVerdict.malicious, 1);
  });

  it('marks envelope degraded on non-2xx HTTP', async () => {
    mockFetch(() => new Response('boom', { status: 503 }));
    const env = await fetchUrlscanThreats();
    assert.equal(env.degraded, true);
    assert.match(env.reason ?? '', /HTTP 503/);
  });

  it('caches identical (q, size) requests', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return SEARCH_ENVELOPE_BODY(); });
    await fetchUrlscanThreats({ q: 'malicious:true', size: 10 });
    await fetchUrlscanThreats({ q: 'malicious:true', size: 10 });
    assert.equal(calls, 1);
  });

  it('treats different (q) as different cache keys', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return SEARCH_ENVELOPE_BODY(); });
    await fetchUrlscanThreats({ q: 'malicious:true' });
    await fetchUrlscanThreats({ q: 'page.domain:evil.example.com' });
    assert.equal(calls, 2);
  });

  it('clearUrlscanCache forces a refetch', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return SEARCH_ENVELOPE_BODY(); });
    await fetchUrlscanThreats();
    clearUrlscanCache();
    await fetchUrlscanThreats();
    assert.equal(calls, 2);
  });
});

describe('submitUrlscan', () => {
  it('returns the report URL on success', async () => {
    mockFetch((url, init) => {
      assert.match(url, /\/api\/security\/urlscan\/submit$/);
      assert.equal(init?.method, 'POST');
      return new Response(
        JSON.stringify({ uuid: 'submitted-uuid', result: 'https://urlscan.io/result/submitted-uuid/', api: 'https://urlscan.io/api/v1/result/submitted-uuid/' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const r = await submitUrlscan('https://example.com/path');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.uuid, 'submitted-uuid');
      assert.match(r.reportUrl ?? '', /submitted-uuid/);
    }
  });

  it('rejects a private host without calling the sidecar', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return new Response('{}', { status: 200 }); });
    const r = await submitUrlscan('http://10.0.0.1');
    assert.equal(r.ok, false);
    assert.equal(calls, 0);
  });

  it('surfaces sidecar errors', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'urlscan rejected anonymous submit' }), { status: 401 }));
    const r = await submitUrlscan('https://example.com');
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /rejected/);
  });
});
