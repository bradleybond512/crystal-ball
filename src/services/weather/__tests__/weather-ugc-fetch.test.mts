import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchUgcZonesForPoint } from '../../weather.ts';

// ── fetchUgcZonesForPoint: honest failure signal (P0 #3) ─────────────────
// This resolver is the DEFAULT `fetchZones` behind resolveSavedPlaceZonesWithHealth,
// whose `degraded` flag exists so the clear decision can withhold "all clear"
// when a saved place's UGC zones are UNKNOWN (a zone-only severe alert could
// match an unresolved place and go unseen). But `degraded` only flips when the
// resolver THROWS. If this function swallows every network/timeout/5xx error and
// returns `[]`, the adapter can never tell "genuinely zone-less point" apart from
// "lookup failed" — so `degraded` is permanently false in production and the
// fail-open it was built to close stays open. It must THROW on an ambiguous
// failure (network down, timeout, 5xx) OR a 200 whose payload carries no
// parseable zone codes (every real NWS point returns at least a forecastZone,
// so zero codes means the zones are UNKNOWN — not a genuinely zone-less place),
// and only return `[]` on the one honest empty: a 404 (NWS has no point here).

const realFetch = globalThis.fetch;

function withFetch(stub: typeof globalThis.fetch, body: () => Promise<void>): Promise<void> {
  globalThis.fetch = stub;
  return body().finally(() => { globalThis.fetch = realFetch; });
}

function response(init: { ok: boolean; status: number; json: () => Promise<unknown> }): Response {
  return init as unknown as Response;
}

test('throws when the network fetch itself rejects (zones unknown, not empty)', async () => {
  await withFetch(
    (async () => { throw new TypeError('network down'); }) as unknown as typeof globalThis.fetch,
    async () => {
      await assert.rejects(() => fetchUgcZonesForPoint(41.61, -86.72));
    },
  );
});

test('throws on a 5xx response (server failure is not an honest empty)', async () => {
  await withFetch(
    (async () => response({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof globalThis.fetch,
    async () => {
      await assert.rejects(() => fetchUgcZonesForPoint(41.61, -86.72));
    },
  );
});

test('returns [] on a 404 (NWS has no point here — a truthful empty)', async () => {
  await withFetch(
    (async () => response({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof globalThis.fetch,
    async () => {
      assert.deepEqual(await fetchUgcZonesForPoint(0, 0), []);
    },
  );
});

test('returns the forecast-zone + county UGC codes on a 200', async () => {
  await withFetch(
    (async () => response({
      ok: true,
      status: 200,
      json: async () => ({
        properties: {
          forecastZone: 'https://api.weather.gov/zones/forecast/INZ001',
          county: 'https://api.weather.gov/zones/county/INC091',
        },
      }),
    })) as unknown as typeof globalThis.fetch,
    async () => {
      assert.deepEqual(await fetchUgcZonesForPoint(41.61, -86.72), ['INZ001', 'INC091']);
    },
  );
});

test('throws on a 200 that carries no parseable zone codes (zones UNKNOWN, not a zone-less place)', async () => {
  // Every real NWS point (land or marine) returns at least a forecastZone, so a
  // 200 with zero parseable codes is anomalous — the zones are unknown, and a
  // zone-only severe alert over this place could go unseen. Treating it as an
  // honest empty (returning []) leaves `degraded` false and re-opens the
  // fail-open; it must throw so the batch is marked degraded.
  await withFetch(
    (async () => response({ ok: true, status: 200, json: async () => ({ properties: {} }) })) as unknown as typeof globalThis.fetch,
    async () => {
      await assert.rejects(() => fetchUgcZonesForPoint(41.61, -86.72));
    },
  );
});
