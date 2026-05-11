import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scoreMatch,
  rankPalette,
  groupByCategory,
  CATEGORY_WEIGHTS,
  type PaletteItem,
} from '../palette-search.ts';

function item(id: string, label: string, category: PaletteItem['category'], hint?: string): PaletteItem {
  return { id, label, category, hint, weight: CATEGORY_WEIGHTS[category] };
}

test('scoreMatch returns 0 for empty query', () => {
  assert.equal(scoreMatch('anything', ''), 0);
});

test('scoreMatch rewards prefix matches more than mid-string matches', () => {
  const prefix = scoreMatch('markets panel', 'mark');
  const middle = scoreMatch('the markets panel', 'mark');
  assert.ok(prefix > middle, `prefix=${prefix} should beat middle=${middle}`);
});

test('scoreMatch rewards word-boundary matches', () => {
  const boundary = scoreMatch('open settings', 'set');
  const middle = scoreMatch('asetstuff', 'set');
  assert.ok(boundary > middle, `boundary=${boundary} should beat embedded=${middle}`);
});

test('scoreMatch returns -Infinity when query is not a subsequence', () => {
  assert.equal(scoreMatch('hello world', 'xyz'), -Infinity);
});

test('scoreMatch handles contiguous matches better than gappy ones', () => {
  const contiguous = scoreMatch('alert center', 'alert');
  const gappy = scoreMatch('a fancy lert er thing', 'alert');
  assert.ok(contiguous > gappy);
});

test('rankPalette empty query sorts by weight desc then alpha asc', () => {
  const items: PaletteItem[] = [
    item('a', 'Zebra', 'preset'),
    item('b', 'Apple', 'action'),
    item('c', 'Banana', 'action'),
  ];
  const ranked = rankPalette(items, '');
  assert.equal(ranked[0]?.item.id, 'b'); // action > preset, apple before banana
  assert.equal(ranked[1]?.item.id, 'c');
  assert.equal(ranked[2]?.item.id, 'a');
});

test('rankPalette filters out non-matches', () => {
  const items: PaletteItem[] = [
    item('a', 'Open Settings', 'action'),
    item('b', 'Markets Panel', 'panel'),
    item('c', 'Refresh All', 'action'),
  ];
  const ranked = rankPalette(items, 'set');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.item.id, 'a');
});

test('rankPalette honors multi-word AND semantics', () => {
  const items: PaletteItem[] = [
    item('a', 'Open Settings', 'action'),
    item('b', 'Open Markets', 'action'),
    item('c', 'Close Tab', 'action'),
  ];
  const ranked = rankPalette(items, 'open settings');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.item.id, 'a');
});

test('rankPalette respects the limit parameter', () => {
  const items: PaletteItem[] = Array.from({ length: 30 }, (_, i) => item(`x${i}`, `Item ${i}`, 'panel'));
  const ranked = rankPalette(items, '', 5);
  assert.equal(ranked.length, 5);
});

test('rankPalette breaks score ties with alpha order', () => {
  const items: PaletteItem[] = [
    item('a', 'fire alert', 'action'),
    item('b', 'fire alert', 'action'),
  ];
  const ranked = rankPalette(items, 'fire');
  // Both score the same; alpha by label is identical, so ids ordering is stable.
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.score, ranked[1]?.score);
});

test('rankPalette weight breaks ties between weak matches across sources', () => {
  // Same hay length, same match, different category weights.
  const items: PaletteItem[] = [
    { id: 'a', label: 'foo bar', category: 'preset', weight: CATEGORY_WEIGHTS.preset },
    { id: 'b', label: 'foo bar', category: 'action', weight: CATEGORY_WEIGHTS.action },
  ];
  const ranked = rankPalette(items, 'foo');
  assert.equal(ranked[0]?.item.id, 'b'); // action wins
});

test('rankPalette searches against hint and category as well', () => {
  const items: PaletteItem[] = [
    item('a', 'Threat Dashboard', 'panel', '⌘1'),
    item('b', 'Markets', 'panel', '⌘5'),
  ];
  const r1 = rankPalette(items, '⌘1');
  assert.equal(r1[0]?.item.id, 'a');
});

test('groupByCategory preserves first-occurrence order across categories', () => {
  const items: PaletteItem[] = [
    item('p1', 'Markets', 'panel'),
    item('a1', 'Refresh', 'action'),
    item('p2', 'Threats', 'panel'),
  ];
  const ranked = rankPalette(items, '');
  const grouped = groupByCategory(ranked);
  // Action has highest weight, so it leads.
  const order = [...grouped.keys()];
  assert.deepEqual(order, ['action', 'panel']);
  assert.equal(grouped.get('panel')?.length, 2);
});
