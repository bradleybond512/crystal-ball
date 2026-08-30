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
      status: 'Actual',
      messageType: 'Alert',
      event: 'Special Weather Statement',
      severity,
      headline: 'h',
      description: 'd',
      areaDesc: 'Somewhere, US',
      sent: '2026-07-27T11:55:00Z',
      effective: '2026-07-27T12:00:00Z',
      onset: '2026-07-27T12:00:00Z',
      expires: '2026-07-27T13:00:00Z',
      geocode: { UGC: ['INC091'] },
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
        status: 'Actual',
        messageType: 'Alert',
        event: 'Severe Thunderstorm Warning',
        severity: 'Severe',
        headline: 'h',
        description: 'd',
        areaDesc: 'Somewhere, US',
        sent: '2026-07-27T11:55:00Z',
        effective: '2026-07-27T12:00:00Z',
        onset: '2026-07-27T12:00:00Z',
        expires: '2026-07-27T13:00:00Z',
        geocode: { UGC: ['INC091'] },
      },
    }],
  } as never);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.severity, 'Severe');
});

test('live normalization retains exact CAP lifecycle and evidence completeness', () => {
  const [alert] = normalizeWeatherAlertsResponse({ features: [featureWith('Severe')] } as never);

  assert.equal(alert?.status, 'Actual');
  assert.equal(alert?.messageType, 'Alert');
  assert.equal(alert?.sent?.toISOString(), '2026-07-27T11:55:00.000Z');
  assert.equal(alert?.effective?.toISOString(), '2026-07-27T12:00:00.000Z');
  assert.equal(alert?.reportedOnset?.toISOString(), '2026-07-27T12:00:00.000Z');
  assert.equal(alert?.onset.toISOString(), '2026-07-27T12:00:00.000Z');
  assert.equal(alert?.expires.toISOString(), '2026-07-27T13:00:00.000Z');
  assert.equal(alert?.geometryStatus, 'absent');
  assert.equal(alert?.ugcStatus, 'complete');
});

test('missing onset preserves null reported onset and uses effective for legacy onset', () => {
  const feature = featureWith('Severe');
  delete (feature.properties as { onset?: unknown }).onset;

  const [alert] = normalizeWeatherAlertsResponse({ features: [feature] } as never);
  assert.equal(alert?.reportedOnset, null);
  assert.equal(alert?.onset.toISOString(), '2026-07-27T12:00:00.000Z');
});

test('only Actual CAP status is retained while recognized non-Actual statuses are dropped', () => {
  for (const status of ['Draft', 'Exercise', 'System', 'Test']) {
    const feature = featureWith('Severe');
    feature.properties.status = status;
    assert.deepEqual(normalizeWeatherAlertsResponse({ features: [feature] } as never), []);
  }
});

test('missing or unrecognized CAP status rejects the whole batch', () => {
  const missing = featureWith('Severe');
  delete (missing.properties as { status?: unknown }).status;
  const unknown = featureWith('Severe');
  unknown.properties.status = 'Production';

  assert.throws(() => normalizeWeatherAlertsResponse({ features: [missing] } as never));
  assert.throws(() => normalizeWeatherAlertsResponse({ features: [unknown] } as never));
});

test('only Alert and Update message types are retained', () => {
  const update = featureWith('Severe');
  update.properties.messageType = 'Update';
  assert.equal(normalizeWeatherAlertsResponse({ features: [update] } as never)[0]?.messageType, 'Update');

  for (const messageType of ['Cancel', 'Ack', 'Error']) {
    const feature = featureWith('Severe');
    feature.properties.messageType = messageType;
    assert.deepEqual(normalizeWeatherAlertsResponse({ features: [feature] } as never), []);
  }
});

test('missing or unrecognized message type rejects the whole batch', () => {
  const missing = featureWith('Severe');
  delete (missing.properties as { messageType?: unknown }).messageType;
  const unknown = featureWith('Severe');
  unknown.properties.messageType = 'Supersede';

  assert.throws(() => normalizeWeatherAlertsResponse({ features: [missing] } as never));
  assert.throws(() => normalizeWeatherAlertsResponse({ features: [unknown] } as never));
});

test('invalid required lifecycle fields reject the live response', () => {
  for (const field of ['sent', 'effective', 'expires'] as const) {
    const missing = featureWith('Severe');
    delete (missing.properties as Record<string, unknown>)[field];
    assert.throws(() => normalizeWeatherAlertsResponse({ features: [missing] } as never));

    const invalid = featureWith('Severe');
    invalid.properties[field] = 'not-a-date';
    assert.throws(() => normalizeWeatherAlertsResponse({ features: [invalid] } as never));
  }
});

test('an invalid optional onset rejects the live response instead of using effective', () => {
  const feature = featureWith('Severe');
  feature.properties.onset = 'not-a-date';
  assert.throws(() => normalizeWeatherAlertsResponse({ features: [feature] } as never));
});

