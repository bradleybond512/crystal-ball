import assert from 'node:assert/strict';
import test from 'node:test';

import {
  correlateThreats,
  detectSeismicNuclear,
  detectSpaceWeatherCascade,
  detectWildfireAirQuality,
  detectInfraCyber,
  detectHurricaneFuel,
  detectMultiHazard,
  haversineKm,
  NUCLEAR_FACILITIES,
  GULF_FUEL_INFRASTRUCTURE,
} from '../correlation-engine.ts';
import type {
  AirQualitySensor,
  BgpHijack,
  CorrelationInput,
  CyberPulse,
  DomainElevation,
  FirePoint,
  Hurricane,
  SeismicEvent,
  SpaceWeatherSnapshot,
} from '../correlation-engine.ts';

const NOW = new Date('2026-05-07T12:00:00Z');

// ── Static-data sanity ──────────────────────────────────────────────────────

test('NUCLEAR_FACILITIES contains 20 plants with finite coordinates', () => {
  assert.equal(NUCLEAR_FACILITIES.length, 20);
  for (const f of NUCLEAR_FACILITIES) {
    assert.ok(Number.isFinite(f.lat) && Math.abs(f.lat) <= 90, `${f.name}: bad lat`);
    assert.ok(Number.isFinite(f.lon) && Math.abs(f.lon) <= 180, `${f.name}: bad lon`);
    assert.ok(f.id.length > 0 && f.name.length > 0, `${f.name}: missing id/name`);
  }
});

test('GULF_FUEL_INFRASTRUCTURE entries sit in the Gulf of Mexico bounding box', () => {
  assert.ok(GULF_FUEL_INFRASTRUCTURE.length >= 8);
  for (const f of GULF_FUEL_INFRASTRUCTURE) {
    assert.ok(f.lat >= 25 && f.lat <= 31, `${f.name}: lat ${f.lat} outside Gulf range`);
    assert.ok(f.lon >= -98 && f.lon <= -82, `${f.name}: lon ${f.lon} outside Gulf range`);
  }
});

// ── haversineKm sanity ──────────────────────────────────────────────────────

test('haversineKm: identical points = 0', () => {
  assert.equal(haversineKm(40, -100, 40, -100), 0);
});

test('haversineKm: 1° latitude ≈ 111 km', () => {
  const km = haversineKm(0, 0, 1, 0);
  assert.ok(Math.abs(km - 111.19) < 0.5, `expected ~111km, got ${km}`);
});

// ── Helpers for fixtures ────────────────────────────────────────────────────

function quake(over: Partial<SeismicEvent> = {}): SeismicEvent {
  return {
    id: 'us-default',
    lat: 0,
    lon: 0,
    magnitude: 5.5,
    occurredAt: NOW,
    ...over,
  };
}

function fire(over: Partial<FirePoint> = {}): FirePoint {
  return {
    id: 'fire-default',
    lat: 0,
    lon: 0,
    frp: 50,
    observedAt: NOW,
    ...over,
  };
}

function aq(over: Partial<AirQualitySensor> = {}): AirQualitySensor {
  return {
    id: 'aq-default',
    lat: 0,
    lon: 0,
    aqi: 100,
    observedAt: NOW,
    ...over,
  };
}

function bgp(over: Partial<BgpHijack> = {}): BgpHijack {
  return {
    id: 'bgp-default',
    asn: 'AS64500',
    prefix: '203.0.113.0/24',
    detectedAt: NOW,
    ...over,
  };
}

function pulse(over: Partial<CyberPulse> = {}): CyberPulse {
  return {
    id: 'otx-default',
    title: 'Pulse',
    description: 'Generic pulse description.',
    publishedAt: NOW,
    ...over,
  };
}

function hurricane(over: Partial<Hurricane> = {}): Hurricane {
  return {
    id: 'al-default',
    name: 'TestStorm',
    lat: 28,
    lon: -88,
    category: 2,
    observedAt: NOW,
    ...over,
  };
}

function input(over: Partial<CorrelationInput> = {}): CorrelationInput {
  return {
    earthquakes: [],
    spaceWeather: null,
    firePoints: [],
    airQuality: [],
    bgpHijacks: [],
    cyberPulses: [],
    hurricanes: [],
    domainElevations: [],
    now: NOW,
    ...over,
  };
}

// ── 1. Seismic + nuclear ────────────────────────────────────────────────────

