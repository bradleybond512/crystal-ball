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
 * The module holds a private TTL cache with no reset seam. Rather than depend on
 * declaration order — which made these tests fail when run individually — each
 * one advances a stubbed clock far enough to expire whatever a previous test
 * left behind, so every test is self-contained and the TTLs themselves become
 * observable.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { fetchSpaceWeather } from '@/services/space-weather';

const REAL_NOW = Date.now.bind(Date);
let clockOffsetMs = 0;
Date.now = () => REAL_NOW() + clockOffsetMs;

const COMPLETE_TTL_MS = 5 * 60 * 1000;
const PARTIAL_TTL_MS = 60 * 1000;

/** Jump past the longest cache lifetime, so the next call is guaranteed to fetch. */
function expireEverything(): void {
  clockOffsetMs += COMPLETE_TTL_MS + 1000;
}

/**
 * SWPC's naïve-UTC stamp format ("2026-07-30 19:03:19.350") for an instant
 * `minutesAgo` in the past. parseAlerts windows against the REAL clock, so a
 * hard-coded date would age out of the 24-hour window and make this suite start
 * failing on a date unrelated to any code change.
 */
function issuedMinutesAgo(minutesAgo: number): string {
  return new Date(REAL_NOW() - minutesAgo * 60_000)
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

test('an envelope with no usable products yields nulls and is not cached', async () => {
  expireEverything();
  const restore = stubFetch({ kp: null, wind: null, xray: null, alerts: null });
  try {
    const first = await fetchSpaceWeather();
    assert.equal(first.kpIndex, null);
    assert.equal(first.solarWindSpeed, null);
    assert.equal(first.bz, null);
    assert.equal(first.xrayClass, null);
    assert.equal(first.windObservedAt, null);
    assert.deepEqual(first.alertMessages, []);

    // An empty result is a failure, not an empty success. Caching it would pin
    // the panel blank for the full five minutes instead of retrying.
    await fetchSpaceWeather();
    assert.equal(requests.length, 2, 'a yield of nothing must not be cached');
  } finally { restore(); }
});

test('fetchSpaceWeather populates every field from the keyed envelope, in one request', async () => {
  expireEverything();
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

    // The original code called fetchJson five separate times against the SAME
    // URL — one per product — and discarded four of the answers. Asserted here
    // rather than in its own test so it can't depend on declaration order.
    assert.equal(requests.length, 1, `expected 1 request, got ${requests.length}`);
    assert.ok(requests[0]!.endsWith('/api/space-weather-feeds'), requests[0]);
  } finally { restore(); }
});

test('the solar-wind measurement time is surfaced, not just the fetch time', async () => {
  expireEverything();
  const restore = stubFetch(FEEDS);
  try {
    const data = await fetchSpaceWeather();
    // `fetchedAt` says when WE asked. Without the observation time, an hour-old
    // reading and a live one are indistinguishable in the panel. The tag is
    // naïve UTC upstream, so this also proves the Z is being stamped.
    assert.equal(data.windObservedAt, '2026-07-30T20:55:00.000Z');
    assert.notEqual(data.windObservedAt, data.fetchedAt.toISOString());
  } finally { restore(); }
});

test('a complete result is cached rather than refetched', async () => {
  expireEverything();
  const restore = stubFetch(FEEDS);
  try {
    await fetchSpaceWeather();
    assert.equal(requests.length, 1);

    clockOffsetMs += PARTIAL_TTL_MS + 1000;
    const again = await fetchSpaceWeather();
    assert.equal(requests.length, 1, 'a complete result survives well past the partial TTL');
    assert.equal(again.kpIndex, 6, 'and is served from the cache');
  } finally { restore(); }
});

test('a partial result is held only briefly, not for the full five minutes', async () => {
  expireEverything();
  // One product missing. The renderer used to cache this for the same 5 minutes
  // as a complete result, overriding the deliberately short TTL the sidecar
  // writes a partial envelope with — pinning the hole in the panel anyway.
  const restore = stubFetch({ ...FEEDS, xray: [] });
  try {
    const partial = await fetchSpaceWeather();
    assert.equal(partial.xrayClass, null, 'this result is missing a measurement');
    assert.equal(partial.kpIndex, 6, 'but is not empty, so it IS cached');
    assert.equal(requests.length, 1);

    clockOffsetMs += PARTIAL_TTL_MS + 1000;
    await fetchSpaceWeather();
    assert.equal(requests.length, 2, 'past 60 s the missing product must be retried');
  } finally { restore(); }
});

test('a quiet sky still counts as complete — an empty alert list is not a gap', async () => {
  expireEverything();
  // Alerts are excluded from the completeness test on purpose: no active alerts
  // is a legitimate reading, unlike a missing measurement. Treating it as
  // partial would put the panel into a 60-second refetch loop for weeks at a
  // time, since quiet is the normal state.
  const restore = stubFetch({ ...FEEDS, alerts: [] });
  try {
    const data = await fetchSpaceWeather();
    assert.deepEqual(data.alertMessages, []);
    assert.equal(requests.length, 1);

    clockOffsetMs += PARTIAL_TTL_MS + 1000;
    await fetchSpaceWeather();
    assert.equal(requests.length, 1, 'a quiet sky is cached for the full TTL');
  } finally { restore(); }
});
