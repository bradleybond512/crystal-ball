import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearPulsediveCache,
  fetchPulsediveIndicators,
} from '../pulsedive-service';

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

beforeEach(() => clearPulsediveCache());
afterEach(() => restoreFetch());

function exploreEnvelope(indicators: unknown[]): Response {
  return new Response(
    JSON.stringify({
      indicators,
      degraded: false,
      source: 'pulsedive.com',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('fetchPulsediveIndicators', () => {
  it('returns explore results parsed + summarised', async () => {
    mockFetch(() => exploreEnvelope([
      { indicator: 'evil.example.com', type: 'domain', risk: 'high', threats: [{ threat: 'Phishing' }] },
    ]));
    const env = await fetchPulsediveIndicators({ risk: 'high', limit: 50 });
    assert.equal(env.indicators.length, 1);
    assert.equal(env.indicators[0]!.risk, 'high');
    assert.equal(env.stats.byRisk.high, 1);
  });

  it('uses a separate cache key per indicator lookup', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return exploreEnvelope([]); });
    await fetchPulsediveIndicators({ indicator: '1.1.1.1' });
    await fetchPulsediveIndicators({ indicator: '1.1.1.1' });
    await fetchPulsediveIndicators({ indicator: '2.2.2.2' });
    assert.equal(calls, 2);
  });

  it('explore and lookup live in separate cache slots', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return exploreEnvelope([]); });
    await fetchPulsediveIndicators({ risk: 'high', limit: 50 });
    await fetchPulsediveIndicators({ indicator: '1.1.1.1' });
    assert.equal(calls, 2);
  });

  it('marks envelope degraded on non-2xx HTTP', async () => {
    mockFetch(() => new Response('boom', { status: 502 }));
    const env = await fetchPulsediveIndicators({ risk: 'high' });
    assert.equal(env.degraded, true);
    assert.match(env.reason ?? '', /HTTP 502/);
  });

  it('handles a sidecar `error` body as degraded', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'upstream offline' }), { status: 200 }));
    const env = await fetchPulsediveIndicators({ risk: 'high' });
    assert.equal(env.degraded, true);
    assert.match(env.reason ?? '', /upstream offline/);
  });

  it('caches identical explore queries', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return exploreEnvelope([]); });
    await fetchPulsediveIndicators({ risk: 'high', limit: 50 });
    await fetchPulsediveIndicators({ risk: 'high', limit: 50 });
    assert.equal(calls, 1);
  });

  it('treats a different risk filter as a different cache key', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return exploreEnvelope([]); });
    await fetchPulsediveIndicators({ risk: 'high' });
    await fetchPulsediveIndicators({ risk: 'medium' });
    assert.equal(calls, 2);
  });

  it('clearPulsediveCache empties the cache', async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return exploreEnvelope([]); });
    await fetchPulsediveIndicators({ risk: 'high' });
    clearPulsediveCache();
    await fetchPulsediveIndicators({ risk: 'high' });
    assert.equal(calls, 2);
  });
});
