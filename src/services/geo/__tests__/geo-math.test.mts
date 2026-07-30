import assert from 'node:assert/strict';
import test from 'node:test';

import { haversineKm, filterNearby, isUsableLatLon } from '../geo-math.ts';

test('isUsableLatLon accepts zero coordinates — Greenwich and the equator are real places', () => {
  // The bug this replaces: `if (!place.lat || !place.lon) return;`. Longitude 0
  // runs through London and Accra, latitude 0 through Quito and Nairobi, and a
  // truthiness test silently skips every saved place on either line — after
  // which both surface_temp providers get recorded empty for that place.
  assert.equal(isUsableLatLon(51.4779, 0), true, 'Greenwich, lon 0');
  assert.equal(isUsableLatLon(0, 32.5), true, 'equator, lat 0');
  assert.equal(isUsableLatLon(0, 0), true, 'Null Island is still a valid coordinate');
});

test('isUsableLatLon rejects non-numeric, non-finite and out-of-range coordinates', () => {
  assert.equal(isUsableLatLon(undefined, -86.7), false);
  assert.equal(isUsableLatLon(41.6, null), false);
  assert.equal(isUsableLatLon('41.6', -86.7), false, 'a numeric string is not a coordinate');
  assert.equal(isUsableLatLon(Number.NaN, -86.7), false);
  assert.equal(isUsableLatLon(41.6, Number.POSITIVE_INFINITY), false);
  assert.equal(isUsableLatLon(91, 0), false, 'latitude above the pole');
  assert.equal(isUsableLatLon(-91, 0), false);
  assert.equal(isUsableLatLon(0, 181), false, 'longitude past the antimeridian');
  assert.equal(isUsableLatLon(0, -181), false);
  assert.equal(isUsableLatLon(90, 180), true, 'the range bounds themselves are valid');
  assert.equal(isUsableLatLon(-90, -180), true);
});

test('haversineKm measures ~50km and ~500km reference pairs from the air-quality fixtures', () => {
  const near = haversineKm(41.6, -87.06, 42.05, -87.06);
  assert.ok(Math.abs(near - 50.04) < 0.5, `near ${near}`);
  const far = haversineKm(41.6, -87.06, 46.1, -87.06);
  assert.ok(Math.abs(far - 500.38) < 1, `far ${far}`);
});

test('haversineKm is zero for identical coordinates', () => {
  assert.equal(haversineKm(41.6, -87.06, 41.6, -87.06), 0);
});

test('haversineKm is symmetric', () => {
  const a = haversineKm(41.6, -87.06, 42.05, -87.06);
  const b = haversineKm(42.05, -87.06, 41.6, -87.06);
  assert.equal(a, b);
});

test('filterNearby keeps items inside the radius and drops items outside it', () => {
  const near = { lat: 42.05, lon: -87.06 };
  const far = { lat: 46.1, lon: -87.06 };
  const kept = filterNearby([near, far], 41.6, -87.06, 100);
  assert.equal(kept.length, 1);
  assert.equal(kept[0], near);
});

test('filterNearby preserves the element type, extra properties intact', () => {
  interface Sensor { lat: number; lon: number; pm25: number; label: string }
  const sensor: Sensor = { lat: 42.05, lon: -87.06, pm25: 12, label: 'north-station' };
  const kept: Sensor[] = filterNearby([sensor], 41.6, -87.06, 100);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.pm25, 12);
  assert.equal(kept[0]!.label, 'north-station');
});

test('filterNearby keeps an item exactly at the radius boundary (inclusive <=)', () => {
  // haversineKm(41.6, -87.06, 42.05, -87.06) ≈ 50.04km — use that exact
  // computed distance as the radius so the boundary case is exercised
  // without depending on a second hand-derived constant.
  const point = { lat: 42.05, lon: -87.06 };
  const radiusKm = haversineKm(41.6, -87.06, point.lat, point.lon);
  const kept = filterNearby([point], 41.6, -87.06, radiusKm);
  assert.equal(kept.length, 1, 'point exactly at the radius is kept, not excluded');
});
