import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchWeatherAlerts,
  getWeatherAlertsFeedState,
  isWeatherFeedFresh,
  normalizeWeatherAlertsResponse,
} from '../../weather.ts';

// ── fetchWeatherAlerts: a malformed 200 must NOT prove "all clear" (P0 #A) ────
// The NWS circuit breaker records a resolved `fn` as a LIVE success and a thrown
// `fn` as a failure (mode → 'unavailable'). The data-loader reads the breaker's
// mode via getWeatherAlertsFeedState()/isWeatherFeedFresh() to decide whether an
// empty candidate set is a real clear or a dead feed. If fetchWeatherAlerts
// returns [] on a corrupt 200 (a body with no `features` array), the breaker
// logs a live success, the feed reads FRESH, and the loader can confirm "all
// clear" — erasing a live threat off a garbage payload. Only a VALID empty
// `features: []` may prove clear; a malformed body must throw so the feed reads
// unavailable and the clear is withheld.

const realFetch = globalThis.fetch;

function withFetch(stub: typeof globalThis.fetch, body: () => Promise<void>): Promise<void> {
  globalThis.fetch = stub;
  return body().finally(() => { globalThis.fetch = realFetch; });
}

function response(init: { ok: boolean; status: number; json: () => Promise<unknown> }): Response {
  return init as unknown as Response;
}

test('a malformed 200 (no features array) leaves the feed NOT fresh (no false clear)', async () => {
  // A successful HTTP 200 whose JSON body has no `features` array is corrupt,
  // not a clear sky. It must route the breaker to a non-live state so the
  // clear decision falls through to `leave`, never `confirm_clear`.
  await withFetch(
    (async () => response({ ok: true, status: 200, json: async () => ({ /* no features */ }) })) as unknown as typeof globalThis.fetch,
    async () => {
      await fetchWeatherAlerts();
      assert.equal(
        isWeatherFeedFresh(getWeatherAlertsFeedState()),
        false,
        'a corrupt payload must not read as a fresh, clear-proving feed',
      );
    },
  );
});

// ── normalizeWeatherAlertsResponse: the malformed-vs-empty seam (pure) ────────
// These pin BOTH branches without the breaker: a valid empty feed must still
// prove clear (return []), while any body lacking a `features` array must throw.

test('a valid empty features array passes through (a legitimate all-clear)', () => {
  assert.deepEqual(normalizeWeatherAlertsResponse({ features: [] }), []);
});

test('a body with no features array throws (malformed, not clear)', () => {
  assert.throws(() => normalizeWeatherAlertsResponse({} as never));
});

test('a null/undefined body throws (malformed, not clear)', () => {
  assert.throws(() => normalizeWeatherAlertsResponse(null));
  assert.throws(() => normalizeWeatherAlertsResponse(undefined));
});

test('a features value that is not an array throws (malformed, not clear)', () => {
  assert.throws(() => normalizeWeatherAlertsResponse({ features: 'nope' } as never));
});

// ── Per-feature severity validation: an unclassifiable feature is not clear ───
// Validating only the `features` container is not enough. A 200 whose features
// array contains an entry we cannot classify by severity (missing or unrecognized
// severity) is a malformed/unknown product: it survives normalization as a
// non-severe alert, never enters the severe loop, and reaches `confirm_clear`.
// That is a fail-open — the corrupt entry could be masking a Severe warning. A
// feature we cannot classify must throw (feed → unavailable, clear withheld),
// exactly like a corrupt container. A recognized severity — INCLUDING the valid
// NWS value 'Unknown', which is well-formed and merely filtered downstream — must
// NOT throw.

function featureWith(severity: unknown) {
  return {
    id: 'nws-x',
    geometry: null,
    properties: {
      event: 'Special Weather Statement',
      severity,
      headline: 'h',
      description: 'd',
      areaDesc: 'Somewhere, US',
      onset: '2026-07-27T12:00:00Z',
      expires: '2026-07-27T13:00:00Z',
    },
  };
}

test('a feature with a missing severity throws (unclassifiable, not clear)', () => {
  const feature = featureWith(undefined);
  delete (feature.properties as { severity?: unknown }).severity;
  assert.throws(() => normalizeWeatherAlertsResponse({ features: [feature] } as never));
});

test('a feature with an unrecognized severity string throws (unclassifiable, not clear)', () => {
  assert.throws(() => normalizeWeatherAlertsResponse({ features: [featureWith('Catastrophic')] } as never));
});

test("a feature with the valid NWS 'Unknown' severity is well-formed (filtered, not thrown)", () => {
  assert.deepEqual(normalizeWeatherAlertsResponse({ features: [featureWith('Unknown')] } as never), []);
});

test('one unclassifiable feature rejects the whole batch (withhold clear over a hidden severe)', () => {
  const good = {
    id: 'nws-severe-1',
    geometry: null,
    properties: {
      event: 'Severe Thunderstorm Warning', severity: 'Severe', headline: 'h', description: 'd',
      areaDesc: 'Somewhere, US', onset: '2026-07-27T12:00:00Z', expires: '2026-07-27T13:00:00Z',
    },
  };
  assert.throws(() => normalizeWeatherAlertsResponse({ features: [good, featureWith(undefined)] } as never));
});

test('a valid non-empty feed normalizes and retains a Severe alert', () => {
  const out = normalizeWeatherAlertsResponse({
    features: [{
      id: 'nws-severe-1',
      geometry: null,
      properties: {
        event: 'Severe Thunderstorm Warning',
        severity: 'Severe',
        headline: 'h',
        description: 'd',
        areaDesc: 'Somewhere, US',
        onset: '2026-07-27T12:00:00Z',
        expires: '2026-07-27T13:00:00Z',
        geocode: { UGC: ['INC091'] },
      },
    }],
  } as never);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.severity, 'Severe');
});
