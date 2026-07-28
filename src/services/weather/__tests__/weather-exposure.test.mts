import assert from 'node:assert/strict';
import test from 'node:test';

import { computeAlertExposure, exposureFromMatch } from '../weather-exposure.ts';
import { detectBigEvent } from '../../insights/big-event-detector.ts';
import type { PolygonMatchResult, SavedPlace } from '../weather-threat-types.ts';
import type { WeatherAlert } from '../../weather.ts';

const NOW = 1_745_000_000_000;

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

// ── computeAlertExposure ─────────────────────────────────────────────────

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
