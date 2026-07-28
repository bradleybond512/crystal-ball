// src/services/survival/__tests__/projection-calibration.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrateProjections,
  applyProjectionCalibration,
  projectionOutcome,
  MIN_PROJECTION_SAMPLES,
} from '../projection-calibration.ts';
import type { ProjectionOutcome } from '../projection-calibration.ts';
import type { AxisProjection, ProjectionDirection } from '../posture-trajectory.ts';
import type { SurvivalAxis } from '../survival-types.ts';

// A resolved projection episode: at `current`, the model projected `projected`
// (with `dir`), and the axis actually reached `actual` at `horizon`.
function outcome(
  axis: SurvivalAxis,
  horizon: string,
  current: number,
  projected: number,
  actual: number,
  dir: ProjectionDirection = 'escalating',
): ProjectionOutcome {
  return {
    axis,
    horizonId: horizon,
    currentLevel: current,
    projectedLevel: projected,
    projectedDirection: dir,
    actualLevel: actual,
  };
}

function only<T>(rows: T[]): T {
  assert.equal(rows.length, 1);
  return rows[0]!;
}

test('a horizon whose projections land on target is well-calibrated with ~0 offset', () => {
  const cal = only(calibrateProjections([
    outcome('physical_safety', '24h', 40, 70, 70),
    outcome('physical_safety', '24h', 45, 72, 74),
    outcome('physical_safety', '24h', 42, 68, 66),
  ]));
  assert.equal(cal.verdict, 'well_calibrated');
  assert.ok(Math.abs(cal.biasOffset) <= 2);
  assert.equal(cal.sampleCount, 3);
  assert.ok(/within tolerance/.test(cal.lesson));
});

test('an axis that runs hotter than projected is flagged under_projects with a positive offset', () => {
  // Projected 55 but actually reached 80 → +25 bias, the dangerous side.
  const cal = only(calibrateProjections([
    outcome('supply', '72h', 30, 55, 80),
    outcome('supply', '72h', 30, 55, 80),
    outcome('supply', '72h', 30, 55, 80),
  ]));
  assert.equal(cal.verdict, 'under_projects');
  assert.equal(cal.meanSignedError, 25);
  assert.equal(cal.biasOffset, 25);
  assert.ok(/under-warns/.test(cal.lesson));
});

test('an axis that comes in cooler than projected is flagged over_projects with a negative offset', () => {
  // Projected 80 but only reached 50 → −30 bias (alarmist).
  const cal = only(calibrateProjections([
    outcome('financial', '24h', 40, 80, 50),
    outcome('financial', '24h', 40, 80, 50),
    outcome('financial', '24h', 40, 80, 50),
  ]));
  assert.equal(cal.verdict, 'over_projects');
  assert.equal(cal.meanSignedError, -30);
  assert.equal(cal.biasOffset, -30);
  assert.ok(/over-warns/.test(cal.lesson));
});

test('too few episodes report insufficient_data with a neutral offset of 0', () => {
  const rows = calibrateProjections([
    outcome('health', '6h', 20, 40, 90),
    outcome('health', '6h', 20, 40, 90),
  ]);
  const cal = only(rows);
  assert.ok(cal.sampleCount < MIN_PROJECTION_SAMPLES);
  assert.equal(cal.verdict, 'insufficient_data');
  assert.equal(cal.biasOffset, 0); // never correct on thin evidence
  assert.ok(/not enough to trust/.test(cal.lesson));
});

test('episodes are grouped independently by axis and by horizon', () => {
  const rows = calibrateProjections([
    outcome('physical_safety', '6h', 40, 50, 50),
    outcome('physical_safety', '6h', 40, 50, 50),
    outcome('physical_safety', '6h', 40, 50, 50),
    outcome('physical_safety', '72h', 40, 50, 90), // same axis, different horizon
    outcome('mobility', '6h', 30, 40, 40),
  ]);
  assert.equal(rows.length, 3);
  const near = rows.find((r) => r.axis === 'physical_safety' && r.horizonId === '6h');
  assert.equal(near?.sampleCount, 3);
  const far = rows.find((r) => r.axis === 'physical_safety' && r.horizonId === '72h');
  assert.equal(far?.sampleCount, 1);
});

