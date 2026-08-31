import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchNwsPointJurisdiction,
  fetchUgcZonesForPoint,
  NWS_POINT_JURISDICTION_TTL_MS,
} from '../../weather.ts';

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

test('throws on rate limiting and timeout (neither is jurisdiction evidence)', async () => {
  await withFetch(
    (async () => response({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof globalThis.fetch,
    async () => {
      await assert.rejects(() => fetchNwsPointJurisdiction(41.61, -86.72), /HTTP 429/);
    },
  );
  await withFetch(
    (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as unknown as typeof globalThis.fetch,
    async () => {
      await assert.rejects(() => fetchNwsPointJurisdiction(41.61, -86.72));
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

test('structured point evidence marks a 404 as explicit, time-bounded outside jurisdiction', async () => {
  await withFetch(
    (async () => response({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof globalThis.fetch,
    async () => {
      const before = Date.now();
      const result = await fetchNwsPointJurisdiction(0, 0);
      const after = Date.now();
      assert.equal(result.status, 'outside-jurisdiction');
      assert.deepEqual(result.zones, []);
      assert.equal(result.source, 'nws-points');
      assert.ok(result.retrievedAt >= before && result.retrievedAt <= after);
      assert.equal(result.validUntil, result.retrievedAt + NWS_POINT_JURISDICTION_TTL_MS);
    },
  );
});

test('returns complete forecast-zone + county + fire-weather-zone evidence on a 200', async () => {
  await withFetch(
    (async () => response({
      ok: true,
      status: 200,
      json: async () => ({
        properties: {
          forecastZone: 'https://api.weather.gov/zones/forecast/INZ001',
          county: 'https://api.weather.gov/zones/county/INC091',
          fireWeatherZone: 'https://api.weather.gov/zones/fire/INZ001',
        },
      }),
    })) as unknown as typeof globalThis.fetch,
    async () => {
      assert.deepEqual(await fetchUgcZonesForPoint(41.61, -86.72), ['INZ001', 'INC091']);
    },
  );
});

test('structured point evidence proves all three jurisdiction fields and bounds its currency', async () => {
  await withFetch(
    (async () => response({
      ok: true,
      status: 200,
      json: async () => ({
        properties: {
          forecastZone: 'https://api.weather.gov/zones/forecast/INZ103',
          county: 'https://api.weather.gov/zones/county/INC091',
          fireWeatherZone: 'https://api.weather.gov/zones/fire/INZ103',
        },
      }),
    })) as unknown as typeof globalThis.fetch,
    async () => {
      const result = await fetchNwsPointJurisdiction(41.61, -86.72);
      assert.equal(result.status, 'covered');
      assert.deepEqual(result.zones, ['INZ103', 'INC091']);
      assert.deepEqual(result.fields, {
        forecastZone: 'INZ103',
        county: 'INC091',
        fireWeatherZone: 'INZ103',
      });
      assert.equal(result.validUntil, result.retrievedAt + NWS_POINT_JURISDICTION_TTL_MS);
    },
  );
});

test('a malformed or incomplete 200 point body fails closed', async () => {
  for (const payload of [
    null,
    {},
    { properties: null },
    { properties: { forecastZone: 'https://api.weather.gov/zones/forecast/INZ103', county: 'https://api.weather.gov/zones/county/INC091' } },
    { properties: { forecastZone: 'INZ103', county: 'https://api.weather.gov/zones/county/INC091', fireWeatherZone: 'https://api.weather.gov/zones/fire/INZ103' } },
    { properties: { forecastZone: 'https://evil.example/zones/forecast/INZ103', county: 'https://api.weather.gov/zones/county/INC091', fireWeatherZone: 'https://api.weather.gov/zones/fire/INZ103' } },
  ]) {
    await withFetch(
      (async () => response({ ok: true, status: 200, json: async () => payload })) as unknown as typeof globalThis.fetch,
      async () => {
        await assert.rejects(() => fetchNwsPointJurisdiction(41.61, -86.72));
      },
    );
  }
});

test('invalid coordinates fail before fetch and a failed request is not cached', async () => {
  let calls = 0;
  await withFetch(
    (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('temporary failure');
      return response({
        ok: true,
        status: 200,
        json: async () => ({
          properties: {
            forecastZone: 'https://api.weather.gov/zones/forecast/INZ103',
            county: 'https://api.weather.gov/zones/county/INC091',
            fireWeatherZone: 'https://api.weather.gov/zones/fire/INZ103',
          },
        }),
      });
    }) as unknown as typeof globalThis.fetch,
    async () => {
      await assert.rejects(() => fetchNwsPointJurisdiction(41.61, -86.72));
      assert.equal((await fetchNwsPointJurisdiction(41.61, -86.72)).status, 'covered');
      await assert.rejects(() => fetchNwsPointJurisdiction(Number.NaN, -86.72), /coordinates out of range/);
      await assert.rejects(() => fetchNwsPointJurisdiction(91, -86.72), /coordinates out of range/);
      await assert.rejects(() => fetchNwsPointJurisdiction(41.61, 181), /coordinates out of range/);
      assert.equal(calls, 2);
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
