// src-tauri/sidecar/ipaws-aggregate.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseNwsCapFeatures,
  parseFemaDisasters,
  dedupeAlerts,
  expireAlerts,
} from './ipaws-aggregate.mjs';

const FIXED_NOW = new Date('2026-05-05T18:00:00Z').getTime();

const nwsFeature = (overrides) => ({
  id: 'urn:nws:abcd-1234',
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[-87.5, 41.5], [-87.4, 41.5], [-87.4, 41.6], [-87.5, 41.5]]],
  },
  properties: {
    id: 'urn:nws:abcd-1234',
    event: 'Tornado Warning',
    headline: 'Tornado Warning issued for La Porte',
    description: 'A tornado has been spotted on radar near La Porte.',
    severity: 'Extreme',
    urgency: 'Immediate',
    certainty: 'Observed',
    areaDesc: 'La Porte, IN',
    effective: '2026-05-05T17:30:00Z',
    expires: '2026-05-05T19:00:00Z',
    status: 'Actual',
    ...overrides?.properties,
  },
  ...overrides,
});

const femaRow = (overrides) => ({
  disasterNumber: 4789,
  incidentType: 'Hurricane',
  declarationTitle: 'HURRICANE IDA',
  state: 'LA',
  declarationDate: '2026-05-04T12:00:00Z',
  ...overrides,
});

// ── parseNwsCapFeatures ──────────────────────────────────────────────────────

test('parseNwsCapFeatures: empty / non-array input returns []', () => {
  assert.deepEqual(parseNwsCapFeatures([]), []);
  assert.deepEqual(parseNwsCapFeatures(null), []);
  assert.deepEqual(parseNwsCapFeatures(undefined), []);
});

test('parseNwsCapFeatures: extracts standard CAP fields', () => {
  const result = parseNwsCapFeatures([nwsFeature()]);
  assert.equal(result.length, 1);
  const a = result[0];
  assert.equal(a.id, 'urn:nws:abcd-1234');
  assert.equal(a.source, 'NWS');
  assert.equal(a.event, 'Tornado Warning');
  assert.equal(a.severity, 'Extreme');
  assert.equal(a.urgency, 'Immediate');
  assert.equal(a.certainty, 'Observed');
  assert.equal(a.areaDesc, 'La Porte, IN');
  assert.equal(a.effective, '2026-05-05T17:30:00Z');
  assert.equal(a.expires, '2026-05-05T19:00:00Z');
});

test('parseNwsCapFeatures: tolerates missing optional fields', () => {
  const minimal = nwsFeature({ properties: { id: 'urn:x', event: 'Flood Watch' } });
  const result = parseNwsCapFeatures([minimal]);
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, 'Unknown');
  assert.equal(result[0].urgency, 'Unknown');
  assert.equal(result[0].areaDesc, '');
});

test('parseNwsCapFeatures: drops features with no id', () => {
  const broken = nwsFeature({ id: undefined, properties: { id: undefined, event: 'No ID Event' } });
  const result = parseNwsCapFeatures([broken]);
  assert.equal(result.length, 0);
});

test('parseNwsCapFeatures: extracts a centroid when polygon present', () => {
  const result = parseNwsCapFeatures([nwsFeature()]);
  assert.ok(result[0].centroid, 'centroid should exist');
  assert.equal(result[0].centroid.length, 2);
  // Average of polygon vertices ~ [-87.45, 41.525]
  assert.ok(result[0].centroid[0] < -87 && result[0].centroid[0] > -88);
  assert.ok(result[0].centroid[1] > 41 && result[0].centroid[1] < 42);
});

// ── parseFemaDisasters ───────────────────────────────────────────────────────

test('parseFemaDisasters: empty input returns []', () => {
  assert.deepEqual(parseFemaDisasters([]), []);
  assert.deepEqual(parseFemaDisasters(null), []);
});

test('parseFemaDisasters: maps disaster summaries to IpawsAlert shape', () => {
  const result = parseFemaDisasters([femaRow()]);
  assert.equal(result.length, 1);
  const a = result[0];
  assert.equal(a.id, 'fema-disaster-4789');
  assert.equal(a.source, 'FEMA');
  assert.equal(a.event, 'Hurricane');
  assert.equal(a.headline, 'HURRICANE IDA');
  assert.equal(a.areaDesc, 'LA');
  assert.equal(a.effective, '2026-05-04T12:00:00Z');
});

test('parseFemaDisasters: skips rows missing disasterNumber', () => {
  const result = parseFemaDisasters([{ incidentType: 'Fire', declarationTitle: 'X' }]);
  assert.equal(result.length, 0);
});

// ── dedupeAlerts ─────────────────────────────────────────────────────────────

test('dedupeAlerts: keeps first occurrence per id', () => {
  const a = parseNwsCapFeatures([nwsFeature()])[0];
  const a2 = { ...a, headline: 'duplicate-headline' };
  const result = dedupeAlerts([a, a2]);
  assert.equal(result.length, 1);
  assert.equal(result[0].headline, a.headline);
});

test('dedupeAlerts: keeps distinct ids regardless of source', () => {
  const nws = parseNwsCapFeatures([nwsFeature()])[0];
  const fema = parseFemaDisasters([femaRow()])[0];
  const result = dedupeAlerts([nws, fema]);
  assert.equal(result.length, 2);
});

// ── expireAlerts ─────────────────────────────────────────────────────────────

test('expireAlerts: drops alerts whose expires is in the past', () => {
  const past = parseNwsCapFeatures([nwsFeature({
    properties: { id: 'urn:past', event: 'Old Watch', expires: '2026-05-05T17:00:00Z' },
  })])[0];
  const future = parseNwsCapFeatures([nwsFeature({
    properties: { id: 'urn:future', event: 'New Warn', expires: '2026-05-05T20:00:00Z' },
  })])[0];
  const result = expireAlerts([past, future], FIXED_NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'urn:future');
});

test('expireAlerts: keeps alerts with no expires field', () => {
  const noExpiry = { id: 'persistent', source: 'FEMA', event: 'Hurricane', headline: '', severity: 'Unknown', urgency: 'Unknown', certainty: 'Unknown', areaDesc: 'LA', effective: '', expires: '', centroid: null };
  const result = expireAlerts([noExpiry], FIXED_NOW);
  assert.equal(result.length, 1);
});

test('expireAlerts: tolerates malformed expires', () => {
  const broken = { id: 'broken', source: 'NWS', event: '', headline: '', severity: 'Unknown', urgency: 'Unknown', certainty: 'Unknown', areaDesc: '', effective: '', expires: 'not-a-date', centroid: null };
  const result = expireAlerts([broken], FIXED_NOW);
  assert.equal(result.length, 1);
});
