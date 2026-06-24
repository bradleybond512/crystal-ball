import test from 'node:test';
import assert from 'node:assert/strict';
import { findInsertBeforeKey } from '../lazy-panel-order.ts';

const ORDER = ['command-center', 'live-news', 'markets', 'hibp-breaches', 'monitors'];

test('returns the nearest present panel AFTER the key (insert before it)', () => {
  // Inserting hibp-breaches when only command-center + monitors are present.
  assert.equal(findInsertBeforeKey(ORDER, new Set(['command-center', 'monitors']), 'hibp-breaches'), 'monitors');
});

test('picks the closest later neighbor, not a farther one', () => {
  assert.equal(findInsertBeforeKey(ORDER, new Set(['command-center', 'markets', 'monitors']), 'live-news'), 'markets');
});

test('appends (null) when no later panel is present', () => {
  assert.equal(findInsertBeforeKey(ORDER, new Set(['command-center', 'live-news']), 'markets'), null);
});

test('appends (null) when the grid is empty', () => {
  assert.equal(findInsertBeforeKey(ORDER, new Set(), 'markets'), null);
});

test('appends (null) for a key not in the canonical order', () => {
  assert.equal(findInsertBeforeKey(ORDER, new Set(['markets']), 'unknown-panel'), null);
});

test('skips earlier-present panels and only looks forward', () => {
  // markets is present but BEFORE hibp-breaches, so it must not be chosen.
  assert.equal(findInsertBeforeKey(ORDER, new Set(['markets']), 'hibp-breaches'), null);
});
