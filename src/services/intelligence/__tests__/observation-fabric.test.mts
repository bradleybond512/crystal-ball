import assert from 'node:assert/strict';
import test from 'node:test';

// ── Adapters ─────────────────────────────────────────────────────────────────

import {
  earthquakeToObservation,
  earthquakesToObservations,
} from '../adapters/earthquake-adapter.ts';
import {
  wildfireToObservation,
  wildifiresToObservations,
} from '../adapters/wildfire-adapter.ts';
import {
  notamToObservation,
  sigmetToObservation,
  notamsToObservations,
  sigmetsToObservations,
} from '../adapters/aviation-adapter.ts';
import {
  aisDisruptionToObservation,
  aisDisruptionsToObservations,
  adsbTrackToObservation,
  adsbTracksToObservations,
} from '../adapters/ais-adapter.ts';

// ── Registry ─────────────────────────────────────────────────────────────────

import {
  upsertEntity,
  getEntity,
  findByName,
  findNear,
  queryEntities,
  registrySize,
  _clearRegistryForTests,
} from '../entity-registry.ts';

// ── Observation Store ─────────────────────────────────────────────────────────

import {
  ingest,
  query,
  getRecent,
  storeSize,
  _clearStoreForTests,
} from '../observation-store.ts';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

const NOW = 1_750_000_000_000;

// Uses the generated protobuf Earthquake type (location.latitude/longitude, occurredAt, depthKm)
const EQ_MINOR = {
  id: 'usc000a001', place: '10km W of Pasadena, CA',
  magnitude: 3.2, depthKm: 10, occurredAt: NOW - 60_000, sourceUrl: '',
  location: { latitude: 34.14, longitude: -118.18 },
};

const EQ_MAJOR = {
  id: 'usc000a002', place: '5km NE of Tokyo, Japan',
  magnitude: 7.2, depthKm: 30, occurredAt: NOW - 30_000, sourceUrl: '',
  location: { latitude: 35.68, longitude: 139.70 },
};

const WILDFIRE_NO_LOC = {
  id: 'noloc-fire', name: 'Test Fire', state: 'CA', county: 'LA',
  cause: 'Lightning' as const, acresBurned: 500, percentContained: 20,
  evacuationOrders: false, evacuationWarnings: false,
  personnel: 50, engines: 10, helicopters: 2,
  discoveryDate: new Date(NOW - 86_400_000), updatedAt: new Date(NOW - 3_600_000),
  url: '', lat: null, lon: null, incidentType: 'Wildfire' as const, severity: 'low' as const,
};

const WILDFIRE_ACTIVE = {
  ...WILDFIRE_NO_LOC, id: 'fire-001', name: 'Oak Fire',
  lat: 37.5, lon: -119.9, severity: 'critical' as const,
  evacuationOrders: true, percentContained: 5, acresBurned: 12_000,
};

const NOTAM_TFR = {
  id: 'n001', notamNumber: '6/7891', classification: 'TFR' as const,
  affectedFir: 'ZLA', featureName: 'Temporary Flight Restriction',
  icaoId: 'KLAX', text: 'TFR ACTIVE', effectiveStart: NOW, effectiveEnd: NOW + 3_600_000,
  center: { lat: 33.94, lon: -118.41, radiusNm: 10 },
  altitudeFt: { min: 0, max: 3000 }, presidential: false,
};

const SIGMET_EXTREME = {
  id: 's001', hazard: 'volcanic_ash' as const, severity: 'extreme' as const,
  polygon: [
    { lat: 20, lon: -160 }, { lat: 22, lon: -158 }, { lat: 21, lon: -156 },
  ],
  text: 'VOLCANIC ASH ADVISORY', validFrom: NOW, validTo: NOW + 7_200_000, isAirmet: false,
};

const AIS_DISRUPTION = {
  id: 'dis-001', name: 'Strait of Hormuz', type: 'gap_spike' as const,
  lat: 26.5, lon: 56.0, severity: 'high' as const, changePct: 45,
  windowHours: 12, darkShips: 3, vesselCount: 120, region: 'PG',
  description: 'Significant AIS gap spike detected near Hormuz',
};

