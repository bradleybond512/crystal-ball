import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAlertSpatiallyUnevaluable,
  alertHasUsablePolygon,
  normalizeWeatherAlertsResponse,
  type WeatherAlert,
} from '../../weather.ts';

// ── isAlertSpatiallyUnevaluable: the silent-drop guard (P0 #B) ────────────────
// A severe alert that survives normalization with NO polygon rings AND NO UGC
// zones cannot be matched to a saved place — computeAlertExposure returns a
// zero exposure without throwing, so the severe loop never sets matchingDegraded
// and the clear decision runs `confirm_clear` off an alert it never actually
// evaluated. That is the silent drop. This predicate lets the loop detect the
// unevaluable alert and route to `revoke_confirmation` instead of a false clear.
// An alert with EITHER a polygon ring OR a UGC zone is evaluable (matching can
// still run) and must read false.

function alert(partial: Partial<WeatherAlert>): WeatherAlert {
  return {
    id: 'a',
    event: 'Severe Thunderstorm Warning',
    severity: 'Severe',
    headline: 'h',
    description: 'd',
    areaDesc: 'Somewhere, US',
    onset: new Date('2026-07-27T12:00:00Z'),
    expires: new Date('2026-07-27T13:00:00Z'),
    coordinates: [],
    ugcZones: [],
    ...partial,
  };
}

test('an alert with no rings and no UGC zones is spatially unevaluable', () => {
  assert.equal(isAlertSpatiallyUnevaluable(alert({ coordinates: [], ugcZones: [] })), true);
});

test('an alert with a polygon ring is evaluable', () => {
  assert.equal(
    isAlertSpatiallyUnevaluable(alert({ coordinates: [[-86.7, 41.6], [-86.6, 41.6], [-86.6, 41.7]], ugcZones: [] })),
    false,
  );
});

test('an alert with a UGC zone (but no ring) is evaluable via the zone fallback', () => {
  assert.equal(isAlertSpatiallyUnevaluable(alert({ coordinates: [], ugcZones: ['INC091'] })), false);
});

test('an alert with both a ring and a zone is evaluable', () => {
  assert.equal(
    isAlertSpatiallyUnevaluable(alert({ coordinates: [[-86.7, 41.6], [-86.6, 41.6], [-86.6, 41.7]], ugcZones: ['INC091'] })),
    false,
  );
});

// ── Degenerate rings: fewer than 3 vertices is NOT usable geometry ────────────
// alertMatchRings (weather-exposure.ts) filters `ring.length >= 3` before it can
// match anything — a 1- or 2-vertex "ring" is discarded there, so exposure comes
// back 0 and the loop never degrades. The predicate must apply the SAME >=3
// threshold or it lets a degenerate-geometry severe alert reach a false clear.

test('an alert whose only ring is a single point is spatially unevaluable', () => {
  assert.equal(isAlertSpatiallyUnevaluable(alert({ coordinates: [[-86.7, 41.6]], ugcZones: [] })), true);
});

test('an alert whose only ring has two vertices is spatially unevaluable', () => {
  assert.equal(isAlertSpatiallyUnevaluable(alert({ coordinates: [[-86.7, 41.6], [-86.6, 41.6]], ugcZones: [] })), true);
});

test('an alert whose every polygonRing has fewer than three vertices is spatially unevaluable', () => {
  assert.equal(
    isAlertSpatiallyUnevaluable(alert({
      coordinates: [[-86.7, 41.6]],
      polygonRings: [[[-86.7, 41.6]], [[-86.6, 41.6], [-86.5, 41.6]]],
      ugcZones: [],
    })),
    true,
  );
});

test('a degenerate ring is still evaluable when a UGC zone is present', () => {
  assert.equal(isAlertSpatiallyUnevaluable(alert({ coordinates: [[-86.7, 41.6]], ugcZones: ['INC091'] })), false);
});

test('an alert with one usable ring among degenerate ones is evaluable', () => {
  assert.equal(
    isAlertSpatiallyUnevaluable(alert({
      coordinates: [[-86.7, 41.6], [-86.6, 41.6], [-86.6, 41.7]],
      polygonRings: [[[-86.7, 41.6], [-86.6, 41.6], [-86.6, 41.7]], [[-86.5, 41.5]]],
      ugcZones: [],
    })),
    false,
  );
});

