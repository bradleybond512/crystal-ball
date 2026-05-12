import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scorePersonalRelevance,
  loadProfile,
  saveProfile,
  emptyProfile,
  type PersonalProfile,
  type PersonalRelevanceScore,
} from '../personal-relevance.ts';
import type { ObservationEvent } from '@/types/intelligence';
import type { SavedPlace } from '@/services/saved-places';

// ── Helpers ────────────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev-1',
    sourceId: 'test',
    domain: 'weather',
    timestamp: NOW - 60_000,
    severity: 'MEDIUM',
    title: 'Test event',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makePlace(name: string, lat: number, lon: number): SavedPlace {
  return {
    id: `p-${name}`,
    name,
    lat,
    lon,
    radiusKm: 100,
    tags: [],
    priority: 1,
    notes: '',
    offlinePinned: false,
    primary: false,
    source: 'manual' as SavedPlace['source'],
    sortIndex: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeProfile(overrides: Partial<PersonalProfile> = {}): PersonalProfile {
  return {
    savedPlaces: [],
    watchlist: [],
    interests: [],
    travelDates: [],
    ...overrides,
  };
}

// ── Empty profile ──────────────────────────────────────────────────────────

test('empty profile returns total=0 and empty matches', () => {
  const result = scorePersonalRelevance(makeEvent(), emptyProfile(), NOW);
  assert.equal(result.total, 0);
  assert.equal(result.components.proximity, 0);
  assert.equal(result.components.watchlist, 0);
  assert.equal(result.components.interests, 0);
  assert.equal(result.components.travel, 0);
  assert.deepEqual(result.matchedPlaces, []);
  assert.deepEqual(result.matchedWatchlist, []);
  assert.equal(result.inTravelWindow, false);
});

// ── Proximity component (reuses prioritizer thresholds) ────────────────────

test('event within 100km of saved place gets +40 proximity', () => {
  const event = makeEvent({ location: { lat: 41.6, lon: -86.7 } }); // La Porte IN
  const profile = makeProfile({ savedPlaces: [makePlace('home', 41.6, -86.7)] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.proximity, 40);
  assert.deepEqual(result.matchedPlaces, ['home']);
});

test('event within 500km of saved place gets +25 proximity', () => {
  const event = makeEvent({ location: { lat: 41.85, lon: -87.65 } }); // Chicago
  const profile = makeProfile({ savedPlaces: [makePlace('madison', 43.05, -89.4)] }); // ~200km
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.proximity, 25);
  assert.deepEqual(result.matchedPlaces, ['madison']);
});

test('event >500km from all saved places gets 0 proximity and no match', () => {
  const event = makeEvent({ location: { lat: 25.8, lon: -80.2 } }); // Miami
  const profile = makeProfile({ savedPlaces: [makePlace('home', 41.6, -86.7)] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.proximity, 0);
  assert.deepEqual(result.matchedPlaces, []);
});

test('event without location yields 0 proximity', () => {
  const event = makeEvent({}); // no location
  const profile = makeProfile({ savedPlaces: [makePlace('home', 41.6, -86.7)] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.proximity, 0);
});

test('multiple saved places: only the nearest matching place is reported', () => {
  const event = makeEvent({ location: { lat: 41.6, lon: -86.7 } });
  const profile = makeProfile({
    savedPlaces: [
      makePlace('home', 41.6, -86.7), // 0 km
      makePlace('family', 43.05, -89.4), // ~300km
    ],
  });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.proximity, 40);
  assert.deepEqual(result.matchedPlaces, ['home']);
});

// ── Watchlist component ────────────────────────────────────────────────────

test('watchlist keyword in event title contributes +20', () => {
  const event = makeEvent({ title: 'AAPL down 5% on earnings' });
  const profile = makeProfile({ watchlist: ['AAPL'] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.watchlist, 20);
  assert.deepEqual(result.matchedWatchlist, ['AAPL']);
});

test('watchlist match is case-insensitive', () => {
  const event = makeEvent({ title: 'aapl trades sideways' });
  const profile = makeProfile({ watchlist: ['AAPL'] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.watchlist, 20);
});

test('watchlist match against entityIds also counts', () => {
  const event = makeEvent({ title: 'Vessel incident', entityIds: ['IMO9123456'] });
  const profile = makeProfile({ watchlist: ['IMO9123456'] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.watchlist, 20);
  assert.deepEqual(result.matchedWatchlist, ['IMO9123456']);
});

test('multiple watchlist matches stack (+20 each)', () => {
  const event = makeEvent({ title: 'AAPL and MSFT both rally', entityIds: ['NYSE'] });
  const profile = makeProfile({ watchlist: ['AAPL', 'MSFT', 'NYSE'] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.watchlist, 60);
  assert.equal(result.matchedWatchlist.length, 3);
});

test('same watchlist term matched in both title and entity counts once', () => {
  const event = makeEvent({ title: 'AAPL news', entityIds: ['AAPL'] });
  const profile = makeProfile({ watchlist: ['AAPL'] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.watchlist, 20);
  assert.deepEqual(result.matchedWatchlist, ['AAPL']);
});

test('empty watchlist contributes 0', () => {
  const event = makeEvent({ title: 'AAPL down' });
  const result = scorePersonalRelevance(event, makeProfile({ watchlist: [] }), NOW);
  assert.equal(result.components.watchlist, 0);
});

test('whitespace-only watchlist entries are ignored', () => {
  const event = makeEvent({ title: 'AAPL up' });
  const result = scorePersonalRelevance(event, makeProfile({ watchlist: ['  ', ''] }), NOW);
  assert.equal(result.components.watchlist, 0);
});

// ── Interest component ────────────────────────────────────────────────────

test('event domain in interests contributes +15', () => {
  const event = makeEvent({ domain: 'weather' });
  const profile = makeProfile({ interests: ['weather'] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.interests, 15);
});

test('event domain NOT in interests contributes 0', () => {
  const event = makeEvent({ domain: 'cyber' });
  const profile = makeProfile({ interests: ['weather', 'maritime'] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.interests, 0);
});

test('multiple interests do not double-count a single event domain', () => {
  const event = makeEvent({ domain: 'weather' });
  const profile = makeProfile({ interests: ['weather', 'maritime', 'cyber'] });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.interests, 15);
});

// ── Travel-window component ──────────────────────────────────────────────

test('event near travel destination AND within date window gets +30', () => {
  const event = makeEvent({
    timestamp: NOW,
    location: { lat: 35.68, lon: 139.69 }, // Tokyo
  });
  const profile = makeProfile({
    travelDates: [{
      location: 'Tokyo',
      lat: 35.68,
      lon: 139.69,
      start: NOW - 24 * 3_600_000,
      end: NOW + 5 * 24 * 3_600_000,
    }],
  });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.travel, 30);
  assert.equal(result.inTravelWindow, true);
});

test('travel window with no location match gives 0 travel score', () => {
  const event = makeEvent({
    timestamp: NOW,
    location: { lat: 41.6, lon: -86.7 }, // La Porte
  });
  const profile = makeProfile({
    travelDates: [{
      location: 'Tokyo',
      lat: 35.68,
      lon: 139.69,
      start: NOW - 86_400_000,
      end: NOW + 86_400_000,
    }],
  });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.travel, 0);
});

test('travel destination match outside date window gives 0', () => {
  const event = makeEvent({
    timestamp: NOW,
    location: { lat: 35.68, lon: 139.69 }, // Tokyo
  });
  const profile = makeProfile({
    travelDates: [{
      location: 'Tokyo',
      lat: 35.68,
      lon: 139.69,
      start: NOW + 30 * 86_400_000, // future trip
      end: NOW + 35 * 86_400_000,
    }],
  });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.travel, 0);
  assert.equal(result.inTravelWindow, false);
});

test('event within 200km of travel destination still counts as travel match', () => {
  // Yokohama (~30km from Tokyo) within the 200km radius
  const event = makeEvent({
    timestamp: NOW,
    location: { lat: 35.44, lon: 139.64 },
  });
  const profile = makeProfile({
    travelDates: [{
      location: 'Tokyo',
      lat: 35.68,
      lon: 139.69,
      start: NOW - 86_400_000,
      end: NOW + 86_400_000,
    }],
  });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.travel, 30);
});

test('event >200km from travel destination gives 0 travel score', () => {
  // Osaka ~400km from Tokyo
  const event = makeEvent({
    timestamp: NOW,
    location: { lat: 34.69, lon: 135.5 },
  });
  const profile = makeProfile({
    travelDates: [{
      location: 'Tokyo',
      lat: 35.68,
      lon: 139.69,
      start: NOW - 86_400_000,
      end: NOW + 86_400_000,
    }],
  });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.travel, 0);
});

test('multiple travel entries — first matching one wins, inTravelWindow is true', () => {
  const event = makeEvent({
    timestamp: NOW,
    location: { lat: 35.68, lon: 139.69 }, // Tokyo
  });
  const profile = makeProfile({
    travelDates: [
      {
        location: 'Paris',
        lat: 48.85,
        lon: 2.35,
        start: NOW + 100 * 86_400_000,
        end: NOW + 105 * 86_400_000,
      },
      {
        location: 'Tokyo',
        lat: 35.68,
        lon: 139.69,
        start: NOW - 86_400_000,
        end: NOW + 86_400_000,
      },
    ],
  });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.travel, 30);
  assert.equal(result.inTravelWindow, true);
});

test('event without location gives 0 travel score even within date window', () => {
  const event = makeEvent({ timestamp: NOW }); // no location
  const profile = makeProfile({
    travelDates: [{
      location: 'Tokyo',
      lat: 35.68,
      lon: 139.69,
      start: NOW - 86_400_000,
      end: NOW + 86_400_000,
    }],
  });
  const result = scorePersonalRelevance(event, profile, NOW);
  assert.equal(result.components.travel, 0);
});

// ── Composition / total ────────────────────────────────────────────────────

test('total is the sum of all four components', () => {
  const event = makeEvent({
    timestamp: NOW,
    domain: 'weather',
    title: 'Heavy AAPL distribution',
    location: { lat: 35.68, lon: 139.69 },
  });
  const profile = makeProfile({
    savedPlaces: [makePlace('tokyo-airbnb', 35.68, 139.69)],
    watchlist: ['AAPL'],
    interests: ['weather'],
    travelDates: [{
      location: 'Tokyo',
      lat: 35.68,
      lon: 139.69,
      start: NOW - 86_400_000,
      end: NOW + 86_400_000,
    }],
  });
  const result = scorePersonalRelevance(event, profile, NOW);
  // proximity=40 + watchlist=20 + interests=15 + travel=30
  assert.equal(result.components.proximity, 40);
  assert.equal(result.components.watchlist, 20);
  assert.equal(result.components.interests, 15);
  assert.equal(result.components.travel, 30);
  assert.equal(result.total, 105);
});

// ── Persistence ────────────────────────────────────────────────────────────

test('loadProfile returns empty profile when localStorage is missing', () => {
  const fakeStorage: Record<string, string> = {};
  const profile = loadProfile({
    getItem: (k) => fakeStorage[k] ?? null,
    setItem: (k, v) => { fakeStorage[k] = v; },
  });
  assert.deepEqual(profile, emptyProfile());
});

test('saveProfile + loadProfile roundtrips the profile', () => {
  const fakeStorage: Record<string, string> = {};
  const storage = {
    getItem: (k: string) => fakeStorage[k] ?? null,
    setItem: (k: string, v: string) => { fakeStorage[k] = v; },
  };
  const original: PersonalProfile = {
    savedPlaces: [makePlace('home', 41.6, -86.7)],
    watchlist: ['AAPL', 'BTC'],
    interests: ['weather', 'markets'],
    travelDates: [{
      location: 'Tokyo',
      lat: 35.68,
      lon: 139.69,
      start: 1,
      end: 2,
    }],
  };
  saveProfile(original, storage);
  const loaded = loadProfile(storage);
  assert.deepEqual(loaded, original);
});

test('loadProfile tolerates corrupted JSON and falls back to empty', () => {
  const fakeStorage: Record<string, string> = { 'wm-personal-profile': '{not json' };
  const profile = loadProfile({
    getItem: (k) => fakeStorage[k] ?? null,
    setItem: (k, v) => { fakeStorage[k] = v; },
  });
  assert.deepEqual(profile, emptyProfile());
});

test('loadProfile fills missing fields with safe defaults', () => {
  const fakeStorage: Record<string, string> = {
    'wm-personal-profile': JSON.stringify({ watchlist: ['AAPL'] }),
  };
  const profile = loadProfile({
    getItem: (k) => fakeStorage[k] ?? null,
    setItem: (k, v) => { fakeStorage[k] = v; },
  });
  assert.deepEqual(profile.watchlist, ['AAPL']);
  assert.deepEqual(profile.savedPlaces, []);
  assert.deepEqual(profile.interests, []);
  assert.deepEqual(profile.travelDates, []);
});

// ── Return value shape ────────────────────────────────────────────────────

test('PersonalRelevanceScore shape is stable', () => {
  const result: PersonalRelevanceScore = scorePersonalRelevance(makeEvent(), emptyProfile(), NOW);
  assert.ok('total' in result);
  assert.ok('components' in result);
  assert.ok('matchedPlaces' in result);
  assert.ok('matchedWatchlist' in result);
  assert.ok('inTravelWindow' in result);
});
