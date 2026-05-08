import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregationFor,
  binToCells,
  buildColoredCells,
  colorFor,
  rampFor,
  stopsFor,
  type HeatmapPoint,
} from '../heatmap-grid.ts';

// ── Ramps + stops + aggregation ────────────────────────────────────────

test('rampFor: every domain has a 5-stop ramp', () => {
  for (const d of ['seismic', 'wildfire', 'weather', 'infrastructure'] as const) {
    assert.equal(rampFor(d).length, 5, `${d} ramp must have 5 stops`);
  }
});

test('rampFor: every color is a valid 0-255 RGB triple with 0-1 alpha', () => {
  for (const d of ['seismic', 'wildfire', 'weather', 'infrastructure'] as const) {
    for (const c of rampFor(d)) {
      for (const ch of [c.r, c.g, c.b]) {
        assert.ok(ch >= 0 && ch <= 255 && Number.isInteger(ch), `${d} channel ${ch}`);
      }
      assert.ok(c.a >= 0 && c.a <= 1, `${d} alpha ${c.a}`);
    }
  }
});

test('aggregationFor: documented per-domain rule', () => {
  assert.equal(aggregationFor('seismic'), 'max');
  assert.equal(aggregationFor('wildfire'), 'sum');
  assert.equal(aggregationFor('weather'), 'count');
  assert.equal(aggregationFor('infrastructure'), 'count');
});

test('stopsFor: each domain has 4 stops (5 ramp colors → 4 boundaries)', () => {
  for (const d of ['seismic', 'wildfire', 'weather', 'infrastructure'] as const) {
    assert.equal(stopsFor(d).length, 4);
  }
});

// ── colorFor ──────────────────────────────────────────────────────────

test('colorFor seismic: M2 gets the lowest stop, M7 gets the highest', () => {
  const ramp = rampFor('seismic');
  assert.deepEqual(colorFor('seismic', 2), ramp[0]);
  assert.deepEqual(colorFor('seismic', 7), ramp[ramp.length - 1]);
});

test('colorFor wildfire: 0 FRP at low stop, 5000 MW at high stop', () => {
  const ramp = rampFor('wildfire');
  assert.deepEqual(colorFor('wildfire', 0), ramp[0]);
  assert.deepEqual(colorFor('wildfire', 5000), ramp[ramp.length - 1]);
});

test('colorFor: value at the stop boundary picks the upper-tier color', () => {
  // Boundary check: weather stops are [1, 3, 5, 10]. value=3 should
  // pick ramp[2] (the third color), since stops[1]=3 → not strictly
  // less than 3.
  assert.deepEqual(colorFor('weather', 3), rampFor('weather')[2]);
});

// ── binToCells ────────────────────────────────────────────────────────

test('binToCells: empty input → empty output', () => {
  assert.deepEqual(binToCells('seismic', []), []);
});

test('binToCells: cell footprint is 1°×1° aligned to integer floor', () => {
  const points: HeatmapPoint[] = [
    { lat: 40.3, lon: -75.7, intensity: 5 },
    { lat: 40.9, lon: -75.1, intensity: 6 }, // same cell
    { lat: 41.1, lon: -75.5, intensity: 4 }, // different cell (lat)
  ];
  const cells = binToCells('seismic', points);
  // Two cells: (40, -76) holding the first two points, (41, -76) the third.
  assert.equal(cells.length, 2);
  const c0 = cells.find((c) => c.south === 40 && c.west === -76);
  assert.ok(c0);
  assert.equal(c0!.north, 41);
  assert.equal(c0!.east, -75);
  assert.equal(c0!.count, 2);
});

test('binToCells: seismic uses max — highest magnitude wins', () => {
  const points: HeatmapPoint[] = [
    { lat: 40.5, lon: -75.5, intensity: 3.2 },
    { lat: 40.8, lon: -75.2, intensity: 5.6 },
    { lat: 40.1, lon: -75.9, intensity: 4.0 },
  ];
  const cells = binToCells('seismic', points);
  assert.equal(cells.length, 1);
  assert.equal(cells[0]!.value, 5.6);
});

test('binToCells: wildfire uses sum — total FRP', () => {
  const points: HeatmapPoint[] = [
    { lat: 40.5, lon: -75.5, intensity: 100 },
    { lat: 40.8, lon: -75.2, intensity: 250 },
  ];
  const cells = binToCells('wildfire', points);
  assert.equal(cells[0]!.value, 350);
});

test('binToCells: weather uses count — value tracks point count', () => {
  const points: HeatmapPoint[] = [
    { lat: 40.5, lon: -75.5, intensity: 1 },
    { lat: 40.6, lon: -75.6, intensity: 1 },
    { lat: 40.7, lon: -75.7, intensity: 1 },
  ];
  const cells = binToCells('weather', points);
  assert.equal(cells[0]!.value, 3);
  assert.equal(cells[0]!.count, 3);
});

test('binToCells: drops NaN intensity, out-of-range coords', () => {
  const points: HeatmapPoint[] = [
    { lat: 40.5, lon: -75.5, intensity: 5 },
    { lat: 200, lon: 0, intensity: 5 },               // bad lat
    { lat: 0, lon: 999, intensity: 5 },                // bad lon
    { lat: 40.5, lon: -75.5, intensity: Number.NaN }, // bad intensity
  ];
  const cells = binToCells('seismic', points);
  assert.equal(cells.length, 1);
  assert.equal(cells[0]!.count, 1);
});

test('binToCells: result sorted by (south asc, west asc)', () => {
  const points: HeatmapPoint[] = [
    { lat: 50, lon: -10, intensity: 1 },
    { lat: 30, lon: 20, intensity: 1 },
    { lat: 30, lon: -20, intensity: 1 },
    { lat: 50, lon: -50, intensity: 1 },
  ];
  const cells = binToCells('weather', points);
  for (let i = 1; i < cells.length; i += 1) {
    const prev = cells[i - 1]!;
    const curr = cells[i]!;
    const prevKey = prev.south * 1000 + prev.west;
    const currKey = curr.south * 1000 + curr.west;
    assert.ok(currKey > prevKey, `cells out of order at ${i}`);
  }
});

// ── buildColoredCells ─────────────────────────────────────────────────

test('buildColoredCells: every cell carries a color', () => {
  const cells = buildColoredCells('seismic', [
    { lat: 40.5, lon: -75.5, intensity: 6.5 },
  ]);
  assert.equal(cells.length, 1);
  assert.ok(cells[0]!.color);
  assert.deepEqual(cells[0]!.color, rampFor('seismic')[4]);
});

test('buildColoredCells is JSON-serializable', () => {
  const cells = buildColoredCells('wildfire', [
    { lat: 40.5, lon: -75.5, intensity: 250 },
  ]);
  const round = JSON.parse(JSON.stringify(cells));
  assert.equal(round[0].south, 40);
});
