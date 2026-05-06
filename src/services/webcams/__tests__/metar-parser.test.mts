import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseMetarResponse,
  parseMetarRow,
  parseStationResponse,
  parseStationRow,
} from '../metar-parser.ts';

// ── parseMetarRow ───────────────────────────────────────────────────────

test('parseMetarRow: parses canonical aviationweather row', () => {
  const row = {
    icaoId: 'KSBN',
    obsTime: 1_745_000_000,
    rawOb: 'KSBN 281555Z 24010KT 10SM SCT040 BKN090 18/12 A3015',
    wdir: 240,
    wspd: 10,
    visib: 10,
    wxString: '',
    temp: 18,
    dewp: 12,
    altim: 30.15,
    clouds: [
      { cover: 'SCT', base: 4000 },
      { cover: 'BKN', base: 9000 },
    ],
  };
  const m = parseMetarRow(row);
  assert.ok(m);
  assert.equal(m.stationId, 'KSBN');
  assert.equal(m.windDirDeg, 240);
  assert.equal(m.windSpeedKt, 10);
  assert.equal(m.visibilityMi, 10);
  assert.equal(m.tempC, 18);
  assert.equal(m.altimeterInHg, 30.15);
  assert.equal(m.clouds.length, 2);
  assert.equal(m.clouds[0]?.cover, 'SCT');
});

test('parseMetarRow: handles "10+" visibility string', () => {
  const m = parseMetarRow({ icaoId: 'KORD', visib: '10+' });
  assert.equal(m?.visibilityMi, 10);
});

test('parseMetarRow: returns null for missing icaoId', () => {
  assert.equal(parseMetarRow({ visib: 10 }), null);
  assert.equal(parseMetarRow(null), null);
  assert.equal(parseMetarRow('garbage'), null);
});

test('parseMetarRow: empty / unknown cloud covers are dropped', () => {
  const m = parseMetarRow({
    icaoId: 'KSBN',
    clouds: [
      { cover: 'BKN', base: 1500 },
      { cover: 'XYZ', base: 5000 },
      { cover: 'OVC' },
    ],
  });
  assert.equal(m?.clouds.length, 2);
  assert.equal(m?.clouds[0]?.cover, 'BKN');
  assert.equal(m?.clouds[1]?.cover, 'OVC');
  assert.equal(m?.clouds[1]?.baseFt, null);
});

test('parseMetarRow: numeric strings coerced; non-numeric returns null', () => {
  const m = parseMetarRow({ icaoId: 'X', wspd: '15', wdir: 'VRB' });
  assert.equal(m?.windSpeedKt, 15);
  assert.equal(m?.windDirDeg, null);
});

test('parseMetarRow: gust + weather string preserved', () => {
  const m = parseMetarRow({
    icaoId: 'KMIA',
    wspd: 18,
    wgst: 28,
    wxString: 'TSRA BR',
  });
  assert.equal(m?.windGustKt, 28);
  assert.equal(m?.weather, 'TSRA BR');
});

// ── parseMetarResponse ──────────────────────────────────────────────────

test('parseMetarResponse: filters bad rows, keeps good ones', () => {
  const out = parseMetarResponse([
    { icaoId: 'KSBN' },
    null,
    { wspd: 10 },
    { icaoId: 'KORD', wspd: 12 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.stationId, 'KSBN');
  assert.equal(out[1]?.stationId, 'KORD');
});

test('parseMetarResponse: tolerates non-array payload', () => {
  assert.equal(parseMetarResponse(null).length, 0);
  assert.equal(parseMetarResponse({ error: 'x' }).length, 0);
});

// ── parseStationRow ─────────────────────────────────────────────────────

test('parseStationRow: parses station with valid coords', () => {
  const s = parseStationRow({
    icaoId: 'KSBN',
    lat: 41.7,
    lon: -86.31,
    elev: 245,
    site: 'South Bend Intl',
    state: 'IN',
    country: 'US',
  });
  assert.ok(s);
  assert.equal(s.icaoId, 'KSBN');
  assert.equal(s.lat, 41.7);
  assert.equal(s.elevFt, 245);
});

test('parseStationRow: returns null on missing lat/lon', () => {
  assert.equal(parseStationRow({ icaoId: 'KX', lat: 41 }), null);
  assert.equal(parseStationRow({ icaoId: 'KX' }), null);
});

test('parseStationResponse: filters out invalid stations', () => {
  const out = parseStationResponse([
    { icaoId: 'KORD', lat: 41.97, lon: -87.9 },
    { icaoId: 'KX', lat: 'bad', lon: -1 },
    null,
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.icaoId, 'KORD');
});
