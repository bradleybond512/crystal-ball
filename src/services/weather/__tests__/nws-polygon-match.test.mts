import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchAlertToPlace,
  matchAlertsToPlaces,
  pointInPolygon,
  distanceToPolygonKm,
} from '../nws-polygon-match.ts';
import { classifyHazard } from '../weather-threat-types.ts';
import type { AlertPolygon, NwsAlertMinimal, SavedPlace } from '../weather-threat-types.ts';

const NOW = 1_745_000_000_000;

// ── Fixtures: La Porte, IN area (matches the user's saved Sitrep) ────────

const HOME: SavedPlace = {
  id: 'home',
  label: 'La Porte, IN',
  lat: 41.610,
  lon: -86.722,
};

// A roughly 50×50 km square polygon centered ~5 km west of home.
// (East edge at -86.78 is ~5 km west of home's -86.722 longitude.)
const NEARBY_POLYGON: AlertPolygon = {
  rings: [[
    [-87.00, 41.40],
    [-86.78, 41.40],
    [-86.78, 41.80],
    [-87.00, 41.80],
    [-87.00, 41.40],
  ]],
};

// A polygon ~200 km away (eastern Michigan).
const FAR_POLYGON: AlertPolygon = {
  rings: [[
    [-83.5, 42.0],
    [-83.0, 42.0],
    [-83.0, 42.5],
    [-83.5, 42.5],
    [-83.5, 42.0],
  ]],
};

// A polygon containing home (lat range covers 41.610).
const ENVELOPING_POLYGON: AlertPolygon = {
  rings: [[
    [-87.0, 41.50],
    [-86.50, 41.50],
    [-86.50, 41.80],
    [-87.0, 41.80],
    [-87.0, 41.50],
  ]],
};

function alert(overrides: Partial<NwsAlertMinimal> = {}): NwsAlertMinimal {
  return {
    id: 'urn:oid:test',
    event: 'Severe Thunderstorm Warning',
    polygon: ENVELOPING_POLYGON,
    sent: new Date(NOW - 5 * 60 * 1000).toISOString(),
    expires: new Date(NOW + 30 * 60 * 1000).toISOString(),
    severity: 'severe',
    messageType: 'alert',
    ...overrides,
  };
}

// ── classifyHazard ──────────────────────────────────────────────────────

test('classifyHazard: tornado, severe TS, flash flood', () => {
  assert.equal(classifyHazard('Tornado Warning'), 'tornado');
  assert.equal(classifyHazard('Severe Thunderstorm Warning'), 'severe_thunderstorm');
  assert.equal(classifyHazard('Flash Flood Warning'), 'flash_flood');
  assert.equal(classifyHazard('Flood Advisory'), 'flood');
});

test('classifyHazard: case-insensitive + watch/warning agnostic', () => {
  assert.equal(classifyHazard('TORNADO WATCH'), 'tornado');
  assert.equal(classifyHazard('severe thunderstorm watch'), 'severe_thunderstorm');
});

test('classifyHazard: winter storm vs blizzard vs ice', () => {
  assert.equal(classifyHazard('Blizzard Warning'), 'blizzard');
  assert.equal(classifyHazard('Ice Storm Warning'), 'ice_storm');
  assert.equal(classifyHazard('Winter Storm Warning'), 'winter_storm');
});

test('classifyHazard: unknown event falls back to other', () => {
  assert.equal(classifyHazard('Lakeshore Flood Statement'), 'flood'); // 'flood' substring
  assert.equal(classifyHazard('Special Weather Statement'), 'other');
});

// ── pointInPolygon + distanceToPolygonKm ────────────────────────────────

test('pointInPolygon: interior point', () => {
  assert.equal(pointInPolygon([HOME.lon, HOME.lat], ENVELOPING_POLYGON), true);
});

test('pointInPolygon: exterior point', () => {
  assert.equal(pointInPolygon([HOME.lon, HOME.lat], FAR_POLYGON), false);
});

test('distanceToPolygonKm: inside polygon = 0', () => {
  assert.equal(distanceToPolygonKm([HOME.lon, HOME.lat], ENVELOPING_POLYGON), 0);
});

