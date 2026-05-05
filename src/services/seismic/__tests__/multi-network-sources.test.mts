import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeGeofonEvent,
  normalizeGeonetEvent,
  normalizeIngvEvent,
  normalizeJmaEvent,
} from '../multi-network-sources.ts';

// ── GeoNet ────────────────────────────────────────────────────────────

test('normalizeGeonetEvent: parses a quality=best feature', () => {
  const event = normalizeGeonetEvent({
    geometry: { type: 'Point', coordinates: [173.5, -41.8] },
    properties: {
      publicID: '2024p001234',
      magnitude: 5.2,
      depth: 12,
      time: '2024-01-15T03:21:00.000Z',
      locality: '15 km E of Wellington',
      quality: 'best',
    },
  });
  assert.ok(event);
  assert.equal(event!.id, 'geonet:2024p001234');
  assert.equal(event!.source, 'geonet');
  assert.equal(event!.lat, -41.8);
  assert.equal(event!.lon, 173.5);
  assert.equal(event!.magnitude, 5.2);
  assert.equal(event!.depthKm, 12);
  assert.equal(event!.status, 'reviewed');
  assert.ok(event!.confidence > 0.7); // reviewed boost
});

test('normalizeGeonetEvent: maps quality=caution to automatic', () => {
  const event = normalizeGeonetEvent({
    geometry: { coordinates: [173, -41] },
    properties: {
      publicID: 'auto1',
      magnitude: 4.0,
      depth: 5,
      time: '2024-01-15T03:21:00.000Z',
      locality: '',
      quality: 'caution',
    },
  });
  assert.ok(event);
  assert.equal(event!.status, 'automatic');
});

test('normalizeGeonetEvent: drops feature without publicID', () => {
  const event = normalizeGeonetEvent({
    geometry: { coordinates: [173, -41] },
    properties: { magnitude: 4.0, depth: 5, time: '2024-01-15T03:21:00.000Z', locality: '', quality: 'best' },
  });
  assert.equal(event, null);
});

test('normalizeGeonetEvent: drops feature without coordinates', () => {
  const event = normalizeGeonetEvent({
    properties: { publicID: 'no-coords', magnitude: 4.0, depth: 5, time: '2024-01-15T03:21:00.000Z', locality: '', quality: 'best' },
  });
  assert.equal(event, null);
});

test('normalizeGeonetEvent: drops feature with malformed time', () => {
  const event = normalizeGeonetEvent({
    geometry: { coordinates: [173, -41] },
    properties: { publicID: 'bad-time', magnitude: 4.0, depth: 5, time: 'not-a-date', locality: '', quality: 'best' },
  });
  assert.equal(event, null);
});

// ── GEOFON / INGV (FDSN GeoJSON) ──────────────────────────────────────

test('normalizeGeofonEvent: parses a reviewed feature', () => {
  const event = normalizeGeofonEvent({
    id: 'gfz2024abcd',
    geometry: { type: 'Point', coordinates: [25.5, 38.7, 12.0] },
    properties: {
      mag: 4.8,
      magtype: 'mb',
      time: '2024-02-10T08:15:30.000Z',
      place: 'Aegean Sea',
      status: 'reviewed',
    },
  });
  assert.ok(event);
  assert.equal(event!.id, 'geofon:gfz2024abcd');
  assert.equal(event!.source, 'geofon');
  assert.equal(event!.depthKm, 12.0);
  assert.equal(event!.magnitudeType, 'mb');
  assert.equal(event!.status, 'reviewed');
});

test('normalizeIngvEvent: parses a preliminary feature', () => {
  const event = normalizeIngvEvent({
    id: 'ingv12345',
    geometry: { coordinates: [13.0, 42.5, 8.0] },
    properties: {
      mag: 3.7,
      magtype: 'ML',
      time: '2024-03-22T14:00:00.000Z',
      place: 'Central Italy',
      status: 'preliminary',
    },
  });
  assert.ok(event);
  assert.equal(event!.id, 'ingv:ingv12345');
  assert.equal(event!.source, 'ingv');
  assert.equal(event!.status, 'automatic'); // preliminary → automatic
});

