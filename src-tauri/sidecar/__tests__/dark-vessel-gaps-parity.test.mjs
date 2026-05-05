/**
 * Parity test: the sidecar's inline JS port of dark-vessel gap detection
 * must produce results matching the canonical TS module in
 * src/services/dark-vessel.ts.
 *
 * If you change one, change the other and update this test.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  computeGapRiskScoreSidecar,
  detectAisGapEventsSidecar,
} from '../local-api-server.mjs';

const NOW = 1_745_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

function obs(mmsi, lat, lon, hoursAgo, name) {
  return { mmsi, lat, lon, observedAt: NOW - hoursAgo * HOUR_MS, name };
}

test('computeGapRiskScoreSidecar: 6h gap at chokepoint center → 60', () => {
  assert.equal(computeGapRiskScoreSidecar(6, 0), 60);
});

test('computeGapRiskScoreSidecar: 48h gap close → 100', () => {
  assert.equal(computeGapRiskScoreSidecar(48, 25), 100);
});

test('computeGapRiskScoreSidecar: clamped 0..100', () => {
  for (const g of [0, 6, 24, 48, 72]) {
    for (const d of [0, 100, 200, 500]) {
      const s = computeGapRiskScoreSidecar(g, d);
      assert.ok(s >= 0 && s <= 100);
    }
  }
});

test('detectAisGapEventsSidecar: 7h gap at Hormuz → event', () => {
  const events = detectAisGapEventsSidecar(
    [obs('111', 26.5, 56.3, 7, 'TANKER A')],
    { now: NOW },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].mmsi, '111');
  assert.equal(events[0].nearestChokepoint, 'Strait of Hormuz');
});

test('detectAisGapEventsSidecar: <6h gap → no event', () => {
  const events = detectAisGapEventsSidecar(
    [obs('111', 26.5, 56.3, 3, 'A')],
    { now: NOW },
  );
  assert.equal(events.length, 0);
});

test('detectAisGapEventsSidecar: middle of Atlantic → no event (not near zone)', () => {
  const events = detectAisGapEventsSidecar(
    [obs('111', 30, -40, 24, 'A')],
    { now: NOW },
  );
  assert.equal(events.length, 0);
});

test('detectAisGapEventsSidecar: latest observation per mmsi wins', () => {
  const events = detectAisGapEventsSidecar(
    [
      obs('111', 26.5, 56.3, 24, 'A'),
      obs('111', 27, 56.5, 8, 'A'),
    ],
    { now: NOW },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].lastKnownLat, 27);
});

test('detectAisGapEventsSidecar: sorted by risk score desc', () => {
  const events = detectAisGapEventsSidecar(
    [
      obs('low', 26.5, 57.85, 7, 'L'),
      obs('high', 12.5, 43.5, 50, 'H'),
      obs('mid', 2, 103.1, 14, 'M'),
    ],
    { now: NOW },
  );
  assert.equal(events.length, 3);
  assert.equal(events[0].mmsi, 'high');
  assert.equal(events[1].mmsi, 'mid');
  assert.equal(events[2].mmsi, 'low');
});

test('detectAisGapEventsSidecar: Panama and Bosphorus in zone list', () => {
  const panama = detectAisGapEventsSidecar(
    [obs('p', 9.1, -79.7, 12, 'P')], { now: NOW },
  );
  const bos = detectAisGapEventsSidecar(
    [obs('b', 41.1, 29, 12, 'B')], { now: NOW },
  );
  assert.equal(panama[0].nearestChokepoint, 'Panama Canal');
  assert.equal(bos[0].nearestChokepoint, 'Bosphorus Strait');
});

test('detectAisGapEventsSidecar: drops bad coordinates', () => {
  const events = detectAisGapEventsSidecar(
    [
      obs('good', 26.5, 56.3, 12, 'G'),
      { mmsi: 'bad', lat: Number.NaN, lon: 56.3, observedAt: NOW - 12 * HOUR_MS },
    ],
    { now: NOW },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].mmsi, 'good');
});
