import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  fetchCloudflareRadarOutages,
  fetchIodaOutageEvents,
  iodaAlertsToEvents,
} from '../cloudflare-radar-fetch.ts';
import { OUTAGE_COUNT_WINDOW_MS, outageCountsToObservations } from '../outage-fusion-observations.ts';
import { ingestDomain } from '../../providers/fusion-ingest.ts';
import { emptyProviderHealthState, recordFetchOutcome } from '../../providers/provider-health.ts';
import type { ProviderHealthState } from '../../providers/provider-health.ts';

/**
 * Reads a `const NAME = <a> * <b> * ...;` millisecond literal back out of a
 * source file. Used to pin two constants that live in different runtimes
 * (renderer + sidecar) and cannot be imported into one another.
 */
function readConstMs(fileUrl: URL, name: string): number {
  const src = readFileSync(fileUrl, 'utf8');
  const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(m, `${name} not found in ${fileUrl.pathname}`);
  return m[1].split('*').reduce((acc, part) => {
    const n = Number(part.trim().replace(/_/g, ''));
    assert.ok(Number.isFinite(n), `unparseable factor '${part}' in ${name}`);
    return acc * n;
  }, 1);
}

interface StubCall { url: string }

// Snapshotted ONCE, at module scope, and every restore assigns these back.
// node:test runs `t.after` hooks in REGISTRATION order, not LIFO, so a helper
// that snapshots the CURRENT global on each call and restores it in its own
// hook leaves the last-registered stub installed after a test that stubs more
// than once. Restoring to the true original is order-independent.
const REAL_FETCH = globalThis.fetch;
const REAL_ABORT_TIMEOUT = AbortSignal.timeout;

function stubFetch(t: { after: (fn: () => void) => void }, payload: unknown, status = 200): StubCall {
  const call: StubCall = { url: '' };
  globalThis.fetch = ((input: RequestInfo | URL) => {
    call.url = String(input);
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }));
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  return call;
}

/** Captures the ms values passed to AbortSignal.timeout — the only way to read
 *  a requested timeout back, since an AbortSignal does not expose it. */
function spyAbortTimeout(t: { after: (fn: () => void) => void }): number[] {
  const requested: number[] = [];
  AbortSignal.timeout = ((ms: number) => {
    requested.push(ms);
    return REAL_ABORT_TIMEOUT.call(AbortSignal, ms);
  }) as typeof AbortSignal.timeout;
  t.after(() => { AbortSignal.timeout = REAL_ABORT_TIMEOUT; });
  return requested;
}

// The upstream deadline each renderer fetch races. Deliberate LITERALS: they
// mirror src-tauri/sidecar/local-api-server.mjs:17715 (IODA, 15s) and :17739
// (Cloudflare Radar, 12s). Deriving them from the renderer constants would make
// the assertions below true by construction.
const SIDECAR_IODA_DEADLINE_MS = 15_000;
const SIDECAR_CLOUDFLARE_DEADLINE_MS = 12_000;

const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const RECENT = NOW - 60 * 60_000;
const RECENT_SEC = RECENT / 1000;

function healthyBoth(now: number): ProviderHealthState {
  let s = emptyProviderHealthState();
  for (const id of ['ioda', 'cloudflare-radar']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, at: now });
  }
  return s;
}

// ── iodaAlertsToEvents ──────────────────────────────────────────────────────

test('three normal rows plus one alert for BF count as one outage onset, not four', () => {
  // /outages/alerts is an alert-TRANSITION feed: `level: 'normal'` rows are
  // RECOVERIES. Over a live 24h window they are roughly half the payload
  // (measured 2026-07-30: 891 normal vs 925 critical), so counting rows
  // without the level filter roughly doubles every country and reports a
  // permanent global outage storm.
  //
  // The four rows carry four different datasources so the (code, datasource)
  // dedupe cannot mask the filter — without `level !== 'normal'` this yields 4.
  const events = iodaAlertsToEvents([
    { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'normal', from: RECENT_SEC },
    { entityType: 'country', entityCode: 'BF', datasource: 'ping-slash24', level: 'normal', from: RECENT_SEC },
    { entityType: 'country', entityCode: 'BF', datasource: 'merit-nt', level: 'normal', from: RECENT_SEC },
    { entityType: 'country', entityCode: 'BF', datasource: 'gtr', level: 'critical', from: RECENT_SEC },
  ]);
  assert.deepEqual(events, [{ country: 'BF', startedAt: RECENT }]);
});

