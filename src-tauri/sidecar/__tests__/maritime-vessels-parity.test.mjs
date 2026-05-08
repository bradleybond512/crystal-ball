/**
 * Parity test: the sidecar's inline JS port of the vessel classifier
 * must produce results matching the canonical TS module in
 * src/services/maritime/vessel-classifier.ts.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  classifyShipTypeSidecar,
  filterVesselsInRiskZonesSidecar,
  flagFromMmsiSidecar,
  summarizeVesselsSidecar,
  zoneForPositionSidecar,
} from '../local-api-server.mjs';

const NOW = 1_745_000_000_000;
const MIN_MS = 60 * 1000;

function row(over) {
  return { mmsi: '273000001', name: 'TEST', lat: 0, lon: 0, timestamp: NOW, ...over };
}

test('classifyShipTypeSidecar: tanker bands', () => {
  for (let t = 80; t <= 89; t++) assert.equal(classifyShipTypeSidecar(t), 'tanker');
});

test('classifyShipTypeSidecar: cargo split', () => {
  for (let t = 70; t <= 77; t++) assert.equal(classifyShipTypeSidecar(t), 'bulk_carrier');
  assert.equal(classifyShipTypeSidecar(78), 'container');
  assert.equal(classifyShipTypeSidecar(79), 'container');
});

test('classifyShipTypeSidecar: military / unknown', () => {
  assert.equal(classifyShipTypeSidecar(35), 'military');
  assert.equal(classifyShipTypeSidecar(55), 'military');
  assert.equal(classifyShipTypeSidecar(undefined), 'other');
  assert.equal(classifyShipTypeSidecar(0), 'other');
  assert.equal(classifyShipTypeSidecar(99), 'other');
});

test('flagFromMmsiSidecar: known + unknown MIDs', () => {
  assert.equal(flagFromMmsiSidecar('273000001'), 'Russia');
  assert.equal(flagFromMmsiSidecar('412567890'), 'China');
  assert.equal(flagFromMmsiSidecar('999000001'), 'Unknown');
  assert.equal(flagFromMmsiSidecar(''), 'Unknown');
  assert.equal(flagFromMmsiSidecar(undefined), 'Unknown');
});

test('zoneForPositionSidecar: each zone center hits the right zone', () => {
  assert.equal(zoneForPositionSidecar(17, 46)?.id, 'red-sea');
  assert.equal(zoneForPositionSidecar(26, 57)?.id, 'hormuz');
  assert.equal(zoneForPositionSidecar(44, 35)?.id, 'black-sea');
  assert.equal(zoneForPositionSidecar(14, 110)?.id, 'south-china-sea');
});

test('zoneForPositionSidecar: edges inclusive, off-zone null', () => {
  assert.equal(zoneForPositionSidecar(12, 42)?.id, 'red-sea');
  assert.equal(zoneForPositionSidecar(11.99, 42), null);
  assert.equal(zoneForPositionSidecar(30, -40), null);
});

test('filterVesselsInRiskZonesSidecar: keeps in-zone + classifies + decodes flag', () => {
  const out = filterVesselsInRiskZonesSidecar([
    row({ mmsi: '273123456', lat: 44, lon: 35, shipType: 80 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].zoneId, 'black-sea');
  assert.equal(out[0].category, 'tanker');
  assert.equal(out[0].flag, 'Russia');
});

test('filterVesselsInRiskZonesSidecar: drops bad coords + missing mmsi', () => {
  const out = filterVesselsInRiskZonesSidecar([
    row({ mmsi: '', lat: 17, lon: 46 }),
    row({ mmsi: '273000001', lat: Number.NaN, lon: 46 }),
  ]);
  assert.equal(out.length, 0);
});

test('filterVesselsInRiskZonesSidecar: maxAgeMs prunes stale rows', () => {
  const out = filterVesselsInRiskZonesSidecar([
    row({ mmsi: '273000001', lat: 44, lon: 35, timestamp: NOW - MIN_MS }),
    row({ mmsi: '273000002', lat: 44, lon: 35, timestamp: NOW - 60 * MIN_MS }),
  ], { now: NOW, maxAgeMs: 30 * MIN_MS });
  assert.equal(out.length, 1);
  assert.equal(out[0].mmsi, '273000001');
});

test('filterVesselsInRiskZonesSidecar: sorted newest-first', () => {
  const out = filterVesselsInRiskZonesSidecar([
    row({ mmsi: '273000001', lat: 44, lon: 35, timestamp: NOW - 5 * MIN_MS }),
    row({ mmsi: '273000002', lat: 44, lon: 36, timestamp: NOW - 1 * MIN_MS }),
    row({ mmsi: '273000003', lat: 44, lon: 37, timestamp: NOW - 3 * MIN_MS }),
  ]);
  assert.deepEqual(out.map((v) => v.mmsi), ['273000002', '273000003', '273000001']);
});

test('summarizeVesselsSidecar: histograms and total', () => {
  const vessels = filterVesselsInRiskZonesSidecar([
    row({ mmsi: '422000001', lat: 26, lon: 57, shipType: 80 }),
    row({ mmsi: '412000001', lat: 14, lon: 110, shipType: 79 }),
    row({ mmsi: '273000001', lat: 44, lon: 35, shipType: 35 }),
  ]);
  const s = summarizeVesselsSidecar(vessels);
  assert.equal(s.total, 3);
  assert.equal(s.byCategory.tanker, 1);
  assert.equal(s.byCategory.container, 1);
  assert.equal(s.byCategory.military, 1);
  assert.equal(s.byZone['Strait of Hormuz'], 1);
});
