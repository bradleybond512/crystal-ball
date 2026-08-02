/**
 * Behavioral cover for the usgs-earthquakes fusion vote's trust boundary.
 *
 * These EXECUTE fetchUsgsSeismicForFusion against stubbed responses. The
 * companion guards in tests/data-sources-wiring.test.mjs assert the wiring
 * around it (cadence, variant gating, adapter-derived `ok`) by reading source
 * text, which cannot tell whether the checks still fire — so the acceptance
 * and rejection rules live here, where a regression actually fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUsgsSeismicForFusion } from '../usgs-fusion-fetch.ts';

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const FRESH = new Date(NOW - 5_000).toISOString();

/** One well-formed sidecar row (already flattened) and its GeoJSON twin. */
const FLAT_ROW = {
  id: 'us1000', magnitude: 5.2, magnitudeType: 'mww', place: 'off Chile',
  time: NOW - 60_000, depth: 33, lat: -31.5, lon: -71.2, url: 'https://x', tsunami: 0,
};
const FEATURE = {
  id: 'us1000',
  geometry: { type: 'Point', coordinates: [-71.2, -31.5, 33] },
  properties: { mag: 5.2, magType: 'mww', place: 'off Chile', time: NOW - 60_000, url: 'https://x', tsunami: 0 },
};

/** `date` is the server's own clock; undefined stubs a response without it. */
function stubFetch(body: unknown, ok = true, date?: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok,
    status: ok ? 200 : 503,
    headers: new Headers(date ? { date } : {}),
    json: async () => body,
  })) as unknown as typeof globalThis.fetch;
  return () => { globalThis.fetch = original; };
}

async function run(
  body: unknown,
  now = NOW,
  date?: string,
): Promise<{ ok: boolean; count: number; message: string }> {
  const restore = stubFetch(body, true, date);
  try {
    const events = await fetchUsgsSeismicForFusion(now);
    return { ok: true, count: events.length, message: '' };
  } catch (error) {
    return { ok: false, count: 0, message: error instanceof Error ? error.message : String(error) };
  } finally {
    restore();
  }
}

test('parses the sidecar shape (flattened rows)', async () => {
  const r = await run({ events: [FLAT_ROW], source: 'primary', generatedAt: FRESH });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.count, 1);
});

test('parses the web shape (raw GeoJSON features)', async () => {
  // The regression that made the web build record a permanent failure: these
  // rows parsed to zero, and zero is recorded as ok:false by the caller.
  const r = await run({ events: [FEATURE], source: 'usgs.gov', generatedAt: FRESH });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.count, 1, 'raw GeoJSON features must normalize before parsing');
});

test('accepts the live all_day fallback, which is degraded but not a replay', async () => {
  const r = await run({ events: [FLAT_ROW], source: 'fallback-0', degraded: true, generatedAt: FRESH });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.count, 1, 'rejecting on `degraded` alone discards live fallback rows');
});

test('rejects a last-good cache replay', async () => {
  const r = await run({ events: [FLAT_ROW], source: 'cached', degraded: true, generatedAt: FRESH });
  assert.equal(r.ok, false, 'a replay must never corroborate');
  assert.match(r.message, /not live/);
});

test('rejects an unrecognized source rather than trusting it', async () => {
  const r = await run({ events: [FLAT_ROW], source: 'mirror-7', generatedAt: FRESH });
  assert.equal(r.ok, false, 'the source check must be an allowlist, not a denylist');
});

test('rejects a TTL replay: live source, but the payload predates the age cap', async () => {
  // Both routes cache the whole envelope for 60s, so a hit still says
  // 'primary'. Only generatedAt separates it from a fresh fetch.
  const stale = new Date(NOW - 200_000).toISOString();
  const r = await run({ events: [FLAT_ROW], source: 'primary', generatedAt: stale });
  assert.equal(r.ok, false, 'a payload older than the cap is a replay, whatever `source` says');
  assert.match(r.message, /stale replay/);
});

test('accepts a payload inside the age cap', async () => {
  const withinCap = new Date(NOW - 100_000).toISOString();
  const r = await run({ events: [FLAT_ROW], source: 'primary', generatedAt: withinCap });
  assert.equal(r.ok, true, `a legitimate cache hit must not be rejected: ${r.message}`);
});

test('measures age against the response Date header, not the browser clock', async () => {
  // The two ends of the subtraction must come from one clock. Browser 10 min
  // FAST: without the header the payload reads as 10 min old and the vote is
  // lost, even though the server stamped it 5 s ago.
  const skewedNow = NOW + 600_000;
  const withoutHeader = await run({ events: [FLAT_ROW], source: 'primary', generatedAt: FRESH }, skewedNow);
  assert.equal(withoutHeader.ok, false, 'no header leaves only the skewed browser clock');

  const withHeader = await run(
    { events: [FLAT_ROW], source: 'primary', generatedAt: FRESH },
    skewedNow,
    new Date(NOW).toUTCString(),
  );
  assert.equal(withHeader.ok, true, `the server's own clock must win: ${withHeader.message}`);
});

test('a slow browser clock cannot make a replay look fresh', async () => {
  // Browser 10 min SLOW, no Date header: a 5 min old payload would otherwise
  // subtract to a NEGATIVE age and sail past the staleness cap.
  const r = await run({ events: [FLAT_ROW], source: 'primary', generatedAt: new Date(NOW - 300_000).toISOString() }, NOW - 600_000);
  assert.equal(r.ok, false, 'a negative age is unestablishable, not extremely fresh');
  assert.match(r.message, /clock skew/);
});

test('tolerates sub-skew drift rather than failing on flight time', async () => {
  const r = await run({ events: [FLAT_ROW], source: 'primary', generatedAt: new Date(NOW + 10_000).toISOString() }, NOW);
  assert.equal(r.ok, true, `ordinary drift must not cost the vote: ${r.message}`);
});

test('rejects a payload whose age cannot be established', async () => {
  for (const generatedAt of [undefined, null, '', 'not-a-date', 1754136000000]) {
    const r = await run({ events: [FLAT_ROW], source: 'primary', generatedAt });
    assert.equal(r.ok, false, `unknown age must fail closed (generatedAt=${String(generatedAt)})`);
  }
});

test('rejects the sidecar and web error envelopes, which both answer HTTP 200', async () => {
  const sidecar = await run({ events: [], error: 'USGS detail 500', degraded: true });
  assert.equal(sidecar.ok, false);
  assert.match(sidecar.message, /USGS detail 500/, 'a string reason should be echoed');

  const web = await run({ events: [], degraded: true, reason: 'USGS returned HTTP 503', source: 'usgs.gov' });
  assert.equal(web.ok, false);
  assert.match(web.message, /HTTP 503/);
});

test('a non-string error field does not stringify to [object Object]', async () => {
  const r = await run({ events: [], error: { code: 500 } });
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.message, /\[object Object\]/);
});

test('rejects a malformed body', async () => {
  for (const body of [null, {}, { events: 'nope', source: 'primary', generatedAt: FRESH }]) {
    const r = await run(body);
    assert.equal(r.ok, false, `malformed body must throw: ${JSON.stringify(body)}`);
  }
});

test('rejects a non-2xx response', async () => {
  const restore = stubFetch({ events: [FLAT_ROW], source: 'primary', generatedAt: FRESH }, false);
  await assert.rejects(() => fetchUsgsSeismicForFusion(NOW), /503/);
  restore();
});
