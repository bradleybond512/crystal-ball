import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdapterRegistry,
  createDefaultRegistry,
  GenericAdapter,
  type ObservationAdapter,
  EarthquakeAdapter,
  WeatherAdapter,
  AviationAdapter,
  MaritimeAdapter,
  WildfireAdapter,
  SpaceWeatherAdapter,
  BiosurveillanceAdapter,
  SanctionsAdapter,
  InfrastructureAdapter,
  GdacsAdapter,
} from '../observation-adapters.ts';
import type { ObservationEvent } from '@/types/intelligence';

// ── AdapterRegistry semantics ────────────────────────────────────────────

test('AdapterRegistry registers and retrieves adapters by domain', () => {
  const reg = new AdapterRegistry();
  const adapter: ObservationAdapter<{ x: number }> = {
    sourceId: 'test',
    domain: 'weather',
    adaptOne: (raw) => ({
      id: `t-${raw.x}`,
      sourceId: 'test',
      domain: 'weather',
      timestamp: 0,
      severity: 'INFO',
      title: `x=${raw.x}`,
      raw,
      entityIds: [],
      tags: [],
    }),
    adaptMany: (raws) => raws.map((r) => adapter.adaptOne(r)),
  };
  reg.register(adapter);
  const result = reg.adapt('test', { x: 1 });
  assert.equal(result?.id, 't-1');
});

test('AdapterRegistry.adaptAll dispatches an array through its sourceId adapter', () => {
  const reg = createDefaultRegistry();
  const fakeQuakes = [
    { id: 'q1', occurredAt: 1000, magnitude: 6.2, place: 'Tokyo', depthKm: 30,
      location: { latitude: 35.68, longitude: 139.69 } },
  ];
  const out = reg.adaptAll('usgs-earthquake', fakeQuakes);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.domain, 'weather');
  assert.equal(out[0]?.severity, 'HIGH');
});

test('AdapterRegistry.adapt returns undefined for an unknown sourceId', () => {
  const reg = new AdapterRegistry();
  assert.equal(reg.adapt('nope', {}), undefined);
});

test('createDefaultRegistry has all 10 built-in adapters wired', () => {
  const reg = createDefaultRegistry();
  for (const id of [
    'usgs-earthquake',
    'nws-alerts',
    'aviation-track',
    'ais-disruption',
    'inciweb-wildfire',
    'swpc-space-weather',
    'cdc-biosurveillance',
    'ofac-sanctions',
    'cisa-infrastructure',
    'gdacs-alerts',
  ]) {
    assert.ok(reg.has(id), `expected ${id} adapter registered`);
  }
});

// ── EarthquakeAdapter ────────────────────────────────────────────────────

test('EarthquakeAdapter produces a CRITICAL ObservationEvent for M7+ quake', () => {
  const obs = EarthquakeAdapter.adaptOne({
    id: 'eq-1', occurredAt: 1000, magnitude: 7.3, place: 'Tokyo',
    depthKm: 20, location: { latitude: 35.68, longitude: 139.69 },
  });
  assert.equal(obs.severity, 'CRITICAL');
  assert.equal(obs.domain, 'weather');
  assert.equal(obs.location?.lat, 35.68);
  assert.ok(obs.tags.includes('earthquake'));
  assert.ok(obs.tags.includes('major-earthquake'));
});

test('EarthquakeAdapter falls back to INFO severity for M<4 quakes', () => {
  const obs = EarthquakeAdapter.adaptOne({
    id: 'eq-2', occurredAt: 1000, magnitude: 3.5, place: 'Suburb',
    depthKm: 10, location: { latitude: 0, longitude: 0 },
  });
  assert.equal(obs.severity, 'INFO');
});

// ── WeatherAdapter ────────────────────────────────────────────────────

test('WeatherAdapter maps NWS Severe severity to HIGH/CRITICAL', () => {
  const obs = WeatherAdapter.adaptOne({
    id: 'nws-1',
    event: 'Severe Thunderstorm Warning',
    severity: 'Severe',
    onset: 1000,
    expires: 4000,
    area: 'La Porte, IN',
    geometry: { coordinates: [-86.7, 41.6] },
  });
  assert.equal(obs.domain, 'weather');
  assert.equal(obs.severity, 'HIGH');
  assert.match(obs.title, /Severe Thunderstorm/);
  assert.equal(obs.location?.lat, 41.6);
});

test('WeatherAdapter Extreme severity maps to CRITICAL', () => {
  const obs = WeatherAdapter.adaptOne({
    id: 'nws-2', event: 'Tornado Warning', severity: 'Extreme',
    onset: 1000, expires: 2000, area: 'Boone County',
  });
  assert.equal(obs.severity, 'CRITICAL');
  assert.ok(obs.tags.includes('tornado-warning'));
});

// ── AviationAdapter ────────────────────────────────────────────────────

