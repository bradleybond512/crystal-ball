import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countAdsbWithinRadius,
  findNearestStation,
  haversineNm,
} from '../station-matcher.ts';
import type { MetarStation } from '../metar-types.ts';

const KSBN: MetarStation = {
  icaoId: 'KSBN',
  lat: 41.7,
  lon: -86.31,
  elevFt: 245,
  site: 'South Bend',
  state: 'IN',
  country: 'US',
};
const KORD: MetarStation = {
  icaoId: 'KORD',
  lat: 41.97,
  lon: -87.9,
  elevFt: 668,
  site: 'Chicago O\'Hare',
  state: 'IL',
  country: 'US',
};
const KMIA: MetarStation = {
  icaoId: 'KMIA',
  lat: 25.79,
  lon: -80.29,
  elevFt: 11,
  site: 'Miami',
  state: 'FL',
  country: 'US',
};

// ── haversineNm ─────────────────────────────────────────────────────────

test('haversineNm: same point is 0', () => {
  assert.equal(haversineNm(41.7, -86.31, 41.7, -86.31), 0);
});

test('haversineNm: KSBN ↔ KORD ≈ 70 nm', () => {
  const d = haversineNm(KSBN.lat, KSBN.lon, KORD.lat, KORD.lon);
  assert.ok(d > 65 && d < 80, `expected 65–80 nm, got ${d}`);
});

test('haversineNm: KSBN ↔ KMIA ≈ 1100 nm (transcontinental)', () => {
  const d = haversineNm(KSBN.lat, KSBN.lon, KMIA.lat, KMIA.lon);
  assert.ok(d > 1000 && d < 1200, `expected 1000–1200 nm, got ${d}`);
});

// ── findNearestStation ──────────────────────────────────────────────────

test('findNearestStation: returns nearest within max distance', () => {
  const camLat = 41.605;
  const camLon = -86.7;
  const s = findNearestStation(camLat, camLon, [KORD, KSBN, KMIA], 50);
  assert.equal(s?.icaoId, 'KSBN');
});

test('findNearestStation: returns null when nothing within radius', () => {
  const camLat = 0;
  const camLon = 0;
  const s = findNearestStation(camLat, camLon, [KSBN, KORD, KMIA], 50);
  assert.equal(s, null);
});

test('findNearestStation: returns null on empty station list', () => {
  assert.equal(findNearestStation(41.7, -86.31, [], 50), null);
});

test('findNearestStation: returns null on NaN coords', () => {
  assert.equal(findNearestStation(Number.NaN, -86.31, [KSBN], 50), null);
});

// ── countAdsbWithinRadius ───────────────────────────────────────────────

test('countAdsbWithinRadius: counts aircraft inside radius', () => {
  // OpenSky state vector: [icao24, callsign, country, time_position, last_contact, lon, lat, ...]
  const adsb = {
    states: [
      ['a1', 'AA1', 'US', 0, 0, -86.31, 41.7, 30000], // at KSBN
      ['a2', 'AA2', 'US', 0, 0, -86.5, 41.7, 30000], // ~9 nm west
      ['a3', 'AA3', 'US', 0, 0, -87.9, 41.97, 30000], // KORD, ~70 nm
    ],
  };
  assert.equal(countAdsbWithinRadius(KSBN.lat, KSBN.lon, adsb, 25), 2);
});

test('countAdsbWithinRadius: zero on null/undefined adsb', () => {
  assert.equal(countAdsbWithinRadius(KSBN.lat, KSBN.lon, null, 25), 0);
  assert.equal(countAdsbWithinRadius(KSBN.lat, KSBN.lon, undefined, 25), 0);
  assert.equal(countAdsbWithinRadius(KSBN.lat, KSBN.lon, { states: 'bad' as unknown as never[][] }, 25), 0);
});

test('countAdsbWithinRadius: skips state vectors with non-numeric coords', () => {
  const adsb = {
    states: [
      ['a1', 'AA1', 'US', 0, 0, null, null, 30000],
      ['a2', 'AA2', 'US', 0, 0, -86.31, 41.7, 30000],
    ],
  };
  assert.equal(countAdsbWithinRadius(KSBN.lat, KSBN.lon, adsb, 25), 1);
});
