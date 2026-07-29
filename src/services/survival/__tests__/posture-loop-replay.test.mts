// src/services/survival/__tests__/posture-loop-replay.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gradePostureLoop,
  summarizePostureLoops,
  STORM_POSTURE_LOOP_FIXTURE,
} from '../posture-loop-replay.ts';
import type { PostureLoopFixture } from '../posture-loop-replay.ts';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

function fixture(over: Partial<PostureLoopFixture> = {}): PostureLoopFixture {
  return {
    label: 'test-loop',
    axis: 'physical_safety',
    warningIssuedAtMs: T0,
    impactAtMs: T0 + 45 * MIN,
    postureBefore: 80,
    postureAfter: 45,
    committedMove: {
      moveId: 'shelter',
      committedAtMs: T0 + 5 * MIN,
      effect: [{ axis: 'physical_safety', deltaLevel: -35, rationale: 'shelter' }],
    },
    ...over,
  };
}

test('the canonical storm-posture-loop fixture grades adequate + improved + near-accurate', () => {
  const g = gradePostureLoop(STORM_POSTURE_LOOP_FIXTURE);
  assert.equal(g.moveId, 'shelter-interior-room'); // carried through for E7 per-move calibration
  assert.equal(g.leadVerdict, 'adequate'); // 42 min ≥ 30 min target
  assert.equal(g.postureImproved, true); // 82 → 51
  assert.equal(g.actualDelta, -31);
  assert.equal(g.projectedDelta, -35);
  assert.equal(g.projectionError, 4); // -31 − (-35): helped 4 pts less than modeled
  assert.equal(g.projectionVerdict, 'accurate'); // |4| ≤ 5 tolerance
  assert.equal(g.committedBeforeImpact, true);
  assert.equal(g.bandBefore, 'critical');
  assert.equal(g.bandAfter, 'elevated');
});

test('warning lead time classifies missed / short / adequate', () => {
  const missed = gradePostureLoop(fixture({ warningIssuedAtMs: T0, impactAtMs: T0 })); // 0 lead
  assert.equal(missed.leadVerdict, 'missed');
  assert.ok(missed.notes.some((n) => /at or after impact/.test(n)));

  const short = gradePostureLoop(fixture({ impactAtMs: T0 + 10 * MIN })); // 10 min < 30
  assert.equal(short.leadVerdict, 'short');

  const adequate = gradePostureLoop(fixture({ impactAtMs: T0 + 60 * MIN }));
  assert.equal(adequate.leadVerdict, 'adequate');
});

test('a warning issued after impact yields negative lead and missed', () => {
  const g = gradePostureLoop(fixture({ warningIssuedAtMs: T0 + 20 * MIN, impactAtMs: T0 }));
  assert.equal(g.warningLeadMs, -20 * MIN);
  assert.equal(g.leadVerdict, 'missed');
});

test('a move that raises the axis level is graded as posture not improved', () => {
  const g = gradePostureLoop(fixture({ postureBefore: 40, postureAfter: 55 }));
  assert.equal(g.postureImproved, false);
  assert.equal(g.actualDelta, 15);
  assert.ok(g.notes.some((n) => /did not improve/.test(n)));
  assert.ok(/worsened/.test(g.headline)); // three-way headline reports the worsening
});

test('the headline reports an improvement when the observed posture drops', () => {
  const g = gradePostureLoop(fixture({ postureBefore: 80, postureAfter: 45 }));
  assert.ok(g.postureImproved);
  assert.ok(!/worsened/.test(g.headline));
  assert.ok(!/held/.test(g.headline));
  assert.ok(/→/.test(g.headline)); // improved branch: "posture <before>→<after>"
});

test('the headline reports posture held when the observed level is unchanged', () => {
  const g = gradePostureLoop(fixture({ postureBefore: 45, postureAfter: 45 }));
  assert.equal(g.actualDelta, 0);
  assert.ok(/held/.test(g.headline)); // three-way headline neutral branch
});

test('projection verdict: overpredicted when the move helped less than modeled', () => {
  // Modeled −40, actually only −20 → error +20 (over-promised) beyond tolerance.
  const g = gradePostureLoop(fixture({
    postureBefore: 80,
    postureAfter: 60,
    committedMove: { moveId: 'm', committedAtMs: T0, effect: [{ axis: 'physical_safety', deltaLevel: -40, rationale: 'x' }] },
  }));
  assert.equal(g.projectedDelta, -40);
  assert.equal(g.actualDelta, -20);
  assert.equal(g.projectionError, 20);
  assert.equal(g.projectionVerdict, 'overpredicted');
  assert.ok(g.notes.some((n) => /fell 20 pts short of the modeled effect/.test(n)));
});

test('projection verdict: underpredicted when the move helped more than modeled', () => {
  const g = gradePostureLoop(fixture({
    postureBefore: 80,
    postureAfter: 30,
    committedMove: { moveId: 'm', committedAtMs: T0, effect: [{ axis: 'physical_safety', deltaLevel: -30, rationale: 'x' }] },
  }));
  assert.equal(g.actualDelta, -50);
  assert.equal(g.projectionError, -20);
  assert.equal(g.projectionVerdict, 'underpredicted');
  assert.ok(g.notes.some((n) => /exceeded the modeled effect by 20 pts/.test(n)));
});

