import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  __TEST_HOOKS__,
  clearLiveFlightsCache,
  fetchLiveFlights,
} from '../commercial-flights-service';

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler: (url: string) => Response | Promise<Response>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = (input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : (input as { url: string }).url;
    return Promise.resolve(handler(url));
  };
}

function restoreFetch(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = ORIGINAL_FETCH;
}

beforeEach(() => clearLiveFlightsCache());
afterEach(() => restoreFetch());

describe('fetchLiveFlights', () => {
  it('returns the envelope from a successful sidecar response', async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({
          flights: [],
          counts: {
            military: 0, commercial: 0, cargo: 0, helicopter: 0, general_aviation: 0,
            total: 0, emergency: 0, squawk7500: 0, squawk7600: 0, squawk7700: 0,
          },
          fetchedAt: 1_700_000_000_000,
          degraded: false,
          source: 'opensky-network.org',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const env = await fetchLiveFlights();
    assert.equal(env.degraded, false);
    assert.equal(env.flights.length, 0);
    assert.equal(env.source, 'opensky-network.org');
  });

  it('marks envelope degraded on non-2xx HTTP', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    const env = await fetchLiveFlights();
    assert.equal(env.degraded, true);
    assert.match(env.reason ?? '', /HTTP 500/);
    assert.equal(env.flights.length, 0);
  });

  it('classifies a raw OpenSky payload (fallback shape)', async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({
          states: [
            ['abcdef', 'AAL55  ', 'United States', 0, 0, -97, 35, 9000, false, 200, 270, null, null, null, '1200', null, 0],
            ['AE1111', 'RCH99  ', 'United States', 0, 0, -100, 40, 11_000, false, 250, 90, null, null, null, '7700', null, 0],
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const env = await fetchLiveFlights();
    assert.equal(env.flights.length, 2);
    assert.equal(env.counts.commercial, 1);
    assert.equal(env.counts.military, 1);
    assert.equal(env.counts.emergency, 1);
  });

  it('serves the in-memory cache within the poll interval', async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return new Response(
        JSON.stringify({
          flights: [],
          counts: {
            military: 0, commercial: 0, cargo: 0, helicopter: 0, general_aviation: 0,
            total: 0, emergency: 0, squawk7500: 0, squawk7600: 0, squawk7700: 0,
          },
          fetchedAt: Date.now(),
          degraded: false,
          source: 'opensky-network.org',
        }),
        { status: 200 },
      );
    });
    await fetchLiveFlights();
    await fetchLiveFlights();
    await fetchLiveFlights();
    assert.equal(calls, 1, 'second + third call should hit the cache');
  });

  it('handles the rate-limited response shape', async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ rateLimited: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const env = await fetchLiveFlights();
    assert.equal(env.degraded, true);
    assert.match(env.reason ?? '', /rate limited/i);
  });

  it('clearLiveFlightsCache forces a refetch', async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return new Response(
        JSON.stringify({ flights: [], counts: {
          military: 0, commercial: 0, cargo: 0, helicopter: 0, general_aviation: 0,
          total: 0, emergency: 0, squawk7500: 0, squawk7600: 0, squawk7700: 0,
        }, fetchedAt: Date.now(), degraded: false, source: 'opensky-network.org' }),
        { status: 200 },
      );
    });
    await fetchLiveFlights();
    clearLiveFlightsCache();
    await fetchLiveFlights();
    assert.equal(calls, 2);
  });

  it('exposes POLL_INTERVAL_MS for inspection', () => {
    assert.equal(typeof __TEST_HOOKS__.POLL_INTERVAL_MS, 'number');
    assert.ok(__TEST_HOOKS__.POLL_INTERVAL_MS >= 60_000);
  });
});
