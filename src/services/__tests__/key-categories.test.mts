import assert from 'node:assert/strict';
import test from 'node:test';

import { KEY_CATEGORIES, categoryFor } from '../settings-constants.ts';

test('every category has a unique id and tier', () => {
  const ids = KEY_CATEGORIES.map((c) => c.id);
  const tiers = KEY_CATEGORIES.map((c) => c.tier);
  assert.equal(new Set(ids).size, ids.length, 'duplicate category id');
  assert.equal(new Set(tiers).size, tiers.length, 'duplicate tier number');
});

test('no key appears in two categories', () => {
  const seen = new Set<string>();
  for (const cat of KEY_CATEGORIES) {
    for (const key of cat.keys) {
      assert.ok(!seen.has(key), key + ' appears in multiple categories');
      seen.add(key);
    }
  }
});

test('categoryFor returns the right tier for a known key', () => {
  assert.equal(categoryFor('ANTHROPIC_API_KEY')?.tier, 1);
  assert.equal(categoryFor('FRED_API_KEY')?.tier, 2);
  assert.equal(categoryFor('OWM_API_KEY')?.tier, 8);
});

test('categoryFor returns undefined for uncategorized keys', () => {
  assert.equal(categoryFor('CRYSTALBALL_API_KEY'), undefined);
  assert.equal(categoryFor('WS_RELAY_URL'), undefined);
});