test('missing, blank, or oversized identifiers and event text reject the batch', () => {
  for (const field of ['id', 'event'] as const) {
    const missing = featureWith('Severe') as Record<string, unknown>;
    if (field === 'id') delete missing.id;
    else delete ((missing.properties as Record<string, unknown>)[field]);
    assert.throws(() => normalizeWeatherAlertsResponse({ features: [missing] } as never));

    const blank = featureWith('Severe');
    if (field === 'id') blank.id = '   ';
    else blank.properties.event = '   ';
    assert.throws(() => normalizeWeatherAlertsResponse({ features: [blank] } as never));

    const oversized = featureWith('Severe');
    if (field === 'id') oversized.id = 'x'.repeat(4_097);
    else oversized.properties.event = 'x'.repeat(1_025);
    assert.throws(() => normalizeWeatherAlertsResponse({ features: [oversized] } as never));
  }
});

test('Polygon holes are preserved for evidence consumers while legacy coordinates retain the outer ring', () => {
  const feature = featureWith('Severe');
  const outer = [[-1, 0], [1, 0], [1, 2], [-1, 2], [-1, 0]];
  const hole = [[-0.5, 0.5], [0.5, 0.5], [0.5, 1.5], [-0.5, 1.5], [-0.5, 0.5]];
  feature.geometry = { type: 'Polygon', coordinates: [outer, hole] } as never;

  const [alert] = normalizeWeatherAlertsResponse({ features: [feature] } as never);
  assert.equal(alert?.geometryStatus, 'complete');
  assert.deepEqual(alert?.coordinates, outer);
  assert.equal(alert?.polygonRings, undefined);
  assert.deepEqual(alert?.polygonAreas, [{ rings: [outer, hole] }]);
});

test('MultiPolygon areas and their holes are preserved while legacy polygonRings retain every outer', () => {
  const feature = featureWith('Severe');
  const outerA = [[-2, 0], [-1, 0], [-1, 1], [-2, 1], [-2, 0]];
  const holeA = [[-1.8, 0.2], [-1.2, 0.2], [-1.2, 0.8], [-1.8, 0.8], [-1.8, 0.2]];
  const outerB = [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]];
  feature.geometry = { type: 'MultiPolygon', coordinates: [[outerA, holeA], [outerB]] } as never;

  const [alert] = normalizeWeatherAlertsResponse({ features: [feature] } as never);
  assert.equal(alert?.geometryStatus, 'complete');
  assert.deepEqual(alert?.coordinates, outerA);
  assert.deepEqual(alert?.polygonRings, [outerA, outerB]);
  assert.deepEqual(alert?.polygonAreas, [{ rings: [outerA, holeA] }, { rings: [outerB] }]);
});

test('zero coordinates are valid and malformed geometry is explicitly incomplete', () => {
  const valid = featureWith('Severe');
  valid.geometry = {
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]],
  } as never;
  assert.equal(
    normalizeWeatherAlertsResponse({ features: [valid] } as never)[0]?.geometryStatus,
    'complete',
  );

  const malformed = featureWith('Severe');
  malformed.geometry = {
    type: 'Polygon',
    coordinates: [[[0, 0], [181, 0], [0, 1], [0, 0]]],
  } as never;
  const [alert] = normalizeWeatherAlertsResponse({ features: [malformed] } as never);
  assert.equal(alert?.geometryStatus, 'invalid');
  assert.equal(alert?.polygonAreas, undefined);
});

test('UGC values are allowlist-filtered, deduplicated, and marked incomplete when any are rejected', () => {
  const feature = featureWith('Severe');
  feature.properties.geocode = { UGC: ['INC091', 'INC091', 'bad', '', 'INZ103'] };

  const [alert] = normalizeWeatherAlertsResponse({ features: [feature] } as never);
  assert.deepEqual(alert?.ugcZones, ['INC091', 'INZ103']);
  assert.equal(alert?.ugcStatus, 'invalid');
});

test('a genuinely absent UGC field is distinct from malformed UGC evidence', () => {
  const absent = featureWith('Severe');
  delete absent.properties.geocode;
  assert.equal(normalizeWeatherAlertsResponse({ features: [absent] } as never)[0]?.ugcStatus, 'absent');

  const invalid = featureWith('Severe');
  invalid.properties.geocode = { UGC: 'INC091' as never };
  assert.equal(normalizeWeatherAlertsResponse({ features: [invalid] } as never)[0]?.ugcStatus, 'invalid');
});

test('provider geometry and UGC hard bounds fail the whole response closed', () => {
  const tooManyAreas = featureWith('Severe');
  const triangle = [[[0, 0], [1, 0], [0, 1], [0, 0]]];
  tooManyAreas.geometry = {
    type: 'MultiPolygon',
    coordinates: Array.from({ length: 129 }, () => triangle),
  } as never;
  assert.throws(() => normalizeWeatherAlertsResponse({ features: [tooManyAreas] } as never));

  const tooManyZones = featureWith('Severe');
  tooManyZones.properties.geocode = {
    UGC: Array.from({ length: 2_049 }, (_, i) => `INZ${String(i % 1_000).padStart(3, '0')}`),
  };
  assert.throws(() => normalizeWeatherAlertsResponse({ features: [tooManyZones] } as never));
});
