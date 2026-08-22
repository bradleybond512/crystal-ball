import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { prewarmLocalLogistics, selectLifelinePrewarmPlaces } from '../src/services/local-logistics.ts';

function place(id: string, offlinePinned = false) {
  return {
 id, name: id, lat: 41.6, lon: -86.7, radiusKm: 25, tags: [], priority: 0,
 notes: '', offlinePinned, primary: false, source: 'manual' as const,
 sortIndex: 0, createdAt: 1, updatedAt: 1,
  };
}

test('prewarm selection includes pinned and storm-matched places without duplicates', () => {
  const selected = selectLifelinePrewarmPlaces(
 [place('pinned', true), place('storm'), place('other')],
 'storm',
  );
  assert.deepEqual(selected.map((item) => item.id), ['pinned', 'storm']);
});

test('prewarm selection does not fetch unpinned places without a storm match', () => {
  const selected = selectLifelinePrewarmPlaces([place('one'), place('two')], null);
  assert.deepEqual(selected, []);
});

test('storm decision wiring prewarms without modifying warning routing', () => {
  const source = readFileSync(new URL('../src/app/data-loader.ts', import.meta.url), 'utf8');
  assert.match(source, /prewarmLocalLogistics\(places, bestDecision\?\.matchedPlaceId\)/);
  assert.match(source, /cb:storm-decision/);
});

test('shipped panel-layout startup prewarms at most three explicitly pinned places', () => {
  const source = readFileSync(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');
  assert.match(source, /getSavedPlaces\(\)\.filter\(\(place\) => place\.offlinePinned\)\.slice\(0, 3\)/);
  assert.match(source, /prewarmLocalLogistics\(/);
  assert.match(source, /cancelPinnedLifelinePrewarm/);
});

test('prewarm limits concurrency to two and applies a 15-minute cooldown', async () => {
  const places = [place('warm-a', true), place('warm-b', true), place('warm-c', true)];
  let active = 0;
  let peak = 0;
  const calls: string[] = [];
  const fetcher = async (item: { id: string }) => {
 active += 1;
 peak = Math.max(peak, active);
 calls.push(item.id);
 await new Promise((resolve) => setTimeout(resolve, 2));
 active -= 1;
  };
  const first = await prewarmLocalLogistics(places, null, 1_000_000, fetcher);
  const second = await prewarmLocalLogistics(places, null, 1_000_001, fetcher);

  assert.equal(peak, 2);
  assert.deepEqual(first.succeeded.sort(), ['warm-a', 'warm-b', 'warm-c']);
  assert.deepEqual(second.skipped.sort(), ['warm-a', 'warm-b', 'warm-c']);
  assert.equal(calls.length, 3);
});
