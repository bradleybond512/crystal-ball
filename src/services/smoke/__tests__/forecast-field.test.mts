import assert from 'node:assert/strict';
import test from 'node:test';

import { forecastGridPoints, assembleForecastField, type GridPointAq } from '../forecast-field.ts';

const T0 = Date.UTC(2026, 6, 20, 12);
const HOUR = 3_600_000;

test('forecastGridPoints: row-major size×size grid centered on the input', () => {
  const pts = forecastGridPoints(41.6, -86.7, 7, 45);
  assert.equal(pts.length, 49);
  const center = pts[24]!;
  assert.ok(Math.abs(center.lat - 41.6) < 1e-9 && Math.abs(center.lon - -86.7) < 1e-9);
  // First point is the NW corner: 3 steps north, 3 steps west.
  assert.ok(pts[0]!.lat > center.lat && pts[0]!.lon < center.lon);
  // Latitude spacing ≈ 45 mi.
  const stepMi = (pts[0]!.lat - pts[7]!.lat) * 69.09;
  assert.ok(Math.abs(stepMi - 45) < 0.5, `expected ~45 mi step, got ${stepMi}`);
});

function gridAq(startMs: number, hours: number, aqi: (i: number) => number | null): GridPointAq {
  return {
    timesMs: Array.from({ length: hours }, (_, i) => startMs + i * HOUR),
    usAqi: Array.from({ length: hours }, (_, i) => aqi(i)),
  };
}

test('assembleForecastField trims pre-now hours and aligns cells on absolute time', () => {
  const points = [{ lat: 41, lon: -86 }, { lat: 42, lon: -86 }];
  // Feed starts 3 h before now (Open-Meteo hourly arrays start at midnight).
  const parsed = [gridAq(T0 - 3 * HOUR, 10, (i) => 50 + i), null];
  const field = assembleForecastField(points, parsed, T0, 48);
  assert.ok(field);
  // First kept hour is the one covering "now − 1 h".
  assert.equal(field.hoursMs[0], T0 - HOUR);
  assert.equal(field.cells.length, 2);
  // Cell 0 hour 0 carries the value stamped at T0−1h (index 2 of the feed).
  assert.equal(field.cells[0]!.aqiByHour[0], 52);
  // Unfetched cell degrades to all-null, same row length.
  assert.ok(field.cells[1]!.aqiByHour.every((v) => v === null));
  assert.equal(field.cells[1]!.aqiByHour.length, field.hoursMs.length);
});

test('horizon cap limits the scrubber range', () => {
  const points = [{ lat: 41, lon: -86 }];
  const field = assembleForecastField(points, [gridAq(T0, 96, () => 40)], T0, 48);
  assert.ok(field);
  assert.equal(field.hoursMs.length, 48);
});

test('fail-closed: all-null AQI or empty parses → null (never a fake-good map)', () => {
  const points = [{ lat: 41, lon: -86 }];
  assert.equal(assembleForecastField(points, [gridAq(T0, 12, () => null)], T0), null);
  assert.equal(assembleForecastField(points, [null], T0), null);
  assert.equal(assembleForecastField([], [], T0), null);
});
