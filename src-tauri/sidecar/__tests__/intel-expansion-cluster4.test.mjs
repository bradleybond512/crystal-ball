/**
 * Intel Expansion Cluster 4 — parser parity tests.
 *
 * All assertions run against committed fixture files (no live fetch).
 * Parsers are exported from local-api-server.mjs and tested here.
 *
 * Sources covered:
 *   - GDELT GKG geocoded events (parseGdeltGkgEvents)
 *   - SWPC OVATION aurora summary (parseSwpcAurora)
 *   - SWPC solar active regions (parseSwpcSolarRegions)
 *   - AviationWeather SIGMET/G-AIRMET hazards (parseAviationHazards)
 *   - FAA NAS airport events (parseFaaNasEvents)
 *   - BfS ODL radiation stations (parseBfsOdlStations)
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { join, dirname } = path;
import {
  parseGdeltGkgEvents,
  parseSwpcAurora,
  parseSwpcSolarRegions,
  parseAviationHazards,
  parseFaaNasEvents,
  parseBfsOdlStations,
} from '../local-api-server.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dir, 'fixtures');

// ── GDELT GKG geocoded events ─────────────────────────────────────────────────

test('parseGdeltGkgEvents: fixture produces 4 events', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gdelt-gkg-geojson.sample.json'), 'utf8'));
  const result = parseGdeltGkgEvents(raw);
  assert.equal(result.length, 4);
});

test('parseGdeltGkgEvents: first event has correct shape', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gdelt-gkg-geojson.sample.json'), 'utf8'));
  const result = parseGdeltGkgEvents(raw);
  const first = result[0];
  assert.equal(first.name, 'Jamshedpur, Jharkhand, India');
  assert.ok(Math.abs(first.lat - 22.8) < 0.01, 'lat should be ~22.8');
  assert.ok(Math.abs(first.lon - 86.18) < 0.01, 'lon should be ~86.18');
  assert.equal(typeof first.tone, 'number');
  assert.ok(first.url.includes('rediff.com'));
  assert.ok(Array.isArray(first.themes) && first.themes.length > 0, 'themes must be non-empty array');
  assert.ok(first.themes.includes('PROTEST'), 'themes must include PROTEST');
});

test('parseGdeltGkgEvents: all events have lat/lon and url', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gdelt-gkg-geojson.sample.json'), 'utf8'));
  const result = parseGdeltGkgEvents(raw);
  for (const ev of result) {
    assert.ok(typeof ev.lat === 'number', `${ev.name}: lat must be a number`);
    assert.ok(typeof ev.lon === 'number', `${ev.name}: lon must be a number`);
    assert.ok(typeof ev.url === 'string' && ev.url.length > 0, `${ev.name}: url must be non-empty string`);
  }
});

test('parseGdeltGkgEvents: negative tone event is present', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gdelt-gkg-geojson.sample.json'), 'utf8'));
  const result = parseGdeltGkgEvents(raw);
  const negative = result.filter(e => typeof e.tone === 'number' && e.tone < -5);
  assert.ok(negative.length >= 1, 'fixture should have at least one event with tone < -5');
});

test('parseGdeltGkgEvents: returns empty for missing features', () => {
  assert.deepEqual(parseGdeltGkgEvents(null), []);
  assert.deepEqual(parseGdeltGkgEvents({}), []);
  assert.deepEqual(parseGdeltGkgEvents({ features: [] }), []);
});

// ── SWPC OVATION aurora summary ───────────────────────────────────────────────

test('parseSwpcAurora: fixture returns correct maxAuroraPercent', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'swpc-aurora.sample.json'), 'utf8'));
  const result = parseSwpcAurora(raw);
  assert.equal(result.maxAuroraPercent, 62);
});

test('parseSwpcAurora: highLatitudeBand flag set when max >= 30', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'swpc-aurora.sample.json'), 'utf8'));
  const result = parseSwpcAurora(raw);
  assert.equal(result.highLatitudeBand, true);
});

test('parseSwpcAurora: forecastTime and observationTime are strings', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'swpc-aurora.sample.json'), 'utf8'));
  const result = parseSwpcAurora(raw);
  assert.ok(typeof result.forecastTime === 'string' && result.forecastTime.length > 0, 'forecastTime must be a non-empty string');
  assert.ok(typeof result.observationTime === 'string' && result.observationTime.length > 0, 'observationTime must be a non-empty string');
});

test('parseSwpcAurora: returns zero max for null/empty input', () => {
  const r1 = parseSwpcAurora(null);
  assert.equal(r1.maxAuroraPercent, 0);
  assert.equal(r1.highLatitudeBand, false);
  const r2 = parseSwpcAurora({ 'Forecast Time': '2026-07-01T14:04:00Z', coordinates: [] });
  assert.equal(r2.maxAuroraPercent, 0);
});

// ── SWPC solar active regions ─────────────────────────────────────────────────

test('parseSwpcSolarRegions: fixture produces 4 regions', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'swpc-solar-regions.sample.json'), 'utf8'));
  const result = parseSwpcSolarRegions(raw);
  assert.equal(result.length, 4);
});

test('parseSwpcSolarRegions: first region is 4087 with correct flare probabilities', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'swpc-solar-regions.sample.json'), 'utf8'));
  const result = parseSwpcSolarRegions(raw);
  const first = result[0];
  assert.equal(first.region, 4087);
  assert.equal(first.cFlareProbability, 25);
  assert.equal(first.mFlareProbability, 5);
  assert.equal(first.xFlareProbability, 1);
  assert.equal(first.magClass, 'beta');
  assert.equal(first.observedDate, '2026-07-01');
});

test('parseSwpcSolarRegions: beta-gamma region is present', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'swpc-solar-regions.sample.json'), 'utf8'));
  const result = parseSwpcSolarRegions(raw);
  const complex = result.find(r => r.magClass === 'beta-gamma');
  assert.ok(complex, 'fixture should have at least one beta-gamma region');
  assert.equal(complex.region, 4085);
  assert.equal(complex.mFlareProbability, 20);
});

test('parseSwpcSolarRegions: all regions have region number and location', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'swpc-solar-regions.sample.json'), 'utf8'));
  const result = parseSwpcSolarRegions(raw);
  for (const r of result) {
    assert.ok(typeof r.region === 'number', `region must be a number`);
    assert.ok(typeof r.location === 'string' && r.location.length > 0, `location must be a non-empty string`);
  }
});

test('parseSwpcSolarRegions: returns empty for non-array input', () => {
  assert.deepEqual(parseSwpcSolarRegions(null), []);
  assert.deepEqual(parseSwpcSolarRegions({}), []);
  assert.deepEqual(parseSwpcSolarRegions([]), []);
});

// ── AviationWeather hazards ───────────────────────────────────────────────────

test('parseAviationHazards: isigmet fixture produces 3 hazards', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'avwx-isigmet.sample.json'), 'utf8'));
  const result = parseAviationHazards(raw, 'isigmet');
  assert.equal(result.length, 3);
});

test('parseAviationHazards: isigmet hazards have source=isigmet and hazardType', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'avwx-isigmet.sample.json'), 'utf8'));
  const result = parseAviationHazards(raw, 'isigmet');
  for (const h of result) {
    assert.equal(h.source, 'isigmet');
    assert.ok(typeof h.hazardType === 'string' && h.hazardType.length > 0, 'hazardType must be set');
  }
});

test('parseAviationHazards: airsigmet fixture produces records with source=airsigmet', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'avwx-airsigmet.sample.json'), 'utf8'));
  const result = parseAviationHazards(raw, 'airsigmet');
  assert.ok(result.length >= 1, 'airsigmet fixture should have at least 1 record');
  assert.equal(result[0].source, 'airsigmet');
});

test('parseAviationHazards: gairmet fixture produces records with source=gairmet', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'avwx-gairmet.sample.json'), 'utf8'));
  const result = parseAviationHazards(raw, 'gairmet');
  assert.ok(result.length >= 1, 'gairmet fixture should have at least 1 record');
  assert.equal(result[0].source, 'gairmet');
});

test('parseAviationHazards: returns empty for null/empty input', () => {
  assert.deepEqual(parseAviationHazards(null, 'isigmet'), []);
  assert.deepEqual(parseAviationHazards([], 'isigmet'), []);
});

// ── FAA NAS airport events ────────────────────────────────────────────────────

test('parseFaaNasEvents: fixture produces events including ground_delay and departure_delay', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'faa-nas-status.sample.json'), 'utf8'));
  const result = parseFaaNasEvents(raw);
  assert.ok(result.length >= 3, 'should produce at least 3 events (EWR notam + SFO delay + MSP dep-delay)');
});

test('parseFaaNasEvents: SFO ground delay event is correct', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'faa-nas-status.sample.json'), 'utf8'));
  const result = parseFaaNasEvents(raw);
  const sfoDelay = result.find(e => e.airport === 'SFO' && e.eventType === 'ground_delay');
  assert.ok(sfoDelay, 'SFO ground_delay event must be present');
  assert.equal(sfoDelay.reason, 'low ceilings');
  assert.ok(typeof sfoDelay.lat === 'number', 'lat must be a number');
  assert.ok(typeof sfoDelay.lon === 'number', 'lon must be a number');
});

test('parseFaaNasEvents: MSP departure delay is correct', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'faa-nas-status.sample.json'), 'utf8'));
  const result = parseFaaNasEvents(raw);
  const mspDep = result.find(e => e.airport === 'MSP' && e.eventType === 'departure_delay');
  assert.ok(mspDep, 'MSP departure_delay event must be present');
});

test('parseFaaNasEvents: freeForm-only airports produce notam events', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'faa-nas-status.sample.json'), 'utf8'));
  const result = parseFaaNasEvents(raw);
  const ewrNotam = result.find(e => e.airport === 'EWR' && e.eventType === 'notam');
  assert.ok(ewrNotam, 'EWR should produce a notam event from freeForm');
  assert.ok(typeof ewrNotam.reason === 'string' && ewrNotam.reason.length > 0, 'notam reason must be set');
});

test('parseFaaNasEvents: returns empty for non-array input', () => {
  assert.deepEqual(parseFaaNasEvents(null), []);
  assert.deepEqual(parseFaaNasEvents({}), []);
  assert.deepEqual(parseFaaNasEvents([]), []);
});

// ── BfS ODL radiation stations ────────────────────────────────────────────────

test('parseBfsOdlStations: fixture produces 2 valid stations (null-value record filtered)', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'bfs-odl-radiation.sample.json'), 'utf8'));
  const result = parseBfsOdlStations(raw);
  // Third fixture feature has value:null and should be filtered out
  assert.equal(result.length, 2);
});

test('parseBfsOdlStations: first station is Manschnow with correct dose', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'bfs-odl-radiation.sample.json'), 'utf8'));
  const result = parseBfsOdlStations(raw);
  const manschnow = result[0];
  assert.equal(manschnow.id, 'DEZ2375');
  assert.equal(manschnow.name, 'Manschnow');
  assert.equal(manschnow.doseRate, 0.086);
  assert.equal(manschnow.unit, 'µSv/h');
  assert.ok(Math.abs(manschnow.lat - 52.55) < 0.01, 'lat should be ~52.55');
  assert.ok(Math.abs(manschnow.lon - 14.55) < 0.01, 'lon should be ~14.55');
  assert.equal(manschnow.measuredAt, '2026-07-01T12:00:00Z');
});

test('parseBfsOdlStations: second station is Butzbach with higher dose', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'bfs-odl-radiation.sample.json'), 'utf8'));
  const result = parseBfsOdlStations(raw);
  const butzbach = result[1];
  assert.equal(butzbach.id, 'DEZ3274');
  assert.equal(butzbach.name, 'Butzbach-Bodenrod');
  assert.equal(butzbach.doseRate, 0.139);
});

test('parseBfsOdlStations: kenn field is preserved', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'bfs-odl-radiation.sample.json'), 'utf8'));
  const result = parseBfsOdlStations(raw);
  assert.equal(result[0].kenn, '120643041');
});

test('parseBfsOdlStations: returns empty for missing features', () => {
  assert.deepEqual(parseBfsOdlStations(null), []);
  assert.deepEqual(parseBfsOdlStations({}), []);
  assert.deepEqual(parseBfsOdlStations({ features: [] }), []);
});
