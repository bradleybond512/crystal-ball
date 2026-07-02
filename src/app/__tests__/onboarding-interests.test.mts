import test from 'node:test';
import assert from 'node:assert/strict';
import { mapInterestsToTerms } from '../onboarding-interests.ts';

test('maps known labels to their expanded term set', () => {
  assert.deepEqual(mapInterestsToTerms(['Weather']), ['weather', 'storm', 'climate']);
});

test('dedupes overlapping terms across labels', () => {
  const terms = mapInterestsToTerms(['Geopolitical', 'Military']);
  assert.equal(terms.filter((t) => t === 'conflict').length, 1);
});

test('falls back to a lowercased label for unknown input', () => {
  assert.deepEqual(mapInterestsToTerms(['Sports']), ['sports']);
});

test('returns an empty array for empty input', () => {
  assert.deepEqual(mapInterestsToTerms([]), []);
});

test('every WelcomeFlow interest label maps to at least one term', () => {
  const labels = ['Geopolitical', 'Weather', 'Cyber', 'Markets', 'Infrastructure', 'Military', 'Health', 'Space'];
  for (const label of labels) {
    assert.ok(mapInterestsToTerms([label]).length > 0, `expected terms for ${label}`);
  }
});