test('distanceToPolygonKm: nearby polygon a few km outside', () => {
  // Home is at -86.722, polygon's east edge at -86.78, so home is east
  // of (i.e. outside) the polygon by ~5 km.
  const d = distanceToPolygonKm([HOME.lon, HOME.lat], NEARBY_POLYGON);
  assert.ok(d > 1 && d < 10, `expected 1-10km, got ${d.toFixed(2)}`);
});

test('distanceToPolygonKm: far polygon ~ hundreds of km', () => {
  const d = distanceToPolygonKm([HOME.lon, HOME.lat], FAR_POLYGON);
  assert.ok(d > 100, `expected >100 km, got ${d.toFixed(2)}`);
});

// ── matchAlertToPlace: inside ───────────────────────────────────────────

test('match: inside polygon → inside_polygon, distance 0, isInside true', () => {
  const r = matchAlertToPlace(alert(), HOME, { now: NOW });
  assert.equal(r.matchKind, 'inside_polygon');
  assert.equal(r.isInside, true);
  assert.equal(r.distanceKm, 0);
  assert.match(r.reason, /Inside/);
});

test('match: inside polygon + Tornado Warning → emergency threatLevel', () => {
  const r = matchAlertToPlace(alert({ event: 'Tornado Warning' }), HOME, { now: NOW });
  assert.equal(r.threatLevel, 'emergency');
});

test('match: inside polygon + Severe Thunderstorm Warning → emergency threatLevel', () => {
  const r = matchAlertToPlace(alert(), HOME, { now: NOW });
  // severe_thunderstorm is a high-risk hazard → inside warning = emergency
  assert.equal(r.threatLevel, 'emergency');
});

test('match: inside polygon + low-risk Flood Advisory → advisory threatLevel', () => {
  const r = matchAlertToPlace(
    alert({ event: 'Flood Advisory', polygon: ENVELOPING_POLYGON }),
    HOME,
    { now: NOW },
  );
  assert.equal(r.threatLevel, 'advisory');
});

// ── matchAlertToPlace: outside but high-risk → near_polygon ─────────────

test('match: tornado warning a few km away → near_polygon (false-positive bias)', () => {
  // Plan invariant: prefer false-positive watch-level alerts over silent
  // misses for tornado, flash flood, destructive wind.
  const r = matchAlertToPlace(
    alert({ event: 'Tornado Warning', polygon: NEARBY_POLYGON }),
    HOME,
    { now: NOW },
  );
  assert.equal(r.matchKind, 'near_polygon');
  assert.equal(r.isInside, false);
  assert.ok(r.distanceKm! > 0);
  // Outside polygon but high-risk warning → still warning-level
  assert.equal(r.threatLevel, 'warning');
});

test('match: severe TS warning >> 10 km away with no place buffer → no_match', () => {
  const r = matchAlertToPlace(
    alert({ polygon: FAR_POLYGON }),
    HOME,
    { now: NOW },
  );
  assert.equal(r.matchKind, 'no_match');
  assert.equal(r.threatLevel, 'none');
});

test('match: low-risk wind advisory nearby with no buffer → no_match', () => {
  // High-wind isn't in the default alwaysNearForHazards list, so
  // without a place buffer this should not auto-near-match.
  const r = matchAlertToPlace(
    alert({ event: 'Wind Advisory', polygon: NEARBY_POLYGON, severity: 'moderate' }),
    HOME,
    { now: NOW },
  );
  assert.equal(r.matchKind, 'no_match');
});

test('match: place with explicit radiusKm catches nearby low-risk alerts', () => {
  const placeWithBuffer: SavedPlace = { ...HOME, radiusKm: 25 };
  const r = matchAlertToPlace(
    alert({ event: 'Wind Advisory', polygon: NEARBY_POLYGON, severity: 'moderate' }),
    placeWithBuffer,
    { now: NOW },
  );
  assert.equal(r.matchKind, 'near_polygon');
  assert.equal(r.threatLevel, 'advisory');
});

// ── Cancellations + updates ─────────────────────────────────────────────

test('match: cancellation message → threatLevel none even when inside', () => {
  const r = matchAlertToPlace(
    alert({ event: 'Tornado Warning', messageType: 'cancel' }),
    HOME,
    { now: NOW },
  );
  assert.equal(r.isCancellation, true);
  assert.equal(r.threatLevel, 'none');
});

