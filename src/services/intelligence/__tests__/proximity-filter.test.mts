import assert from 'node:assert/strict';
import test from 'node:test';

import { filterByProximity } from '../proximity-filter.ts';
import type { ObservationEvent } from '@/types/intelligence';
import type { SavedPlace } from '@/services/saved-places';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEvent(id: string, lat?: number, lon?: number): ObservationEvent {
  return {
    id,
    sourceId: 'test',
    domain: 'seismic',
    timestamp: Date.now(),
    location: lat != null && lon != null ? { lat, lon } : undefined,
    severity: 'MEDIUM',
    title: id,
    raw: null,
    entityIds: [],
    tags: [],
  };
}

function makePlace(lat: number, lon: number): SavedPlace {
  return {
    id: 'p1',
    name: 'Home',
    lat,
    lon,
    radiusKm: 100,
    tags: [],
    priority: 1,
    notes: '',
    offlinePinned: false,
    primary: true,
    source: 'manual' as SavedPlace['source'],
    sortIndex: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('returns all events when no saved places provided', () => {
  const events = [makeEvent('e1', 41.6, -86.7), makeEvent('e2', 25.8, -80.2)];
  assert.deepEqual(filterByProximity(events, []), events);
});

test('filters out events outside the radius', () => {
  const nearby = makeEvent('near', 41.6, -86.7);   // Chicago area
  const far = makeEvent('far', 25.8, -80.2);         // Miami — ~2100km
  const place = makePlace(41.6, -86.7);
  const result = filterByProximity([nearby, far], [place], 500);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'near');
});

test('includes events within the radius', () => {
  // Milwaukee ≈ 43.04, -87.91 — ~150km from Chicago
  const event = makeEvent('milw', 43.04, -87.91);
  const place = makePlace(41.85, -87.65); // Chicago
  const result = filterByProximity([event], [place], 200);
  assert.equal(result.length, 1);
});

test('excludes events beyond the radius', () => {
  const event = makeEvent('miami', 25.8, -80.2);
  const place = makePlace(41.85, -87.65);
  const result = filterByProximity([event], [place], 200);
  assert.equal(result.length, 0);
});

test('default radius is 500 km', () => {
  // Somewhere ~400km from Chicago should be included
  const event = makeEvent('near', 44.98, -93.27); // Minneapolis ~560km
  const place = makePlace(41.85, -87.65);
  // 560km > 500km default, should be excluded
  const result = filterByProximity([event], [place]);
  assert.equal(result.length, 0);
});

test('events without location are excluded when savedPlaces present', () => {
  const event = makeEvent('no-loc'); // no location
  const place = makePlace(41.6, -86.7);
  const result = filterByProximity([event], [place], 500);
  assert.equal(result.length, 0);
});

test('matches against nearest saved place (any one in radius is enough)', () => {
  const event = makeEvent('ev', 41.6, -86.7); // La Porte IN
  const farPlace = makePlace(25.8, -80.2);    // Miami — far
  const nearPlace = makePlace(41.6, -86.7);    // exact match
  const result = filterByProximity([event], [farPlace, nearPlace], 500);
  assert.equal(result.length, 1);
});

test('empty events array returns empty array', () => {
  const place = makePlace(41.6, -86.7);
  assert.deepEqual(filterByProximity([], [place]), []);
});
