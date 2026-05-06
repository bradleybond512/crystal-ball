import assert from 'node:assert/strict';
import test from 'node:test';

import { WebcamSpatialIndex, haversineKm } from '../webcam-spatial.ts';
import type { WebcamFeed } from '../webcam-types.ts';

function feed(overrides: Partial<WebcamFeed>): WebcamFeed {
  return {
    id: 'cam',
    source: 'FAA',
    name: 'Cam',
    lat: 0,
    lon: 0,
    snapshotUrl: 'x',
    refreshIntervalSec: 60,
    category: 'weather',
    metadata: {},
    ...overrides,
  };
}

// ── haversineKm ─────────────────────────────────────────────────────────

test('haversineKm: zero distance for same point', () => {
  assert.equal(haversineKm(40, -74, 40, -74), 0);
});

test('haversineKm: NYC ↔ LA approx 3935 km (within 1%)', () => {
  const km = haversineKm(40.7128, -74.006, 34.0522, -118.2437);
  assert.ok(Math.abs(km - 3935) < 40, `got ${km}`);
});

test('haversineKm: 1° latitude near equator ~111.2 km', () => {
  const km = haversineKm(0, 0, 1, 0);
  assert.ok(Math.abs(km - 111.2) < 1, `got ${km}`);
});

// ── nearest ─────────────────────────────────────────────────────────────

test('nearest: returns cams within radius sorted by distance', () => {
  const index = new WebcamSpatialIndex({
    feeds: [
      feed({ id: 'a', lat: 40.0, lon: -74.0 }),
      feed({ id: 'b', lat: 40.5, lon: -74.0 }),
      feed({ id: 'c', lat: 50.0, lon: -74.0 }),
    ],
  });
  const out = index.nearest(40.0, -74.0, 100);
  assert.deepEqual(out.map((f) => f.id), ['a', 'b']);
});

test('nearest: respects maxResults', () => {
  const feeds = Array.from({ length: 10 }, (_, i) =>
    feed({ id: `cam-${i}`, lat: 40 + i * 0.01, lon: -74 }),
  );
  const index = new WebcamSpatialIndex({ feeds });
  const out = index.nearest(40, -74, 1000, { maxResults: 3 });
  assert.equal(out.length, 3);
});

test('nearest: returns empty for zero/negative radius', () => {
  const index = new WebcamSpatialIndex({ feeds: [feed({ id: 'a', lat: 40, lon: -74 })] });
  assert.deepEqual(index.nearest(40, -74, 0), []);
  assert.deepEqual(index.nearest(40, -74, -5), []);
});

test('nearest: ignores invalid lat/lon coords on input', () => {
  const index = new WebcamSpatialIndex({ feeds: [] });
  assert.deepEqual(index.nearest(NaN, -74, 50), []);
});

// ── inBbox ──────────────────────────────────────────────────────────────

test('inBbox: filters by rectangle', () => {
  const index = new WebcamSpatialIndex({
    feeds: [
      feed({ id: 'a', lat: 41, lon: -86 }),
      feed({ id: 'b', lat: 35, lon: -100 }),
      feed({ id: 'c', lat: 41.5, lon: -85.5 }),
    ],
  });
  const out = index.inBbox(40, -90, 42, -80);
  assert.deepEqual(out.map((f) => f.id).sort(), ['a', 'c']);
});

// ── byCategory ──────────────────────────────────────────────────────────

test('byCategory: filters by exact category match', () => {
  const index = new WebcamSpatialIndex({
    feeds: [
      feed({ id: 'a', category: 'fire' }),
      feed({ id: 'b', category: 'volcano' }),
      feed({ id: 'c', category: 'fire' }),
    ],
  });
  const out = index.byCategory('fire');
  assert.deepEqual(out.map((f) => f.id).sort(), ['a', 'c']);
});

test('size: reflects feed count', () => {
  const index = new WebcamSpatialIndex({
    feeds: [feed({ id: 'a' }), feed({ id: 'b' })],
  });
  assert.equal(index.size(), 2);
});
