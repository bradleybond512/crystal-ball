// src/services/survival/__tests__/posture-calibration.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrateMoveEffects,
  applyCalibration,
  MIN_CALIBRATION_SAMPLES,
} from '../posture-calibration.ts';
import { gradePostureLoop } from '../posture-loop-replay.ts';
import type { PostureLoopGrade } from '../posture-loop-replay.ts';
import type { SurvivalAxis } from '../survival-types.ts';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

// Build a real grade from the real grader: modeled `projected` on `axis`, and an
// observed `actual` (postureAfter − postureBefore). Both signed; negative = better.
function grade(moveId: string, axis: SurvivalAxis, projected: number, actual: number): PostureLoopGrade {
  const before = 80;
  return gradePostureLoop({
    label: `${moveId}-episode`,
    axis,
    warningIssuedAtMs: T0,
    impactAtMs: T0 + 45 * MIN,
    postureBefore: before,
    postureAfter: before + actual,
    committedMove: {
      moveId,
      committedAtMs: T0 + 5 * MIN,
      effect: [{ axis, deltaLevel: projected, rationale: 'x' }],
    },
  });
}

function only<T>(rows: T[]): T {
  assert.equal(rows.length, 1);
  return rows[0];
}

test('a move whose delivery matches its model is well-calibrated with ~1 correction', () => {
  // Modeled −30, delivered −30, three times.
  const cal = only(calibrateMoveEffects([
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -28),
    grade('shelter', 'physical_safety', -30, -32),
  ]));
  assert.equal(cal.verdict, 'well_calibrated');
  assert.ok(Math.abs(cal.correctionFactor - 1) < 0.1);
  assert.equal(cal.sampleCount, 3);
  assert.ok(/well-calibrated/.test(cal.lesson));
});

test('a move that over-promises yields a positive bias and a shrinking correction', () => {
  // Modeled −40 but only delivered −20 → bias +20, factor ≈ 0.5.
  const cal = only(calibrateMoveEffects([
    grade('sandbag', 'physical_safety', -40, -20),
    grade('sandbag', 'physical_safety', -40, -20),
    grade('sandbag', 'physical_safety', -40, -20),
  ]));
  assert.equal(cal.verdict, 'over_promises');
  assert.equal(cal.meanProjectionError, 20);
  assert.ok(Math.abs(cal.correctionFactor - 0.5) < 1e-9);
  assert.ok(/scale its projected effect/.test(cal.lesson));
});

test('a move that under-promises yields a negative bias and a >1 correction', () => {
  // Modeled −20 but delivered −40 → bias −20, factor ≈ 2.
  const cal = only(calibrateMoveEffects([
    grade('evacuate', 'mobility', -20, -40),
    grade('evacuate', 'mobility', -20, -40),
    grade('evacuate', 'mobility', -20, -40),
  ]));
  assert.equal(cal.verdict, 'under_promises');
  assert.equal(cal.meanProjectionError, -20);
  assert.ok(Math.abs(cal.correctionFactor - 2) < 1e-9);
  assert.ok(/worth more than the board shows/.test(cal.lesson));
});

test('too few episodes report insufficient_data with a neutral correction of 1', () => {
  const rows = calibrateMoveEffects([
    grade('shelter', 'physical_safety', -40, -10),
    grade('shelter', 'physical_safety', -40, -10),
  ]);
  const cal = only(rows);
  assert.ok(cal.sampleCount < MIN_CALIBRATION_SAMPLES);
  assert.equal(cal.verdict, 'insufficient_data');
  assert.equal(cal.correctionFactor, 1); // never correct on thin evidence
  assert.ok(/not enough to calibrate/.test(cal.lesson));
});

test('the correction factor is clamped to [0, 2] for extreme under-promises', () => {
  // Modeled −5 but delivered −60 → raw ratio 12, clamped to 2.
  const cal = only(calibrateMoveEffects([
    grade('generator', 'energy_water', -5, -60),
    grade('generator', 'energy_water', -5, -60),
    grade('generator', 'energy_water', -5, -60),
  ]));
  assert.equal(cal.correctionFactor, 2);
});

test('a move that modeled improvement but on average worsened posture credits zero', () => {
  // Modeled −20 (improve) but posture rose +10 on average → negative ratio → 0.
  const cal = only(calibrateMoveEffects([
    grade('barricade', 'security', -20, 10),
    grade('barricade', 'security', -20, 10),
    grade('barricade', 'security', -20, 10),
  ]));
  assert.equal(cal.correctionFactor, 0);
  assert.equal(cal.verdict, 'over_promises'); // it promised relief it did not deliver
});