test('AviationAdapter handles OpenSky state-vector with squawk 7700 → CRITICAL', () => {
  const obs = AviationAdapter.adaptOne({
    icao24: 'abc123', callsign: 'UAL900',
    latitude: 41.85, longitude: -87.65,
    altitude: 11_000, squawk: '7700', timestamp: 1000,
  });
  assert.equal(obs.domain, 'aviation');
  assert.equal(obs.severity, 'CRITICAL');
  assert.ok(obs.tags.includes('emergency-squawk'));
  assert.ok(obs.entityIds.includes('UAL900'));
});

test('AviationAdapter normal squawk = INFO', () => {
  const obs = AviationAdapter.adaptOne({
    icao24: 'def456', callsign: 'DAL10',
    latitude: 0, longitude: 0,
    altitude: 10_000, squawk: '1234', timestamp: 1000,
  });
  assert.equal(obs.severity, 'INFO');
});

// ── MaritimeAdapter ────────────────────────────────────────────────────

test('MaritimeAdapter maps AIS vessel to maritime observation', () => {
  const obs = MaritimeAdapter.adaptOne({
    mmsi: '477123456', vesselName: 'Test Carrier',
    lat: 25.0, lon: -80.0, speedKn: 12, destination: 'Miami',
    timestamp: 1000,
  });
  assert.equal(obs.domain, 'maritime');
  assert.equal(obs.entityIds[0], '477123456');
  assert.match(obs.title, /Test Carrier/);
});

test('MaritimeAdapter vessel with 0kn speed gets adrift tag', () => {
  const obs = MaritimeAdapter.adaptOne({
    mmsi: '477', vesselName: 'X', lat: 0, lon: 0, speedKn: 0,
    destination: '', timestamp: 1000,
  });
  assert.ok(obs.tags.includes('vessel-stopped'));
});

// ── WildfireAdapter ────────────────────────────────────────────────────

test('WildfireAdapter exposes the existing wildfire-adapter behavior through the registry', () => {
  const obs = WildfireAdapter.adaptOne({
    id: 'wf-1', name: 'Test', state: 'CA',
    severity: 'high', incidentType: 'Wildfire',
    acresBurned: 1000, percentContained: 20,
    discoveryDate: new Date(1000),
    updatedAt: new Date(1000),
    lat: 40, lon: -120,
    evacuationOrders: 1, evacuationWarnings: 0,
  });
  assert.ok(obs);
  assert.equal(obs!.domain, 'weather');
  assert.equal(obs!.severity, 'HIGH');
});

// ── SpaceWeatherAdapter ────────────────────────────────────────────────

test('SpaceWeatherAdapter maps G5 geomagnetic storm to CRITICAL', () => {
  const obs = SpaceWeatherAdapter.adaptOne({
    id: 'sw-1', eventType: 'geomagnetic-storm',
    scale: 'G5', onset: 1000, regions: ['polar'],
  });
  assert.equal(obs.domain, 'space');
  assert.equal(obs.severity, 'CRITICAL');
  assert.ok(obs.tags.includes('geomagnetic-storm'));
});

test('SpaceWeatherAdapter low-scale event = LOW', () => {
  const obs = SpaceWeatherAdapter.adaptOne({
    id: 'sw-2', eventType: 'solar-radiation-storm',
    scale: 'S1', onset: 1000, regions: [],
  });
  assert.equal(obs.severity, 'LOW');
});

// ── BiosurveillanceAdapter ────────────────────────────────────────────

test('BiosurveillanceAdapter scales severity by case count', () => {
  const big = BiosurveillanceAdapter.adaptOne({
    id: 'bio-1', disease: 'Avian Influenza H5N1',
    location: 'Vietnam', caseCount: 1500, timestamp: 1000,
  });
  assert.equal(big.severity, 'CRITICAL');
  const small = BiosurveillanceAdapter.adaptOne({
    id: 'bio-2', disease: 'Norovirus',
    location: 'Cruise ship', caseCount: 5, timestamp: 1000,
  });
  assert.equal(small.severity, 'LOW');
});

test('BiosurveillanceAdapter sets domain to humanitarian', () => {
  const obs = BiosurveillanceAdapter.adaptOne({
    id: 'bio-3', disease: 'X', location: 'Y', caseCount: 100, timestamp: 1000,
  });
  assert.equal(obs.domain, 'humanitarian');
});

// ── SanctionsAdapter ───────────────────────────────────────────────────

test('SanctionsAdapter normalizes OFAC entry', () => {
  const obs = SanctionsAdapter.adaptOne({
    sdnId: 'SDN-12345', entityType: 'Individual',
    name: 'John Doe', reason: 'Iran-related', timestamp: 1000,
  });
  assert.equal(obs.domain, 'macro');
  assert.equal(obs.severity, 'MEDIUM');
  assert.equal(obs.entityIds[0], 'SDN-12345');
});

// ── InfrastructureAdapter ───────────────────────────────────────────────

test('InfrastructureAdapter maps CISA advisory to infra observation', () => {
  const obs = InfrastructureAdapter.adaptOne({
    id: 'cisa-1', affectedSystem: 'Industrial Control System',
    impactType: 'remote-code-execution', severity: 'critical', timestamp: 1000,
  });
  assert.equal(obs.domain, 'infra');
  assert.equal(obs.severity, 'CRITICAL');
});

