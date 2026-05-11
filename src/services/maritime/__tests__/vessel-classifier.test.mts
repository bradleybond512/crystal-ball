import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RISK_ZONES,
  classifyShipType,
  filterVesselsInRiskZones,
  flagFromMmsi,
  summarizeVessels,
  zoneForPosition,
  type AisVesselRow,
} from '../vessel-classifier.ts';

const NOW = 1_745_000_000_000;
const MIN_MS = 60 * 1000;

function row(over: Partial<AisVesselRow>): AisVesselRow {
  return {
    mmsi: '273000001',
    name: 'TEST',
    lat: 0,
    lon: 0,
    timestamp: NOW,
    ...over,
  };
}

// ── classifyShipType ─────────────────────────────────────────────────────────

test('classifyShipType: 80–89 → tanker', () => {
  for (let t = 80; t <= 89; t++) {
    assert.equal(classifyShipType(t), 'tanker', `${t}`);
  }
});

test('classifyShipType: 70–77 → bulk_carrier; 78/79 → container', () => {
  for (let t = 70; t <= 77; t++) assert.equal(classifyShipType(t), 'bulk_carrier', `${t}`);
  assert.equal(classifyShipType(78), 'container');
  assert.equal(classifyShipType(79), 'container');
});

test('classifyShipType: 35 / 55 → military', () => {
  assert.equal(classifyShipType(35), 'military');
  assert.equal(classifyShipType(55), 'military');
});

test('classifyShipType: undefined / NaN / unknown → other', () => {
  assert.equal(classifyShipType(undefined), 'other');
  assert.equal(classifyShipType(null), 'other');
  assert.equal(classifyShipType(Number.NaN), 'other');
  assert.equal(classifyShipType(0), 'other');
  assert.equal(classifyShipType(99), 'other');
});

// ── zoneForPosition + RISK_ZONES ─────────────────────────────────────────────

test('RISK_ZONES contains the four zones from the brief', () => {
  const ids = RISK_ZONES.map((z) => z.id).sort();
  assert.deepEqual(ids, ['black-sea', 'hormuz', 'red-sea', 'south-china-sea']);
});

test('zoneForPosition: Red Sea center → red-sea', () => {
  const z = zoneForPosition(17, 46);
  assert.equal(z?.id, 'red-sea');
});

test('zoneForPosition: Strait of Hormuz center → hormuz', () => {
  const z = zoneForPosition(26, 57);
  assert.equal(z?.id, 'hormuz');
});

test('zoneForPosition: mid-Atlantic → null', () => {
  assert.equal(zoneForPosition(30, -40), null);
});

test('zoneForPosition: NaN → null (no throw)', () => {
  assert.equal(zoneForPosition(Number.NaN, 0), null);
  assert.equal(zoneForPosition(0, Number.NaN), null);
});

test('zoneForPosition: bounding-box edges are inclusive', () => {
  // Red Sea south edge
  assert.equal(zoneForPosition(12, 42)?.id, 'red-sea');
  // Red Sea north-east corner
  assert.equal(zoneForPosition(22, 50)?.id, 'red-sea');
  // Just outside
  assert.equal(zoneForPosition(11.99, 42), null);
  assert.equal(zoneForPosition(22, 50.01), null);
});

// ── flagFromMmsi ─────────────────────────────────────────────────────────────

test('flagFromMmsi: known MIDs decode', () => {
  assert.equal(flagFromMmsi('273000001'), 'Russia');
  assert.equal(flagFromMmsi('271111111'), 'Turkey');
  assert.equal(flagFromMmsi('412567890'), 'China');
  assert.equal(flagFromMmsi('538123456'), 'Marshall Islands');
  assert.equal(flagFromMmsi('366111111'), 'United States');
});

test('flagFromMmsi: unknown MID → Unknown', () => {
  assert.equal(flagFromMmsi('999000001'), 'Unknown');
});

test('flagFromMmsi: too short / invalid → Unknown', () => {
  assert.equal(flagFromMmsi(''), 'Unknown');
  assert.equal(flagFromMmsi('12'), 'Unknown');
  assert.equal(flagFromMmsi(undefined), 'Unknown');
  assert.equal(flagFromMmsi(null), 'Unknown');
});

// ── filterVesselsInRiskZones ─────────────────────────────────────────────────

