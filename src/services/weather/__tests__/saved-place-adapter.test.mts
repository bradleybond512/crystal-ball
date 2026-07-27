import assert from 'node:assert/strict';
import test from 'node:test';

import { toMatcherPlace, resolveSavedPlaceZones } from '../saved-place-adapter.ts';
import type { SavedPlace as StoredPlace } from '../../saved-places.ts';

function stored(overrides: Partial<StoredPlace> = {}): StoredPlace {
  return { id: 'home', name: 'La Porte, IN', lat: 41.61, lon: -86.72, radiusKm: 50, ...overrides };
}

// ── toMatcherPlace ───────────────────────────────────────────────────────
// The two data-loader call sites that feed the polygon matcher (the
// notification/exposure path and the Personal Storm Mode routing path)
// historically hand-rolled this mapping and drifted: one dropped radiusKm,
// the other dropped BOTH radiusKm and ugcZones. Dropping radiusKm collapses
// the user's configured coverage to the 10 km hazard default; dropping
// ugcZones makes geometry-free (zone-only) alerts unmatchable. A single
// shared adapter keeps both sites honest.

test('toMatcherPlace maps name→label and carries lat/lon', () => {
  const m = toMatcherPlace(stored());
  assert.equal(m.id, 'home');
  assert.equal(m.label, 'La Porte, IN');
  assert.equal(m.lat, 41.61);
  assert.equal(m.lon, -86.72);
});

test('toMatcherPlace carries the configured radiusKm (near-polygon buffer)', () => {
  assert.equal(toMatcherPlace(stored({ radiusKm: 75 })).radiusKm, 75);
});

test('toMatcherPlace attaches resolved UGC zones when provided', () => {
  const m = toMatcherPlace(stored(), ['INZ001', 'INC091']);
  assert.deepEqual(m.ugcZones, ['INZ001', 'INC091']);
});

test('toMatcherPlace omits ugcZones when none resolved', () => {
  assert.equal(toMatcherPlace(stored()).ugcZones, undefined);
});

// ── resolveSavedPlaceZones ───────────────────────────────────────────────

test('resolveSavedPlaceZones returns a map of place id → resolved zones', async () => {
  const places = [stored({ id: 'a', lat: 10, lon: 10 }), stored({ id: 'b', lat: 20, lon: 20 })];
  const map = await resolveSavedPlaceZones(places, async (lat) => [`Z${lat}`]);
  assert.deepEqual(map.get('a'), ['Z10']);
  assert.deepEqual(map.get('b'), ['Z20']);
});

test('resolveSavedPlaceZones caches by coordinate (no re-fetch on repeat)', async () => {
  let calls = 0;
  const fetchZones = async (): Promise<string[]> => { calls += 1; return ['INZ777']; };
  const place = [stored({ id: 'c', lat: 33.3, lon: 44.4 })];
  await resolveSavedPlaceZones(place, fetchZones);
  await resolveSavedPlaceZones(place, fetchZones);
  assert.equal(calls, 1, 'second resolve for the same coordinate must hit the cache');
});

test('resolveSavedPlaceZones omits places with no resolved zones', async () => {
  const places = [stored({ id: 'd', lat: 55.5, lon: 66.6 })];
  const map = await resolveSavedPlaceZones(places, async () => []);
  assert.equal(map.has('d'), false);
});

test('a transient empty/failed resolve is NOT cached — a later tick re-resolves', async () => {
  // A single transient NWS /points failure (or an empty response) must not
  // permanently disable zone-only matching for a place. If the first resolve
  // yields no zones, the next weather tick must try again rather than serving
  // an empty result from a poisoned negative cache. (Empty arrays are truthy
  // in JS, so a naive `zoneCache.get(key)` guard treats a cached [] as a hit.)
  let call = 0;
  const fetchZones = async (): Promise<string[]> => {
    call += 1;
    return call === 1 ? [] : ['INZ042'];
  };
  const place = [stored({ id: 'flaky', lat: 47.1, lon: -122.2 })];

  const first = await resolveSavedPlaceZones(place, fetchZones);
  assert.equal(first.has('flaky'), false, 'first (empty) tick resolves nothing');

  const second = await resolveSavedPlaceZones(place, fetchZones);
  assert.deepEqual(
    second.get('flaky'),
    ['INZ042'],
    'second tick must re-resolve, not serve a poisoned empty cache',
  );
});

test('resolveSavedPlaceZones is best-effort: a throwing fetch does not break the batch', async () => {
  const places = [
    stored({ id: 'boom', lat: 1.1, lon: 1.1 }),
    stored({ id: 'ok', lat: 2.2, lon: 2.2 }),
  ];
  const fetchZones = async (lat: number): Promise<string[]> => {
    if (lat === 1.1) throw new Error('network down');
    return ['INZ002'];
  };
  const map = await resolveSavedPlaceZones(places, fetchZones);
  assert.equal(map.has('boom'), false);
  assert.deepEqual(map.get('ok'), ['INZ002']);
});