test('FDSN normalizers: drop feature without id', () => {
  assert.equal(normalizeGeofonEvent({
    geometry: { coordinates: [0, 0, 0] },
    properties: { mag: 4, time: '2024-01-01T00:00:00Z' },
  }), null);
  assert.equal(normalizeIngvEvent({
    geometry: { coordinates: [0, 0, 0] },
    properties: { mag: 4, time: '2024-01-01T00:00:00Z' },
  }), null);
});

test('FDSN normalizers: depth missing leaves depthKm null', () => {
  const event = normalizeGeofonEvent({
    id: 'g1',
    geometry: { coordinates: [25.5, 38.7] },
    properties: { mag: 4.8, time: '2024-02-10T08:15:30.000Z', place: '', status: 'reviewed' },
  });
  assert.ok(event);
  assert.equal(event!.depthKm, null);
});

// ── JMA ───────────────────────────────────────────────────────────────

test('normalizeJmaEvent: parses N/E coordinate strings + yyyyMMddHHmmss time', () => {
  const event = normalizeJmaEvent({
    eid: '20240101170023',
    anm: '茨城県北部',
    mag: '3.4',
    lat: 'N37.0',
    lon: 'E140.6',
    dep: '10km',
    ctt: '20240101170000',
  });
  assert.ok(event);
  assert.equal(event!.source, 'jma');
  assert.equal(event!.id, 'jma:20240101170023');
  assert.equal(event!.lat, 37.0);
  assert.equal(event!.lon, 140.6);
  assert.equal(event!.magnitude, 3.4);
  assert.equal(event!.depthKm, 10);
  assert.equal(event!.place, '茨城県北部');
  assert.equal(event!.status, 'reviewed');
  // 17:00 JST on 2024-01-01 = 08:00 UTC on 2024-01-01
  const expectedUtc = Date.UTC(2024, 0, 1, 8, 0, 0);
  assert.equal(event!.occurredAt, expectedUtc);
});

test('normalizeJmaEvent: parses S/W coordinates (negative)', () => {
  const event = normalizeJmaEvent({
    eid: 'south',
    anm: '南半球テスト',
    mag: 5.0,
    lat: 'S40.0',
    lon: 'W170.0',
    dep: 30,
    ctt: '20240101170000',
  });
  assert.ok(event);
  assert.equal(event!.lat, -40.0);
  assert.equal(event!.lon, -170.0);
});

test('normalizeJmaEvent: numeric lat/lon also accepted', () => {
  const event = normalizeJmaEvent({
    eid: 'numeric',
    anm: 'Test',
    mag: 5.0,
    lat: 35.5,
    lon: 139.5,
    dep: 20,
    ctt: '20240101170000',
  });
  assert.ok(event);
  assert.equal(event!.lat, 35.5);
  assert.equal(event!.lon, 139.5);
});

test('normalizeJmaEvent: ISO time string also accepted', () => {
  const event = normalizeJmaEvent({
    eid: 'iso',
    anm: 'Test',
    mag: 4.0,
    lat: 'N35.0',
    lon: 'E139.0',
    dep: 0,
    ctt: '2024-05-01T12:34:56Z',
  });
  assert.ok(event);
  assert.equal(event!.occurredAt, Date.parse('2024-05-01T12:34:56Z'));
});

test('normalizeJmaEvent: ごく浅い depth parses to 0 km', () => {
  const event = normalizeJmaEvent({
    eid: 'shallow',
    anm: 'Test',
    mag: 4.0,
    lat: 'N35.0',
    lon: 'E139.0',
    dep: 'ごく浅い',
    ctt: '20240101170000',
  });
  assert.ok(event);
  assert.equal(event!.depthKm, 0);
});