const ADSB_LOW_CONF = {
  hex: 'a12345', lat: 40.7, lng: -74.0, callsign: 'UAL123',
  observedAt: NOW - 90_000, confidence: 0.45,
  providers: ['opensky'], ageMs: 90_000,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Earthquake adapter
// ═══════════════════════════════════════════════════════════════════════════════

test('earthquake-adapter: maps minor quake to INFO severity', () => {
  const obs = earthquakeToObservation(EQ_MINOR);
  assert.equal(obs.sourceId, 'usgs-earthquake');
  assert.equal(obs.domain, 'weather');
  assert.equal(obs.severity, 'INFO');
  assert.ok(obs.tags.includes('earthquake'));
  assert.ok(obs.title.includes('M3.2'));
  assert.ok(obs.id.startsWith('usgs-eq-'));
});

test('earthquake-adapter: maps M7.2 to CRITICAL with tsunami-risk tag', () => {
  const obs = earthquakeToObservation(EQ_MAJOR);
  assert.equal(obs.severity, 'CRITICAL');
  assert.ok(obs.tags.includes('tsunami-risk'));
  assert.ok(obs.tags.includes('major-earthquake'));
  assert.equal(obs.location?.lat, 35.68);
  assert.equal(obs.location?.lon, 139.7);
});

test('earthquake-adapter: timestamp comes from eq.occurredAt', () => {
  const obs = earthquakeToObservation(EQ_MINOR);
  assert.equal(obs.timestamp, EQ_MINOR.occurredAt);
});

test('earthquake-adapter: batch converts array', () => {
  const all = earthquakesToObservations([EQ_MINOR, EQ_MAJOR]);
  assert.equal(all.length, 2);
  assert.equal(all[0].id, 'usgs-eq-usc000a001');
  assert.equal(all[1].id, 'usgs-eq-usc000a002');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Wildfire adapter
// ═══════════════════════════════════════════════════════════════════════════════

test('wildfire-adapter: returns null for incidents without coordinates', () => {
  const obs = wildfireToObservation(WILDFIRE_NO_LOC);
  assert.equal(obs, null);
});

test('wildfire-adapter: maps critical wildfire with evac order', () => {
  const obs = wildfireToObservation(WILDFIRE_ACTIVE);
  assert.ok(obs !== null);
  assert.equal(obs.severity, 'CRITICAL');
  assert.ok(obs.tags.includes('wildfire'));
  assert.ok(obs.tags.includes('evacuation-order'));
  assert.ok(obs.title.includes('Oak Fire'));
  assert.ok(obs.title.includes('12,000 acres'));
  assert.equal(obs.entityIds[0], 'CA');
});

test('wildfire-adapter: rapidly-spreading tag when <10% contained', () => {
  const obs = wildfireToObservation(WILDFIRE_ACTIVE);
  assert.ok(obs?.tags.includes('rapidly-spreading'));
});

test('wildfire-adapter: batch skips incidents without lat/lon', () => {
  const all = wildifiresToObservations([WILDFIRE_NO_LOC, WILDFIRE_ACTIVE]);
  assert.equal(all.length, 1);
  assert.equal(all[0].id, 'inciweb-fire-001');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Aviation adapter
// ═══════════════════════════════════════════════════════════════════════════════

test('aviation-adapter: notam TFR maps to aviation domain + MEDIUM', () => {
  const obs = notamToObservation(NOTAM_TFR);
  assert.equal(obs.domain, 'aviation');
  assert.equal(obs.severity, 'MEDIUM');
  assert.ok(obs.tags.includes('notam'));
  assert.ok(obs.tags.includes('tfr'));
  assert.equal(obs.entityIds[0], 'KLAX');
  assert.ok(obs.location?.radiusKm && obs.location.radiusKm > 0);
});

test('aviation-adapter: sigmet extreme maps to CRITICAL + hazard tag', () => {
  const obs = sigmetToObservation(SIGMET_EXTREME);
  assert.equal(obs.severity, 'CRITICAL');
  assert.ok(obs.tags.includes('volcanic_ash'));
  assert.ok(obs.tags.includes('sigmet'));
  assert.ok(obs.title.includes('SIGMET'));
});

test('aviation-adapter: sigmet centroid computed from polygon', () => {
  const obs = sigmetToObservation(SIGMET_EXTREME);
  assert.ok(obs.location != null);
  assert.ok(Math.abs(obs.location!.lat - 21) < 1);
  assert.ok(Math.abs(obs.location!.lon - (-158)) < 2);
});

test('aviation-adapter: airmet flag surfaces in tags', () => {
  const airmet = { ...SIGMET_EXTREME, id: 'a001', isAirmet: true, severity: 'light' as const };
  const obs = sigmetToObservation(airmet);
  assert.ok(obs.tags.includes('airmet'));
  assert.equal(obs.severity, 'LOW');
});

test('aviation-adapter: batch converts notams and sigmets', () => {
  assert.equal(notamsToObservations([NOTAM_TFR]).length, 1);
  assert.equal(sigmetsToObservations([SIGMET_EXTREME]).length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AIS adapter
// ═══════════════════════════════════════════════════════════════════════════════

test('ais-adapter: AIS disruption maps to maritime domain + HIGH severity', () => {
  const obs = aisDisruptionToObservation(AIS_DISRUPTION);
  assert.equal(obs.domain, 'maritime');
  assert.equal(obs.severity, 'HIGH');
  assert.ok(obs.tags.includes('ais'));
  assert.ok(obs.tags.includes('dark-ships'));
  assert.equal(obs.entityIds[0], 'PG');
});

test('ais-adapter: AIS elevated disruption maps to MEDIUM', () => {
  const obs = aisDisruptionToObservation({ ...AIS_DISRUPTION, severity: 'elevated' });
  assert.equal(obs.severity, 'MEDIUM');
});

test('ais-adapter: batch converts disruptions', () => {
  const all = aisDisruptionsToObservations([AIS_DISRUPTION]);
  assert.equal(all.length, 1);
});

test('ais-adapter: healthy fresh ADS-B track returns null (not an alert)', () => {
  const track = { ...ADSB_LOW_CONF, confidence: 0.9, ageMs: 10_000 };
  assert.equal(adsbTrackToObservation(track, NOW), null);
});

test('ais-adapter: low-confidence ADS-B track surfaces as MEDIUM observation', () => {
  const obs = adsbTrackToObservation(ADSB_LOW_CONF, NOW);
  assert.ok(obs !== null);
  assert.equal(obs!.domain, 'aviation');
  assert.equal(obs!.severity, 'MEDIUM');
  assert.ok(obs!.tags.includes('adsb'));
  assert.ok(obs!.entityIds.includes('UAL123'));
});

test('ais-adapter: very-low-confidence track surfaces as HIGH', () => {
  const track = { ...ADSB_LOW_CONF, confidence: 0.3 };
  const obs = adsbTrackToObservation(track, NOW);
  assert.equal(obs?.severity, 'HIGH');
});

test('ais-adapter: stale track gets stale-track tag', () => {
  const track = { ...ADSB_LOW_CONF, ageMs: 200_000 };
  const obs = adsbTrackToObservation(track, NOW);
  assert.ok(obs?.tags.includes('stale-track'));
});

test('ais-adapter: batch skips healthy tracks', () => {
  const fresh = { ...ADSB_LOW_CONF, confidence: 0.95, ageMs: 5_000 };
  const stale = { ...ADSB_LOW_CONF, hex: 'b00001', callsign: undefined, confidence: 0.5, ageMs: 200_000 };
  const all = adsbTracksToObservations([fresh, stale], NOW);
  assert.equal(all.length, 1);
  assert.ok(all[0].id.includes('b00001'), 'stale track id should include its hex');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Entity Registry
// ═══════════════════════════════════════════════════════════════════════════════

test('entity-registry: upsert creates and retrieves entity', () => {
  _clearRegistryForTests();
  upsertEntity({ id: 'mmsi-123', kind: 'ship', name: 'MV Horizon', lat: 26.5, lon: 56.0, meta: {} });
  const e = getEntity('mmsi-123');
  assert.ok(e != null);
  assert.equal(e!.name, 'MV Horizon');
  assert.equal(e!.kind, 'ship');
});

test('entity-registry: upsert merges meta without overwriting', () => {
  _clearRegistryForTests();
  upsertEntity({ id: 'hex-a001', kind: 'aircraft', name: 'UAL123', meta: { flag: 'US' } });
  upsertEntity({ id: 'hex-a001', kind: 'aircraft', name: 'UAL123', meta: { squawk: '7700' } });
  const e = getEntity('hex-a001');
  assert.equal(e?.meta['flag'], 'US');
  assert.equal(e?.meta['squawk'], '7700');
});

test('entity-registry: getEntity returns undefined for unknown id', () => {
  _clearRegistryForTests();
  assert.equal(getEntity('nonexistent'), undefined);
});

test('entity-registry: findByName finds case-insensitive substring', () => {
  _clearRegistryForTests();
  upsertEntity({ id: 'loc-1', kind: 'location', name: 'Strait of Hormuz', meta: {} });
  upsertEntity({ id: 'loc-2', kind: 'location', name: 'Suez Canal', meta: {} });
  const hits = findByName('hormuz');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'loc-1');
});

test('entity-registry: findNear filters by radius', () => {
  _clearRegistryForTests();
  upsertEntity({ id: 'ship-1', kind: 'ship', name: 'Near Ship', lat: 26.5, lon: 56.0, meta: {} });
  upsertEntity({ id: 'ship-2', kind: 'ship', name: 'Far Ship', lat: 0, lon: 0, meta: {} });
  const near = findNear({ lat: 26.5, lon: 56.0, radiusKm: 10 });
  assert.equal(near.length, 1);
  assert.equal(near[0].id, 'ship-1');
});

test('entity-registry: queryEntities filters by kind', () => {
  _clearRegistryForTests();
  upsertEntity({ id: 'ship-x', kind: 'ship', name: 'Tanker A', meta: {} });
  upsertEntity({ id: 'aircraft-x', kind: 'aircraft', name: 'UAL99', meta: {} });
  const ships = queryEntities({ kind: 'ship' });
  assert.equal(ships.length, 1);
  assert.equal(ships[0].id, 'ship-x');
});

test('entity-registry: registrySize reflects upsert count', () => {
  _clearRegistryForTests();
  assert.equal(registrySize(), 0);
  upsertEntity({ id: 'x1', kind: 'location', name: 'A', meta: {} });
  upsertEntity({ id: 'x2', kind: 'location', name: 'B', meta: {} });
  assert.equal(registrySize(), 2);
  upsertEntity({ id: 'x1', kind: 'location', name: 'A updated', meta: {} });
  assert.equal(registrySize(), 2);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Observation Store
// ═══════════════════════════════════════════════════════════════════════════════

function makeObs(id: string, domain = 'weather', ts = NOW): import('../../../types/intelligence.ts').ObservationEvent {
  return {
    id, sourceId: 'test', domain, timestamp: ts,
    severity: 'INFO', title: `Test ${id}`, raw: null, entityIds: [], tags: ['test'],
  };
}

test('observation-store: ingest and getRecent', () => {
  _clearStoreForTests();
  ingest([makeObs('o1'), makeObs('o2'), makeObs('o3')]);
  const recent = getRecent(10);
  assert.equal(recent.length, 3);
});

test('observation-store: getRecent returns newest first', () => {
  _clearStoreForTests();
  ingest(makeObs('first', 'weather', NOW - 1000));
  ingest(makeObs('last', 'weather', NOW));
  const recent = getRecent(2);
  assert.equal(recent[0].id, 'last');
  assert.equal(recent[1].id, 'first');
});

test('observation-store: query filters by domain', () => {
  _clearStoreForTests();
  ingest([makeObs('eq1', 'weather'), makeObs('ais1', 'maritime')]);
  const maritime = query({ domain: 'maritime' });
  assert.equal(maritime.length, 1);
  assert.equal(maritime[0].id, 'ais1');
});

test('observation-store: query filters by since timestamp', () => {
  _clearStoreForTests();
  ingest([makeObs('old', 'weather', NOW - 10_000), makeObs('new', 'weather', NOW)]);
  const recent = query({ since: NOW - 5_000 });
  assert.equal(recent.length, 1);
  assert.equal(recent[0].id, 'new');
});

test('observation-store: query filters by tag', () => {
  _clearStoreForTests();
  ingest([
    { ...makeObs('tagged'), tags: ['earthquake', 'tsunami-risk'] },
    makeObs('untagged'),
  ]);
  const hits = query({ tag: 'earthquake' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'tagged');
});

test('observation-store: query respects limit', () => {
  _clearStoreForTests();
  ingest(Array.from({ length: 10 }, (_, i) => makeObs(`obs-${i}`)));
  const limited = query({ limit: 3 });
  assert.equal(limited.length, 3);
});

test('observation-store: ring buffer overwrites oldest at capacity', () => {
  _clearStoreForTests();
  // Fill with 1000 events timestamped 0..999
  for (let i = 0; i < 1000; i++) {
    ingest(makeObs(`fill-${i}`, 'weather', i));
  }
  assert.equal(storeSize(), 1000);
  // Insert one more — should push out ts=0
  ingest(makeObs('overflow', 'weather', 9999));
  assert.equal(storeSize(), 1000);
  const all = query({ limit: 1000 });
  assert.ok(!all.some(e => e.id === 'fill-0'), 'oldest entry should be gone');
  assert.ok(all.some(e => e.id === 'overflow'), 'new entry should be present');
});

test('observation-store: storeSize tracks count', () => {
  _clearStoreForTests();
  assert.equal(storeSize(), 0);
  ingest(makeObs('a'));
  ingest(makeObs('b'));
  assert.equal(storeSize(), 2);
});

test('observation-store: single event ingest (non-array form)', () => {
  _clearStoreForTests();
  ingest(makeObs('single'));
  assert.equal(storeSize(), 1);
});
