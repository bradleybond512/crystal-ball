import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildLifelinePrewarmFingerprint,
  resolveLifelinePrewarmRadius,
  selectLifelinePrewarmPlaces,
} from '../src/services/local-logistics.ts';

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
  assert.match(source, /lifelinePrewarmCoordinator\.enqueue\(\{ place, trigger: ['"]storm['"] \}\)/);
  assert.match(source, /candidate\.id === bestDecision\?\.matchedPlaceId/);
  assert.match(source, /cb:storm-decision/);
});

test('manual, startup, and storm paths share the renderer coordinator singleton', () => {
  const panel = readFileSync(new URL('../src/components/LocalLogisticsPanel.ts', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');
  const loader = readFileSync(new URL('../src/app/data-loader.ts', import.meta.url), 'utf8');
  for (const source of [panel, layout, loader]) {
    assert.match(source, /lifelinePrewarmCoordinator/);
  }
  assert.match(layout, /trigger:\s*['"]startup['"]/);
  assert.match(loader, /trigger:\s*['"]storm['"]/);
  assert.match(panel, /trigger:\s*['"]manual['"]/);
  assert.doesNotMatch(layout, /prewarmLocalLogistics\(/);
  assert.doesNotMatch(loader, /prewarmLocalLogistics\(/);
});

test('shipped panel-layout startup prewarms at most three explicitly pinned places', () => {
  const source = readFileSync(new URL('../src/app/panel-layout.ts', import.meta.url), 'utf8');
  assert.match(source, /getSavedPlaces\(\)\.filter\(\(place\) => place\.offlinePinned\)\.slice\(0, 3\)/);
  assert.match(source, /lifelinePrewarmCoordinator\.enqueue\(\{ place, trigger: ['"]startup['"] \}\)/);
  assert.match(source, /cancelPinnedLifelinePrewarm/);
});

test('prewarm resolver preserves only exact supported radii and canonical fingerprints', () => {
  const item = place('warm-a', true);
  assert.equal(resolveLifelinePrewarmRadius(item, 10), 10);
  assert.equal(resolveLifelinePrewarmRadius({ ...item, radiusKm: 8 }), 10);
  assert.equal(resolveLifelinePrewarmRadius(item, 999), 25);
  assert.equal(
    buildLifelinePrewarmFingerprint(item, 10),
    buildLifelinePrewarmFingerprint(item, resolveLifelinePrewarmRadius(item, 10)),
  );
});