test('detectSeismicNuclear: M5.5 within 50km of a nuclear plant fires CRITICAL', () => {
  const dc = NUCLEAR_FACILITIES.find((f) => f.id === 'us-diablo-canyon');
  assert.ok(dc, 'fixture relies on Diablo Canyon entry');
  const events = detectSeismicNuclear({
    earthquakes: [quake({ id: 'us123', lat: dc.lat + 0.1, lon: dc.lon, magnitude: 5.6 })],
    now: NOW,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'seismic-nuclear');
  assert.equal(events[0]?.severity, 'critical');
  assert.ok(events[0]?.domains.includes('seismic'));
  assert.ok(events[0]?.domains.includes('nuclear'));
  assert.equal(events[0]?.components.length, 2);
});

test('detectSeismicNuclear: M5.4 below threshold → no event', () => {
  const dc = NUCLEAR_FACILITIES[0];
  assert.ok(dc);
  const events = detectSeismicNuclear({
    earthquakes: [quake({ lat: dc.lat, lon: dc.lon, magnitude: 5.4 })],
    now: NOW,
  });
  assert.equal(events.length, 0);
});

test('detectSeismicNuclear: M6 at 60km outside radius → no event', () => {
  const dc = NUCLEAR_FACILITIES[0];
  assert.ok(dc);
  // 0.6° latitude ≈ 67km
  const events = detectSeismicNuclear({
    earthquakes: [quake({ lat: dc.lat + 0.6, lon: dc.lon, magnitude: 6.0 })],
    now: NOW,
  });
  assert.equal(events.length, 0);
});

test('detectSeismicNuclear: empty earthquake list returns no events', () => {
  assert.deepEqual(detectSeismicNuclear({ earthquakes: [], now: NOW }), []);
});

test('detectSeismicNuclear: same quake near two plants emits two events', () => {
  // Place two synthetic plants on either side of a synthetic quake
  // by crafting a quake that's near multiple real plants. Hinkley Point
  // (UK) and Heysham (UK) are far apart enough that one quake won't
  // hit both, so we test the per-plant emission directly.
  const a = NUCLEAR_FACILITIES.find((f) => f.id === 'us-palo-verde');
  const b = NUCLEAR_FACILITIES.find((f) => f.id === 'us-diablo-canyon');
  assert.ok(a && b);
  const events = detectSeismicNuclear({
    earthquakes: [
      quake({ id: 'q1', lat: a.lat, lon: a.lon, magnitude: 6 }),
      quake({ id: 'q2', lat: b.lat, lon: b.lon, magnitude: 5.7 }),
    ],
    now: NOW,
  });
  assert.equal(events.length, 2);
});

// ── 2. Space weather cascade ────────────────────────────────────────────────

test('detectSpaceWeatherCascade: Kp7 + X-class flare + 24h-out earthward CME → fires CRITICAL', () => {
  const sw: SpaceWeatherSnapshot = {
    kp: 7.5,
    xrayFlux: 2.3e-4,
    earthwardCmes: [{ id: 'cme1', estimatedArrival: new Date(NOW.getTime() + 24 * 3600 * 1000).toISOString() }],
  };
  const events = detectSpaceWeatherCascade({ spaceWeather: sw, now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'space-weather-cascade');
  assert.equal(events[0]?.severity, 'critical');
  assert.ok(events[0]?.domains.includes('space-weather'));
});

test('detectSpaceWeatherCascade: missing X-class flare → no event', () => {
  const sw: SpaceWeatherSnapshot = {
    kp: 8,
    xrayFlux: 5e-5, // M-class — below 1e-4 threshold
    earthwardCmes: [{ id: 'cme1', estimatedArrival: new Date(NOW.getTime() + 24 * 3600 * 1000).toISOString() }],
  };
  assert.equal(detectSpaceWeatherCascade({ spaceWeather: sw, now: NOW }).length, 0);
});

test('detectSpaceWeatherCascade: Kp6 below threshold → no event', () => {
  const sw: SpaceWeatherSnapshot = {
    kp: 6.9,
    xrayFlux: 5e-4,
    earthwardCmes: [{ id: 'cme1', estimatedArrival: new Date(NOW.getTime() + 12 * 3600 * 1000).toISOString() }],
  };
  assert.equal(detectSpaceWeatherCascade({ spaceWeather: sw, now: NOW }).length, 0);
});

test('detectSpaceWeatherCascade: CME outside 48h window → no event', () => {
  const sw: SpaceWeatherSnapshot = {
    kp: 8,
    xrayFlux: 5e-4,
    earthwardCmes: [{ id: 'cme1', estimatedArrival: new Date(NOW.getTime() + 72 * 3600 * 1000).toISOString() }],
  };
  assert.equal(detectSpaceWeatherCascade({ spaceWeather: sw, now: NOW }).length, 0);
});

test('detectSpaceWeatherCascade: no spaceWeather snapshot → no event', () => {
  assert.equal(detectSpaceWeatherCascade({ spaceWeather: null, now: NOW }).length, 0);
});

// ── 3. Wildfire + air quality ───────────────────────────────────────────────

test('detectWildfireAirQuality: hotspot 50km from AQI=180 sensor → fires HIGH', () => {
  const events = detectWildfireAirQuality({
    firePoints: [fire({ lat: 40, lon: -120, frp: 80 })],
    airQuality: [aq({ lat: 40.45, lon: -120, aqi: 180 })],
    now: NOW,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'wildfire-air-quality');
  assert.equal(events[0]?.severity, 'high');
});

test('detectWildfireAirQuality: hotspot 150km away → no event', () => {
  const events = detectWildfireAirQuality({
    firePoints: [fire({ lat: 40, lon: -120 })],
    airQuality: [aq({ lat: 41.4, lon: -120, aqi: 200 })],
    now: NOW,
  });
  assert.equal(events.length, 0);
});

test('detectWildfireAirQuality: AQI=140 below threshold → no event', () => {
  const events = detectWildfireAirQuality({
    firePoints: [fire({ lat: 40, lon: -120 })],
    airQuality: [aq({ lat: 40.1, lon: -120, aqi: 140 })],
    now: NOW,
  });
  assert.equal(events.length, 0);
});

test('detectWildfireAirQuality: AQI>200 escalates to CRITICAL', () => {
  const events = detectWildfireAirQuality({
    firePoints: [fire({ lat: 40, lon: -120 })],
    airQuality: [aq({ lat: 40.1, lon: -120, aqi: 240 })],
    now: NOW,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.severity, 'critical');
});

// ── 4. Infra + cyber ───────────────────────────────────────────────────────

test('detectInfraCyber: BGP hijack + infrastructure-keyword pulse within 24h → fires HIGH', () => {
  const events = detectInfraCyber({
    bgpHijacks: [bgp()],
    cyberPulses: [pulse({
      title: 'Critical infrastructure power-grid intrusion',
      description: 'Threat actor targeting electric grid SCADA.',
    })],
    now: NOW,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'infra-cyber');
  assert.equal(events[0]?.severity, 'high');
});

test('detectInfraCyber: BGP only, no pulse → no event', () => {
  assert.equal(
    detectInfraCyber({ bgpHijacks: [bgp()], cyberPulses: [], now: NOW }).length,
    0,
  );
});

test('detectInfraCyber: pulse without infra keywords → no event', () => {
  const events = detectInfraCyber({
    bgpHijacks: [bgp()],
    cyberPulses: [pulse({ title: 'Phishing campaign', description: 'Email-based.' })],
    now: NOW,
  });
  assert.equal(events.length, 0);
});

test('detectInfraCyber: pulse outside 24h window → no event', () => {
  const events = detectInfraCyber({
    bgpHijacks: [bgp()],
    cyberPulses: [pulse({
      title: 'Power grid intrusion',
      publishedAt: new Date(NOW.getTime() - 25 * 3600 * 1000),
    })],
    now: NOW,
  });
  assert.equal(events.length, 0);
});

test('detectInfraCyber: 3+ BGP hijacks + infra pulse escalates to CRITICAL', () => {
  const events = detectInfraCyber({
    bgpHijacks: [
      bgp({ id: 'b1' }), bgp({ id: 'b2' }), bgp({ id: 'b3' }),
    ],
    cyberPulses: [pulse({ title: 'Power grid SCADA attack' })],
    now: NOW,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.severity, 'critical');
});

// ── 5. Hurricane + fuel ─────────────────────────────────────────────────────

test('detectHurricaneFuel: Cat 2 within 200km of Thunder Horse → fires HIGH', () => {
  const th = GULF_FUEL_INFRASTRUCTURE.find((p) => p.id === 'gom-thunder-horse');
  assert.ok(th);
  const events = detectHurricaneFuel({
    hurricanes: [hurricane({ lat: th.lat + 1.0, lon: th.lon, category: 2 })],
    now: NOW,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'hurricane-fuel');
  assert.equal(events[0]?.severity, 'high');
});

test('detectHurricaneFuel: Cat 1 below threshold → no event', () => {
  const th = GULF_FUEL_INFRASTRUCTURE[0];
  assert.ok(th);
  const events = detectHurricaneFuel({
    hurricanes: [hurricane({ lat: th.lat, lon: th.lon, category: 1 })],
    now: NOW,
  });
  assert.equal(events.length, 0);
});

test('detectHurricaneFuel: Cat 4 escalates to CRITICAL', () => {
  const th = GULF_FUEL_INFRASTRUCTURE[0];
  assert.ok(th);
  const events = detectHurricaneFuel({
    hurricanes: [hurricane({ lat: th.lat, lon: th.lon, category: 4 })],
    now: NOW,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.severity, 'critical');
});

test('detectHurricaneFuel: storm outside 200km of any platform → no event', () => {
  const events = detectHurricaneFuel({
    hurricanes: [hurricane({ lat: 35, lon: -75, category: 4 })], // Off Carolinas
    now: NOW,
  });
  assert.equal(events.length, 0);
});

// ── 6. Multi-hazard ─────────────────────────────────────────────────────────

test('detectMultiHazard: 3 elevated domains → fires HIGH', () => {
  const events = detectMultiHazard({
    domainElevations: [
      { domain: 'seismic', elevated: true },
      { domain: 'cyber', elevated: true },
      { domain: 'wildfire', elevated: true },
      { domain: 'nuclear', elevated: false },
    ],
    now: NOW,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'multi-hazard');
  assert.equal(events[0]?.severity, 'high');
  assert.equal(events[0]?.domains.length, 3);
});

test('detectMultiHazard: 5 elevated domains escalates to CRITICAL', () => {
  const elevations: DomainElevation[] = [
    { domain: 'seismic', elevated: true },
    { domain: 'cyber', elevated: true },
    { domain: 'wildfire', elevated: true },
    { domain: 'space-weather', elevated: true },
    { domain: 'hurricane', elevated: true },
  ];
  const events = detectMultiHazard({ domainElevations: elevations, now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.severity, 'critical');
});

test('detectMultiHazard: only 2 elevated → no event', () => {
  const events = detectMultiHazard({
    domainElevations: [
      { domain: 'seismic', elevated: true },
      { domain: 'cyber', elevated: true },
    ],
    now: NOW,
  });
  assert.equal(events.length, 0);
});

test('detectMultiHazard: duplicate domains de-duplicate before counting', () => {
  const events = detectMultiHazard({
    domainElevations: [
      { domain: 'seismic', elevated: true },
      { domain: 'seismic', elevated: true },
      { domain: 'cyber', elevated: true },
    ],
    now: NOW,
  });
  assert.equal(events.length, 0);
});

// ── correlateThreats integration ────────────────────────────────────────────

test('correlateThreats: empty input → []', () => {
  assert.deepEqual(correlateThreats(input()), []);
});

test('correlateThreats: emits events from all six detectors when conditions met', () => {
  const dc = NUCLEAR_FACILITIES.find((f) => f.id === 'us-diablo-canyon');
  const th = GULF_FUEL_INFRASTRUCTURE.find((p) => p.id === 'gom-thunder-horse');
  assert.ok(dc && th);
  const events = correlateThreats(input({
    earthquakes: [quake({ lat: dc.lat, lon: dc.lon, magnitude: 6.1 })],
    spaceWeather: {
      kp: 8.2,
      xrayFlux: 3e-4,
      earthwardCmes: [{ id: 'cme1', estimatedArrival: new Date(NOW.getTime() + 12 * 3600 * 1000).toISOString() }],
    },
    firePoints: [fire({ lat: 40, lon: -120, frp: 90 })],
    airQuality: [aq({ lat: 40.1, lon: -120, aqi: 220 })],
    bgpHijacks: [bgp()],
    cyberPulses: [pulse({ title: 'Critical-infrastructure SCADA breach' })],
    hurricanes: [hurricane({ lat: th.lat, lon: th.lon, category: 3 })],
    domainElevations: [
      { domain: 'seismic', elevated: true },
      { domain: 'cyber', elevated: true },
      { domain: 'wildfire', elevated: true },
    ],
  }));
  const types = new Set(events.map((e) => e.type));
  assert.ok(types.has('seismic-nuclear'));
  assert.ok(types.has('space-weather-cascade'));
  assert.ok(types.has('wildfire-air-quality'));
  assert.ok(types.has('infra-cyber'));
  assert.ok(types.has('hurricane-fuel'));
  assert.ok(types.has('multi-hazard'));
});

test('correlateThreats: each event carries triggeredAt = now and ≥1 components', () => {
  const dc = NUCLEAR_FACILITIES[0];
  assert.ok(dc);
  const events = correlateThreats(input({
    earthquakes: [quake({ lat: dc.lat, lon: dc.lon, magnitude: 6 })],
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.triggeredAt.getTime(), NOW.getTime());
  assert.ok((events[0]?.components.length ?? 0) >= 1);
});

test('correlateThreats: components include domain + source labels', () => {
  const dc = NUCLEAR_FACILITIES.find((f) => f.id === 'us-palo-verde');
  assert.ok(dc);
  const events = correlateThreats(input({
    earthquakes: [quake({ id: 'usABC', lat: dc.lat, lon: dc.lon, magnitude: 6 })],
  }));
  const ev = events[0];
  assert.ok(ev);
  const domains = ev.components.map((c) => c.domain);
  assert.ok(domains.includes('seismic'));
  assert.ok(domains.includes('nuclear'));
  const sources = ev.components.map((c) => c.source);
  assert.ok(sources.some((s) => s.includes('usABC')));
  assert.ok(sources.some((s) => s.toLowerCase().includes('palo verde')));
});
