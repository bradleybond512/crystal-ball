import assert from 'node:assert/strict';
import test from 'node:test';

import { computeAlertExposure, exposureFromMatch, toIsoString } from '../weather-exposure.ts';
import { detectBigEvent } from '../../insights/big-event-detector.ts';
import type { PolygonMatchResult, SavedPlace } from '../weather-threat-types.ts';
import type { WeatherAlert } from '../../weather.ts';

const NOW = 1_745_000_000_000;

// ── toIsoString: crash-safe timestamp coercion (P0 #6) ───────────────────
// The datacenter mapping in data-loader coerced alert timestamps with
// `a.onset instanceof Date ? a.onset.toISOString() : String(a.onset)`. An
// INVALID Date (`new Date('garbage')`) still passes `instanceof Date`, and its
// `.toISOString()` throws RangeError('Invalid time value'). That block has no
// inner try/catch, so one malformed NWS timestamp aborted the whole weather
// tick — including the status-chip publication downstream, which could leave a
// stale "ALL CLEAR" up during a live storm. This shared guard makes an invalid
// Date coerce to '' instead of throwing, and passes real values through.

test('toIsoString: an invalid Date coerces to empty string, never throws', () => {
  assert.equal(toIsoString(new Date('garbage')), '');
});

test('toIsoString: a real Date becomes its ISO form', () => {
  assert.equal(toIsoString(new Date('2026-07-27T18:00:00Z')), '2026-07-27T18:00:00.000Z');
});

test('toIsoString: a cache-hydrated ISO string passes straight through', () => {
  assert.equal(toIsoString('2026-07-27T18:00:00Z'), '2026-07-27T18:00:00Z');
});

test('toIsoString: null / undefined coerce to empty string', () => {
  assert.equal(toIsoString(null), '');
  assert.equal(toIsoString(undefined), '');
});

// ── Fixtures: La Porte, IN (the user's saved home) ───────────────────────

const HOME: SavedPlace = {
  id: 'home',
  label: 'La Porte, IN',
  lat: 41.610,
  lon: -86.722,
};

/** A warning polygon that CONTAINS La Porte. */
const COVERS_HOME: [number, number][] = [
  [-87.00, 41.40],
  [-86.40, 41.40],
  [-86.40, 41.80],
  [-87.00, 41.80],
  [-87.00, 41.40],
];

/** A polygon ~200 km east (Detroit) — nowhere near La Porte. */
const FAR_AWAY: [number, number][] = [
  [-83.5, 42.0],
  [-83.0, 42.0],
  [-83.0, 42.5],
  [-83.5, 42.5],
  [-83.5, 42.0],
];

function tornadoWarning(coordinates: [number, number][]): WeatherAlert {
  return {
    id: 'nws-tornado-1',
    event: 'Tornado Warning',
    severity: 'Extreme',
    headline: 'Tornado Warning for La Porte County',
    description: 'A confirmed tornado was located near La Porte.',
    areaDesc: 'La Porte, IN',
    onset: new Date(NOW),
    expires: new Date(NOW + 45 * 60_000),
    coordinates,
    centroid: [-86.70, 41.60],
    ugcZones: ['INC091'],
  };
}

/** A MultiPolygon warning: the FIRST sub-polygon is far away (Detroit), the
 *  SECOND covers La Porte. NWS issues MultiPolygon products routinely (a warning
 *  split across disjoint areas). `coordinates` legacy-carries only the first
 *  ring; `polygonRings` carries every outer ring. */
function multiPolygonTornado(): WeatherAlert {
  return {
    id: 'nws-tornado-multi',
    event: 'Tornado Warning',
    severity: 'Extreme',
    headline: 'Tornado Warning (multi-area)',
    description: 'A confirmed tornado in two disjoint areas.',
    areaDesc: 'Detroit, MI and La Porte, IN',
    onset: new Date(NOW),
    expires: new Date(NOW + 45 * 60_000),
    coordinates: FAR_AWAY, // legacy single ring = the FAR sub-polygon only
    polygonRings: [FAR_AWAY, COVERS_HOME],
    centroid: [-86.70, 41.60],
    ugcZones: ['INC091'],
  };
}

// ── computeAlertExposure ─────────────────────────────────────────────────

// ── Regression: MultiPolygon warnings (P0 #4) ────────────────────────────
// extractCoordinates collapsed a MultiPolygon to `coords[0][0]` — the FIRST
// sub-polygon's outer ring only. A warning whose SECOND sub-polygon sits over
// the user's home matched NOTHING (the first ring is far away), so exposure was
// 0 and the Big Event Detector dropped it: a silent "all clear" over a live
// tornado. Carrying every outer ring in `polygonRings` and matching the union
// of them fixes it. `coordinates` keeps its legacy first-ring value for the
// map/DeckGL consumers.

