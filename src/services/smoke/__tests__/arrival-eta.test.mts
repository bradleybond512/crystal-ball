import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateArrivals,
  summarizeArrivals,
  haversineMi,
  initialBearingDeg,
  toCompassDirection,
  pointInRings,
} from '../arrival-eta.ts';
import type { HourlyWind, SmokeTransportSource } from '../smoke-types.ts';

const HOME = { lat: 41.6, lon: -86.7 }; // La Porte, IN
const T0 = Date.UTC(2026, 6, 20, 12); // 2026-07-20T12:00Z

/** n hourly samples from T0, constant wind. Mirrors production: `time` is a
 *  place-local wall string (for a place at UTC+offsetHours, no Z suffix) and
 *  `timeMs` is the true epoch — the estimator must index by the epoch. */
function winds(
  n: number,
  directionDeg: number | null,
  speedMph: number | null,
  offsetHours = 0,
): HourlyWind[] {
  return Array.from({ length: n }, (_, i) => {
    const epoch = T0 + i * 3_600_000;
    return {
      time: new Date(epoch + offsetHours * 3_600_000).toISOString().slice(0, 16),
      timeMs: epoch,
      speedMph,
      directionDeg,
    };
  });
}

/** A plume centroid ~90 mi due north of home (comfortably under the 100 mi
 *  that 5 h of 20 mph aligned wind covers — no float-edge flakiness). */
const NORTH_PLUME: SmokeTransportSource = {
  id: 'p1',
  kind: 'plume',
  label: 'Heavy smoke plume',
  lat: HOME.lat + 90 / 69.09,
  lon: HOME.lon,
  intensity: 'heavy',
};

test('geometry helpers: distance, bearing, compass, point-in-ring', () => {
  const d = haversineMi(HOME.lat, HOME.lon, NORTH_PLUME.lat, NORTH_PLUME.lon);
  assert.ok(Math.abs(d - 90) < 2, `expected ~90 mi, got ${d}`);
  const brg = initialBearingDeg(HOME.lat, HOME.lon, NORTH_PLUME.lat, NORTH_PLUME.lon);
  assert.ok(brg < 1 || brg > 359, `expected ~0°, got ${brg}`);
  assert.equal(toCompassDirection(0), 'N');
  assert.equal(toCompassDirection(315), 'NW');
  assert.equal(toCompassDirection(292.5), 'NW'); // rounds to nearest 8-wind
  const ring: [number, number][][] = [[[-87.5, 41.0], [-85.9, 41.0], [-85.9, 42.2], [-87.5, 42.2], [-87.5, 41.0]]];
  assert.equal(pointInRings(HOME.lat, HOME.lon, ring), true);
  assert.equal(pointInRings(30, -86.7, ring), false);
});

test('steady north wind carries a 90 mi upwind plume in ~5 h, high confidence', () => {
  // Wind FROM the north (0°) → transport due south → straight at home.
  const [est] = estimateArrivals({ home: HOME, sources: [NORTH_PLUME], winds: winds(12, 0, 20), now: T0 });
  assert.ok(est);
  assert.equal(est.status, 'incoming');
  assert.equal(est.direction, 'N');
  assert.ok(Math.abs(est.distanceMi - 90) <= 2);
  // 20 mph aligned → 90 mi crossed inside the 5th hourly sample.
  assert.equal(est.etaStartIso, winds(12, 0, 20)[4]!.time);
  assert.equal(est.confidence, 'high');
  assert.ok(est.etaLabel && est.etaEndIso);
  assert.match(est.summary, /Heavy smoke plume 90 mi N/);
});

test('wind blowing the other way → not_expected, honest wording', () => {
  // Wind FROM the south (180°) → transport north, away from home.
  const [est] = estimateArrivals({ home: HOME, sources: [NORTH_PLUME], winds: winds(12, 180, 20), now: T0 });
  assert.ok(est);
  assert.equal(est.status, 'not_expected');
  assert.equal(est.etaStartIso, null);
  assert.match(est.summary, /not carrying it here/);
});

