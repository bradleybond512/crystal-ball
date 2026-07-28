import assert from 'node:assert/strict';
import test from 'node:test';

import { firmsToTransportSources, type FirePixel } from '../fire-detection-sources.ts';

const HOME = { lat: 40, lon: -100 };
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

/** Fresh, in-range pixel near home unless overridden. */
function pixel(over: Partial<FirePixel> = {}): FirePixel {
  return { lat: 40, lon: -100, frpMw: 50, detectedAtMs: NOW - HOUR, ...over };
}

test('returns [] for empty input', () => {
  assert.deepEqual(firmsToTransportSources([], HOME, { nowMs: NOW }), []);
});

test('drops non-finite rows', () => {
  const out = firmsToTransportSources(
    [
      pixel({ lat: NaN }),
      pixel({ lon: Infinity }),
      pixel({ frpMw: NaN }),
      pixel({ detectedAtMs: NaN }),
      pixel({ lat: 40.0, lon: -100.0 }), // the only valid row
    ],
    HOME,
    { nowMs: NOW },
  );
  assert.equal(out.length, 1);
});

test('drops detections below minFrpMw', () => {
  const out = firmsToTransportSources(
    [
      pixel({ lat: 40.0, lon: -100.0, frpMw: 4 }), // below default 5 → dropped
      pixel({ lat: 40.5, lon: -100.0, frpMw: 100 }), // separate cell, kept
    ],
    HOME,
    { nowMs: NOW },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'firms:202:-500');
});

test('drops detections older than maxAgeHours', () => {
  const out = firmsToTransportSources(
    [
      pixel({ lat: 40.0, lon: -100.0, detectedAtMs: NOW - 30 * HOUR }), // >24h → dropped
      pixel({ lat: 40.5, lon: -100.0, detectedAtMs: NOW - 1 * HOUR }), // kept
    ],
    HOME,
    { nowMs: NOW, maxAgeHours: 24 },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'firms:202:-500');
});

test('drops future-dated detections (negative age is not "fresh")', () => {
  const out = firmsToTransportSources(
    [
      pixel({ lat: 40.0, lon: -100.0, detectedAtMs: NOW + 6 * HOUR }), // clock skew → dropped
      pixel({ lat: 40.5, lon: -100.0, detectedAtMs: NOW - 1 * HOUR }), // kept
    ],
    HOME,
    { nowMs: NOW, maxAgeHours: 24 },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'firms:202:-500');
});

test('drops out-of-range coordinates (no haversine aliasing)', () => {
  const out = firmsToTransportSources(
    [
      pixel({ lat: 400, lon: -100 }), // finite but absurd → must not alias to lat 40
      pixel({ lat: 40, lon: -460 }), // finite but out of range → dropped
      pixel({ lat: 40.1, lon: -100 }), // the only valid row
    ],
    HOME,
    { nowMs: NOW },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'firms:200:-500');
});

test('drops detections beyond maxRadiusMi', () => {
  const out = firmsToTransportSources(
    [
      pixel({ lat: 47, lon: -100 }), // ~483 mi north of home → dropped
      pixel({ lat: 40.1, lon: -100 }), // ~7 mi → kept
    ],
    HOME,
    { nowMs: NOW, maxRadiusMi: 450 },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'firms:200:-500');
});

test('clusters same-cell pixels and uses the FRP-weighted centroid', () => {
  // Both fall in grid cell (200, -500) at cellDeg 0.2.
  const out = firmsToTransportSources(
    [
      pixel({ lat: 40.0, lon: -99.95, frpMw: 10 }),
      pixel({ lat: 40.05, lon: -99.85, frpMw: 90 }),
    ],
    HOME,
    { nowMs: NOW },
  );
  assert.equal(out.length, 1, 'two pixels in one cell → one source');
  const s = out[0]!;
  // Weighted toward the 90 MW pixel, not the plain mean (40.025 / -99.90).
  assert.ok(Math.abs(s.lat - 40.045) < 1e-9, `lat ${s.lat}`);
  assert.ok(Math.abs(s.lon - -99.86) < 1e-9, `lon ${s.lon}`);
  assert.match(s.label, /2 hotspots/);
});

test('ranks cells by total FRP and caps at maxSources', () => {
  const out = firmsToTransportSources(
    [
      pixel({ lat: 40.0, lon: -100, frpMw: 300 }),
      pixel({ lat: 40.5, lon: -100, frpMw: 200 }),
      pixel({ lat: 41.0, lon: -100, frpMw: 100 }), // weakest → dropped by cap
    ],
    HOME,
    { nowMs: NOW, maxSources: 2 },
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => s.id), ['firms:200:-500', 'firms:202:-500']);
});

test('assigns intensity bands by total cell FRP', () => {
  const out = firmsToTransportSources(
    [
      pixel({ lat: 40.0, lon: -100, frpMw: 600 }), // >=500 → heavy
      pixel({ lat: 40.4, lon: -100, frpMw: 150 }), // >=100 → medium
      pixel({ lat: 40.8, lon: -100, frpMw: 40 }), //  <100 → light
    ],
    HOME,
    { nowMs: NOW },
  );
  assert.deepEqual(
    out.map((s) => s.intensity),
    ['heavy', 'medium', 'light'],
  );
});
