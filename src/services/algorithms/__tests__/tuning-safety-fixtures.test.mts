/**
 * B2-enable: the tuning-safety fixtures must DISCRIMINATE — block a change
 * that regresses the known-good scenarios, allow one that doesn't. A gate
 * that always returns the same answer would be a Potemkin gate; these tests
 * are the honesty proof.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scoreTuningSafety,
  proposeTuningSafety,
  hasTuningSafetyFixtures,
} from '../tuning-safety-fixtures.ts';

test('the negative-evidence.maxPenalty curve peaks in the middle (real algorithm)', () => {
  const at = (cap: number) => scoreTuningSafety('negative-evidence', 'maxPenalty', cap)!.hitRate;
  // Mid-range values score perfectly; both extremes regress.
  assert.equal(at(0.3), 1);
  assert.equal(at(0.4), 1);
  assert.ok(at(0.2) < 1, 'too-low cap fails the true-absence cases');
  assert.ok(at(0.6) < 1, 'too-high cap fails the false-absence cases');
  // The curve is not flat — that is what makes the gate meaningful.
  assert.ok(at(0.4) > at(0.6), 'discriminates between a good and a worse value');
});

test('proposeTuningSafety BLOCKS a regressing change', () => {
  // 0.3 scores 1.0, 0.2 scores < 1.0 → moving down to 0.2 regresses.
  assert.equal(proposeTuningSafety('negative-evidence', 'maxPenalty', 0.3, 0.2), false);
});

test('proposeTuningSafety ALLOWS a non-regressing change', () => {
  // 0.6 → 0.5 is a tie (no regression); 0.5 → 0.4 is an improvement.
  assert.equal(proposeTuningSafety('negative-evidence', 'maxPenalty', 0.6, 0.5), true);
  assert.equal(proposeTuningSafety('negative-evidence', 'maxPenalty', 0.5, 0.4), true);
});

test('set-wise non-regression BLOCKS a swap that keeps aggregate hit rate equal', () => {
  // 0.6 and 0.2 both score 0.667 but on DIFFERENT passing sets — moving
  // 0.6 → 0.2 breaks true-absence cases while fixing false-absence ones.
  // Aggregate "hit rate didn't drop" would wrongly allow it; set-wise blocks.
  const at06 = scoreTuningSafety('negative-evidence', 'maxPenalty', 0.6)!;
  const at02 = scoreTuningSafety('negative-evidence', 'maxPenalty', 0.2)!;
  assert.equal(at06.hitRate, at02.hitRate, 'precondition: equal aggregate hit rate');
  assert.notDeepEqual([...at06.passingCaseIds].sort(), [...at02.passingCaseIds].sort());
  assert.equal(proposeTuningSafety('negative-evidence', 'maxPenalty', 0.6, 0.2), false);
});

test('a knob without fixtures fails closed (no fixtures → never auto-apply)', () => {
  assert.equal(scoreTuningSafety('big-event-detector', 'threshold', 45), null);
  assert.equal(proposeTuningSafety('big-event-detector', 'threshold', 40, 45), false);
  assert.equal(hasTuningSafetyFixtures('big-event-detector', 'threshold'), false);
  assert.equal(hasTuningSafetyFixtures('negative-evidence', 'maxPenalty'), true);
});
