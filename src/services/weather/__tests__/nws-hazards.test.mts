import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseNwsAlerts,
  categorizeAlertEvent,
  ALERT_CATEGORY_COLOR,
  parseNhcStorms,
  stormCategoryFor,
  parseHurricaneTrack,
  parseDroughtCsv,
  latestDroughtSnapshot,
  parseSeaIceCsv,
  computeSeaIceClimatology,
  latestSeaIceSnapshot,
  WEATHER_HAZARD_POLLING_MS,
} from '../nws-hazards.ts';

// ── NWS alert parsing ─────────────────────────────────────────────────

test('parseNwsAlerts: keeps Extreme + Severe alerts', () => {
  const fc = {
    features: [
      {
        properties: {
          id: 'a1',
          event: 'Tornado Warning',
          severity: 'Extreme',
          certainty: 'Observed',
          urgency: 'Immediate',
          headline: 'Tornado warning for X county',
          areaDesc: 'X county',
          sent: '2026-05-05T18:00:00Z',
          expires: '2026-05-05T19:00:00Z',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[-97, 35], [-96, 35], [-96, 36], [-97, 36], [-97, 35]]],
        },
      },
      {
        properties: {
          id: 'a2',
          event: 'Special Weather Statement',
          severity: 'Minor',
          certainty: 'Likely',
          urgency: 'Future',
          headline: 'Mild',
          areaDesc: 'Y',
          sent: '2026-05-05T18:00:00Z',
          expires: '2026-05-05T19:00:00Z',
        },
      },
    ],
  };
  const alerts = parseNwsAlerts(fc);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.event, 'Tornado Warning');
  assert.equal(alerts[0]!.category, 'tornado');
  assert.equal(alerts[0]!.geometry?.kind, 'Polygon');
});

test('parseNwsAlerts: keeps Moderate-severity Tornado Warning re-issues', () => {
  const fc = {
    features: [
      {
        properties: {
          id: 'a3',
          event: 'Tornado Warning',
          severity: 'Moderate',
          certainty: 'Possible',
          urgency: 'Expected',
          headline: '',
          areaDesc: '',
          sent: '',
          expires: '',
        },
      },
    ],
  };
  const alerts = parseNwsAlerts(fc);
  assert.equal(alerts.length, 1);
});

test('parseNwsAlerts: empty / malformed input → empty array', () => {
  assert.deepEqual(parseNwsAlerts(null), []);
  assert.deepEqual(parseNwsAlerts({}), []);
  assert.deepEqual(parseNwsAlerts({ features: 'nope' }), []);
});

test('categorizeAlertEvent: covers all categories', () => {
  assert.equal(categorizeAlertEvent('Tornado Warning'), 'tornado');
  assert.equal(categorizeAlertEvent('Hurricane Warning'), 'hurricane');
  assert.equal(categorizeAlertEvent('Storm Surge Warning'), 'hurricane');
  assert.equal(categorizeAlertEvent('Flash Flood Warning'), 'flood');
  assert.equal(categorizeAlertEvent('Winter Storm Warning'), 'winter');
  assert.equal(categorizeAlertEvent('Blizzard Warning'), 'winter');
  assert.equal(categorizeAlertEvent('Severe Thunderstorm Warning'), 'thunderstorm');
  assert.equal(categorizeAlertEvent('Special Weather Statement'), 'other');
});