test('match: alert with references is flagged as update, not new issue', () => {
  const r = matchAlertToPlace(
    alert({ references: ['urn:oid:earlier'] }),
    HOME,
    { now: NOW },
  );
  assert.equal(r.isUpdate, true);
});

test('match: alert without references is NOT an update', () => {
  const r = matchAlertToPlace(alert(), HOME, { now: NOW });
  assert.equal(r.isUpdate, false);
});

// ── UGC zone fallback ───────────────────────────────────────────────────

test('match: no polygon + matching UGC zone → inside_zone', () => {
  const placeWithZone = { ...HOME, ugcZones: ['INZ006'] } as SavedPlace;
  const a = alert({ polygon: undefined, ugcZones: ['INZ005', 'INZ006', 'INZ007'] });
  const r = matchAlertToPlace(a, placeWithZone, { now: NOW });
  assert.equal(r.matchKind, 'inside_zone');
  assert.equal(r.isInside, true);
  assert.equal(r.distanceKm, undefined);
  assert.match(r.reason, /INZ006/);
});

test('match: no polygon + no zone overlap → no_match with descriptive reason', () => {
  const a = alert({ polygon: undefined, ugcZones: ['INZ100'] });
  const placeWithZone = { ...HOME, ugcZones: ['INZ006'] } as SavedPlace;
  const r = matchAlertToPlace(a, placeWithZone, { now: NOW });
  assert.equal(r.matchKind, 'no_match');
  assert.match(r.reason, /no polygon and no UGC zone overlap/i);
});

// ── Time remaining ──────────────────────────────────────────────────────

test('match: msUntilExpires reflects expires - now', () => {
  const r = matchAlertToPlace(alert(), HOME, { now: NOW });
  assert.equal(r.msUntilExpires, 30 * 60 * 1000);
});

test('match: expired alert produces negative msUntilExpires (caller can filter)', () => {
  const expired = alert({ expires: new Date(NOW - 60 * 1000).toISOString() });
  const r = matchAlertToPlace(expired, HOME, { now: NOW });
  assert.ok(r.msUntilExpires < 0);
});

// ── matchAlertsToPlaces ─────────────────────────────────────────────────

test('matchAlertsToPlaces: returns only matches (no_match filtered)', () => {
  const places: SavedPlace[] = [HOME, { id: 'office', label: 'Office', lat: 41.610, lon: -86.722 }];
  const alerts: NwsAlertMinimal[] = [
    alert(), // hits both places (same coords)
    alert({ id: 'far', polygon: FAR_POLYGON }), // hits neither
  ];
  const results = matchAlertsToPlaces(alerts, places, { now: NOW });
  assert.equal(results.length, 2); // 1 alert × 2 places, 1 alert dropped
  for (const r of results) assert.notEqual(r.matchKind, 'no_match');
});

test('matchAlertsToPlaces: empty when nothing matches', () => {
  const r = matchAlertsToPlaces(
    [alert({ event: 'Wind Advisory', polygon: FAR_POLYGON })],
    [HOME],
    { now: NOW },
  );
  assert.deepEqual(r, []);
});

// ── Determinism ─────────────────────────────────────────────────────────

test('determinism: same inputs → same output', () => {
  const a = matchAlertToPlace(alert(), HOME, { now: NOW });
  const b = matchAlertToPlace(alert(), HOME, { now: NOW });
  assert.deepEqual(a, b);
});

// ── End-to-end plan example ─────────────────────────────────────────────

test('integration: plan example "outside Severe TS Warning polygon"', () => {
  // The plan's section-2 narrative example: home is a few km outside a
  // severe-TS warning polygon. We expect a near_polygon match with a
  // structured distance + warning-level threatLevel.
  const r = matchAlertToPlace(
    alert({ event: 'Severe Thunderstorm Warning', polygon: NEARBY_POLYGON }),
    HOME,
    { now: NOW },
  );
  assert.equal(r.matchKind, 'near_polygon');
  assert.equal(r.hazardKind, 'severe_thunderstorm');
  assert.equal(r.threatLevel, 'warning'); // outside, but high-risk warning
  assert.ok(r.distanceKm! > 0);
  assert.match(r.reason, /km outside polygon/);
});
