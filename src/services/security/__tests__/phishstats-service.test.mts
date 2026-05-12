import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  __TEST_HOOKS__,
  clearPhishingCache,
  fetchPhishingRecords,
} from '../phishstats-service';

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler: (url: string) => Response | Promise<Response>): void {
  Reflect.set(globalThis, 'fetch', (input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : (input as { url: string }).url;
    return Promise.resolve(handler(url));
  });
}

function restoreFetch(): void {
  Reflect.set(globalThis, 'fetch', ORIGINAL_FETCH);
}

beforeEach(() => clearPhishingCache());
afterEach(() => restoreFetch());

function envelopeBody(records: unknown[]): Response {
  return new Response(
    JSON.stringify({ records, fetchedAt: Date.now(), degraded: false, source: 'phishstats.info' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('fetchPhishingRecords', () => {
  it('returns the envelope from a successful sidecar response', async () => {
    mockFetch(() => envelopeBody([
      { url: 'http://evil.example.com', score: 8.7, title: 'Microsoft' },
    ]));
    const env = await fetchPhishingRecords();
    assert.equal(env.degraded, false);
    // Sidecar returns raw rows; service runs them through the parser.
    assert.equal(env.records.length, 1);
    assert.equal(env.records[0]!.url, 'http://evil.example.com');
  });

  it('falls back to parsing a raw array payload', async () => {
    mockFetch(() => new Response(
      JSON.stringify([{ url: 'http://evil.example.com', score: 5 }]),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const env = await fetchPhishingRecords({ limit: 50, minScore: 5 });
    assert.equal(env.records.length, 1);
    assert.equal(env.records[0]!.severity, 'medium');
  });

  it('marks envelope degraded on non-2xx HTTP', async () => {
    mockFetch(() => new Response('boom', { status: 502 }));
    const env = await fetchPhishingRecords();
    assert.equal(env.degraded, true);
    assert.match(env.reason ?? '', /HTTP 502/);
    assert.equal(env.records.length, 0);
  });

  it('serves the cache within the poll interval for the same key', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return envelopeBody([]); });
    await fetchPhishingRecords({ limit: 50, minScore: 5 });
    await fetchPhishingRecords({ limit: 50, minScore: 5 });
    await fetchPhishingRecords({ limit: 50, minScore: 5 });
    assert.equal(calls, 1);
  });

  it('treats a different (limit, minScore) key as a fresh fetch', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return envelopeBody([]); });
    await fetchPhishingRecords({ limit: 50, minScore: 5 });
    await fetchPhishingRecords({ limit: 50, minScore: 7 });
    assert.equal(calls, 2);
  });

  it('clearPhishingCache forces a refetch', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return envelopeBody([]); });
    await fetchPhishingRecords();
    clearPhishingCache();
    await fetchPhishingRecords();
    assert.equal(calls, 2);
  });

  it('translates an `error` body into a degraded envelope', async () => {
    mockFetch(() => new Response(
      JSON.stringify({ error: 'upstream timeout' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const env = await fetchPhishingRecords();
    assert.equal(env.degraded, true);
    assert.match(env.reason ?? '', /upstream timeout/);
  });

  it('exposes a sane POLL_INTERVAL_MS', () => {
    assert.equal(typeof __TEST_HOOKS__.POLL_INTERVAL_MS, 'number');
    assert.ok(__TEST_HOOKS__.POLL_INTERVAL_MS >= 60_000);
  });
});