test('only the graded axis contributes to the projected delta', () => {
  const g = gradePostureLoop(fixture({
    axis: 'physical_safety',
    committedMove: {
      moveId: 'm',
      committedAtMs: T0,
      effect: [
        { axis: 'physical_safety', deltaLevel: -30, rationale: 'a' },
        { axis: 'mobility', deltaLevel: -50, rationale: 'b' }, // ignored
      ],
    },
  }));
  assert.equal(g.projectedDelta, -30);
});

test('committedBeforeImpact is false when the move lands after impact', () => {
  const g = gradePostureLoop(fixture({ impactAtMs: T0 + 10 * MIN, committedMove: { moveId: 'm', committedAtMs: T0 + 20 * MIN, effect: [] } }));
  assert.equal(g.committedBeforeImpact, false);
  assert.ok(g.notes.some((n) => /committed after impact/.test(n)));
});

test('non-finite levels normalize to 0 and non-finite timestamps fail closed to missed', () => {
  const g = gradePostureLoop(fixture({
    postureBefore: Number.NaN,
    postureAfter: Number.POSITIVE_INFINITY,
    warningIssuedAtMs: Number.NaN,
    impactAtMs: Number.NaN,
  }));
  assert.equal(g.bandBefore, 'secure'); // 0
  assert.equal(g.bandAfter, 'secure'); // non-finite level → 0
  assert.equal(Number.isFinite(g.warningLeadMs), true);
  assert.equal(g.leadVerdict, 'missed'); // invalid timing must not read as a lead
  assert.ok(g.notes.some((n) => /missing\/invalid/.test(n)));
});

test('a valid impact with a NaN warning time fails closed instead of a huge adequate lead', () => {
  const g = gradePostureLoop(fixture({ warningIssuedAtMs: Number.NaN, impactAtMs: T0 + 60 * MIN }));
  assert.equal(g.warningLeadMs, 0); // not impact − 0 (which would be enormous)
  assert.equal(g.leadVerdict, 'missed');
});

test('a NaN commit time cannot masquerade as committed before impact', () => {
  const g = gradePostureLoop(fixture({ committedMove: { moveId: 'm', committedAtMs: Number.NaN, effect: [] } }));
  assert.equal(g.committedBeforeImpact, false);
  assert.ok(g.notes.some((n) => /cannot confirm the move beat impact/.test(n)));
});

test('levels above 100 / below 0 are clamped before banding', () => {
  const g = gradePostureLoop(fixture({ postureBefore: 250, postureAfter: -30 }));
  assert.equal(g.bandBefore, 'critical'); // clamped to 100
  assert.equal(g.bandAfter, 'secure'); // clamped to 0
  assert.equal(g.actualDelta, -100);
});

test('a custom lead target and tolerance override the defaults', () => {
  // 20 min lead, target 15 min → adequate (default 30 min would be short).
  // Error +4 (actual −31 vs modeled −35): accurate under the default tolerance 5,
  // but overpredicted once tolerance is tightened to 1 — so this exercises the override.
  const g = gradePostureLoop(fixture({
    impactAtMs: T0 + 20 * MIN,
    leadTimeTargetMs: 15 * MIN,
    projectionToleranceLevels: 1,
    postureBefore: 80,
    postureAfter: 49, // actual −31, projected −35 → error +4
  }));
  assert.equal(g.leadVerdict, 'adequate');
  assert.equal(g.projectionError, 4);
  assert.equal(g.projectionVerdict, 'overpredicted'); // |4| > custom tolerance 1
});

test('summarize aggregates lead verdicts, improvements, and signed projection bias', () => {
  const s = summarizePostureLoops([
    fixture({ impactAtMs: T0 + 60 * MIN, postureBefore: 80, postureAfter: 45, committedMove: { moveId: 'a', committedAtMs: T0, effect: [{ axis: 'physical_safety', deltaLevel: -35, rationale: 'x' }] } }), // adequate, improved, err 0
    fixture({ impactAtMs: T0 + 10 * MIN, postureBefore: 70, postureAfter: 55, committedMove: { moveId: 'b', committedAtMs: T0, effect: [{ axis: 'physical_safety', deltaLevel: -30, rationale: 'x' }] } }), // short, improved, actual −15 vs −30 → err +15
    fixture({ impactAtMs: T0, warningIssuedAtMs: T0, postureBefore: 40, postureAfter: 60, committedMove: { moveId: 'c', committedAtMs: T0, effect: [{ axis: 'physical_safety', deltaLevel: -10, rationale: 'x' }] } }), // missed, not improved, actual +20 vs −10 → err +30
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.adequateWarnings, 1);
  assert.equal(s.shortWarnings, 1);
  assert.equal(s.missedWarnings, 1);
  assert.equal(s.posturesImproved, 2);
  assert.equal(s.meanProjectionError, (0 + 15 + 30) / 3); // signed bias = +15
  assert.equal(s.meanAbsProjectionError, (0 + 15 + 30) / 3);
  assert.equal(s.grades.length, 3);
});

test('summarize of an empty list returns zeroed means, not NaN', () => {
  const s = summarizePostureLoops([]);
  assert.equal(s.count, 0);
  assert.equal(s.meanWarningLeadMs, 0);
  assert.equal(s.meanProjectionError, 0);
  assert.equal(s.meanAbsProjectionError, 0);
});
