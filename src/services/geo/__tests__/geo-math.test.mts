import assert from 'node:assert/strict';
import test from 'node:test';

import { haversineKm, filterNearby } from '../geo-math.ts';

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