test('ALERT_CATEGORY_COLOR: every category has a hex color', () => {
  for (const cat of ['tornado', 'hurricane', 'flood', 'winter', 'thunderstorm', 'other'] as const) {
    assert.match(ALERT_CATEGORY_COLOR[cat], /^#[0-9a-f]{6}$/i);
  }
});

// ── NHC storms ────────────────────────────────────────────────────────

test('parseNhcStorms: extracts active storms', () => {
  const raw = {
    activeStorms: [
      {
        id: 'AL062026',
        name: 'Frances',
        classification: 'HU',
        basin: 'AL',
        latitudeNumeric: 25.4,
        longitudeNumeric: -78.2,
        intensity: 130,
        pressure: 925,
        movementDir: 290,
        movementSpeed: 12,
        advNum: '15',
      },
    ],
  };
  const storms = parseNhcStorms(raw);
  assert.equal(storms.length, 1);
  assert.equal(storms[0]!.name, 'Frances');
  assert.equal(storms[0]!.category, 'HU4');
  assert.equal(storms[0]!.basin, 'AL');
  assert.equal(storms[0]!.movement?.headingDeg, 290);
});

test('parseNhcStorms: skips storms missing position', () => {
  const raw = { activeStorms: [{ name: 'Ghost' }] };
  assert.equal(parseNhcStorms(raw).length, 0);
});

test('stormCategoryFor: Saffir-Simpson thresholds', () => {
  assert.equal(stormCategoryFor('HU', 75), 'HU1');
  assert.equal(stormCategoryFor('HU', 100), 'HU2');
  assert.equal(stormCategoryFor('HU', 115), 'HU3');
  assert.equal(stormCategoryFor('HU', 140), 'HU4');
  assert.equal(stormCategoryFor('HU', 160), 'HU5');
  assert.equal(stormCategoryFor('TS', 50), 'TS');
  assert.equal(stormCategoryFor('TD', 30), 'TD');
  assert.equal(stormCategoryFor('PT', 60), 'PT');
});

// ── Hurricane track ──────────────────────────────────────────────────

test('parseHurricaneTrack: extracts forecast points + cone', () => {
  const raw = {
    features: [
      {
        geometry: { type: 'Point', coordinates: [-77, 26] },
        properties: { HOUR: 0, MAXWIND: 130 },
      },
      {
        geometry: { type: 'Point', coordinates: [-78, 28] },
        properties: { HOUR: 12, MAXWIND: 110 },
      },
      {
        geometry: { type: 'Polygon', coordinates: [[[-79, 25], [-79, 28], [-77, 28], [-77, 25], [-79, 25]]] },
        properties: {},
      },
    ],
  };
  const track = parseHurricaneTrack(raw, 'AL062026');
  assert.ok(track);
  assert.equal(track!.forecastPoints.length, 2);
  assert.equal(track!.uncertaintyCone?.length, 5);
});

test('parseHurricaneTrack: malformed → null', () => {
  assert.equal(parseHurricaneTrack(null, 'x'), null);
  assert.equal(parseHurricaneTrack({}, 'x'), null);
  assert.equal(parseHurricaneTrack({ features: [] }, 'x'), null);
});

// ── Drought CSV ──────────────────────────────────────────────────────

test('parseDroughtCsv: parses USDM percent rows', () => {
  const csv = [
    'MapDate,None,D0,D1,D2,D3,D4',
    '20260505,40.5,30.0,15.0,10.0,3.0,1.5',
    '20260428,42.1,29.0,14.5,9.5,3.5,1.4',
  ].join('\n');
  const rows = parseDroughtCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.weekDate, '2026-05-05');
  assert.ok(Math.abs(rows[0]!.d0Fraction - 0.30) < 1e-9);
});

test('latestDroughtSnapshot: returns the newest by ISO date', () => {
  const csv = ['MapDate,None,D0,D1,D2,D3,D4', '20260105,1,1,1,1,1,1', '20260112,2,2,2,2,2,2'].join('\n');
  const rows = parseDroughtCsv(csv);
  const latest = latestDroughtSnapshot(rows);
  assert.equal(latest?.weekDate, '2026-01-12');
});

test('parseDroughtCsv: handles M/D/YYYY date format', () => {
  const csv = ['MapDate,None,D0,D1,D2,D3,D4', '5/5/2026,40,30,15,10,3,2'].join('\n');
  const rows = parseDroughtCsv(csv);
  assert.equal(rows[0]!.weekDate, '2026-05-05');
});

// ── Sea ice CSV ──────────────────────────────────────────────────────

test('parseSeaIceCsv: parses NSIDC daily extent rows', () => {
  // Build a small fixture with 1981-2010 climatology + 2 modern years.
  const lines = ['Year, Month, Day, Extent, Missing, Source Data'];
  for (let yr = 1985; yr <= 1989; yr += 1) {
    lines.push(`${yr}, 03, 15, 14.5, 0, NRT`);
  }
  lines.push('2024, 03, 15, 13.0, 0, NRT');
  lines.push('2026, 03, 15, 12.0, 0, NRT');
  const rows = parseSeaIceCsv(lines.join('\n'));
  // Climatology is computed from 1981-2010 (here 1985-1989 = 5 points, all = 14.5)
  // The 2026 row should have anomaly = 12.0 - 14.5 = -2.5
  const latest = latestSeaIceSnapshot(rows);
  assert.equal(latest?.date, '2026-03-15');
  assert.equal(latest?.medianMillionKm2, 14.5);
  assert.ok(Math.abs(latest!.anomalyMillionKm2! - -2.5) < 1e-9);
});

test('parseSeaIceCsv: marks all-time low day-of-year', () => {
  const lines = [
    'Year, Month, Day, Extent, Missing, Source Data',
    '1985, 03, 15, 14.5, 0, NRT',
    '1990, 03, 15, 14.0, 0, NRT',
    '2024, 03, 15, 11.8, 0, NRT', // record low for DOY
  ];
  const rows = parseSeaIceCsv(lines.join('\n'));
  const recordLow = rows.find((r) => r.date === '2024-03-15');
  assert.equal(recordLow?.isRecordLow, true);
});

test('computeSeaIceClimatology: handles empty input', () => {
  assert.deepEqual(computeSeaIceClimatology([]), []);
});

// ── Polling constants ────────────────────────────────────────────────

test('WEATHER_HAZARD_POLLING_MS: 2min for alerts, 30min tropical, daily for slow series', () => {
  assert.equal(WEATHER_HAZARD_POLLING_MS.alerts, 2 * 60 * 1000);
  assert.equal(WEATHER_HAZARD_POLLING_MS.tropical, 30 * 60 * 1000);
  assert.equal(WEATHER_HAZARD_POLLING_MS.drought, 24 * 60 * 60 * 1000);
  assert.equal(WEATHER_HAZARD_POLLING_MS.seaIce, 24 * 60 * 60 * 1000);
});
