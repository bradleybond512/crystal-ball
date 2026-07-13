import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapEventsToPersonalImpact,
  haversineKm,
  type IncomingEvent,
  type PersonalProfile,
  type SavedPlace,
} from '../personal-impact.ts';

const NOW = 1_745_000_000_000;

const HOME: SavedPlace = {
  placeId: 'home',
  label: 'Home',
  latitude: 41.6082,
  longitude: -86.7228,
  ugcZoneId: 'INZ007',
  role: 'home',
};

const MOM: SavedPlace = {
  placeId: 'mom',
  label: "Mom's house",
  latitude: 41.65,
  longitude: -86.74,
  role: 'family',
};

const FAR_PLACE: SavedPlace = {
  placeId: 'far',
  label: 'Cabin',
  latitude: 47.0,
  longitude: -120.0,
  role: 'travel',
};

function profile(overrides: Partial<PersonalProfile> = {}): PersonalProfile {
  return {
    savedPlaces: overrides.savedPlaces ?? [HOME, MOM],
    watchedEntities: overrides.watchedEntities ?? [
      { entityId: 'taiwan', kind: 'country', label: 'Taiwan' },
    ],
    portfolio: overrides.portfolio ?? [
      { symbol: 'AAPL', weight: 0.15, sector: 'technology' },
    ],
    travelRoutes: overrides.travelRoutes ?? [],
    utilities: overrides.utilities ?? [
      { utilityId: 'home-power', kind: 'power', placeId: 'home' },
    ],
  };
}

function event(overrides: Partial<IncomingEvent> = {}): IncomingEvent {
  return {
    eventId: 'evt-1',
    description: 'Severe thunderstorm warning',
    domain: 'weather',
    severity: 80,
    at: NOW,
    location: { latitude: 41.61, longitude: -86.72 },
    ...overrides,
  };
}

// ── Geometry ────────────────────────────────────────────────────────────

test('haversineKm: same point → 0 km', () => {
  assert.equal(haversineKm(41.6, -86.7, 41.6, -86.7), 0);
});

test('haversineKm: ~111 km per degree of latitude near the equator', () => {
  const km = haversineKm(0, 0, 1, 0);
  assert.ok(km > 110 && km < 112, `expected ~111 km, got ${km}`);
});

// ── Spatial matching ───────────────────────────────────────────────────

test('weather event near Home matches Home + Mom (both within radius)', () => {
  const r = mapEventsToPersonalImpact(profile(), [event()], { now: () => NOW });
  const impact = r.impacts[0]!;
  assert.equal(impact.severity, 'critical');
  assert.equal(impact.exposures.length, 2);
  assert.ok(impact.exposures.some((e) => e.exposureId === 'home'));
  assert.ok(impact.exposures.some((e) => e.exposureId === 'mom'));
});

test('event far from any saved place matches no exposures', () => {
  const r = mapEventsToPersonalImpact(profile({ savedPlaces: [FAR_PLACE] }), [event()], {
    now: () => NOW,
  });
  const impact = r.impacts[0]!;
  assert.equal(impact.exposures.length, 0);
});

test('UGC zone fallback matches when lat/lng is far but zone overlaps', () => {
  const e = event({
    location: { latitude: 0, longitude: 0, ugcZoneId: 'INZ007' },
  });
  const r = mapEventsToPersonalImpact(profile(), [e], { now: () => NOW });
  const impact = r.impacts[0]!;
  assert.ok(impact.exposures.some((x) => x.exposureId === 'home'));
});

// ── Category decisions ────────────────────────────────────────────────

test('weather event hitting home/family → family_place category', () => {
  const r = mapEventsToPersonalImpact(profile(), [event()], { now: () => NOW });
  assert.equal(r.impacts[0]?.category, 'family_place');
});

test('cyber event with watched entity → immediate_risk', () => {
  const e = event({
    domain: 'cyber',
    description: 'Active CVE campaign',
    location: undefined,
    affectedEntities: ['taiwan'],
  });
  const r = mapEventsToPersonalImpact(profile(), [e], { now: () => NOW });
  assert.equal(r.impacts[0]?.category, 'immediate_risk');
  assert.equal(r.impacts[0]?.exposures[0]?.exposureId, 'watch:taiwan');
});

test('event with affected portfolio symbol → financial category', () => {
  const e = event({
    domain: 'market',
    description: 'AAPL down 8%',
    location: undefined,
    severity: 60,
    affectedSymbols: ['AAPL'],
  });
  const r = mapEventsToPersonalImpact(profile(), [e], { now: () => NOW });
  assert.equal(r.impacts[0]?.category, 'financial');
  assert.match(r.impacts[0]?.exposures[0]?.reason ?? '', /15.0%/);
});

