import assert from 'node:assert/strict';
import test from 'node:test';

import {
  truncatePm25,
  pm25ToAqi,
  categoryForAqi,
  filterUsable,
  scoreAndRank,
  colorForCategory,
  parseV1SensorsResponse,
  parsePublicJsonResponse,
  type PurpleAirSensor,
} from '../purpleair-helpers.ts';

// ── truncatePm25 ────────────────────────────────────────────────────────

test('truncatePm25: 0 returns 0', () => {
  assert.equal(truncatePm25(0), 0);
});

test('truncatePm25: truncates (does not round) to 1 decimal place', () => {
  assert.equal(truncatePm25(9.999), 9.9);
  assert.equal(truncatePm25(35.4567), 35.4);
});

test('truncatePm25: negative clamps to 0', () => {
  assert.equal(truncatePm25(-5), 0);
});

test('truncatePm25: NaN / Infinity returns null', () => {
  assert.equal(truncatePm25(Number.NaN), null);
  assert.equal(truncatePm25(Number.POSITIVE_INFINITY), null);
});

// ── pm25ToAqi ───────────────────────────────────────────────────────────

test('pm25ToAqi: PM2.5=0 → AQI 0 (good floor)', () => {
  assert.equal(pm25ToAqi(0), 0);
});

test('pm25ToAqi: PM2.5=9.0 → AQI 50 (top of good)', () => {
  assert.equal(pm25ToAqi(9.0), 50);
});

test('pm25ToAqi: PM2.5=9.1 → AQI 51 (bottom of moderate)', () => {
  assert.equal(pm25ToAqi(9.1), 51);
});

test('pm25ToAqi: PM2.5=35.4 → AQI 100 (top of moderate)', () => {
  assert.equal(pm25ToAqi(35.4), 100);
});

test('pm25ToAqi: PM2.5=55.4 → AQI 150 (top of sensitive)', () => {
  assert.equal(pm25ToAqi(55.4), 150);
});

test('pm25ToAqi: PM2.5=125.4 → AQI 200 (top of unhealthy)', () => {
  assert.equal(pm25ToAqi(125.4), 200);
});

test('pm25ToAqi: PM2.5=225.4 → AQI 300 (top of very_unhealthy)', () => {
  assert.equal(pm25ToAqi(225.4), 300);
});

test('pm25ToAqi: PM2.5=500 → AQI capped at 500', () => {
  assert.equal(pm25ToAqi(500), 500);
});

test('pm25ToAqi: PM2.5=999 (off the chart) → AQI capped at 500', () => {
  assert.equal(pm25ToAqi(999), 500);
});

test('pm25ToAqi: PM2.5=NaN → null', () => {
  assert.equal(pm25ToAqi(Number.NaN), null);
});

test('pm25ToAqi: negative PM2.5 clamped to 0 → AQI 0', () => {
  assert.equal(pm25ToAqi(-2), 0);
});

test('pm25ToAqi: truncation matters — 12.299 → AQI for 12.2 (1-decimal truncation, moderate band)', () => {
  // 12.2 falls in [9.1, 35.4] → AQI 51..100
  // AQI = ((100-51)/(35.4-9.1)) * (12.2 - 9.1) + 51
  //     = (49/26.3) * 3.1 + 51 ≈ 56.78 → round → 57
  assert.equal(pm25ToAqi(12.299), 57);
});

test('pm25ToAqi: 1-decimal truncation closes the inter-band crack — 9.05 → AQI 50, not null', () => {
  // Under 2-decimal truncation 9.05 stays 9.05, which is > the first band's
  // 9.0 ceiling and < the second band's 9.1 floor — matches neither, so the
  // old truncation silently dropped a valid reading. 1-decimal truncation
  // lands it at 9.0, inside the first (good) band.
  assert.equal(pm25ToAqi(9.05), 50);
});

// ── categoryForAqi ──────────────────────────────────────────────────────

test('categoryForAqi: thresholds map per EPA scale', () => {
  assert.equal(categoryForAqi(0),   'good');
  assert.equal(categoryForAqi(50),  'good');
  assert.equal(categoryForAqi(51),  'moderate');
  assert.equal(categoryForAqi(100), 'moderate');
  assert.equal(categoryForAqi(101), 'sensitive');
  assert.equal(categoryForAqi(150), 'sensitive');
  assert.equal(categoryForAqi(151), 'unhealthy');
  assert.equal(categoryForAqi(200), 'unhealthy');
  assert.equal(categoryForAqi(201), 'very_unhealthy');
  assert.equal(categoryForAqi(300), 'very_unhealthy');
  assert.equal(categoryForAqi(301), 'hazardous');
  assert.equal(categoryForAqi(500), 'hazardous');
});

// ── colorForCategory ────────────────────────────────────────────────────