// ── Non-finite geometry: a ring with ANY non-finite vertex is NOT usable ──────
// A corrupt feed can carry a Severe warning whose polygon vertices are non-finite
// (null / NaN / strings). toFiniteRing (weather.ts, the single producer) rejects
// the WHOLE ring when ANY vertex is non-finite — it must NOT drop only the corrupt
// vertices and salvage the finite ones into a smaller polygon: that smaller shape
// silently mis-places the user (a saved place inside the intended polygon can fall
// OUTSIDE the salvaged one), so matching returns 0 exposure, the severe loop never
// degrades, and `confirm_clear` fires off a severe warning it could not actually
// evaluate — a false ALL CLEAR. Rejecting the ring whole makes both the predicate
// here and the matcher (alertMatchRings) read the alert as unplaceable in lockstep.

function severeFeatureWithGeometry(geometry: unknown) {
  return {
    id: 'nws-corrupt-geo',
    geometry,
    properties: {
      event: 'Severe Thunderstorm Warning',
      severity: 'Severe',
      headline: 'h',
      description: 'd',
      areaDesc: 'Somewhere, US',
      onset: '2026-07-27T12:00:00Z',
      expires: '2026-07-27T13:00:00Z',
    },
  };
}

test('a Severe Polygon whose every vertex is non-finite normalizes to spatially unevaluable', () => {
  const [out] = normalizeWeatherAlertsResponse({
    features: [severeFeatureWithGeometry({
      type: 'Polygon',
      coordinates: [[[null, null], [null, null], [null, null]]],
    })],
  } as never);
  assert.ok(out, 'the Severe alert must survive normalization — it is a threat, not a clear');
  assert.equal(isAlertSpatiallyUnevaluable(out!), true);
});

test('a Severe MultiPolygon whose every vertex is non-finite normalizes to spatially unevaluable', () => {
  const [out] = normalizeWeatherAlertsResponse({
    features: [severeFeatureWithGeometry({
      type: 'MultiPolygon',
      coordinates: [[[['x', 'y'], ['x', 'y'], ['x', 'y']]]],
    })],
  } as never);
  assert.ok(out);
  assert.equal(isAlertSpatiallyUnevaluable(out!), true);
});

test('a Severe Polygon with a stray non-finite vertex is rejected whole (no partial salvage)', () => {
  const [out] = normalizeWeatherAlertsResponse({
    features: [severeFeatureWithGeometry({
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [null, 1], [0, 1]]],
    })],
  } as never);
  assert.ok(out, 'the Severe alert must survive normalization — it is a threat, not a clear');
  // A single corrupt vertex must invalidate the WHOLE ring, not salvage the
  // finite ones into a smaller polygon: dropping [null,1] would leave the
  // triangle [[0,0],[1,0],[0,1]], and a saved place at [0.9,0.9] sits inside the
  // intended unit square but OUTSIDE that triangle — matching would return
  // exposure 0, stay "complete", and mint a false ALL CLEAR. Reject the ring.
  assert.equal(alertHasUsablePolygon(out!), false);
  assert.equal(isAlertSpatiallyUnevaluable(out!), true);
});

// ── Out-of-range geometry: finite vertices outside the earth are NOT usable ───
// A corrupt feed can carry a Severe warning whose polygon vertices are finite but
// outside the valid geographic range (|lon| > 180 or |lat| > 90). toFiniteRing
// keeps them (they are finite), and such a ring still encloses non-zero area, so
// under the old area-only check it read EVALUABLE — yet no real saved place lies
// inside it. computeAlertExposure returns 0, the severe loop never degrades, and
// `confirm_clear` fires off a severe warning it could not actually place — a false
// ALL CLEAR. isUsableMatchRing rejects any out-of-range vertex, so both this
// predicate and the matcher (alertMatchRings) read the alert as unplaceable.

test('an alert whose only polygon is out of geographic range is spatially unevaluable', () => {
  assert.equal(
    isAlertSpatiallyUnevaluable(alert({ coordinates: [[181, 40], [182, 40], [181, 41]], ugcZones: [] })),
    true,
  );
});

