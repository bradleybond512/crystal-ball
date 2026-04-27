import assert from 'node:assert/strict';
import test from 'node:test';

import { featuresFor } from '../key-feature-index.ts';

test('returns features for a key required by multiple features', () => {
  const features = featuresFor('ACLED_ACCESS_TOKEN');
  assert.ok(features.length >= 2, 'expected ACLED to unlock multiple features');
});

test('returns features for a single-use key', () => {
  const features = featuresFor('GROQ_API_KEY');
  assert.ok(features.length >= 1, 'expected GROQ to unlock at least one feature');
});

test('returns an empty array for keys not referenced by any feature', () => {
  const features = featuresFor('CESIUM_ION_TOKEN');
  assert.equal(Array.isArray(features), true);
});