test('event affecting a utility → utility category', () => {
  const e = event({
    domain: 'infrastructure',
    description: 'Regional power outage',
    location: undefined,
    severity: 70,
    affectedUtilities: ['power'],
  });
  const r = mapEventsToPersonalImpact(profile(), [e], { now: () => NOW });
  assert.equal(r.impacts[0]?.category, 'utility');
});

test('event during travel window → travel category', () => {
  const route = {
    routeId: 'r1',
    description: 'ORD → DEN',
    startsAt: NOW - 60_000,
    endsAt: NOW + 60_000,
  };
  const e = event({
    domain: 'travel',
    description: 'Storm at ORD',
    location: undefined,
    severity: 60,
  });
  const r = mapEventsToPersonalImpact(profile({ travelRoutes: [route] }), [e], { now: () => NOW });
  assert.equal(r.impacts[0]?.category, 'travel');
});

// ── Zero-exposure relevance (dormant contract) ────────────────────────

test('high-severity weather event with zero exposures → dormant, not immediate_risk', () => {
  const r = mapEventsToPersonalImpact(profile({ savedPlaces: [FAR_PLACE] }), [event({ severity: 90 })], {
    now: () => NOW,
  });
  const impact = r.impacts[0]!;
  assert.equal(impact.exposures.length, 0);
  assert.equal(impact.category, 'dormant');
});

test('high-severity event with zero exposures → severity capped at low', () => {
  const r = mapEventsToPersonalImpact(profile({ savedPlaces: [FAR_PLACE] }), [event({ severity: 90 })], {
    now: () => NOW,
  });
  assert.equal(r.impacts[0]?.severity, 'low');
});

test('non-weather event with zero exposures → dormant category', () => {
  const e = event({
    domain: 'cyber',
    description: 'Ransomware wave in unrelated sector',
    location: undefined,
    severity: 85,
    affectedEntities: ['nobody-i-watch'],
  });
  const r = mapEventsToPersonalImpact(profile(), [e], { now: () => NOW });
  assert.equal(r.impacts[0]?.category, 'dormant');
  assert.equal(r.impacts[0]?.severity, 'low');
});

test('zero-exposure events are tallied as dormant and produce no recommendations', () => {
  const events = [
    event({ eventId: 'a', severity: 90 }),
    event({ eventId: 'b', severity: 80 }),
  ];
  const r = mapEventsToPersonalImpact(profile({ savedPlaces: [FAR_PLACE] }), events, {
    now: () => NOW,
  });
  assert.match(r.summary, /2 dormant/);
  assert.ok(!r.summary.includes('critical'));
  assert.equal(r.recommendations.length, 0);
});

test('event with real exposure keeps its non-dormant category and full severity', () => {
  const r = mapEventsToPersonalImpact(profile(), [event({ severity: 90 })], { now: () => NOW });
  assert.equal(r.impacts[0]?.category, 'family_place');
  assert.equal(r.impacts[0]?.severity, 'critical');
});

test('zero-exposure event below the floor → dormant category AND none severity', () => {
  const r = mapEventsToPersonalImpact(profile({ savedPlaces: [FAR_PLACE] }), [event({ severity: 10 })], {
    now: () => NOW,
  });
  assert.equal(r.impacts[0]?.category, 'dormant');
  assert.equal(r.impacts[0]?.severity, 'none');
});

test('category follows the matched exposure, not raw event fields: route match + unmatched symbols → travel', () => {
  const route = { routeId: 'r1', description: 'ORD → DEN', startsAt: NOW - 60_000, endsAt: NOW + 60_000 };
  const e = event({
    domain: 'market',
    description: 'TSLA halted',
    location: undefined,
    severity: 60,
    affectedSymbols: ['TSLA'],
  });
  const r = mapEventsToPersonalImpact(profile({ travelRoutes: [route] }), [e], { now: () => NOW });
  assert.equal(r.impacts[0]?.exposures.length, 1);
  assert.equal(r.impacts[0]?.category, 'travel');
});

test('category follows the matched exposure, not raw event fields: entity match + unmatched utilities → not utility', () => {
  const e = event({
    domain: 'cyber',
    description: 'Grid-sector CVE campaign',
    location: undefined,
    severity: 60,
    affectedEntities: ['taiwan'],
    affectedUtilities: ['water'],
  });
  const r = mapEventsToPersonalImpact(profile({ utilities: [] }), [e], { now: () => NOW });
  assert.equal(r.impacts[0]?.exposures.length, 1);
  assert.equal(r.impacts[0]?.category, 'immediate_risk');
});

