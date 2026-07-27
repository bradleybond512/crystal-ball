import assert from 'node:assert/strict';
import test from 'node:test';

import {
  toMatcherPlace,
  resolveSavedPlaceZones,
  resolveSavedPlaceZonesWithHealth,
} from '../saved-place-adapter.ts';
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

// ── resolveSavedPlaceZonesWithHealth: honest zone-currency signal (P0 #3) ──
// The clear decision must never assert "no threat" on top of a DEGRADED zone
// resolution. If a saved place's /points lookup THREW, we don't know that
// place's UGC zones — so a geometry-free (zone-only) severe alert could match
// and we'd never see it. That is degradation: the batch must report it so the
// caller withholds the confirmed-clear. Crucially, an HONEST empty resolve (a
// genuinely zone-less coordinate that returned []) is NOT degradation — it is a
// truthful "this place has no zones", and must not block a clear. Conflating
// "threw" with "returned empty" would either strand CHECKING forever (if empty
// counted as degraded) or clear over an unknown zone (if a throw were ignored).

test('resolveSavedPlaceZonesWithHealth reports degraded:false when every resolve succeeds', async () => {
  const places = [
    stored({ id: 'h1', lat: 61.1, lon: 61.1 }),
    stored({ id: 'h2', lat: 62.2, lon: 62.2 }),
  ];
  const { zonesByPlace, degraded } = await resolveSavedPlaceZonesWithHealth(
    places,
    async (lat) => [`Z${lat}`],
  );
  assert.equal(degraded, false);
  assert.deepEqual(zonesByPlace.get('h1'), ['Z61.1']);
  assert.deepEqual(zonesByPlace.get('h2'), ['Z62.2']);
});

test('resolveSavedPlaceZonesWithHealth: an HONEST empty resolve is NOT degraded', async () => {
  // A genuinely zone-less point returns [] without throwing. That is truthful,
  // not a failure — it must never withhold a clear. degraded stays false.
  const places = [stored({ id: 'empty', lat: 63.3, lon: 63.3 })];
  const { zonesByPlace, degraded } = await resolveSavedPlaceZonesWithHealth(
    places,
    async () => [],
  );
  assert.equal(degraded, false, 'an honest empty resolve is not degradation');
  assert.equal(zonesByPlace.has('empty'), false);
});

test('resolveSavedPlaceZonesWithHealth reports degraded:true when any resolve throws', async () => {
  // A throwing /points lookup means we do NOT know this place's zones. A
  // zone-only severe alert could match and go unseen, so the caller must
  // withhold the confirmed-clear. The other place still resolves normally.
  const places = [
    stored({ id: 'threw', lat: 64.4, lon: 64.4 }),
    stored({ id: 'fine', lat: 65.5, lon: 65.5 }),
  ];
  const { zonesByPlace, degraded } = await resolveSavedPlaceZonesWithHealth(
    places,
    async (lat) => {
      if (lat === 64.4) throw new Error('points lookup down');
      return ['INZ065'];
    },
  );
  assert.equal(degraded, true, 'a thrown zone resolve degrades the batch');
  assert.equal(zonesByPlace.has('threw'), false);
  assert.deepEqual(zonesByPlace.get('fine'), ['INZ065']);
});

test('concurrent same-coordinate resolves share ONE in-flight fetch (no duplicate /points)', async () => {
  // The initial full-app wave runs the `weather` and `nwsAlerts` tasks
  // concurrently and both resolve the SAME saved places. `zoneCache` only holds
  // COMPLETED results, so without in-flight dedup both callers see a miss and
  // fire duplicate /points requests. Worse, under throttling an asymmetric
  // failure could hand the weather-status leg `[]` and clear a geometry-free
  // warning the other leg matched. Coalesce concurrent resolves per coordinate.
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const fetchZones = async (): Promise<string[]> => {
    calls += 1;
    await gate; // hold both callers in-flight at once
    return ['INZ900'];
  };
  const place = [stored({ id: 'dup', lat: 12.5, lon: -98.3 })];

  const a = resolveSavedPlaceZones(place, fetchZones);
  const b = resolveSavedPlaceZones(place, fetchZones);
  release();
  const [ra, rb] = await Promise.all([a, b]);

  assert.equal(calls, 1, 'concurrent same-coordinate resolves must share one in-flight fetch');
  assert.deepEqual(ra.get('dup'), ['INZ900']);
  assert.deepEqual(rb.get('dup'), ['INZ900']);
});
