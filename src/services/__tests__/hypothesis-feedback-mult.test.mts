import test from 'node:test';
import assert from 'node:assert/strict';

import { feedbackMultiplier } from '../hypothesis-feedback.ts';

test('feedbackMultiplier: neutral below min samples', () => {
  assert.equal(feedbackMultiplier(1, 0, 0.5), 1);
});

test('feedbackMultiplier: all-up boosts toward 1.3', () => {
  assert.equal(feedbackMultiplier(4, 0, 0.5), 1.3);
});

test('feedbackMultiplier: all-down floors at 0.5 with default penalty', () => {
  assert.equal(feedbackMultiplier(0, 4, 0.5), 0.5);
});

test('feedbackMultiplier: higher downPenalty punishes mixed feedback harder', () => {
  const lenient = feedbackMultiplier(2, 2, 0.3);
  const strict = feedbackMultiplier(2, 2, 0.7);
  assert.ok(strict < lenient);
});
