/**
 * Call-site regression tests for fetchSpaceWeather().
 *
 * space-weather-parse.test.mts proves the PARSERS handle the real SWPC shapes.
 * That is not the bug that emptied the panel: the parsers were being handed the
 * wrong thing. fetchSpaceWeather() issued five identical requests to
 * /api/space-weather-feeds and gated each parse on Array.isArray() of the
 * response — but the route answers with one OBJECT keyed by product, so every
 * branch was skipped and every field stayed null while the fetch itself
 * "succeeded".
 *
 * Parser-only coverage cannot see that regression come back, so these tests
 * drive the exported function with a stubbed fetch instead.
 *
 * Test ORDER matters: the failure-path test runs first, while the module-level
 * cache is still empty.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { fetchSpaceWeather } from '@/services/space-weather';

/**
 * SWPC's naïve-UTC stamp format ("2026-07-30 19:03:19.350") for an instant
 * `minutesAgo` in the past. parseAlerts windows against the REAL clock, so a
 * hard-coded date would age out of the 24-hour window and make this suite start
 * failing on a date unrelated to any code change.
 */
function issuedMinutesAgo(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '');
}

const ALERT_ISSUED_AT = issuedMinutesAgo(60);

/** The real envelope shape: one object keyed by SWPC product. */
const FEEDS = {
  kp: [
    { time_tag: '2026-07-30T18:00:00', Kp: 3, a_running: 7, station_count: 8 },
    { time_tag: '2026-07-30T21:00:00', Kp: 6, a_running: 9, station_count: 8 },
  ],
  wind: [
    ['time_tag', 'speed', 'density', 'bz'],
    ['2026-07-30 20:55:00.000', '512.4', '6.1', '-8.3'],
  ],
  xray: [{ max_class: 'M2.4', current_class: 'C1.1' }],
  alerts: [
    {
      product_id: 'ALTK07',
      issue_datetime: ALERT_ISSUED_AT,
      message: 'Space Weather Message Code: ALTK07\r\nSerial Number: 366\r\n\r\nALERT: Geomagnetic K-index of 7\r\n',
    },
  ],
};

let requests: string[] = [];

/** Installs a fetch stub returning `body`, and records every URL requested. */
function stubFetch(body: unknown, ok = true) {
  requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    requests.push(typeof url === 'string' ? url : String((url as URL).href ?? url));
    return {
      ok,
      status: ok ? 200 : 502,
      json: async () => body,
    } as Response;
  }) as typeof globalThis.fetch;
  return () => { globalThis.fetch = original; };
}

// ── Failure path first, so nothing is cached before the success test ────────

test('an envelope with no usable products yields nulls and is not cached', async () => {
  const restore = stubFetch({ kp: null, wind: null, xray: null, alerts: null });
  try {
    const first = await fetchSpaceWeather();
    assert.equal(first.kpIndex, null);
    assert.equal(first.solarWindSpeed, null);
    assert.equal(first.bz, null);
    assert.equal(first.xrayClass, null);
    assert.deepEqual(first.alertMessages, []);

    // An empty result is a failure, not an empty success. Caching it would pin
    // the panel blank for the full five minutes instead of retrying.
    const before = requests.length;
    await fetchSpaceWeather();
    assert.ok(requests.length > before, 'a yield of nothing must not be cached');
  } finally { restore(); }
});

// ── The regression itself ───────────────────────────────────────────────────

test('fetchSpaceWeather populates every field from the keyed envelope', async () => {
  const restore = stubFetch(FEEDS);
  try {
    const data = await fetchSpaceWeather();

    // Newest Kp bin, read off the capital-K field of an array of OBJECTS — not
    // the header-row + array-of-arrays shape the 1-minute products use.
    assert.equal(data.kpIndex, 6);
    assert.equal(data.kpClass, 'moderate_storm');

    // Speed, density and bz all come from the one propagated-solar-wind product.
    assert.equal(data.solarWindSpeed, 512.4);
    assert.equal(data.solarWindDensity, 6.1);
    assert.equal(data.bz, -8.3);

    assert.equal(data.xrayClass, 'M2.4');
    assert.equal(data.alertMessages.length, 1);
    assert.equal(data.alertMessages[0]!.severity, 'alert');
    assert.equal(data.alertMessages[0]!.message, 'ALERT: Geomagnetic K-index of 7');
  } finally { restore(); }
});

test('fetchSpaceWeather asks the route exactly once', () => {
  // The original code called fetchJson five separate times against the SAME
  // URL — one per product — and discarded four of the answers.
  assert.equal(requests.length, 1, `expected 1 request, got ${requests.length}`);
  assert.ok(requests[0]!.endsWith('/api/space-weather-feeds'), requests[0]);
});

test('a successful result is cached rather than refetched', async () => {
  const restore = stubFetch(FEEDS);
  try {
    const data = await fetchSpaceWeather();
    assert.equal(data.kpIndex, 6, 'served from the cache written by the previous test');
    assert.equal(requests.length, 0, 'no request should have been issued');
  } finally { restore(); }
});