test('an out-of-range polygon is still evaluable when a UGC zone is present (no fail-stuck)', () => {
  assert.equal(
    isAlertSpatiallyUnevaluable(alert({ coordinates: [[181, 40], [182, 40], [181, 41]], ugcZones: ['INC091'] })),
    false,
  );
});

test('alertHasUsablePolygon: an out-of-range polygon is not a usable polygon', () => {
  assert.equal(
    alertHasUsablePolygon(alert({ coordinates: [[181, 40], [182, 40], [181, 41]], ugcZones: [] })),
    false,
  );
});

test('a Severe Polygon whose every vertex is out of geographic range normalizes to spatially unevaluable', () => {
  const [out] = normalizeWeatherAlertsResponse({
    features: [severeFeatureWithGeometry({
      type: 'Polygon',
      coordinates: [[[181, 40], [182, 40], [181, 41]]],
    })],
  } as never);
  assert.ok(out, 'the Severe alert must survive normalization — it is a threat, not a clear');
  assert.equal(isAlertSpatiallyUnevaluable(out!), true);
});

test('a legitimate antimeridian Severe Polygon (lon ±180) stays evaluable (fail-stuck guard)', () => {
  const [out] = normalizeWeatherAlertsResponse({
    features: [severeFeatureWithGeometry({
      type: 'Polygon',
      coordinates: [[[180, 71], [-180, 71], [-180, 71.5], [180, 71.5]]],
    })],
  } as never);
  assert.ok(out);
  assert.equal(isAlertSpatiallyUnevaluable(out!), false);
});

// ── alertHasUsablePolygon: the POLYGON-only half of evaluability ──────────────
// isAlertSpatiallyUnevaluable = !alertHasUsablePolygon && no UGC zones. The clear
// decision needs to count severe alerts that CAN ONLY match via the zone fallback
// (no usable polygon) so a degraded zone lookup blocks the clear for exactly those
// alerts and no others. That count is `severeAlerts.filter(a => !alertHasUsablePolygon(a))`,
// so this predicate must answer "has a >=3-vertex ring" WITHOUT consulting ugcZones.

test('alertHasUsablePolygon: a ring of >=3 vertices has a usable polygon', () => {
  assert.equal(
    alertHasUsablePolygon(alert({ coordinates: [[-86.7, 41.6], [-86.6, 41.6], [-86.6, 41.7]], ugcZones: [] })),
    true,
  );
});

test('alertHasUsablePolygon: no rings at all has no usable polygon', () => {
  assert.equal(alertHasUsablePolygon(alert({ coordinates: [], ugcZones: [] })), false);
});

test('alertHasUsablePolygon: a single-point ring is not a usable polygon', () => {
  assert.equal(alertHasUsablePolygon(alert({ coordinates: [[-86.7, 41.6]], ugcZones: [] })), false);
});

test('alertHasUsablePolygon: a two-vertex ring is not a usable polygon', () => {
  assert.equal(alertHasUsablePolygon(alert({ coordinates: [[-86.7, 41.6], [-86.6, 41.6]], ugcZones: [] })), false);
});

test('alertHasUsablePolygon: one usable ring among degenerate polygonRings still counts', () => {
  assert.equal(
    alertHasUsablePolygon(alert({
      coordinates: [[-86.7, 41.6]],
      polygonRings: [[[-86.7, 41.6]], [[-86.6, 41.6], [-86.5, 41.6], [-86.5, 41.7]]],
      ugcZones: [],
    })),
    true,
  );
});

// The distinguishing case from isAlertSpatiallyUnevaluable: a zone-only alert IS
// evaluable (via the fallback) but has NO usable polygon. alertHasUsablePolygon
// must ignore ugcZones entirely, so the clear decision can identify the zone-only
// severe alerts a degraded zone lookup would put at risk.
test('alertHasUsablePolygon: a zone-only alert (no ring, has UGC zone) has no usable polygon', () => {
  assert.equal(alertHasUsablePolygon(alert({ coordinates: [], ugcZones: ['INC091'] })), false);
});
