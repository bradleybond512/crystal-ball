import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOpenaqLocations,
  rankReadings,
  summarizeNearby,
  pickGlobalWorst,
  normalizeParameter,
  STALE_AFTER_MS,
} from '../openaq-service.ts';

const NOW = Date.UTC(2026, 4, 11, 12, 0, 0);

function loc(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Test Station',
    city: 'Testville',
    country: 'US',
    coordinates: { latitude: 40, longitude: -74 },
    sensors: [],
    ...over,
  };
}

function sensor(param: string, value: number, dt: string, unit = 'µg/m³') {
  return {
    parameter: { name: param },
    latest: { value, datetime: { utc: dt }, unit },
  };
}

// ── normalizeParameter ────────────────────────────────────────────────

test('parameter: maps aliases to canonical ids', () => {
  assert.equal(normalizeParameter('PM2.5'), 'pm25');
  assert.equal(normalizeParameter('pm25'), 'pm25');
  assert.equal(normalizeParameter('Ozone'), 'o3');
  assert.equal(normalizeParameter('NO2'), 'no2');
  assert.equal(normalizeParameter('PM10'), 'pm10');
});

test('parameter: unknown returns null', () => {
  assert.equal(normalizeParameter('xenon'), null);
  assert.equal(normalizeParameter(42 as unknown as string), null);
});

// ── parseOpenaqLocations ──────────────────────────────────────────────

test('parser: flattens (location, parameter) into readings', () => {
  const out = parseOpenaqLocations([
    loc({
      sensors: [
        sensor('pm25', 12.5, '2026-05-11T11:30:00Z'),
        sensor('pm10', 30, '2026-05-11T11:30:00Z'),
      ],
    }),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.parameter, 'pm25');
  assert.equal(out[0]!.value, 12.5);
  assert.equal(out[0]!.station, 'Test Station');
  assert.equal(out[0]!.city, 'Testville');
});

test('parser: PM2.5 readings carry an EPA AQI + category', () => {
  const out = parseOpenaqLocations([loc({ sensors: [sensor('pm25', 75, '2026-05-11T11:30:00Z')] })]);
  assert.ok(out[0]!.aqi !== null);
  assert.ok((out[0]!.aqi ?? 0) > 100);
  assert.equal(out[0]!.category, 'unhealthy');
});

test('parser: non-PM2.5 readings carry aqi=null', () => {
  const out = parseOpenaqLocations([loc({ sensors: [sensor('o3', 0.075, '2026-05-11T11:30:00Z', 'ppm')] })]);
  assert.equal(out[0]!.aqi, null);
  assert.equal(out[0]!.parameter, 'o3');
});

test('parser: locations without numeric id are dropped', () => {
  const out = parseOpenaqLocations([loc({ id: undefined, sensors: [sensor('pm25', 12, '2026-05-11T11:30:00Z')] })]);
  assert.equal(out.length, 0);
});

test('parser: non-finite values are dropped', () => {
  const out = parseOpenaqLocations([
    loc({ sensors: [{ parameter: { name: 'pm25' }, latest: { value: 'not-a-number', datetime: { utc: '2026-05-11T11:30:00Z' } } }] }),
  ]);
  assert.equal(out.length, 0);
});

test('parser: unknown parameters are skipped', () => {
  const out = parseOpenaqLocations([loc({ sensors: [sensor('xenon', 1, '2026-05-11T11:30:00Z')] })]);
  assert.equal(out.length, 0);
});

test('parser: result is JSON-serializable', () => {
  const out = parseOpenaqLocations([loc({ sensors: [sensor('pm25', 12.5, '2026-05-11T11:30:00Z')] })]);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

// ── rankReadings / summarizeNearby ────────────────────────────────────

test('rank: PM2.5 with higher AQI sorts above PM2.5 with lower AQI', () => {
  const rows = parseOpenaqLocations([
    loc({ id: 1, sensors: [sensor('pm25', 12, '2026-05-11T11:30:00Z')] }),
    loc({ id: 2, sensors: [sensor('pm25', 75, '2026-05-11T11:30:00Z')] }),
  ]);
  const ranked = rankReadings(rows, NOW);
  assert.equal(ranked[0]!.locationId, 2);
});

test('rank: stale readings sink below fresh ones regardless of AQI', () => {
  const staleTs = new Date(NOW - STALE_AFTER_MS - 60_000).toISOString();
  const freshTs = new Date(NOW - 60_000).toISOString();
  const rows = parseOpenaqLocations([
    loc({ id: 1, sensors: [sensor('pm25', 200, staleTs)] }),
    loc({ id: 2, sensors: [sensor('pm25', 30, freshTs)] }),
  ]);
  const ranked = rankReadings(rows, NOW);
  assert.equal(ranked[0]!.locationId, 2);
});

test('summary: counts stations whose category is sensitive or worse', () => {
  const rows = parseOpenaqLocations([
    loc({ id: 1, sensors: [sensor('pm25', 5, '2026-05-11T11:30:00Z')] }),    // good
    loc({ id: 2, sensors: [sensor('pm25', 40, '2026-05-11T11:30:00Z')] }),   // sensitive
    loc({ id: 3, sensors: [sensor('pm25', 75, '2026-05-11T11:30:00Z')] }),   // unhealthy
  ]);
  const summary = summarizeNearby(rows, NOW);
  assert.equal(summary.unhealthyCount, 2);
  assert.equal(summary.worst?.locationId, 3);
});

test('worst: filters stale + null-AQI readings before slicing', () => {
  const staleTs = new Date(NOW - STALE_AFTER_MS - 60_000).toISOString();
  const rows = parseOpenaqLocations([
    loc({ id: 1, sensors: [sensor('pm25', 200, staleTs)] }),                      // stale
    loc({ id: 2, sensors: [sensor('o3', 0.08, '2026-05-11T11:30:00Z', 'ppm')] }), // no AQI
    loc({ id: 3, sensors: [sensor('pm25', 60, '2026-05-11T11:30:00Z')] }),        // qualifies
  ]);
  const worst = pickGlobalWorst(rows, NOW, 5);
  assert.equal(worst.length, 1);
  assert.equal(worst[0]!.locationId, 3);
});

test('summary: empty input → empty readings + null worst', () => {
  const summary = summarizeNearby([], NOW);
  assert.equal(summary.readings.length, 0);
  assert.equal(summary.worst, null);
  assert.equal(summary.unhealthyCount, 0);
});