test('filterVesselsInRiskZones: keeps in-zone vessels with category + flag', () => {
  const out = filterVesselsInRiskZones([
    row({ mmsi: '273123456', lat: 44, lon: 35, shipType: 80, name: 'TANKER A' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.zoneId, 'black-sea');
  assert.equal(out[0]!.category, 'tanker');
  assert.equal(out[0]!.flag, 'Russia');
});

test('filterVesselsInRiskZones: drops out-of-zone vessels', () => {
  const out = filterVesselsInRiskZones([
    row({ mmsi: '366111111', lat: 40, lon: -73, shipType: 70 }), // off NYC
  ]);
  assert.equal(out.length, 0);
});

test('filterVesselsInRiskZones: drops bad coordinates and missing mmsi', () => {
  const out = filterVesselsInRiskZones([
    row({ mmsi: '', lat: 17, lon: 46 }),
    row({ mmsi: '273000001', lat: Number.NaN, lon: 46 }),
    row({ mmsi: '273000001', lat: 17, lon: Number.NaN }),
  ]);
  assert.equal(out.length, 0);
});

test('filterVesselsInRiskZones: maxAgeMs drops stale rows', () => {
  const now = NOW;
  const fresh = row({ mmsi: '273123456', lat: 44, lon: 35, timestamp: now - MIN_MS });
  const stale = row({ mmsi: '273234567', lat: 44, lon: 35, timestamp: now - 60 * MIN_MS });
  const out = filterVesselsInRiskZones([fresh, stale], { now, maxAgeMs: 30 * MIN_MS });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.mmsi, '273123456');
});

test('filterVesselsInRiskZones: sorted newest-first', () => {
  const out = filterVesselsInRiskZones([
    row({ mmsi: '273000001', lat: 44, lon: 35, timestamp: NOW - 5 * MIN_MS }),
    row({ mmsi: '273000002', lat: 44, lon: 36, timestamp: NOW - 1 * MIN_MS }),
    row({ mmsi: '273000003', lat: 44, lon: 37, timestamp: NOW - 3 * MIN_MS }),
  ]);
  assert.deepEqual(out.map((v) => v.mmsi), ['273000002', '273000003', '273000001']);
});

test('filterVesselsInRiskZones: vessels without timestamp sort last', () => {
  const out = filterVesselsInRiskZones([
    row({ mmsi: '273000001', lat: 44, lon: 35, timestamp: undefined }),
    row({ mmsi: '273000002', lat: 44, lon: 36, timestamp: NOW }),
  ]);
  assert.equal(out[0]!.mmsi, '273000002');
  assert.equal(out[1]!.mmsi, '273000001');
});

test('filterVesselsInRiskZones: speed/heading propagated when finite, null otherwise', () => {
  const out = filterVesselsInRiskZones([
    row({ mmsi: '273000001', lat: 44, lon: 35, speed: 12.5, heading: 270 }),
    row({ mmsi: '273000002', lat: 44, lon: 36, speed: undefined, heading: undefined }),
  ]);
  const a = out.find((v) => v.mmsi === '273000001')!;
  const b = out.find((v) => v.mmsi === '273000002')!;
  assert.equal(a.speedKnots, 12.5);
  assert.equal(a.headingDeg, 270);
  assert.equal(b.speedKnots, null);
  assert.equal(b.headingDeg, null);
});

test('filterVesselsInRiskZones: multi-zone scan tags each vessel with its zone', () => {
  const out = filterVesselsInRiskZones([
    row({ mmsi: '422000001', lat: 26, lon: 57, shipType: 80 }),  // Hormuz tanker
    row({ mmsi: '412000001', lat: 14, lon: 110, shipType: 79 }), // SCS container
    row({ mmsi: '273000001', lat: 44, lon: 35, shipType: 35 }),  // Black Sea military
    row({ mmsi: '475000001', lat: 17, lon: 43, shipType: 70 }),  // Red Sea bulk
  ]);
  assert.equal(out.length, 4);
  const m = new Map(out.map((v) => [v.mmsi, v]));
  assert.equal(m.get('422000001')!.zoneId, 'hormuz');
  assert.equal(m.get('412000001')!.zoneId, 'south-china-sea');
  assert.equal(m.get('273000001')!.zoneId, 'black-sea');
  assert.equal(m.get('475000001')!.zoneId, 'red-sea');
  assert.equal(m.get('475000001')!.flag, 'Yemen');
});

// ── summarizeVessels ─────────────────────────────────────────────────────────

test('summarizeVessels: empty → zero histograms', () => {
  const s = summarizeVessels([]);
  assert.equal(s.total, 0);
  assert.deepEqual(s.byCategory, { tanker: 0, bulk_carrier: 0, container: 0, military: 0, other: 0 });
});

test('summarizeVessels: counts by zone + category', () => {
  const vessels = filterVesselsInRiskZones([
    row({ mmsi: '422000001', lat: 26, lon: 57, shipType: 80 }),  // Hormuz tanker
    row({ mmsi: '422000002', lat: 26, lon: 57, shipType: 80 }),  // Hormuz tanker
    row({ mmsi: '412000001', lat: 14, lon: 110, shipType: 79 }), // SCS container
    row({ mmsi: '273000001', lat: 44, lon: 35, shipType: 35 }),  // Black Sea military
  ]);
  const s = summarizeVessels(vessels);
  assert.equal(s.total, 4);
  assert.equal(s.byCategory.tanker, 2);
  assert.equal(s.byCategory.container, 1);
  assert.equal(s.byCategory.military, 1);
  assert.equal(s.byZone['Strait of Hormuz'], 2);
  assert.equal(s.byZone['South China Sea'], 1);
  assert.equal(s.byZone['Black Sea'], 1);
});
