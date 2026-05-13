import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalize,
  computeContinent,
  computeCountryCode,
  type NormalizedObservation,
} from '../observation-normalizer.ts';
import type { ObservationEvent } from '@/types/intelligence';
import type { SavedPlace } from '@/services/saved-places';

const NOW = 1_745_000_000_000;

function makeObs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev-1',
    sourceId: 'test',
    domain: 'weather',
    timestamp: NOW - 60_000,
    severity: 'MEDIUM',
    title: 'Test',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makePlace(name: string, lat: number, lon: number): SavedPlace {
  return {
    id: `p-${name}`, name, lat, lon, radiusKm: 100, tags: [], priority: 1,
    notes: '', offlinePinned: false, primary: false, source: 'manual' as SavedPlace['source'],
    sortIndex: 0, createdAt: 0, updatedAt: 0,
  };
}

// ── continent classification ─────────────────────────────────────────────

test('computeContinent: La Porte (US Midwest) → North America', () => {
  assert.equal(computeContinent(41.6, -86.7), 'NA');
});

test('computeContinent: Tokyo → Asia', () => {
  assert.equal(computeContinent(35.68, 139.69), 'AS');
});

test('computeContinent: Paris → Europe', () => {
  assert.equal(computeContinent(48.85, 2.35), 'EU');
});

test('computeContinent: Sydney → Oceania', () => {
  assert.equal(computeContinent(-33.87, 151.21), 'OC');
});

test('computeContinent: São Paulo → South America', () => {
  assert.equal(computeContinent(-23.55, -46.63), 'SA');
});

test('computeContinent: Cape Town → Africa', () => {
  assert.equal(computeContinent(-33.92, 18.42), 'AF');
});

test('computeContinent: South Pole → Antarctica', () => {
  assert.equal(computeContinent(-85, 0), 'AN');
});

// ── country code (light heuristic) ─────────────────────────────────────

test('computeCountryCode: continental US bounds → US', () => {
  assert.equal(computeCountryCode(41.6, -86.7), 'US');
});

test('computeCountryCode: out-of-bounds returns undefined', () => {
  assert.equal(computeCountryCode(0, 0), undefined); // open ocean
});

// ── normalize() main path ──────────────────────────────────────────────

test('normalize: fills continent + countryCode when missing', () => {
  const obs = makeObs({ location: { lat: 41.6, lon: -86.7 } });
  const out = normalize(obs);
  assert.equal(out.continent, 'NA');
  assert.equal(out.countryCode, 'US');
});

test('normalize: preserves provided countryCode (no overwrite)', () => {
  const obs = makeObs({ location: { lat: 41.6, lon: -86.7 } });
  const out = normalize(obs, { countryCode: 'CA' });
  assert.equal(out.countryCode, 'CA');
});

test('normalize: continent and country undefined when no location', () => {
  const obs = makeObs({});
  const out = normalize(obs);
  assert.equal(out.continent, undefined);
  assert.equal(out.countryCode, undefined);
});

// ── proximity to saved places ──────────────────────────────────────────

test('normalize: proximityToSavedPlaces computes one distance per place', () => {
  const obs = makeObs({ location: { lat: 41.6, lon: -86.7 } });
  const out = normalize(obs, {
    savedPlaces: [
      makePlace('home', 41.6, -86.7),
      makePlace('work', 41.85, -87.65),
    ],
  });
  assert.equal(out.proximityToSavedPlaces?.length, 2);
  assert.equal(out.proximityToSavedPlaces?.[0]?.placeName, 'home');
  assert.ok((out.proximityToSavedPlaces?.[0]?.distanceKm ?? 9999) < 1);
  assert.ok((out.proximityToSavedPlaces?.[1]?.distanceKm ?? 0) > 50);
});

test('normalize: proximityToSavedPlaces sorted by distance ascending', () => {
  const obs = makeObs({ location: { lat: 41.6, lon: -86.7 } });
  const out = normalize(obs, {
    savedPlaces: [
      makePlace('chicago', 41.85, -87.65),
      makePlace('home', 41.6, -86.7),
    ],
  });
  assert.equal(out.proximityToSavedPlaces?.[0]?.placeName, 'home');
  assert.equal(out.proximityToSavedPlaces?.[1]?.placeName, 'chicago');
});

test('normalize: proximityToSavedPlaces omitted when no places supplied', () => {
  const obs = makeObs({ location: { lat: 0, lon: 0 } });
  const out = normalize(obs);
  assert.equal(out.proximityToSavedPlaces, undefined);
});

test('normalize: proximityToSavedPlaces empty array → undefined', () => {
  const obs = makeObs({ location: { lat: 0, lon: 0 } });
  const out = normalize(obs, { savedPlaces: [] });
  assert.equal(out.proximityToSavedPlaces, undefined);
});

// ── relevance score ────────────────────────────────────────────────────

test('normalize: relevanceScore is between 0 and 100', () => {
  const obs = makeObs({ severity: 'CRITICAL', location: { lat: 41.6, lon: -86.7 } });
  const out = normalize(obs, { savedPlaces: [makePlace('home', 41.6, -86.7)], nowMs: NOW });
  assert.ok(out.relevanceScore !== undefined);
  assert.ok((out.relevanceScore ?? 0) >= 0 && (out.relevanceScore ?? 0) <= 100);
});

test('normalize: CRITICAL severity + near home → higher relevance than INFO far away', () => {
  const close = normalize(makeObs({
    severity: 'CRITICAL', timestamp: NOW, location: { lat: 41.6, lon: -86.7 },
  }), { savedPlaces: [makePlace('home', 41.6, -86.7)], nowMs: NOW });
  const far = normalize(makeObs({
    severity: 'INFO', timestamp: NOW - 86_400_000, location: { lat: 25.8, lon: -80.2 },
  }), { savedPlaces: [makePlace('home', 41.6, -86.7)], nowMs: NOW });
  assert.ok((close.relevanceScore ?? 0) > (far.relevanceScore ?? 0));
});

// ── NormalizedObservation shape stability ──────────────────────────────

test('NormalizedObservation extends ObservationEvent without breaking the base shape', () => {
  const obs = makeObs();
  const out: NormalizedObservation = normalize(obs);
  // Every base field is preserved
  assert.equal(out.id, obs.id);
  assert.equal(out.title, obs.title);
  assert.equal(out.domain, obs.domain);
  assert.equal(out.severity, obs.severity);
});
