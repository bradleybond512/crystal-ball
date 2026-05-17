/**
 * Tests for SavedPlacesFilterService — the first-class proximity
 * lens that scopes ObservationEvent consumers to the neighborhood
 * of an activated saved place.
 *
 * The service depends on the live saved-places store, so each test
 * injects a tiny in-memory adapter that mirrors the real store's
 * `list / get / subscribe` shape.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  SavedPlacesFilterService,
  __internals,
  __resetSavedPlacesFilterSingleton,
  getSavedPlacesFilterService,
  type FilterContext,
  type FilterStats,
  type SavedPlacesAdapter,
} from '../../src/services/intelligence/saved-places-filter.ts';
import type { SavedPlace } from '../../src/services/saved-places.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/services/intelligence/observation-adapters.ts';

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function makePlace(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: 'home',
    name: 'Home',
    lat: 41.6,
    lon: -86.7,
    radiusKm: 500,
    tags: [],
    priority: 1,
    notes: '',
    offlinePinned: false,
    primary: false,
    source: 'manual',
    sortIndex: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as SavedPlace;
}

function makeObs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'src',
    domain: 'weather',
    timestamp: NOW,
    severity: 'MEDIUM' as ObservationSeverity,
    title: 'fixture',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeAdapter(initial: readonly SavedPlace[] = []): {
  adapter: SavedPlacesAdapter;
  setPlaces(places: readonly SavedPlace[]): void;
} {
  let places = [...initial];
  const listeners = new Set<(p: readonly SavedPlace[]) => void>();
  return {
    adapter: {
      list: () => places,
      get: (id) => places.find((p) => p.id === id) ?? null,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    setPlaces(next) {
      places = [...next];
      for (const l of listeners) l(places);
    },
  };
}

function freshService(initial: readonly SavedPlace[] = []): {
  svc: SavedPlacesFilterService;
  rig: ReturnType<typeof makeAdapter>;
} {
  __storage.clear();
  const rig = makeAdapter(initial);
  const svc = new SavedPlacesFilterService({ adapter: rig.adapter });
  return { svc, rig };
}

// ── Inactive defaults ────────────────────────────────────────────────

test('filter starts inactive with null context fields and default radius', () => {
  const { svc } = freshService([makePlace()]);
  const ctx = svc.getContext();
  assert.equal(ctx.isActive, false);
  assert.equal(ctx.activePlaceId, null);
  assert.equal(ctx.activePlaceName, null);
  assert.equal(ctx.center, null);
  assert.equal(ctx.radiusKm, __internals.DEFAULT_RADIUS_KM);
});

test('filterObservations returns input unchanged when inactive', () => {
  const { svc } = freshService([makePlace()]);
  const obs = [
    makeObs({ id: 'a', location: { lat: 35, lon: 139 } }),
    makeObs({ id: 'b', location: { lat: 0, lon: 0 } }),
  ];
  assert.equal(svc.filterObservations(obs).length, 2);
});

// ── activate / deactivate lifecycle ──────────────────────────────────

test('activate sets the active place + emits to subscribers', () => {
  const { svc } = freshService([makePlace()]);
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.activate('home');
  assert.equal(svc.getContext().isActive, true);
  assert.equal(calls, 1);
});

test('activate is a no-op when the place id is unknown', () => {
  const { svc } = freshService([makePlace()]);
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.activate('does-not-exist');
  assert.equal(svc.getContext().isActive, false);
  assert.equal(calls, 0);
});

test('activating the already-active place does not re-emit', () => {
  const { svc } = freshService([makePlace()]);
  svc.activate('home');
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.activate('home');
  assert.equal(calls, 0);
});

test('deactivate clears the filter and emits', () => {
  const { svc } = freshService([makePlace()]);
  svc.activate('home');
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.deactivate();
  assert.equal(svc.getContext().isActive, false);
  assert.equal(calls, 1);
});

test('deactivate when already inactive is a silent no-op', () => {
  const { svc } = freshService([makePlace()]);
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.deactivate();
  assert.equal(calls, 0);
});

// ── Context shape ───────────────────────────────────────────────────

test('getContext reflects the active place name + center + radius', () => {
  const { svc } = freshService([makePlace({ name: 'Cabin', radiusKm: 250 })]);
  svc.activate('home');
  const ctx = svc.getContext();
  assert.equal(ctx.activePlaceId, 'home');
  assert.equal(ctx.activePlaceName, 'Cabin');
  assert.deepEqual(ctx.center, { lat: 41.6, lon: -86.7 });
  assert.equal(ctx.radiusKm, 250);
});

test('getContext falls back to the default radius when the place stored 0', () => {
  const { svc } = freshService([makePlace({ radiusKm: 0 })]);
  svc.activate('home');
  assert.equal(svc.getContext().radiusKm, __internals.DEFAULT_RADIUS_KM);
});

// ── Proximity filtering ────────────────────────────────────────────

test('filterObservations keeps observations within radius', () => {
  const { svc } = freshService([makePlace({ radiusKm: 500 })]);
  svc.activate('home');
  const obs = [
    makeObs({ id: 'inside', location: { lat: 41.7, lon: -86.5 } }),
    makeObs({ id: 'far', location: { lat: 35, lon: 139 } }),
  ];
  const filtered = svc.filterObservations(obs);
  assert.deepEqual(filtered.map((o) => o.id), ['inside']);
});

test('filterObservations passes through observations without coordinates', () => {
  const { svc } = freshService([makePlace()]);
  svc.activate('home');
  const obs = [
    makeObs({ id: 'no-coords' }),
    makeObs({ id: 'far', location: { lat: 35, lon: 139 } }),
  ];
  const filtered = svc.filterObservations(obs);
  // 'no-coords' passes through; 'far' is filtered out.
  assert.deepEqual(filtered.map((o) => o.id), ['no-coords']);
});

test('filterObservations returns a defensive copy of the input array', () => {
  const { svc } = freshService([makePlace()]);
  const obs = [makeObs({ id: 'a' })];
  const filtered = svc.filterObservations(obs);
  assert.notEqual(filtered, obs);
});

test('filterObservations honors smaller radius', () => {
  const { svc } = freshService([makePlace({ radiusKm: 50 })]);
  svc.activate('home');
  const obs = [
    makeObs({ id: 'very-close', location: { lat: 41.6, lon: -86.7 } }),
    // ~80km from center → outside 50km
    makeObs({ id: 'just-outside', location: { lat: 42.3, lon: -86.7 } }),
  ];
  const filtered = svc.filterObservations(obs);
  assert.deepEqual(filtered.map((o) => o.id), ['very-close']);
});

test('haversineKm computes great-circle distance (London → Paris ~ 343km)', () => {
  const d = __internals.haversineKm(51.5, -0.13, 48.85, 2.35);
  assert.ok(Math.abs(d - 343) < 10, `expected ~343km, got ${d}`);
});

test('isWithinRadius: observation without location returns true (passthrough)', () => {
  const obs = makeObs({ id: 'no-coords' });
  assert.equal(__internals.isWithinRadius(obs, { lat: 0, lon: 0 }, 100), true);
});

// ── evaluate() stats ───────────────────────────────────────────────

test('evaluate returns inactive-passthrough stats when nothing is active', () => {
  const { svc } = freshService([makePlace()]);
  const obs = [
    makeObs({ id: 'a', location: { lat: 0, lon: 0 } }),
    makeObs({ id: 'b' }),
  ];
  const stats: FilterStats = svc.evaluate(obs);
  assert.equal(stats.total, 2);
  assert.equal(stats.passed, 2);
  assert.equal(stats.failed, 0);
  assert.equal(stats.passthrough, 0);
});

test('evaluate partitions passed / failed / passthrough when active', () => {
  const { svc } = freshService([makePlace({ radiusKm: 500 })]);
  svc.activate('home');
  const obs = [
    makeObs({ id: 'in', location: { lat: 41.6, lon: -86.7 } }),
    makeObs({ id: 'out', location: { lat: 35, lon: 139 } }),
    makeObs({ id: 'no-coords' }),
  ];
  const stats = svc.evaluate(obs);
  assert.equal(stats.total, 3);
  assert.equal(stats.passed, 1);
  assert.equal(stats.failed, 1);
  assert.equal(stats.passthrough, 1);
});

test('evaluate is non-mutating — successive calls return the same numbers', () => {
  const { svc } = freshService([makePlace()]);
  svc.activate('home');
  const obs = [makeObs({ id: 'a', location: { lat: 0, lon: 0 } })];
  const first = svc.evaluate(obs);
  const second = svc.evaluate(obs);
  assert.deepEqual(first, second);
});

// ── Adapter sync ─────────────────────────────────────────────────────

test('removing the active place from the store auto-deactivates the filter', () => {
  const { svc, rig } = freshService([makePlace()]);
  svc.activate('home');
  rig.setPlaces([]); // user deleted the place
  assert.equal(svc.getContext().isActive, false);
});

test('renaming the active place re-emits with the new label', () => {
  const { svc, rig } = freshService([makePlace()]);
  svc.activate('home');
  let lastCtx: FilterContext | undefined;
  svc.subscribe((ctx) => { lastCtx = ctx; });
  rig.setPlaces([makePlace({ name: 'Cabin' })]);
  assert.equal(lastCtx?.activePlaceName, 'Cabin');
});

// ── Persistence ─────────────────────────────────────────────────────

test('active filter persists across service instances', () => {
  __storage.clear();
  const rig = makeAdapter([makePlace()]);
  const a = new SavedPlacesFilterService({ adapter: rig.adapter });
  a.activate('home');
  const b = new SavedPlacesFilterService({ adapter: rig.adapter });
  assert.equal(b.getContext().activePlaceId, 'home');
});

test('persisted active id pointing at a missing place is ignored on hydrate', () => {
  __storage.clear();
  __storage.set(__internals.STORAGE_KEY, JSON.stringify({ activeId: 'gone' }));
  const rig = makeAdapter([makePlace()]);
  const svc = new SavedPlacesFilterService({ adapter: rig.adapter });
  assert.equal(svc.getContext().isActive, false);
});

test('corrupt persisted payload is ignored without throwing', () => {
  __storage.clear();
  __storage.set(__internals.STORAGE_KEY, 'not-json');
  const rig = makeAdapter([makePlace()]);
  const svc = new SavedPlacesFilterService({ adapter: rig.adapter });
  assert.doesNotThrow(() => svc.getContext());
});

// ── Subscribe lifecycle ─────────────────────────────────────────────

test('subscribe returns an unsubscribe function', () => {
  const { svc } = freshService([makePlace()]);
  let calls = 0;
  const off = svc.subscribe(() => { calls += 1; });
  svc.activate('home');
  off();
  svc.deactivate();
  assert.equal(calls, 1);
});

test('unsubscribe(listener) also stops further notifications', () => {
  const { svc } = freshService([makePlace()]);
  let calls = 0;
  const listener = (): void => { calls += 1; };
  svc.subscribe(listener);
  svc.unsubscribe(listener);
  svc.activate('home');
  assert.equal(calls, 0);
});

test('listener exceptions do not break further dispatch', () => {
  const { svc } = freshService([makePlace()]);
  let second = false;
  svc.subscribe(() => { throw new Error('boom'); });
  svc.subscribe(() => { second = true; });
  svc.activate('home');
  assert.equal(second, true);
});

test('multiple subscribers all receive the same snapshot', () => {
  const { svc } = freshService([makePlace()]);
  const seen: FilterContext[] = [];
  svc.subscribe((c) => seen.push(c));
  svc.subscribe((c) => seen.push(c));
  svc.activate('home');
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], seen[1]);
});

// ── listPlaces + singleton ──────────────────────────────────────────

test('listPlaces forwards the adapter list directly', () => {
  const place = makePlace();
  const { svc } = freshService([place]);
  assert.deepEqual(svc.listPlaces(), [place]);
});

test('getSavedPlacesFilterService returns a stable singleton', () => {
  __resetSavedPlacesFilterSingleton();
  const a = getSavedPlacesFilterService();
  const b = getSavedPlacesFilterService();
  assert.equal(a, b);
});

// ── Teardown ────────────────────────────────────────────────────────

test('teardown', () => {
  __resetSavedPlacesFilterSingleton();
  __storage.clear();
  assert.ok(true);
});
