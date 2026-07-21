import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchPinnablePanels } from '../pin-picker-filter.ts';

const PANELS: [string, { name: string }][] = [
  ['warlord-economics', { name: 'Warlord Economics' }],
  ['backtest-gate', { name: 'Backtest Gate' }],
  ['weather', { name: 'Weather' }],
  ['storm-posture', { name: 'Storm Posture' }],
  ['air-smoke', { name: 'Air & Smoke' }],
];

test('matchPinnablePanels: empty query lists all unpinned, sorted by name', () => {
  const out = matchPinnablePanels('', PANELS, []);
  assert.deepEqual(out.map((x) => x[1]), ['Air & Smoke', 'Backtest Gate', 'Storm Posture', 'Warlord Economics', 'Weather']);
});

test('matchPinnablePanels: filters by case-insensitive substring of the name', () => {
  assert.deepEqual(matchPinnablePanels('storm', PANELS, []), [['storm-posture', 'Storm Posture']]);
  assert.deepEqual(matchPinnablePanels('SMOKE', PANELS, []).map((x) => x[0]), ['air-smoke']);
});

test('matchPinnablePanels: excludes already-pinned panels', () => {
  const out = matchPinnablePanels('', PANELS, ['weather', 'warlord-economics']);
  assert.equal(out.some(([k]) => k === 'weather'), false);
  assert.equal(out.some(([k]) => k === 'warlord-economics'), false);
  assert.equal(out.length, 3);
});

test('matchPinnablePanels: no accidental match — typing "war" does NOT return Backtest/Storm', () => {
  // the native-select misfire pinned "Warlord Economics"/"Backtest Gate" on
  // stray keystrokes; the filter only returns genuine name matches.
  const out = matchPinnablePanels('war', PANELS, []);
  assert.deepEqual(out, [['warlord-economics', 'Warlord Economics']]);
});

test('matchPinnablePanels: caps the result list at the limit', () => {
  const many: [string, { name: string }][] = Array.from({ length: 100 }, (_, i) => [`p${i}`, { name: `Panel ${String(i).padStart(3, '0')}` }]);
  assert.equal(matchPinnablePanels('panel', many, [], 40).length, 40);
});

test('matchPinnablePanels: whitespace-only query behaves like empty (lists all)', () => {
  assert.equal(matchPinnablePanels('   ', PANELS, []).length, 5);
});