test('normalizeJmaEvent: 不明 depth parses to null', () => {
  const event = normalizeJmaEvent({
    eid: 'unknown',
    anm: 'Test',
    mag: 4.0,
    lat: 'N35.0',
    lon: 'E139.0',
    dep: '深さ不明',
    ctt: '20240101170000',
  });
  assert.ok(event);
  assert.equal(event!.depthKm, null);
});

test('normalizeJmaEvent: drops entry without eid', () => {
  const event = normalizeJmaEvent({
    anm: 'Test', mag: 4.0, lat: 'N35.0', lon: 'E139.0', dep: 10,
    ctt: '20240101170000',
  });
  assert.equal(event, null);
});

test('normalizeJmaEvent: drops entry with bad coordinates', () => {
  const event = normalizeJmaEvent({
    eid: 'bad',
    anm: 'Test', mag: 4.0, lat: 'banana', lon: 'E139.0', dep: 10,
    ctt: '20240101170000',
  });
  assert.equal(event, null);
});

test('normalizeJmaEvent: drops entry with malformed timestamp', () => {
  const event = normalizeJmaEvent({
    eid: 'bad-time',
    anm: 'Test', mag: 4.0, lat: 'N35.0', lon: 'E139.0', dep: 10,
    ctt: '12345', // not 14 digits, not ISO
  });
  assert.equal(event, null);
});

// ── Cross-source: outputs are JSON-serializable ───────────────────────

test('all four normalizers produce JSON-serializable records', () => {
  const samples = [
    normalizeGeonetEvent({
      geometry: { coordinates: [173, -41] },
      properties: { publicID: 'g1', magnitude: 4, depth: 5, time: '2024-01-01T00:00:00Z', locality: 'NZ', quality: 'best' },
    }),
    normalizeGeofonEvent({
      id: 'gf1', geometry: { coordinates: [0, 0, 10] },
      properties: { mag: 4, time: '2024-01-01T00:00:00Z', place: '', status: 'reviewed' },
    }),
    normalizeIngvEvent({
      id: 'i1', geometry: { coordinates: [13, 42, 8] },
      properties: { mag: 3.5, time: '2024-01-01T00:00:00Z', place: '', status: 'reviewed' },
    }),
    normalizeJmaEvent({
      eid: 'j1', anm: 'JP', mag: 4, lat: 'N35.0', lon: 'E139.0', dep: 10,
      ctt: '20240101000000',
    }),
  ];
  for (const s of samples) {
    assert.ok(s);
    const round = JSON.parse(JSON.stringify(s));
    assert.equal(round.source, s!.source);
  }
});

// ── Source priority + confidence baselines (smoke) ────────────────────

test('all four regional networks produce confidence in [0.5, 1]', () => {
  const samples = [
    normalizeGeonetEvent({
      geometry: { coordinates: [173, -41] },
      properties: { publicID: 'g1', magnitude: 4, depth: 5, time: '2024-01-01T00:00:00Z', locality: '', quality: 'best' },
    }),
    normalizeGeofonEvent({
      id: 'gf1', geometry: { coordinates: [0, 0, 10] },
      properties: { mag: 4, time: '2024-01-01T00:00:00Z', place: '', status: 'reviewed' },
    }),
    normalizeIngvEvent({
      id: 'i1', geometry: { coordinates: [13, 42, 8] },
      properties: { mag: 3.5, time: '2024-01-01T00:00:00Z', place: '', status: 'preliminary' },
    }),
    normalizeJmaEvent({
      eid: 'j1', anm: 'JP', mag: 4, lat: 'N35.0', lon: 'E139.0', dep: 10,
      ctt: '20240101000000',
    }),
  ];
  for (const s of samples) {
    assert.ok(s);
    assert.ok(s!.confidence >= 0.5 && s!.confidence <= 1, `${s!.source} confidence ${s!.confidence}`);
  }
});