test('a MultiPolygon warning whose SECOND ring covers the user still clears the exposure floor', () => {
  const { exposure, match } = computeAlertExposure(multiPolygonTornado(), [HOME], { now: NOW });
  assert.ok(exposure >= 70, `expected exposure >= 70 from the 2nd ring, got ${exposure}`);
  assert.equal(match?.matchKind, 'inside_polygon');
});

test('an alert whose polygon covers a saved place yields exposure above the Big Event exposure floor', () => {
  const { exposure, match } = computeAlertExposure(tornadoWarning(COVERS_HOME), [HOME], { now: NOW });
  // Default exposureFloor in the Big Event Detector is 70; a warning
  // sitting on top of the user's home must clear it decisively.
  assert.ok(exposure >= 70, `expected exposure >= 70, got ${exposure}`);
  assert.equal(match?.matchKind, 'inside_polygon');
});

test('an alert far from every saved place yields zero exposure', () => {
  const { exposure } = computeAlertExposure(tornadoWarning(FAR_AWAY), [HOME], { now: NOW });
  assert.equal(exposure, 0);
});

// ── Regression: cache-hydrated alerts (string dates) ─────────────────────
// The NWS circuit breaker uses persistCache:true, which round-trips the
// payload through JSON (persistent-cache does JSON.stringify → JSON.parse).
// That turns `onset`/`expires` from Date objects into ISO strings. If the
// adapter calls `.toISOString()` on them it throws a TypeError, and because
// this runs inside the per-batch try/catch in data-loader, ONE bad alert
// aborts the entire severe-alert batch — no warning is dispatched that
// cycle. That is strictly worse than the original bug, and it happens
// exactly when offline/cached (a storm knocking out connectivity).

test('cache-hydrated alerts (string dates) do not throw and still match', () => {
  const live = tornadoWarning(COVERS_HOME);
  // Faithful reproduction of persistent-cache hydration.
  const hydrated = JSON.parse(JSON.stringify(live)) as unknown as WeatherAlert;
  assert.equal(typeof (hydrated as unknown as { onset: unknown }).onset, 'string');
  const { exposure, match } = computeAlertExposure(hydrated, [HOME], { now: NOW });
  assert.ok(exposure >= 70, `expected exposure >= 70, got ${exposure}`);
  assert.equal(match?.matchKind, 'inside_polygon');
});

// ── Regression: an INVALID Date must not throw ───────────────────────────
// A malformed NWS timestamp yields `new Date('…')` → an *invalid* Date object
// (getTime() is NaN). `toISOString()` on an invalid Date throws
// RangeError('Invalid time value'). Because computeAlertExposure runs inside
// data-loader's severe-alert batch, that RangeError would abort the whole batch
// and strand the personal-status chip publication — a second, sneakier path to
// the same "no warning" outcome as the string-date bug above. An unusable Date
// must degrade to '' (the matcher only needs a parseable string), never throw.

test('an alert with an invalid onset/expires Date does not throw and still matches', () => {
  const alert = tornadoWarning(COVERS_HOME);
  (alert as unknown as { onset: Date }).onset = new Date('not a real date');
  (alert as unknown as { expires: Date }).expires = new Date('also bad');
  assert.doesNotThrow(() => computeAlertExposure(alert, [HOME], { now: NOW }));
  const { exposure, match } = computeAlertExposure(alert, [HOME], { now: NOW });
  assert.ok(exposure >= 70, `a covering polygon still matches; got ${exposure}`);
  assert.equal(match?.matchKind, 'inside_polygon');
});

test('exposure is zero when the user has no saved places', () => {
  const { exposure } = computeAlertExposure(tornadoWarning(COVERS_HOME), [], { now: NOW });
  assert.equal(exposure, 0);
});

test('exposureFromMatch maps a no_match result to zero', () => {
  const noMatch = { matchKind: 'no_match', isInside: false, threatLevel: 'none' } as PolygonMatchResult;
  assert.equal(exposureFromMatch(noMatch), 0);
});

// ── Regression: the reported bug ─────────────────────────────────────────
// "Right now I'm getting an all clear message during a severe storm."
// An Extreme tornado warning sitting over the user's home must be
// classified as a Big Event (→ dispatched notification), not silently
// dropped. With the old hardcoded userExposure=50 the ONLY trigger that
// fired was high_confidence_high_impact (weight 35 < threshold 40), so
// detectBigEvent returned isBigEvent=false and the alert was dropped.

test('a severe storm over the user home is a Big Event, not all-clear', () => {
  const alert = tornadoWarning(COVERS_HOME);
  const { exposure } = computeAlertExposure(alert, [HOME], { now: NOW });
  const result = detectBigEvent({
    id: alert.id,
    domain: 'weather',
    severityScore: 95,
    truthScore: 0.85,
    sourceCount: 1,
    hasOfficialSource: true,
    overlappingDomains: ['weather'],
    userExposure: exposure,
    potentialImpact: 95,
  });
  assert.equal(result.isBigEvent, true, result.explanation);
});