test('colorForCategory: returns AirNow palette hex per category', () => {
  assert.equal(colorForCategory('good'),           '#00e400');
  assert.equal(colorForCategory('moderate'),       '#ffff00');
  assert.equal(colorForCategory('sensitive'),      '#ff7e00');
  assert.equal(colorForCategory('unhealthy'),      '#ff0000');
  assert.equal(colorForCategory('very_unhealthy'), '#8f3f97');
  assert.equal(colorForCategory('hazardous'),      '#7e0023');
});

// ── filterUsable ────────────────────────────────────────────────────────

function sensor(overrides: Partial<PurpleAirSensor> = {}): PurpleAirSensor {
  return {
    id: 1,
    name: 'Test',
    lat: 40,
    lon: -100,
    pm25: 10,
    confidence: 100,
    locationType: 0,
    lastSeen: null,
    ...overrides,
  };
}

test('filterUsable: drops indoor sensors (location_type=1)', () => {
  const out = filterUsable([sensor({ id: 1 }), sensor({ id: 2, locationType: 1 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 1);
});

test('filterUsable: drops sensors with confidence ≤ 50', () => {
  const out = filterUsable([
    sensor({ id: 1, confidence: 51 }),
    sensor({ id: 2, confidence: 50 }),
    sensor({ id: 3, confidence: 49 }),
  ]);
  assert.deepEqual(out.map(s => s.id), [1]);
});

test('filterUsable: drops NaN coordinates / pm25', () => {
  const out = filterUsable([
    sensor({ id: 1 }),
    sensor({ id: 2, lat: Number.NaN }),
    sensor({ id: 3, lon: Number.NaN }),
    sensor({ id: 4, pm25: Number.NaN }),
    sensor({ id: 5, pm25: -1 }),
  ]);
  assert.deepEqual(out.map(s => s.id), [1]);
});

// ── scoreAndRank ────────────────────────────────────────────────────────

test('scoreAndRank: sorts by PM2.5 descending and caps to topN', () => {
  const out = scoreAndRank(
    [
      sensor({ id: 1, pm25: 10 }),
      sensor({ id: 2, pm25: 80 }),
      sensor({ id: 3, pm25: 30 }),
    ],
    2,
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(s => s.id), [2, 3]);
  assert.equal(out[0]!.aqi, pm25ToAqi(80));
  assert.equal(out[0]!.category, 'unhealthy');
});

test('scoreAndRank: drops sensors that produce no AQI (NaN pm25)', () => {
  const out = scoreAndRank([sensor({ id: 1, pm25: Number.NaN }), sensor({ id: 2, pm25: 5 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 2);
});

// ── parseV1SensorsResponse ──────────────────────────────────────────────

test('parseV1SensorsResponse: maps fields by name and produces sensors', () => {
  const out = parseV1SensorsResponse({
    fields: ['sensor_index', 'pm2.5', 'latitude', 'longitude', 'location_type', 'confidence', 'name', 'last_seen'],
    data: [
      [101, 12.5, 34.05, -118.24, 0, 92, 'LA West', 1_700_000_000],
      [102, 78.2, 40.71, -74.00,  0, 88, 'NYC East', 1_700_000_100],
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0]!.id, 101);
  assert.equal(out[0]!.pm25, 12.5);
  assert.equal(out[0]!.locationType, 0);
  assert.equal(out[0]!.lastSeen, 1_700_000_000);
});

test('parseV1SensorsResponse: returns [] on garbage input', () => {
  assert.deepEqual(parseV1SensorsResponse(null), []);
  assert.deepEqual(parseV1SensorsResponse('nope'), []);
  assert.deepEqual(parseV1SensorsResponse({ data: [] }), []);
  assert.deepEqual(parseV1SensorsResponse({ fields: ['sensor_index'], data: [] }), []);
});

test('parseV1SensorsResponse: skips rows with missing required fields', () => {
  const out = parseV1SensorsResponse({
    fields: ['sensor_index', 'pm2.5', 'latitude', 'longitude'],
    data: [
      [1, 5, 40, -100],
      [2, 'oops', 40, -100],   // pm25 not numeric → dropped
      [3, 5, 'bad', -100],      // lat not numeric → dropped
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 1);
});

// ── parsePublicJsonResponse ─────────────────────────────────────────────

test('parsePublicJsonResponse: maps legacy /json shape (LastSeen seconds → ms)', () => {
  const out = parsePublicJsonResponse({
    results: [
      { ID: '5001', Lat: 34.0, Lon: -118.0, Type: '0', Conf: '95', PM2_5Value: '7.4', Label: 'Cam', LastSeen: 1_700_000_000 },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 5001);
  assert.equal(out[0]!.pm25, 7.4);
  assert.equal(out[0]!.lastSeen, 1_700_000_000_000);
});

test('parsePublicJsonResponse: returns [] when results missing', () => {
  assert.deepEqual(parsePublicJsonResponse({}), []);
  assert.deepEqual(parsePublicJsonResponse({ results: 'not-an-array' }), []);
});