test('directional hit rate counts episodes whose projected direction matched reality', () => {
  // Projected escalating each time; two actually escalated (40→70), one held (40→41).
  const cal = only(calibrateProjections([
    outcome('security', '24h', 40, 70, 70, 'escalating'),
    outcome('security', '24h', 40, 70, 72, 'escalating'),
    outcome('security', '24h', 40, 70, 41, 'escalating'), // realized steady → miss
  ]));
  assert.ok(Math.abs(cal.directionalHitRate - 2 / 3) < 1e-9);
});

test('a projected easing that actually escalates is a directional miss', () => {
  const cal = only(calibrateProjections([
    outcome('comms', '24h', 60, 40, 85, 'easing'),
    outcome('comms', '24h', 60, 40, 85, 'easing'),
    outcome('comms', '24h', 60, 40, 85, 'easing'),
  ]));
  assert.equal(cal.directionalHitRate, 0); // called easing, posture escalated
});

test('mean absolute error captures sharpness even when signed bias cancels', () => {
  // +20 and −20 cancel to 0 signed bias, but the projections were each off by 20.
  const cal = only(calibrateProjections([
    outcome('energy_water', '24h', 40, 60, 80),
    outcome('energy_water', '24h', 40, 60, 40),
    outcome('energy_water', '24h', 40, 60, 60),
  ]));
  assert.ok(Math.abs(cal.meanSignedError) < 1e-9); // bias cancels
  assert.ok(Math.abs(cal.meanAbsError - 40 / 3) < 1e-9); // (20 + 20 + 0) / 3
  assert.equal(cal.verdict, 'well_calibrated'); // no consistent directional bias
});

test('confidence grows with more episodes at equal agreement', () => {
  const few = only(calibrateProjections([
    outcome('supply', '24h', 30, 55, 80),
    outcome('supply', '24h', 30, 55, 80),
    outcome('supply', '24h', 30, 55, 80),
  ]));
  const many = only(calibrateProjections(
    Array.from({ length: 12 }, () => outcome('supply', '24h', 30, 55, 80)),
  ));
  assert.ok(many.confidence > few.confidence);
  assert.ok(many.confidence <= 1);
});

test('disagreeing episodes are less confident than agreeing ones at equal count', () => {
  const agree = only(calibrateProjections([
    outcome('supply', '24h', 30, 55, 80),
    outcome('supply', '24h', 30, 55, 80),
    outcome('supply', '24h', 30, 55, 80),
    outcome('supply', '24h', 30, 55, 80),
  ]));
  const disagree = only(calibrateProjections([
    outcome('supply', '24h', 30, 55, 60),
    outcome('supply', '24h', 30, 55, 100),
    outcome('supply', '24h', 30, 55, 60),
    outcome('supply', '24h', 30, 55, 100),
  ]));
  // Same mean error (+25), same count — spread should dampen confidence.
  assert.ok(disagree.confidence < agree.confidence);
});

test('the most dangerous miscalibration sorts first; under-projection outranks equal over-projection', () => {
  const rows = calibrateProjections([
    // over-projection, bias −20
    outcome('financial', '24h', 40, 80, 60),
    outcome('financial', '24h', 40, 80, 60),
    outcome('financial', '24h', 40, 80, 60),
    // under-projection, same magnitude bias +20 → should rank ABOVE the over-projection
    outcome('supply', '24h', 30, 50, 70),
    outcome('supply', '24h', 30, 50, 70),
    outcome('supply', '24h', 30, 50, 70),
    // well-calibrated
    outcome('mobility', '24h', 40, 50, 50),
    outcome('mobility', '24h', 40, 50, 50),
    outcome('mobility', '24h', 40, 50, 50),
    // insufficient
    outcome('health', '24h', 40, 50, 90),
  ]);
  assert.equal(rows[0]!.axis, 'supply'); // under_projects, equal magnitude, ranks first
  assert.equal(rows[1]!.axis, 'financial'); // over_projects next
  assert.equal(rows[rows.length - 1]!.verdict, 'insufficient_data'); // thin last
});

