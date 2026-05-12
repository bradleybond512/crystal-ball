import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseWatchRegions,
  normalizeRegion,
  regionContainsPoint,
  regionFor,
  createWatchRegionStore,
  STORAGE_KEY,
  _resetWatchRegionIdCounter,
  type WatchRegion,
} from '../watch-regions.ts';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}

function region(overrides: Partial<WatchRegion> = {}): WatchRegion {
  return {
    id: 'r1',
    label: 'Test',
    minLat: 30, maxLat: 35,
    minLon: -120, maxLon: -110,
    createdAt: 1_000,
    ...overrides,
  };
}

test('parseWatchRegions returns [] for null / malformed', () => {
  assert.deepEqual(parseWatchRegions(null), []);
  assert.deepEqual(parseWatchRegions(''), []);
  assert.deepEqual(parseWatchRegions('not-json'), []);
  assert.deepEqual(parseWatchRegions('{}'), []); // not an array
});

test('parseWatchRegions skips entries missing required fields', () => {
  const raw = JSON.stringify([
    region(), // valid
    { id: 'x' }, // missing fields
    { id: 'y', label: 'Y', minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 }, // missing createdAt
  ]);
  const parsed = parseWatchRegions(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.id, 'r1');
});

test('normalizeRegion swaps min/max when they are reversed', () => {
  const r = normalizeRegion(
    { label: 'X', minLat: 40, maxLat: 30, minLon: -100, maxLon: -120 },
    1_000, 'wr-1',
  );
  assert.equal(r.minLat, 30);
  assert.equal(r.maxLat, 40);
  assert.equal(r.minLon, -120);
  assert.equal(r.maxLon, -100);
});

test('normalizeRegion rejects empty label', () => {
  assert.throws(() =>
    normalizeRegion({ label: '   ', minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 }, 0, 'r'),
  );
});

test('normalizeRegion rejects out-of-range lat/lon', () => {
  assert.throws(() =>
    normalizeRegion({ label: 'X', minLat: -91, maxLat: 0, minLon: 0, maxLon: 1 }, 0, 'r'),
  );
  assert.throws(() =>
    normalizeRegion({ label: 'X', minLat: 0, maxLat: 91, minLon: 0, maxLon: 1 }, 0, 'r'),
  );
  assert.throws(() =>
    normalizeRegion({ label: 'X', minLat: 0, maxLat: 1, minLon: -181, maxLon: 0 }, 0, 'r'),
  );
});

test('normalizeRegion rejects zero-area boxes', () => {
  assert.throws(() =>
    normalizeRegion({ label: 'X', minLat: 10, maxLat: 10, minLon: 0, maxLon: 1 }, 0, 'r'),
  );
});

test('regionContainsPoint: inside → true, outside → false', () => {
  const r = region();
  assert.equal(regionContainsPoint(r, 32, -115), true); // centre
  assert.equal(regionContainsPoint(r, 30, -120), true); // SW corner
  assert.equal(regionContainsPoint(r, 35, -110), true); // NE corner
  assert.equal(regionContainsPoint(r, 36, -115), false); // north of box
  assert.equal(regionContainsPoint(r, 32, -105), false); // east of box
});

test('regionFor returns first matching region in order, else undefined', () => {
  const rs = [
    region({ id: 'a', label: 'West', minLat: 30, maxLat: 35, minLon: -120, maxLon: -110 }),
    region({ id: 'b', label: 'East', minLat: 30, maxLat: 35, minLon: -80, maxLon: -70 }),
  ];
  assert.equal(regionFor({ lat: 32, lon: -115 }, rs)?.id, 'a');
  assert.equal(regionFor({ lat: 32, lon: -75 }, rs)?.id, 'b');
  assert.equal(regionFor({ lat: 0, lon: 0 }, rs), undefined);
  assert.equal(regionFor(undefined, rs), undefined);
});

test('store.add persists to storage and returns the region', () => {
  _resetWatchRegionIdCounter();
  const storage = fakeStorage();
  const store = createWatchRegionStore(storage, () => 1_000);
  const r = store.add({ label: 'Hub', minLat: 30, maxLat: 35, minLon: -120, maxLon: -110 });
  assert.equal(r.label, 'Hub');
  assert.match(r.id, /^wr-/);
  const stored = storage._map.get(STORAGE_KEY);
  assert.ok(stored);
  assert.ok(stored?.includes('Hub'));
});

test('store.remove drops the region and re-persists', () => {
  _resetWatchRegionIdCounter();
  const storage = fakeStorage();
  const store = createWatchRegionStore(storage, () => 1_000);
  const r = store.add({ label: 'Hub', minLat: 30, maxLat: 35, minLon: -120, maxLon: -110 });
  store.add({ label: 'Other', minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 });
  assert.equal(store.list().length, 2);
  store.remove(r.id);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0]?.label, 'Other');
});

test('store.remove on unknown id is a silent no-op', () => {
  const storage = fakeStorage();
  const store = createWatchRegionStore(storage, () => 1_000);
  store.add({ label: 'Hub', minLat: 30, maxLat: 35, minLon: -120, maxLon: -110 });
  const before = store.list().length;
  store.remove('does-not-exist');
  assert.equal(store.list().length, before);
});

test('store.list returns a fresh array (no shared reference)', () => {
  const storage = fakeStorage();
  const store = createWatchRegionStore(storage, () => 1_000);
  store.add({ label: 'A', minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 });
  const a = store.list();
  const b = store.list();
  assert.notStrictEqual(a, b);
});

test('store.clear empties the cache and removes the storage key', () => {
  const storage = fakeStorage();
  const store = createWatchRegionStore(storage, () => 1_000);
  store.add({ label: 'A', minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 });
  store.clear();
  assert.equal(store.list().length, 0);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});
