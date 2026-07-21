import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardEntityId, parseBoardEntityId, isBoardEntityId, toBoardIncomingEvent,
  BOARD_EVENT_DOMAINS, type BoardEventKind,
} from '../board-events.ts';
import { axisForDomain } from '../personal-lens.ts';

test('boardEntityId formats <kind>:<rawId> and is deterministic', () => {
  assert.equal(boardEntityId('earthquake', 'us7000abcd'), 'earthquake:us7000abcd');
  assert.equal(boardEntityId('conflict', 12345), 'conflict:12345');
  assert.equal(boardEntityId('earthquake', 'us7000abcd'), boardEntityId('earthquake', 'us7000abcd'));
});

test('boardEntityId percent-encodes the raw id (injective, lossless round-trip)', () => {
  const id = boardEntityId('vessel', 'MMSI:12:34');
  // The rawId colons are encoded, so the only bare ':' is the kind separator.
  assert.equal(id, 'vessel:MMSI%3A12%3A34');
  assert.deepEqual(parseBoardEntityId(id), { kind: 'vessel', rawId: 'MMSI:12:34' });
  // Distinct raw ids never collapse to the same board id.
  assert.notEqual(boardEntityId('vessel', 'MMSI:12:34'), boardEntityId('vessel', 'MMSI_12_34'));
});

test('parseBoardEntityId rejects malformed percent-encoding', () => {
  assert.equal(parseBoardEntityId('vessel:%zz'), null);
});

test('parseBoardEntityId round-trips a valid id', () => {
  const id = boardEntityId('gdacs', 'EQ-99');
  assert.deepEqual(parseBoardEntityId(id), { kind: 'gdacs', rawId: 'EQ-99' });
});

test('parseBoardEntityId rejects non-board ids', () => {
  assert.equal(parseBoardEntityId('aviation-flight-abc123'), null); // legacy dash scheme
  assert.equal(parseBoardEntityId('nokind'), null);
  assert.equal(parseBoardEntityId(':leading'), null);
  assert.equal(parseBoardEntityId('bogus:xyz'), null); // unknown kind
});

test('isBoardEntityId agrees with parseBoardEntityId', () => {
  assert.equal(isBoardEntityId('weather:wx-1'), true);
  assert.equal(isBoardEntityId('aviation-flight-1'), false);
});

test('every BoardEventKind maps to a lens domain', () => {
  const kinds: BoardEventKind[] = ['weather', 'earthquake', 'conflict', 'gdacs', 'disease',
    'wildfire', 'outage', 'cyber', 'flight', 'vessel'];
  for (const k of kinds) {
    assert.ok(BOARD_EVENT_DOMAINS[k], `${k} has a domain`);
  }
});

test('board domains resolve to sensible survival axes via the lens', () => {
  assert.equal(axisForDomain(BOARD_EVENT_DOMAINS.earthquake), 'physical_safety');
  assert.equal(axisForDomain(BOARD_EVENT_DOMAINS.conflict), 'security');
  assert.equal(axisForDomain(BOARD_EVENT_DOMAINS.disease), 'health');
  assert.equal(axisForDomain(BOARD_EVENT_DOMAINS.outage), 'energy_water');
  assert.equal(axisForDomain(BOARD_EVENT_DOMAINS.vessel), 'mobility');
  assert.equal(axisForDomain(BOARD_EVENT_DOMAINS.cyber), 'security');
});

test('toBoardIncomingEvent keys the event by the same boardEntityId', () => {
  const ev = toBoardIncomingEvent('earthquake', { rawId: 'us7000abcd', severity: 70, at: 1_700_000_000_000 });
  assert.equal(ev.eventId, boardEntityId('earthquake', 'us7000abcd'));
  assert.equal(ev.domain, 'weather'); // earthquake → physical_safety domain
  assert.equal(ev.severity, 70);
});

test('toBoardIncomingEvent passes through location + description + symbols', () => {
  const ev = toBoardIncomingEvent('conflict', {
    rawId: 42, severity: 90, at: 1_700_000_000_000,
    description: 'Airstrike near depot',
    location: { latitude: 33.5, longitude: 36.3, radiusKm: 30 },
    affectedEntities: ['SY'],
  });
  assert.equal(ev.description, 'Airstrike near depot');
  assert.deepEqual(ev.location, { latitude: 33.5, longitude: 36.3, radiusKm: 30 });
  assert.deepEqual(ev.affectedEntities, ['SY']);
});

test('toBoardIncomingEvent defaults description to the kind when absent', () => {
  const ev = toBoardIncomingEvent('wildfire', { rawId: 'f1', severity: 50, at: 0 });
  assert.equal(ev.description, 'wildfire');
});

test('the eventId a lens view would carry matches the entity id stamped on the marker', () => {
  // This is the whole point of PR1: entity.id === lensView.eventId.
  const rawId = 'us7000abcd';
  const entityId = boardEntityId('earthquake', rawId);
  const ev = toBoardIncomingEvent('earthquake', { rawId, severity: 70, at: 0 });
  assert.equal(entityId, ev.eventId);
});
