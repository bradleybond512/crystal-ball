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
  assert.equal(hasTuningSafetyFixtures('big-event-detector', 'rapidJumpDelta'), true);
  assert.equal(hasTuningSafetyFixtures('big-event-detector', 'exposureFloor'), true);
  assert.equal(hasTuningSafetyFixtures('hypothesis-feedback', 'downPenalty'), true);
});

// ── New knob fixtures ────────────────────────────────────────────────────

test('big-event-detector.rapidJumpDelta gate: lower delta fires more triggers (monotone)', () => {
  const at = (delta: number) => scoreTuningSafety('big-event-detector', 'rapidJumpDelta', delta)!.hitRate;
  // At the minimum valid delta all T cases fire — perfect score.
  assert.equal(at(15), 1);
  // At default (25) T3 (jump=20) does not fire — one case fails.
  assert.ok(at(25) < 1, 'T3 does not fire at default delta');
  // Higher deltas lose more T cases — score decreases.
  assert.ok(at(25) >= at(30), 'stricter delta scores the same or lower');
  // proposeTuningSafety: increasing delta from 25 breaks T2 (jump=28 < 30).
  assert.equal(proposeTuningSafety('big-event-detector', 'rapidJumpDelta', 25, 30), false);
  // Decreasing delta from 25 never regresses the current passing set.
  assert.equal(proposeTuningSafety('big-event-detector', 'rapidJumpDelta', 25, 20), true);
});

test('big-event-detector.exposureFloor gate peaks in the middle (real algorithm)', () => {
  const at = (floor: number) => scoreTuningSafety('big-event-detector', 'exposureFloor', floor)!.hitRate;
  // Mid-range floor (60) correctly handles both in-path and out-of-path cases.
  assert.equal(at(60), 1);
  // Too-low floor fires on moderate-exposure users (F3 fails).
  assert.ok(at(55) < 1, 'too-low floor fires on moderate-exposure user');
  // Too-high floor misses direct-path users (T1 or T2 fails).
  assert.ok(at(86) < 1, 'too-high floor misses high-exposure users');
  // Increasing the floor to 85 regresses T2 (exposure=80).
  assert.equal(proposeTuningSafety('big-event-detector', 'exposureFloor', 70, 85), false);
  // Decreasing the floor to 60 does not regress — T3 gains.
  assert.equal(proposeTuningSafety('big-event-detector', 'exposureFloor', 70, 60), true);
});

test('hypothesis-feedback.downPenalty gate peaks in the middle (real algorithm)', () => {
  const at = (p: number) => scoreTuningSafety('hypothesis-feedback', 'downPenalty', p)!.hitRate;
  // Mid-range (0.5) correctly classifies both demoted and promoted cases.
  assert.equal(at(0.5), 1);
  // Too-low penalty: D1 (balanced feedback) fails to be demoted.
  assert.ok(at(0.3) < 1, 'too-low penalty misses balanced-feedback demotion');
  // Too-high penalty: M1 (slight positive edge) is wrongly demoted.
  assert.ok(at(0.7) < 1, 'too-high penalty wrongly demotes slight-positive case');
  // Jumping to the extreme regresses the current passing set.
  assert.equal(proposeTuningSafety('hypothesis-feedback', 'downPenalty', 0.5, 0.3), false);
  // Small adjacent decrease is safe.
  assert.equal(proposeTuningSafety('hypothesis-feedback', 'downPenalty', 0.5, 0.45), true);
});
