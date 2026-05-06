import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateWebcams,
  dedupeFeeds,
  filterByBoundingBox,
  sortFeeds,
} from '../webcam-aggregator.ts';
import type { WebcamFeed } from '../webcam-types.ts';

const NOW = 1_745_000_000_000;

function feed(overrides: Partial<WebcamFeed> = {}): WebcamFeed {
  return {
    id: 'cam-1',
    source: 'FAA',
    name: 'Test Cam',
    lat: 41.6,
    lon: -86.7,
    snapshotUrl: 'https://example.com/cam.jpg',
    refreshIntervalSec: 60,
    category: 'weather',
    metadata: {},
    ...overrides,
  };
}

// ── dedupe ──────────────────────────────────────────────────────────────

test('dedupeFeeds: identical name + close coords merge', () => {
  const a = feed({ id: 'a', name: 'Mt Hood Lookout', lat: 45.3, lon: -121.7 });
  const b = feed({ id: 'b', name: 'Mt Hood Lookout', lat: 45.305, lon: -121.703 });
  const out = dedupeFeeds([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'a');
});

test('dedupeFeeds: same name beyond tolerance stays separate', () => {
  const a = feed({ id: 'a', name: 'Highway Cam', lat: 41.0, lon: -86.0 });
  const b = feed({ id: 'b', name: 'Highway Cam', lat: 41.5, lon: -86.5 });
  const out = dedupeFeeds([a, b]);
  assert.equal(out.length, 2);
});

test('dedupeFeeds: different names at same coords stay separate', () => {
  const a = feed({ id: 'a', name: 'North View', lat: 41.6, lon: -86.7 });
  const b = feed({ id: 'b', name: 'South View', lat: 41.6, lon: -86.7 });
  const out = dedupeFeeds([a, b]);
  assert.equal(out.length, 2);
});

test('dedupeFeeds: name matching is case + whitespace insensitive', () => {
  const a = feed({ id: 'a', name: 'Yellowstone Old Faithful' });
  const b = feed({ id: 'b', name: '  yellowstone   old   faithful ' });
  const out = dedupeFeeds([a, b]);
  assert.equal(out.length, 1);
});

test('dedupeFeeds: dup with newer lastChecked replaces older', () => {
  const a = feed({ id: 'a', name: 'Cam', lastChecked: NOW - 60_000 });
  const b = feed({ id: 'b', name: 'Cam', lastChecked: NOW });
  const out = dedupeFeeds([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'b');
});

test('dedupeFeeds: online dup replaces offline one (when timestamps equal)', () => {
  const a = feed({ id: 'a', name: 'Cam', isOnline: false });
  const b = feed({ id: 'b', name: 'Cam', isOnline: true });
  const out = dedupeFeeds([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'b');
});

// ── sort ────────────────────────────────────────────────────────────────

test('sortFeeds: fire before volcano before weather before traffic', () => {
  const traffic = feed({ id: 't', name: 'A', category: 'traffic' });
  const fire = feed({ id: 'f', name: 'A', category: 'fire' });
  const weather = feed({ id: 'w', name: 'A', category: 'weather' });
  const volcano = feed({ id: 'v', name: 'A', category: 'volcano' });
  const out = sortFeeds([traffic, fire, weather, volcano]);
  assert.deepEqual(
    out.map((f) => f.category),
    ['fire', 'volcano', 'weather', 'traffic'],
  );
});

test('sortFeeds: within category, sorts alphabetically by name', () => {
  const out = sortFeeds([
    feed({ id: '1', name: 'Charlie', category: 'fire' }),
    feed({ id: '2', name: 'Alpha', category: 'fire' }),
    feed({ id: '3', name: 'Bravo', category: 'fire' }),
  ]);
  assert.deepEqual(
    out.map((f) => f.name),
    ['Alpha', 'Bravo', 'Charlie'],
  );
});

test('sortFeeds: pure (does not mutate input)', () => {
  const input = [
    feed({ id: '1', name: 'Z', category: 'traffic' }),
    feed({ id: '2', name: 'A', category: 'fire' }),
  ];
  const before = input.map((f) => f.id).join(',');
  sortFeeds(input);
  assert.equal(input.map((f) => f.id).join(','), before);
});

// ── aggregate ───────────────────────────────────────────────────────────

test('aggregateWebcams: merges multiple source arrays + dedupes + sorts', () => {
  const faa = [
    feed({ id: 'FAA:1', source: 'FAA', name: 'AAA', category: 'weather' }),
    feed({ id: 'FAA:2', source: 'FAA', name: 'BBB', category: 'weather' }),
  ];
  const fire = [
    feed({
      id: 'FIRE:1',
      source: 'ALERTWILDFIRE',
      name: 'Lookout',
      category: 'fire',
      lat: 39.0,
      lon: -120.0,
    }),
  ];
  const dot = [
    feed({
      id: 'DOT:1',
      source: 'DOT511',
      name: 'I-94 East',
      category: 'traffic',
      lat: 41.0,
      lon: -85.0,
    }),
  ];
  const cat = aggregateWebcams([faa, fire, dot], NOW);
  assert.equal(cat.feeds.length, 4);
  assert.equal(cat.feeds[0]?.category, 'fire');
  assert.equal(cat.feeds[cat.feeds.length - 1]?.category, 'traffic');
  assert.equal(cat.lastUpdated, NOW);
  assert.equal(cat.bySource.FAA.length, 2);
  assert.equal(cat.bySource.ALERTWILDFIRE.length, 1);
  assert.equal(cat.bySource.DOT511.length, 1);
  assert.equal(cat.bySource.WINDY.length, 0);
});

test('aggregateWebcams: tolerates null / undefined source arrays', () => {
  const cat = aggregateWebcams([null, undefined, [feed()]], NOW);
  assert.equal(cat.feeds.length, 1);
});

test('aggregateWebcams: drops malformed feeds (missing id, NaN coords)', () => {
  const bad = [
    { source: 'FAA', name: 'no-id', lat: 1, lon: 1, snapshotUrl: 'x' } as never,
    feed({ id: 'good' }),
    { id: 'nan-lat', source: 'FAA', name: 'X', lat: NaN, lon: 0, snapshotUrl: 'x' } as never,
  ];
  const cat = aggregateWebcams([bad], NOW);
  assert.equal(cat.feeds.length, 1);
  assert.equal(cat.feeds[0]?.id, 'good');
});

test('aggregateWebcams: cross-source dedup (FAA + WINDY at same place)', () => {
  const faa = [feed({ id: 'FAA:KSBN', source: 'FAA', name: 'South Bend Airport' })];
  const windy = [
    feed({
      id: 'WINDY:1234',
      source: 'WINDY',
      name: 'South Bend Airport',
      lat: 41.605,
      lon: -86.705,
    }),
  ];
  const cat = aggregateWebcams([faa, windy], NOW);
  assert.equal(cat.feeds.length, 1);
});

// ── bbox ────────────────────────────────────────────────────────────────

test('filterByBoundingBox: keeps feeds inside, drops outside', () => {
  const feeds = [
    feed({ id: 'in', lat: 41.5, lon: -86.5 }),
    feed({ id: 'out-n', lat: 50.0, lon: -86.5 }),
    feed({ id: 'out-w', lat: 41.5, lon: -130.0 }),
  ];
  const out = filterByBoundingBox(feeds, {
    minLat: 40,
    minLon: -90,
    maxLat: 45,
    maxLon: -80,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'in');
});

test('filterByBoundingBox: inclusive at boundary', () => {
  const out = filterByBoundingBox(
    [feed({ lat: 40, lon: -90 })],
    { minLat: 40, minLon: -90, maxLat: 45, maxLon: -80 },
  );
  assert.equal(out.length, 1);
});