// ── GdacsAdapter ───────────────────────────────────────────────────────

test('GdacsAdapter maps Red alert level to CRITICAL', () => {
  const obs = GdacsAdapter.adaptOne({
    id: 'gdacs-1', eventType: 'TC', alertLevel: 'Red',
    country: 'PH', lat: 14.6, lon: 120.98, onset: 1000,
  });
  assert.equal(obs.severity, 'CRITICAL');
  assert.equal(obs.entityIds[0], 'PH');
  assert.ok(obs.tags.includes('tropical-cyclone'));
});

test('GdacsAdapter maps Green alert level to LOW', () => {
  const obs = GdacsAdapter.adaptOne({
    id: 'gdacs-2', eventType: 'EQ', alertLevel: 'Green',
    country: 'CL', lat: -33, lon: -70, onset: 1000,
  });
  assert.equal(obs.severity, 'LOW');
});

// ── GenericAdapter ─────────────────────────────────────────────────────

test('GenericAdapter maps any object with title + lat/lon + severity', () => {
  const adapter = new GenericAdapter({
    sourceId: 'custom-feed',
    domain: 'cyber',
  });
  const obs = adapter.adaptOne({
    id: 'x-1', title: 'Custom event', lat: 41, lon: -86,
    severity: 'HIGH', timestamp: 1000,
  });
  assert.equal(obs.domain, 'cyber');
  assert.equal(obs.sourceId, 'custom-feed');
  assert.equal(obs.title, 'Custom event');
  assert.equal(obs.severity, 'HIGH');
});

test('GenericAdapter defaults severity to INFO when missing', () => {
  const adapter = new GenericAdapter({ sourceId: 'x', domain: 'other' });
  const obs = adapter.adaptOne({ id: 'x', title: 't', timestamp: 1000 });
  assert.equal(obs.severity, 'INFO');
});

// ── ingestRaw wiring ───────────────────────────────────────────────────

test('observation-store.ingestRaw adapts and stores raw provider payloads', async () => {
  const { ingestRaw, getRecent, _clearStoreForTests } = await import('../observation-store.ts');
  _clearStoreForTests();
  const adapted = ingestRaw('usgs-earthquake', [{
    id: 'eq-store-1', occurredAt: 1234, magnitude: 6.0, place: 'Test',
    depthKm: 10, location: { latitude: 0, longitude: 0 },
  }]);
  assert.equal(adapted.length, 1);
  const stored = getRecent(5);
  assert.ok(stored.some((e) => e.id === 'usgs-eq-eq-store-1'));
  _clearStoreForTests();
});

test('observation-store.ingestRaw silently drops unknown sourceIds', async () => {
  const { ingestRaw, _clearStoreForTests, storeSize } = await import('../observation-store.ts');
  _clearStoreForTests();
  const adapted = ingestRaw('unknown-source', [{ x: 1 }]);
  assert.deepEqual(adapted, []);
  assert.equal(storeSize(), 0);
});

// ── Output invariants ──────────────────────────────────────────────────

test('every built-in adapter produces a JSON-serializable ObservationEvent', () => {
  const samples: { id: string; raw: unknown; adapter: ObservationAdapter<never> }[] = [
    { id: 'usgs-earthquake', adapter: EarthquakeAdapter as ObservationAdapter<never>,
      raw: { id: 'q', occurredAt: 1, magnitude: 5, place: 'p', depthKm: 1,
        location: { latitude: 0, longitude: 0 } } },
    { id: 'nws-alerts', adapter: WeatherAdapter as ObservationAdapter<never>,
      raw: { id: 'n', event: 'Test', severity: 'Moderate', onset: 0, expires: 0, area: 'a' } },
    { id: 'aviation-track', adapter: AviationAdapter as ObservationAdapter<never>,
      raw: { icao24: 'x', callsign: 'y', latitude: 0, longitude: 0, altitude: 0, squawk: '1234', timestamp: 0 } },
    { id: 'ais-disruption', adapter: MaritimeAdapter as ObservationAdapter<never>,
      raw: { mmsi: '1', vesselName: 'v', lat: 0, lon: 0, speedKn: 1, destination: '', timestamp: 0 } },
    { id: 'inciweb-wildfire', adapter: WildfireAdapter as ObservationAdapter<never>,
      raw: { id: 'w', name: 'x', state: 's', severity: 'low', incidentType: 'Wildfire',
        acresBurned: 1, percentContained: 1, discoveryDate: new Date(0), updatedAt: new Date(0),
        lat: 0, lon: 0, evacuationOrders: 0, evacuationWarnings: 0 } },
  ];
  for (const s of samples) {
    const obs = s.adapter.adaptOne(s.raw as never);
    if (!obs) continue;
    // JSON round-trip must succeed
    const json = JSON.stringify({ ...obs, raw: '<redacted>' });
    const parsed = JSON.parse(json) as ObservationEvent;
    assert.equal(typeof parsed.id, 'string');
    assert.equal(typeof parsed.title, 'string');
    assert.ok(Array.isArray(parsed.tags));
    assert.ok(Array.isArray(parsed.entityIds));
  }
});
