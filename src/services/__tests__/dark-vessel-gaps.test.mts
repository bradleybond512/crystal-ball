import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeGapRiskScore,
  detectAisGapEvents,
  DEFAULT_GAP_THRESHOLD_HOURS,
} from '../dark-vessel.ts';
import type { VesselSnapshotObservation } from '../dark-vessel.ts';

const NOW = 1_745_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

function obs(
  mmsi: string,
  lat: number,
  lon: number,
  hoursAgo: number,
  name?: string,
): VesselSnapshotObservation {
  return { mmsi, lat, lon, observedAt: NOW - hoursAgo * HOUR_MS, name };
}

// ── computeGapRiskScore ──────────────────────────────────────────────────────

test('risk score: 6h gap right at chokepoint → 60 (10 + 50)', () => {
  assert.equal(computeGapRiskScore(6, 0), 60);
});

test('risk score: 48h gap + within 50km → max 100', () => {
  assert.equal(computeGapRiskScore(48, 25), 100);
});

test('risk score: short gap + far from chokepoint → 0', () => {
  assert.equal(computeGapRiskScore(2, 250), 0);
});

test('risk score: monotonic in gap duration (fixed distance)', () => {
  const distance = 80;
  const scores = [0, 6, 12, 24, 48].map((h) => computeGapRiskScore(h, distance));
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i]! >= scores[i - 1]!,
      `not monotonic: ${scores}`);
  }
});

test('risk score: monotonic decreasing with distance (fixed gap)', () => {
  const gap = 12;
  const scores = [0, 50, 100, 150, 200, 300].map((d) => computeGapRiskScore(gap, d));
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i]! <= scores[i - 1]!,
      `not monotonic: ${scores}`);
  }
});

test('risk score is clamped to 0..100', () => {
  for (const g of [0, 1, 6, 24, 48, 72, 168]) {
    for (const d of [0, 50, 100, 200, 500]) {
      const s = computeGapRiskScore(g, d);
      assert.ok(s >= 0 && s <= 100, `${g}h ${d}km → ${s}`);
    }
  }
});

// ── detectAisGapEvents ───────────────────────────────────────────────────────

test('vessel last seen 7h ago in Hormuz → gap event with chokepoint name', () => {
  const events = detectAisGapEvents(
    [obs('111', 26.5, 56.3, 7, 'TANKER A')],
    { now: NOW },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]!.mmsi, '111');
  assert.equal(events[0]!.vesselName, 'TANKER A');
  assert.equal(events[0]!.nearestChokepoint, 'Strait of Hormuz');
  assert.ok(events[0]!.gapDurationHours >= 6.9 && events[0]!.gapDurationHours <= 7.1);
});

test('vessel last seen <6h ago → no gap event', () => {
  const events = detectAisGapEvents(
    [obs('111', 26.5, 56.3, 3, 'A')],
    { now: NOW },
  );
  assert.equal(events.length, 0);
});

test('vessel in middle of Atlantic with old timestamp → no event (not near risk zone)', () => {
  const events = detectAisGapEvents(
    [obs('111', 30, -40, 24, 'A')],
    { now: NOW },
  );
  assert.equal(events.length, 0);
});

test('multiple observations per mmsi → uses latest position', () => {
  const events = detectAisGapEvents(
    [
      obs('111', 26.5, 56.3, 24, 'TANKER A'),
      obs('111', 27.0, 56.5, 8, 'TANKER A'),
    ],
    { now: NOW },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]!.lastKnownLat, 27.0);
  assert.ok(events[0]!.gapDurationHours >= 7.9 && events[0]!.gapDurationHours <= 8.1);
});

test('events sorted by risk score descending', () => {
  const events = detectAisGapEvents(
    [
      // 7h gap + ~150km from Hormuz center → 10 + 20 = 30
      obs('low', 26.5, 57.85, 7, 'L'),
      // 50h gap right at Bab el-Mandeb → 50 + 50 = 100
      obs('high', 12.5, 43.5, 50, 'H'),
      // 14h gap + ~120km from Malacca center → 20 + 20 = 40
      obs('mid', 2.0, 103.1, 14, 'M'),
    ],
    { now: NOW },
  );
  assert.equal(events.length, 3);
  assert.equal(events[0]!.mmsi, 'high');
  assert.equal(events[1]!.mmsi, 'mid');
  assert.equal(events[2]!.mmsi, 'low');
});

test('threshold override: 12h threshold filters out 8h gaps', () => {
  const events = detectAisGapEvents(
    [obs('111', 26.5, 56.3, 8, 'A')],
    { now: NOW, thresholdHours: 12 },
  );
  assert.equal(events.length, 0);
});

test('riskZoneRadiusKm override: tighter radius excludes vessels just outside', () => {
  const eventsWide = detectAisGapEvents(
    [obs('111', 28, 58, 12, 'A')], // ~218km from Hormuz center
    { now: NOW, riskZoneRadiusKm: 250 },
  );
  const eventsNarrow = detectAisGapEvents(
    [obs('111', 28, 58, 12, 'A')],
    { now: NOW, riskZoneRadiusKm: 100 },
  );
  assert.equal(eventsWide.length, 1);
  assert.equal(eventsNarrow.length, 0);
});

test('Panama Canal is a recognized chokepoint', () => {
  const events = detectAisGapEvents(
    [obs('111', 9.1, -79.7, 12, 'A')],
    { now: NOW },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]!.nearestChokepoint, 'Panama Canal');
});

test('Bosphorus Strait is a recognized chokepoint', () => {
  const events = detectAisGapEvents(
    [obs('111', 41.1, 29.0, 12, 'A')],
    { now: NOW },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]!.nearestChokepoint, 'Bosphorus Strait');
});

test('drops observations with non-finite coordinates', () => {
  const events = detectAisGapEvents(
    [
      { mmsi: 'good', lat: 26.5, lon: 56.3, observedAt: NOW - 12 * HOUR_MS },
      { mmsi: 'bad-lat', lat: Number.NaN, lon: 56.3, observedAt: NOW - 12 * HOUR_MS },
      { mmsi: 'bad-lon', lat: 26.5, lon: Number.NaN, observedAt: NOW - 12 * HOUR_MS },
      { mmsi: 'bad-time', lat: 26.5, lon: 56.3, observedAt: Number.NaN },
    ],
    { now: NOW },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]!.mmsi, 'good');
});

test('default threshold is 6 hours', () => {
  assert.equal(DEFAULT_GAP_THRESHOLD_HOURS, 6);
});

test('empty input → empty output', () => {
  assert.deepEqual(detectAisGapEvents([], { now: NOW }), []);
});

test('reports gap duration to one decimal place', () => {
  const events = detectAisGapEvents(
    [obs('111', 26.5, 56.3, 7.567, 'A')],
    { now: NOW },
  );
  // 7.567h rounded to 1 dp
  assert.equal(events[0]!.gapDurationHours, 7.6);
});