test("'critical' is the ordinary alert level, not a major-outage marker", () => {
  // Live IODA emits 'critical' for essentially every non-recovery row. A count
  // built from these is an ALERT-ROW count, never a "major outage" count, and
  // nothing downstream may relabel it as one.
  const events = iodaAlertsToEvents([
    { entityType: 'country', entityCode: 'IR', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
  ]);
  assert.equal(events.length, 1);
});

test('level is an ALLOWLIST — absent, null, non-string and unknown levels are dropped', () => {
  // `level` is untrusted input typed `unknown`. A denylist (`level !== 'normal'`)
  // rejects only that exact string, so every malformed row below passes straight
  // through and becomes a real country outage onset. Under the denylist this
  // returns all six countries.
  const events = iodaAlertsToEvents([
    { entityType: 'country', entityCode: 'AA', datasource: 'bgp', from: RECENT_SEC },
    { entityType: 'country', entityCode: 'BB', datasource: 'bgp', level: null, from: RECENT_SEC },
    { entityType: 'country', entityCode: 'CC', datasource: 'bgp', level: 'ok', from: RECENT_SEC },
    { entityType: 'country', entityCode: 'DD', datasource: 'bgp', level: 7, from: RECENT_SEC },
    { entityType: 'country', entityCode: 'EE', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
    { entityType: 'country', entityCode: 'FF', datasource: 'bgp', level: 'warning', from: RECENT_SEC },
  ]);
  assert.deepEqual(events.map((e) => e.country), ['EE', 'FF'], 'only the two onset levels survive');
});

test('a malformed IODA row must not corroborate a real Cloudflare outage', () => {
  // The harm the allowlist prevents, end to end: a row with no `level` at all
  // slips past a denylist, IODA then "sees" BF, and Cloudflare's genuine BF
  // annotation turns it into a corroborated TWO-SOURCE fact built half out of
  // junk. Assert the surviving voter by NAME — a length check would pass on
  // the wrong pair.
  const r = ingestDomain('internet_outages', [
    ...outageCountsToObservations('ioda', iodaAlertsToEvents([
      { entityType: 'country', entityCode: 'BF', datasource: 'bgp', from: RECENT_SEC },
    ]), NOW),
    ...outageCountsToObservations('cloudflare-radar', [{ country: 'BF', startedAt: RECENT }], NOW),
  ], healthyBoth(NOW), NOW);

  assert.equal(r.facts.length, 1);
  assert.deepEqual(r.facts[0]!.providerIds, ['cloudflare-radar'], 'only the source that really saw BF votes');
});

test('never filters on `condition`, which is a threshold string', () => {
  // Live values are 'normal', '< 0.99', '< 0.95', '< 0.8', '< 0.25' — a
  // threshold expression, not a status word. `condition === 'outage'` (or any
  // similar guess) matches nothing and silently empties the feed.
  const events = iodaAlertsToEvents([
    { entityType: 'country', entityCode: 'SD', datasource: 'bgp', level: 'critical', condition: '< 0.25', from: RECENT_SEC },
  ] as Parameters<typeof iodaAlertsToEvents>[0]);
  assert.deepEqual(events.map((e) => e.country), ['SD']);
});

test('drops region and ASN rows, keeping only countries', () => {
  // entityCode is only an ISO2 code for entityType 'country'. Region codes
  // ('BF-01') and ASN numbers are a different namespace entirely, and under
  // matchBy:'key' they would either sit as permanent singletons or collide
  // with a real country key. Live 24h mix: 44 country rows against 275 region,
  // 763 asn and 734 geoasn.
  const events = iodaAlertsToEvents([
    { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
    { entityType: 'region', entityCode: 'BF-01', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
    { entityType: 'asn', entityCode: '12345', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
    { entityType: 'geoasn', entityCode: 'BF-12345', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
  ]);
  assert.deepEqual(events.map((e) => e.country), ['BF']);
});

test('drops rows with a missing or empty entity code', () => {
  const events = iodaAlertsToEvents([
    { entityType: 'country', entityCode: '', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
    { entityType: 'country', entityCode: '   ', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
    { entityType: 'country', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
    { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
  ]);
  assert.deepEqual(events.map((e) => e.country), ['BF']);
});

test('dedupes repeated rows for the same country and datasource', () => {
  // One detection method re-asserting the same country inside the window is
  // one outage, not three. Without the dedupe this counts 3.
  const events = iodaAlertsToEvents([
    { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
    { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'critical', from: RECENT_SEC + 600 },
    { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'critical', from: RECENT_SEC + 1200 },
  ]);
  assert.deepEqual(events, [{ country: 'BF', startedAt: RECENT }], 'first occurrence wins');
});

test('one country seen by two different datasources counts twice', () => {
  // Deliberate, and the reason FUSION_DOMAINS.internet_outages sets
  // numericTolerance to 3: IODA raises a row per detection method, so a single
  // national outage can inflate to 2-3 against Cloudflare's one-annotation-per-
  // event counting. The dedupe key is (entityCode, datasource) — deduping on
  // the country alone would pin every value at 0 or 1, which would make the
  // count carry no information and the tolerance meaningless.
  const events = iodaAlertsToEvents([
    { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
    { entityType: 'country', entityCode: 'BF', datasource: 'ping-slash24', level: 'critical', from: RECENT_SEC },
  ]);
  assert.equal(events.length, 2);
});

test('converts IODA `from` from unix seconds to ms and normalizes the code', () => {
  const events = iodaAlertsToEvents([
    { entityType: 'country', entityCode: ' bf ', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
  ]);
  assert.deepEqual(events, [{ country: 'BF', startedAt: RECENT }]);
});

test('drops rows with an unusable timestamp', () => {
  const events = iodaAlertsToEvents([
    { entityType: 'country', entityCode: 'AA', datasource: 'bgp', level: 'critical', from: Number.NaN },
    { entityType: 'country', entityCode: 'BB', datasource: 'bgp', level: 'critical', from: 0 },
    { entityType: 'country', entityCode: 'CC', datasource: 'bgp', level: 'critical', from: '1785369751' },
    { entityType: 'country', entityCode: 'DD', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
  ]);
  assert.deepEqual(events.map((e) => e.country), ['DD']);
});

test('an all-normal payload yields no events, which is a quiet internet not a failure', () => {
  assert.deepEqual(iodaAlertsToEvents([
    { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'normal', from: RECENT_SEC },
  ]), []);
});

// ── outageCountsToObservations ──────────────────────────────────────────────

test('counts onsets per country into key-matched observations stamped with the wall clock', () => {
  const obs = outageCountsToObservations('ioda', [
    { country: 'BF', startedAt: RECENT },
    { country: 'BF', startedAt: RECENT + 600_000 },
    { country: 'SD', startedAt: RECENT },
  ], NOW);
  assert.deepEqual(obs, [
    { providerId: 'ioda', key: 'BF', value: 2, lat: 0, lon: 0, occurredAt: NOW },
    { providerId: 'ioda', key: 'SD', value: 1, lat: 0, lon: 0, occurredAt: NOW },
  ]);
});

test('drops events older than the trailing count window', () => {
  // Both providers must count over the SAME window or their numbers are not
  // comparable and every shared country reads as a disagreement.
  //
  // BF is placed relative to the window so it is outside whatever the window
  // is. SD's 5h is a deliberate LITERAL, not `RECENT` and not window-relative:
  // it is the only fixture that straddles the window, so shrinking the constant
  // drops SD and fails this test. Both rows expressed relative to the constant
  // would be true by construction and would pin nothing.
  const obs = outageCountsToObservations('ioda', [
    { country: 'BF', startedAt: NOW - OUTAGE_COUNT_WINDOW_MS - 60 * 60_000 },
    { country: 'SD', startedAt: NOW - 5 * 60 * 60_000 },
  ], NOW);
  assert.deepEqual(obs.map((o) => o.key), ['SD']);
});

test('the window edge is inclusive — an event exactly at the cutoff still counts', () => {
  // The comparison is `startedAt < cutoff`, so an event landing exactly on
  // NOW - OUTAGE_COUNT_WINDOW_MS is INSIDE the window. Both providers count
  // over the same trailing window, so the two sides must agree on which way
  // the boundary falls or a shared outage sitting on the edge reads as a
  // disagreement. Loosening to `<=` silently drops this row.
  const obs = outageCountsToObservations('ioda', [
    { country: 'BF', startedAt: NOW - OUTAGE_COUNT_WINDOW_MS },
    { country: 'SD', startedAt: NOW - OUTAGE_COUNT_WINDOW_MS - 1 },
  ], NOW);
  assert.deepEqual(obs.map((o) => o.key), ['BF'], 'edge is in, one ms past it is out');
});

test('drops rows with a missing country key', () => {
  const obs = outageCountsToObservations('ioda', [
    { country: '', startedAt: RECENT },
    { country: '   ', startedAt: RECENT },
    { country: 'BF', startedAt: RECENT },
  ], NOW);
  assert.deepEqual(obs.map((o) => o.key), ['BF']);
});

test("''-keyed rows from both providers would fuse into one bogus corroborated fact", () => {
  // Why the empty-key guard exists: matchBy:'key' ignores distance entirely,
  // so '' is a perfectly good cluster key and two junk rows corroborate each
  // other into a 2-vote "fact" about a country that does not exist.
  const junk = ingestDomain('internet_outages', [
    { providerId: 'ioda', key: '', value: 1, lat: 0, lon: 0, occurredAt: NOW },
    { providerId: 'cloudflare-radar', key: '', value: 1, lat: 0, lon: 0, occurredAt: NOW },
  ], healthyBoth(NOW), NOW);
  assert.equal(junk.facts.length, 1);
  assert.equal(junk.facts[0]!.providerIds.length, 2, 'two junk rows corroborate each other — exactly what the guard stops');

  const guarded = ingestDomain('internet_outages', [
    ...outageCountsToObservations('ioda', [{ country: '', startedAt: RECENT }], NOW),
    ...outageCountsToObservations('cloudflare-radar', [{ country: '', startedAt: RECENT }], NOW),
  ], healthyBoth(NOW), NOW);
  assert.equal(guarded.facts.length, 0, 'the adapter drops them before they can fuse');
});

// ── IODA fetch ──────────────────────────────────────────────────────────────

test('fetchIodaOutageEvents asks for limit=5000 over a 24h window', async (t) => {
  // The shared route defaults to limit=50 and IODA returns rows ASCENDING, so
  // the limit truncates the NEWEST rows. At 50 the fusion path would see only
  // the oldest sliver of the day and still report success.
  const call = stubFetch(t, { alerts: [] });
  await fetchIodaOutageEvents(NOW);
  const url = new URL(call.url, 'http://sidecar.test');
  assert.equal(url.pathname, '/api/internet-outages');
  assert.equal(url.searchParams.get('limit'), '5000');
  const from = Number(url.searchParams.get('from'));
  const until = Number(url.searchParams.get('until'));
  assert.equal(until, Math.floor(NOW / 1000));
  assert.equal(until - from, 24 * 60 * 60);
});

test('fetchIodaOutageEvents snaps its window so ticks inside one quantum share a cache key', async (t) => {
  // The route's cache key is `ioda-outages:${from}:${until}:${limit}`. An
  // unsnapped `now` makes every call's key unique, so the sidecar's 15 min
  // cache is provably never hit and each scheduled tick is a fresh limit=5000
  // request against a keyless fair-use API. This is what bounds the upstream
  // rate to one request per quantum regardless of the loader's cadence.
  //
  // NOTE: the limit=5000 test above uses a NOW that already sits exactly on a
  // 15 min boundary, so it cannot observe snapping at all. These instants are
  // deliberately off-boundary.
  // Read the quantum out of BOTH sides rather than restating it. Every
  // assertion below is relative to the quantum, so a local constant would let
  // the production value drift freely: at a 30 min quantum these same
  // instants still share a key and `until` still lands on BOUNDARY+15min,
  // and the test stays green while each cache key outlives the 15 min entry
  // it is meant to reuse. Pinning the two together is the actual contract.
  const QUANTUM_MS = readConstMs(
    new URL('../cloudflare-radar-fetch.ts', import.meta.url),
    'IODA_WINDOW_QUANTUM_MS',
  );
  const sidecarTtlMs = readConstMs(
    new URL('../../../../src-tauri/sidecar/local-api-server.mjs', import.meta.url),
    'IODA_TTL',
  );
  assert.equal(
    QUANTUM_MS,
    sidecarTtlMs,
    'the fusion window quantum must equal the route\'s IODA_TTL: larger and every key outlives its ' +
    'cache entry, smaller and each boundary abandons a still-valid entry and multiplies the upstream rate',
  );
  const BOUNDARY = Date.parse('2026-07-30T12:15:00.000Z');
  const call = stubFetch(t, { alerts: [] });

  await fetchIodaOutageEvents(BOUNDARY + 20_000);
  const first = call.url;
  await fetchIodaOutageEvents(BOUNDARY + 14 * 60_000);
  const second = call.url;
  assert.equal(second, first, 'two ticks 14 min apart inside one quantum reuse the same key');

  const url = new URL(first, 'http://sidecar.test');
  const until = Number(url.searchParams.get('until'));
  const from = Number(url.searchParams.get('from'));
  assert.equal(until, (BOUNDARY + QUANTUM_MS) / 1000, 'until snaps UP to the next boundary');
  assert.equal(until - from, 24 * 60 * 60, 'snapping moves the window without resizing it');

  // The reason it snaps up rather than down. A floored `until` ends BEFORE the
  // caller instant, so every onset published between the boundary and this tick
  // is truncated away — and since the adapter emits no observation at all for a
  // country with zero rows, that silently drops the country to a single vote
  // while Cloudflare still reports it.
  for (const offsetMs of [20_000, 14 * 60_000, QUANTUM_MS - 1]) {
    await fetchIodaOutageEvents(BOUNDARY + offsetMs);
    const tickUntil = Number(new URL(call.url, 'http://sidecar.test').searchParams.get('until')) * 1000;
    assert.ok(
      tickUntil >= BOUNDARY + offsetMs,
      `until (${tickUntil}) must never end before the caller instant (${BOUNDARY + offsetMs})`,
    );
  }

  // Crossing the boundary must produce a NEW key, or the window would freeze
  // and the domain would count outages over a receding 24 h forever. Under ceil
  // the boundary instant itself still belongs to the OLD quantum, so step past.
  await fetchIodaOutageEvents(BOUNDARY + QUANTUM_MS + 1000);
  assert.notEqual(call.url, first, 'the next quantum fetches fresh');
});

test('fetchIodaOutageEvents outlives the 15s deadline on the route it races', async (t) => {
  // Each renderer timeout must STRICTLY EXCEED the sidecar deadline behind the
  // route it calls. Aborting first kills the request before the sidecar can
  // record its degraded response or setCached the good one, so a slow-but-
  // successful upstream reads as a hard failure on every tick.
  //
  // IODA and Cloudflare race DIFFERENT deadlines (15s vs 12s), so the two
  // constants are not interchangeable: swapping them at the call sites hands
  // IODA a 15s timeout against a 15s deadline and reinstates the bug.
  const requested = spyAbortTimeout(t);
  stubFetch(t, { alerts: [] });
  await fetchIodaOutageEvents(NOW);
  assert.equal(requested.length, 1, 'exactly one timeout requested');
  assert.ok(
    requested[0]! > SIDECAR_IODA_DEADLINE_MS,
    `IODA renderer timeout ${requested[0]}ms must exceed the route's ${SIDECAR_IODA_DEADLINE_MS}ms upstream deadline`,
  );
});

test('fetchCloudflareRadarOutages outlives the 12s deadline on the route it races', async (t) => {
  const requested = spyAbortTimeout(t);
  stubFetch(t, { outages: [] });
  await fetchCloudflareRadarOutages();
  assert.equal(requested.length, 1, 'exactly one timeout requested');
  assert.ok(
    requested[0]! > SIDECAR_CLOUDFLARE_DEADLINE_MS,
    `Cloudflare renderer timeout ${requested[0]}ms must exceed the route's ${SIDECAR_CLOUDFLARE_DEADLINE_MS}ms upstream deadline`,
  );
});

test('fetchIodaOutageEvents reports a quiet internet as a success, not a failure', async (t) => {
  // The domain-wide exception: zero qualifying rows behind a 200 is a real
  // observation. Failing it closed would blank the domain exactly when
  // everything is working.
  stubFetch(t, { alerts: [] });
  assert.deepEqual(await fetchIodaOutageEvents(NOW), { ok: true, events: [] }, 'empty payload');

  stubFetch(t, {
    alerts: [
      { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'normal', from: RECENT_SEC },
      { entityType: 'asn', entityCode: '12345', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
    ],
  });
  assert.deepEqual(await fetchIodaOutageEvents(NOW), { ok: true, events: [] }, 'rows present but none qualify');
});

test('fetchIodaOutageEvents fails closed on non-2xx, degraded, and a malformed body', async (t) => {
  const empty = { ok: false, events: [] };
  const good = [{ entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'critical', from: RECENT_SEC }];

  stubFetch(t, { alerts: good }, 502);
  assert.deepEqual(await fetchIodaOutageEvents(NOW), empty, 'non-2xx');

  // Otherwise fully valid — `degraded` must be the sole reason this fails.
  stubFetch(t, { alerts: good, degraded: true });
  assert.deepEqual(await fetchIodaOutageEvents(NOW), empty, 'degraded flag');

  stubFetch(t, { alerts: 'nope' });
  assert.deepEqual(await fetchIodaOutageEvents(NOW), empty, 'alerts is not an array');

  stubFetch(t, {});
  assert.deepEqual(await fetchIodaOutageEvents(NOW), empty, 'alerts missing entirely');

  stubFetch(t, null);
  assert.deepEqual(await fetchIodaOutageEvents(NOW), empty, 'null body');
});

test('fetchIodaOutageEvents returns the mapped events on success', async (t) => {
  stubFetch(t, {
    alerts: [
      { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'critical', from: RECENT_SEC },
      { entityType: 'country', entityCode: 'BF', datasource: 'bgp', level: 'normal', from: RECENT_SEC + 900 },
    ],
  });
  assert.deepEqual(await fetchIodaOutageEvents(NOW), { ok: true, events: [{ country: 'BF', startedAt: RECENT }] });
});

// ── Cloudflare Radar fetch ──────────────────────────────────────────────────

test('fetchCloudflareRadarOutages reads the sidecar route and maps its rows', async (t) => {
  const call = stubFetch(t, { outages: [{ country: ' bf ', startedAt: RECENT }] });
  const r = await fetchCloudflareRadarOutages();
  assert.equal(new URL(call.url, 'http://sidecar.test').pathname, '/api/internet-outages-cf');
  assert.deepEqual(r, { ok: true, events: [{ country: 'BF', startedAt: RECENT }] });
});

test('fetchCloudflareRadarOutages reports an empty annotation list as a success', async (t) => {
  stubFetch(t, { outages: [] });
  assert.deepEqual(await fetchCloudflareRadarOutages(), { ok: true, events: [] });
});

test('fetchCloudflareRadarOutages fails closed on non-2xx, degraded, and a malformed body', async (t) => {
  const empty = { ok: false, events: [] };
  const good = [{ country: 'BF', startedAt: RECENT }];

  stubFetch(t, { outages: good }, 502);
  assert.deepEqual(await fetchCloudflareRadarOutages(), empty, 'non-2xx');

  // The no-token case: the sidecar answers 200 with degraded:true, and that
  // must never be recorded as a healthy vote.
  stubFetch(t, { outages: [], degraded: true });
  assert.deepEqual(await fetchCloudflareRadarOutages(), empty, 'degraded flag');

  stubFetch(t, { outages: 'nope' });
  assert.deepEqual(await fetchCloudflareRadarOutages(), empty, 'outages is not an array');

  stubFetch(t, {});
  assert.deepEqual(await fetchCloudflareRadarOutages(), empty, 'outages missing entirely');

  stubFetch(t, null);
  assert.deepEqual(await fetchCloudflareRadarOutages(), empty, 'null body');
});

test('fetchCloudflareRadarOutages drops unusable rows without failing the fetch', async (t) => {
  stubFetch(t, {
    outages: [
      { country: '', startedAt: RECENT },
      { country: 'BF', startedAt: Number.NaN },
      { country: 'BF', startedAt: 0 },
      { country: 'SD', startedAt: RECENT },
    ],
  });
  assert.deepEqual(await fetchCloudflareRadarOutages(), { ok: true, events: [{ country: 'SD', startedAt: RECENT }] });
});

// ── Fusion ──────────────────────────────────────────────────────────────────

test('BF counted 4 by IODA and 2 by Cloudflare fuses into one two-vote fact', () => {
  // The expected steady state: IODA inflates per detection method, Cloudflare
  // curates one annotation per event. A gap this size is methodology, not a
  // defect, and must not read as disagreement.
  const r = ingestDomain('internet_outages', [
    ...outageCountsToObservations('ioda', [
      { country: 'BF', startedAt: RECENT },
      { country: 'BF', startedAt: RECENT },
      { country: 'BF', startedAt: RECENT },
      { country: 'BF', startedAt: RECENT },
    ], NOW),
    ...outageCountsToObservations('cloudflare-radar', [
      { country: 'BF', startedAt: RECENT },
      { country: 'BF', startedAt: RECENT },
    ], NOW),
  ], healthyBoth(NOW), NOW);

  assert.equal(r.facts.length, 1, 'same country collapses to one fact');
  const f = r.facts[0]!;
  assert.equal(f.key, 'BF');
  assert.equal(f.providerIds.length, 2);
  assert.equal(f.fusion.disagreements.length, 0);
  // Pin to a concrete value first: `undefined === undefined` would pass this
  // vacuously if the fact never formed.
  assert.equal(typeof r.providerFingerprints['ioda'], 'string');
  assert.equal(r.providerFingerprints['ioda'], r.providerFingerprints['cloudflare-radar']);
});

test('BF counted 9 by one source and 1 by the other surfaces a disagreement', () => {
  const r = ingestDomain('internet_outages', [
    ...outageCountsToObservations('ioda', Array.from({ length: 9 }, () => ({ country: 'BF', startedAt: RECENT })), NOW),
    ...outageCountsToObservations('cloudflare-radar', [{ country: 'BF', startedAt: RECENT }], NOW),
  ], healthyBoth(NOW), NOW);

  const f = r.facts[0]!;
  assert.ok(f.fusion.disagreements.length >= 1, 'disagreement surfaces');
  // Only the outlier is named, never the pair — a disagreement listing both
  // providers would mean the consensus side got reported as dissenting. With
  // two size-1 clusters every tie-break in splitConsensus draws (one
  // independence group each, one observation each, identical reliabilityWeight
  // 0.85), so consensus falls to first-seen order and it is the SECOND
  // provider that gets reported. Counting the ids instead would be true by
  // construction and would pin nothing.
  assert.deepEqual(f.fusion.disagreements[0]!.providerIds, ['cloudflare-radar']);
  assert.ok(f.fusion.confidenceMultiplier <= 0.6, 'capped at the disagreement ceiling');
  assert.ok('ioda' in f.fingerprints, 'fingerprint map names ioda');
  assert.ok('cloudflare-radar' in f.fingerprints, 'fingerprint map names cloudflare-radar');
  assert.notEqual(f.fingerprints['ioda'], f.fingerprints['cloudflare-radar']);
});

test('a country only one source sees stays a single-vote fact rather than vanishing', () => {
  // The expected steady state for this domain — a 24h IODA window yields ~20
  // countries, Cloudflare curates far fewer, so most facts carry one vote.
  const r = ingestDomain('internet_outages', [
    ...outageCountsToObservations('ioda', [{ country: 'SD', startedAt: RECENT }], NOW),
    ...outageCountsToObservations('cloudflare-radar', [{ country: 'BF', startedAt: RECENT }], NOW),
  ], healthyBoth(NOW), NOW);

  assert.equal(r.facts.length, 2);
  for (const f of r.facts) {
    assert.equal(f.providerIds.length, 1, `${f.key} is seen by one source only`);
    assert.equal(f.fusion.disagreements.length, 0, 'one observation cannot disagree with itself');
  }
});