test('a move that models no effect on the axis is not force-corrected', () => {
  // Modeled 0 on the axis: ratio is undefined → factor stays 1.
  const cal = only(calibrateMoveEffects([
    grade('note', 'comms', 0, -3),
    grade('note', 'comms', 0, -3),
    grade('note', 'comms', 0, -3),
  ]));
  assert.equal(cal.correctionFactor, 1);
});

test('episodes are grouped independently by move and by axis', () => {
  const rows = calibrateMoveEffects([
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'financial', -10, -5), // same move, different axis
    grade('evacuate', 'mobility', -20, -20),
  ]);
  assert.equal(rows.length, 3); // (shelter,physical_safety) (shelter,financial) (evacuate,mobility)
  const shelterSafety = rows.find((r) => r.moveId === 'shelter' && r.axis === 'physical_safety');
  assert.equal(shelterSafety?.sampleCount, 3);
  const shelterFin = rows.find((r) => r.moveId === 'shelter' && r.axis === 'financial');
  assert.equal(shelterFin?.sampleCount, 1);
});

test('confidence grows with more episodes at equal agreement', () => {
  const few = only(calibrateMoveEffects([
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
  ]));
  const many = only(calibrateMoveEffects(
    Array.from({ length: 12 }, () => grade('shelter', 'physical_safety', -30, -30)),
  ));
  assert.ok(many.confidence > few.confidence);
  assert.ok(many.confidence <= 1);
});

test('disagreeing episodes are less confident than agreeing ones at equal count', () => {
  const agree = only(calibrateMoveEffects([
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
  ]));
  const disagree = only(calibrateMoveEffects([
    grade('shelter', 'physical_safety', -30, -5),
    grade('shelter', 'physical_safety', -30, -55),
    grade('shelter', 'physical_safety', -30, -5),
    grade('shelter', 'physical_safety', -30, -55),
  ]));
  // Same mean error, same count — but the spread should dampen confidence.
  assert.ok(disagree.confidence < agree.confidence);
});

test('the worst-calibrated move sorts first; well-calibrated and thin sink below', () => {
  const rows = calibrateMoveEffects([
    // well-calibrated
    grade('good', 'physical_safety', -30, -30),
    grade('good', 'physical_safety', -30, -30),
    grade('good', 'physical_safety', -30, -30),
    // heavily over-promising (bias +25)
    grade('bad', 'supply', -40, -15),
    grade('bad', 'supply', -40, -15),
    grade('bad', 'supply', -40, -15),
    // insufficient data
    grade('thin', 'health', -40, -10),
  ]);
  assert.equal(rows[0].moveId, 'bad'); // largest bias first
  assert.equal(rows[rows.length - 1].verdict, 'insufficient_data'); // thin last
});

test('applyCalibration scales a modeled delta by the learned factor and keeps its sign', () => {
  const cal = only(calibrateMoveEffects([
    grade('sandbag', 'physical_safety', -40, -20),
    grade('sandbag', 'physical_safety', -40, -20),
    grade('sandbag', 'physical_safety', -40, -20),
  ]));
  // factor 0.5 → a fresh −40 projection becomes −20.
  assert.equal(applyCalibration(-40, cal), -20);
  assert.ok(applyCalibration(-40, cal) < 0); // sign preserved
});

test('applyCalibration leaves a delta unchanged when evidence is insufficient', () => {
  const cal = only(calibrateMoveEffects([
    grade('sandbag', 'physical_safety', -40, -20),
    grade('sandbag', 'physical_safety', -40, -20),
  ]));
  assert.equal(cal.verdict, 'insufficient_data');
  assert.equal(applyCalibration(-40, cal), -40); // factor 1
});

test('applyCalibration coerces a non-finite delta to 0', () => {
  const cal = only(calibrateMoveEffects([
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
  ]));
  assert.equal(applyCalibration(Number.NaN, cal), 0);
  assert.equal(applyCalibration(Number.POSITIVE_INFINITY, cal), 0);
});

test('an empty grade list calibrates to an empty result', () => {
  assert.deepEqual(calibrateMoveEffects([]), []);
});

test('a custom minSamples raises the bar for calling a move calibrated', () => {
  const grades = [
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
    grade('shelter', 'physical_safety', -30, -30),
  ];
  assert.equal(only(calibrateMoveEffects(grades)).verdict, 'well_calibrated'); // default 3
  assert.equal(only(calibrateMoveEffects(grades, { minSamples: 5 })).verdict, 'insufficient_data');
});