// ── Severity ladder ────────────────────────────────────────────────────

test('severity 80 → critical', () => {
  const r = mapEventsToPersonalImpact(profile(), [event({ severity: 80 })], { now: () => NOW });
  assert.equal(r.impacts[0]?.severity, 'critical');
});

test('severity 60 with exposures → elevated', () => {
  const r = mapEventsToPersonalImpact(profile(), [event({ severity: 60 })], { now: () => NOW });
  assert.equal(r.impacts[0]?.severity, 'elevated');
});

test('severity 30 with exposures → watch', () => {
  const r = mapEventsToPersonalImpact(profile(), [event({ severity: 30 })], { now: () => NOW });
  assert.equal(r.impacts[0]?.severity, 'watch');
});

test('severity exactly at the dormant floor with exposures → watch (floor is exclusive)', () => {
  const r = mapEventsToPersonalImpact(profile(), [event({ severity: 25 })], { now: () => NOW });
  assert.equal(r.impacts[0]?.severity, 'watch');
});

test('custom dormantSeverityFloor is honored for zero-exposure demotion', () => {
  const r = mapEventsToPersonalImpact(profile({ savedPlaces: [FAR_PLACE] }), [event({ severity: 30 })], {
    now: () => NOW,
    dormantSeverityFloor: 40,
  });
  assert.equal(r.impacts[0]?.severity, 'none');
});

test('severity 10 with no exposures → none (suppressed)', () => {
  const e = event({
    severity: 10,
    location: { latitude: 0, longitude: 0 },
  });
  const r = mapEventsToPersonalImpact(profile({ savedPlaces: [FAR_PLACE] }), [e], {
    now: () => NOW,
  });
  assert.equal(r.impacts[0]?.severity, 'none');
});

test('severity 10 with personal exposure → low (dormant)', () => {
  const r = mapEventsToPersonalImpact(profile(), [event({ severity: 10 })], { now: () => NOW });
  assert.equal(r.impacts[0]?.severity, 'low');
});

// ── Sort + summary ─────────────────────────────────────────────────────

test('impacts sorted by severity desc', () => {
  const events = [
    event({ eventId: 'a', severity: 30 }),
    event({ eventId: 'b', severity: 80 }),
    event({ eventId: 'c', severity: 60 }),
  ];
  const r = mapEventsToPersonalImpact(profile(), events, { now: () => NOW });
  assert.deepEqual(r.impacts.map((i) => i.eventId), ['b', 'c', 'a']);
});

test('summary tallies and recommendations follow severity', () => {
  const events = [
    event({ eventId: 'a', severity: 80 }),
    event({ eventId: 'b', severity: 60 }),
    event({ eventId: 'c', severity: 10 }),
  ];
  const r = mapEventsToPersonalImpact(profile(), events, { now: () => NOW });
  assert.match(r.summary, /1 critical/);
  assert.match(r.summary, /1 elevated/);
  assert.match(r.summary, /dormant/);
  assert.ok(r.recommendations.length >= 1);
});

test('summary dormant tally counts surfacing tier (low/none severity), not the dormant category', () => {
  // A sub-floor event WITH a real exposure keeps its category but is
  // tallied dormant — "dormant" in the summary means "not surfaced".
  const events = [
    event({ eventId: 'exposed-subfloor', severity: 10 }),
    event({ eventId: 'no-exposure', severity: 80, location: { latitude: 0, longitude: 0 } }),
  ];
  const r = mapEventsToPersonalImpact(profile(), events, { now: () => NOW });
  const exposed = r.impacts.find((i) => i.eventId === 'exposed-subfloor')!;
  assert.equal(exposed.category, 'family_place');
  assert.equal(exposed.severity, 'low');
  assert.match(r.summary, /2 dormant/);
});

test('recommendations capped at 6', () => {
  const events = Array.from({ length: 12 }, (_, i) => event({ eventId: `e-${i}`, severity: 80 }));
  const r = mapEventsToPersonalImpact(profile(), events, { now: () => NOW });
  assert.ok(r.recommendations.length <= 6);
});

// ── JSON round-trip ────────────────────────────────────────────────────

test('output is JSON-serializable', () => {
  const r = mapEventsToPersonalImpact(profile(), [event()], { now: () => NOW });
  const parsed = JSON.parse(JSON.stringify(r)) as { impacts: unknown[] };
  assert.ok(Array.isArray(parsed.impacts));
});