test('home inside a plume ring → overhead, even with no winds', () => {
  const overhead: SmokeTransportSource = {
    ...NORTH_PLUME,
    id: 'p2',
    lat: HOME.lat,
    rings: [[[-87.5, 41.0], [-85.9, 41.0], [-85.9, 42.2], [-87.5, 42.2], [-87.5, 41.0]]],
  };
  const out = estimateArrivals({ home: HOME, sources: [overhead], winds: [], now: T0 });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.status, 'overhead');
  assert.equal(out[0]!.confidence, 'high');
});

test('fail-closed: no usable winds → no transport claims for non-overhead sources', () => {
  assert.deepEqual(estimateArrivals({ home: HOME, sources: [NORTH_PLUME], winds: [], now: T0 }), []);
  assert.deepEqual(
    estimateArrivals({ home: HOME, sources: [NORTH_PLUME], winds: winds(12, null, null), now: T0 }),
    [],
  );
});

test('sources beyond maxDistanceMi are ignored entirely', () => {
  const far: SmokeTransportSource = { ...NORTH_PLUME, id: 'far', lat: HOME.lat + 600 / 69.09 };
  assert.deepEqual(estimateArrivals({ home: HOME, sources: [far], winds: winds(12, 0, 30), now: T0 }), []);
});

test('sort order: overhead → incoming (soonest) → not_expected; capped at maxResults', () => {
  const overhead: SmokeTransportSource = {
    ...NORTH_PLUME, id: 'ov', lat: HOME.lat,
    rings: [[[-87.5, 41.0], [-85.9, 41.0], [-85.9, 42.2], [-87.5, 42.2], [-87.5, 41.0]]],
  };
  const near: SmokeTransportSource = { ...NORTH_PLUME, id: 'near', lat: HOME.lat + 40 / 69.09 };
  const west: SmokeTransportSource = {
    id: 'w', kind: 'fire', label: 'Test fire', intensity: 'medium',
    lat: HOME.lat, lon: HOME.lon - 2,
  };
  const out = estimateArrivals({
    home: HOME,
    sources: [west, NORTH_PLUME, near, overhead],
    winds: winds(12, 0, 20),
    now: T0,
    maxResults: 3,
  });
  assert.equal(out.length, 3);
  assert.equal(out[0]!.sourceId, 'ov');
  assert.equal(out[1]!.sourceId, 'near'); // sooner ETA than the 100 mi plume
  assert.equal(out[2]!.sourceId, 'p1');
});

test('summarizeArrivals picks the first actionable estimate; null when none', () => {
  const incoming = estimateArrivals({ home: HOME, sources: [NORTH_PLUME], winds: winds(12, 0, 20), now: T0 });
  assert.match(summarizeArrivals(incoming) ?? '', /winds could bring smoke/);
  const stalled = estimateArrivals({ home: HOME, sources: [NORTH_PLUME], winds: winds(12, 180, 20), now: T0 });
  assert.equal(summarizeArrivals(stalled), null);
  assert.equal(summarizeArrivals(undefined), null);
});

test('device timezone never skews the ETA: indexing is by epoch, not wall string', () => {
  // A place at UTC-7 whose wall strings lag the epoch by 7 h. If the
  // estimator parsed the strings against the device clock (the bug the
  // independent review caught), startIdx would shift and the arrival hour
  // with it. With timeMs it must land on exactly the same sample as the
  // offset-0 run.
  const w = winds(12, 0, 20, -7);
  const [est] = estimateArrivals({ home: HOME, sources: [NORTH_PLUME], winds: w, now: T0 });
  assert.ok(est);
  assert.equal(est.status, 'incoming');
  assert.equal(est.etaStartIso, w[4]!.time);
  // And the wall label reads the PLACE's clock (T0+4h at UTC-7 = 09:00 wall).
  assert.match(est.etaLabel ?? '', /9 AM/);
});
