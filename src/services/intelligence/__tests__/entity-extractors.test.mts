import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractAviationEntities,
  extractEntitiesFromObservation,
  extractLocationEntities,
  extractMaritimeEntities,
  extractSanctionsEntities,
  normalizeIcao24,
  normalizeMmsi,
  normalizeTail,
} from '../entity-extractors.ts';
import type { ObservationEvent } from '@/types/intelligence';

const NOW = 1_746_000_000_000;

function obs(overrides: Partial<ObservationEvent>): ObservationEvent {
  return {
    id: 'evt',
    sourceId: 'test',
    domain: 'maritime',
    timestamp: NOW,
    severity: 'INFO',
    title: 'unknown',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

// ── Normalizers ────────────────────────────────────────────────────────────

test('normalizeMmsi: accepts 9-digit strings + integers, rejects others', () => {
  assert.equal(normalizeMmsi('123456789'), '123456789');
  assert.equal(normalizeMmsi(' 123456789 '), '123456789');
  assert.equal(normalizeMmsi(123_456_789), '123456789');
  assert.equal(normalizeMmsi('12345'), undefined);
  assert.equal(normalizeMmsi('1234567890'), undefined);
  assert.equal(normalizeMmsi('not-a-number'), undefined);
  assert.equal(normalizeMmsi(undefined), undefined);
});

test('normalizeIcao24: 6 hex digits, case-insensitive', () => {
  assert.equal(normalizeIcao24('A12BCD'), 'a12bcd');
  assert.equal(normalizeIcao24('abcdef'), 'abcdef');
  assert.equal(normalizeIcao24('AB12'), undefined);
  assert.equal(normalizeIcao24('XYZ123'), undefined);
});

test('normalizeTail: letters + digits + dashes, 4..10 chars', () => {
  assert.equal(normalizeTail('n12345'), 'N12345');
  assert.equal(normalizeTail('G-EUUU'), 'G-EUUU');
  assert.equal(normalizeTail('ab'), undefined);
  assert.equal(normalizeTail('TOOLONGREG12'), undefined);
});

// ── Maritime ───────────────────────────────────────────────────────────────

test('maritime: extracts MMSI + vessel name from AIS payload', () => {
  const out = extractMaritimeEntities(obs({
    domain: 'maritime',
    raw: { mmsi: '111111111', vesselName: 'MV Horizon', flag: 'PA' },
    title: 'AIS position',
  }));
  assert.equal(out.length, 1);
  const e = out[0]!;
  assert.equal(e.type, 'ship');
  assert.equal(e.canonicalName, 'MV Horizon');
  assert.equal(e.identifiers?.mmsi, '111111111');
  assert.deepEqual(e.attributes, { flag: 'PA' });
});

test('maritime: falls back to MMSI from entityIds when raw has none', () => {
  const out = extractMaritimeEntities(obs({
    domain: 'maritime',
    entityIds: ['mmsi:222222222'],
    raw: {},
    title: 'AIS',
  }));
  assert.equal(out[0]!.identifiers?.mmsi, '222222222');
});

test('maritime: returns empty when no MMSI and no name', () => {
  const out = extractMaritimeEntities(obs({
    domain: 'maritime',
    raw: {},
    title: '',
  }));
  assert.equal(out.length, 0);
});

test('maritime: skips events from other domains', () => {
  assert.equal(extractMaritimeEntities(obs({ domain: 'aviation' })).length, 0);
});

// ── Aviation ───────────────────────────────────────────────────────────────

test('aviation: extracts ICAO24 + callsign + tail', () => {
  const out = extractAviationEntities(obs({
    domain: 'aviation',
    raw: { icao24: 'A12BCD', callsign: 'UAL123', registration: 'n12345' },
    title: 'flight',
  }));
  assert.equal(out.length, 1);
  const e = out[0]!;
  assert.equal(e.type, 'aircraft');
  assert.equal(e.identifiers?.icao24, 'a12bcd');
  assert.equal(e.identifiers?.callsign, 'UAL123');
  assert.equal(e.identifiers?.tail, 'N12345');
});

test('aviation: falls back to ICAO24 from entityIds', () => {
  const out = extractAviationEntities(obs({
    domain: 'aviation',
    entityIds: ['icao24:abc123'],
    raw: {},
  }));
  assert.equal(out[0]!.identifiers?.icao24, 'abc123');
});

test('aviation: canonical name prefers callsign when present', () => {
  const out = extractAviationEntities(obs({
    domain: 'aviation',
    raw: { icao24: 'abc123', callsign: 'UAL999', tail: 'N99999' },
  }));
  assert.equal(out[0]!.canonicalName, 'UAL999');
});

test('aviation: empty when nothing identifying is present', () => {
  assert.equal(extractAviationEntities(obs({ domain: 'aviation', raw: {} })).length, 0);
});

// ── Sanctions ──────────────────────────────────────────────────────────────

test('sanctions: extracts SDN ID + name + aliases for individual', () => {
  const out = extractSanctionsEntities(obs({
    domain: 'sanctions',
    raw: { sdnId: '12345', name: 'John Q. Public', aliases: ['Jon Public'], sdnType: 'individual' },
  }));
  assert.equal(out.length, 1);
  const e = out[0]!;
  assert.equal(e.type, 'person');
  assert.equal(e.identifiers?.['ofac-sdn'], '12345');
  assert.deepEqual(e.aliases, ['Jon Public']);
});

test('sanctions: maps sdnType "entity" to organization', () => {
  const out = extractSanctionsEntities(obs({
    domain: 'sanctions',
    raw: { sdnId: '999', name: 'Acme Corp', sdnType: 'entity' },
  }));
  assert.equal(out[0]!.type, 'organization');
});

test('sanctions: maps sdnType "vessel" to ship and "aircraft" to aircraft', () => {
  const ship = extractSanctionsEntities(obs({
    domain: 'sanctions',
    raw: { sdnId: 'V1', name: 'Sanctioned Vessel', sdnType: 'vessel' },
  }));
  const ac = extractSanctionsEntities(obs({
    domain: 'sanctions',
    raw: { sdnId: 'A1', name: 'Sanctioned Plane', sdnType: 'aircraft' },
  }));
  assert.equal(ship[0]!.type, 'ship');
  assert.equal(ac[0]!.type, 'aircraft');
});

test('sanctions: skips when no sdnId and no name', () => {
  assert.equal(extractSanctionsEntities(obs({ domain: 'sanctions', raw: {}, title: '' })).length, 0);
});

// ── Location ───────────────────────────────────────────────────────────────

test('location: rounds coordinates and produces a location entity', () => {
  const out = extractLocationEntities(obs({
    domain: 'earthquake',
    location: { lat: 35.681236, lon: 139.767125 },
    raw: { place: 'Tokyo' },
  }));
  assert.equal(out.length, 1);
  const e = out[0]!;
  assert.equal(e.type, 'location');
  assert.equal(e.canonicalName, 'Tokyo');
  assert.match(e.id, /location:geo:35\.7,139\.8/);
  assert.deepEqual(e.domains, ['earthquake']);
});

test('location: falls back to coord-string name when no place', () => {
  const out = extractLocationEntities(obs({
    domain: 'earthquake',
    location: { lat: -45.5, lon: 12.34 },
  }));
  assert.match(out[0]!.canonicalName, /-45\.50/);
});

test('location: skipped when observation has no coordinates', () => {
  assert.equal(extractLocationEntities(obs({ location: undefined })).length, 0);
});

// ── Aggregate ──────────────────────────────────────────────────────────────

test('extractEntitiesFromObservation: aggregates extractors and dedupes by id', () => {
  const out = extractEntitiesFromObservation(obs({
    domain: 'maritime',
    location: { lat: 25.0, lon: 56.0 },
    raw: { mmsi: '333333333', vesselName: 'MV Dual', place: 'Hormuz' },
  }));
  // One ship + one location.
  const types = out.map((e) => e.type).sort();
  assert.deepEqual(types, ['location', 'ship']);
});