test('applyProjectionCalibration adds the learned offset and clamps to [0, 100]', () => {
  const cal = only(calibrateProjections([
    outcome('supply', '72h', 30, 55, 80),
    outcome('supply', '72h', 30, 55, 80),
    outcome('supply', '72h', 30, 55, 80),
  ]));
  assert.equal(cal.biasOffset, 25);
  assert.equal(applyProjectionCalibration(55, cal), 80); // 55 + 25
  assert.equal(applyProjectionCalibration(90, cal), 100); // 90 + 25 clamped
});

test('applyProjectionCalibration leaves a projection unchanged when evidence is insufficient', () => {
  const cal = only(calibrateProjections([
    outcome('supply', '72h', 30, 55, 80),
    outcome('supply', '72h', 30, 55, 80),
  ]));
  assert.equal(cal.verdict, 'insufficient_data');
  assert.equal(applyProjectionCalibration(55, cal), 55); // offset 0
});

test('applyProjectionCalibration coerces a non-finite projection to 0', () => {
  const cal = only(calibrateProjections([
    outcome('physical_safety', '24h', 40, 70, 70),
    outcome('physical_safety', '24h', 40, 70, 70),
    outcome('physical_safety', '24h', 40, 70, 70),
  ]));
  assert.equal(applyProjectionCalibration(Number.NaN, cal), 0);
  assert.equal(applyProjectionCalibration(Number.POSITIVE_INFINITY, cal), 0);
});

test('non-finite and out-of-range levels are sanitized before calibration', () => {
  // Over-range 130 clamps to 100; a non-finite reading is not finite → coerced to 0.
  const cal = only(calibrateProjections([
    outcome('security', '6h', 40, 90, 130), // actual 130 → 100
    outcome('security', '6h', 40, 90, Number.POSITIVE_INFINITY), // → 0
    outcome('security', '6h', 40, 90, 50),
  ]));
  assert.equal(cal.meanProjectedLevel, 90);
  assert.ok(Math.abs(cal.meanActualLevel - (100 + 0 + 50) / 3) < 1e-9);
});

test('an empty outcome list calibrates to an empty result', () => {
  assert.deepEqual(calibrateProjections([]), []);
});

test('projectionOutcome pairs a live AxisProjection with an observed level', () => {
  const projection: AxisProjection = {
    axis: 'physical_safety',
    horizonId: '24h',
    horizonMins: 1440,
    currentLevel: 40,
    projectedLevel: 72,
    projectedBand: 'elevated',
    delta: 32,
    direction: 'escalating',
    confidence: 0.72,
    drivers: ['storm arriving in ~18h'],
    rationale: 'x',
  };
  const o = projectionOutcome(projection, 88);
  assert.equal(o.axis, 'physical_safety');
  assert.equal(o.horizonId, '24h');
  assert.equal(o.currentLevel, 40);
  assert.equal(o.projectedLevel, 72);
  assert.equal(o.projectedDirection, 'escalating');
  assert.equal(o.actualLevel, 88);
});

test('a custom tolerance tightens what counts as calibrated', () => {
  const outcomes = [
    outcome('supply', '24h', 30, 55, 62), // +7 bias
    outcome('supply', '24h', 30, 55, 62),
    outcome('supply', '24h', 30, 55, 62),
  ];
  assert.equal(only(calibrateProjections(outcomes)).verdict, 'well_calibrated'); // default tol 8
  assert.equal(only(calibrateProjections(outcomes, { toleranceLevels: 5 })).verdict, 'under_projects');
});
