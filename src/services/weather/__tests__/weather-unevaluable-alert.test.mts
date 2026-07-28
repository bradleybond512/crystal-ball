import assert from 'node:assert/strict';
import test from 'node:test';

import { isAlertSpatiallyUnevaluable, type WeatherAlert } from '../../weather.ts';

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
