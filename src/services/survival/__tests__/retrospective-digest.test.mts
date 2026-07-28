// src/services/survival/__tests__/retrospective-digest.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRetrospectiveDigest } from '../retrospective-digest.ts';
import type { MoveEffectCalibration, CalibrationVerdict } from '../posture-calibration.ts';
import type {
  ProjectionCalibration,
  ProjectionCalibrationVerdict,
} from '../projection-calibration.ts';
import type { SurvivalAxis } from '../survival-types.ts';

// Minimal valid MoveEffectCalibration; `error` drives verdict + miss magnitude.
function moveCal(
  moveId: string,
  axis: SurvivalAxis,
  verdict: CalibrationVerdict,
  error: number,
  over: Partial<MoveEffectCalibration> = {},
): MoveEffectCalibration {
  return {
    moveId,
    axis,
    sampleCount: 5,
    meanProjectedDelta: -30,
    meanActualDelta: -30 + error,
    meanProjectionError: error,
    correctionFactor: 1,
    confidence: 0.7,
    verdict,
    lesson: `move-lesson:${moveId}`,
    ...over,
  };
}

// Minimal valid ProjectionCalibration; `error` drives verdict + miss magnitude.
function projCal(
  axis: SurvivalAxis,
  horizonId: string,
  verdict: ProjectionCalibrationVerdict,
  error: number,
  over: Partial<ProjectionCalibration> = {},
): ProjectionCalibration {
  return {
    axis,
    horizonId,
    sampleCount: 5,
    meanProjectedLevel: 50,
    meanActualLevel: 50 + error,
    meanSignedError: error,
    meanAbsError: Math.abs(error),
    biasOffset: Math.round(error),
    directionalHitRate: 0.8,
    confidence: 0.7,
    verdict,
    lesson: `proj-lesson:${axis}:${horizonId}`,
    ...over,
  };
}

test('empty inputs produce no lessons and a nothing-to-learn headline', () => {
  const d = buildRetrospectiveDigest([], []);
  assert.deepEqual(d.lessons, []);
  assert.equal(d.summary.totalCalibrations, 0);
  assert.equal(d.summary.actionableLessons, 0);
  assert.equal(d.summary.meanLessonConfidence, 0);
  assert.ok(/nothing to learn/i.test(d.headline));
});

test('over_promises and under_projects both normalize to overconfident (the dangerous side)', () => {
  const d = buildRetrospectiveDigest(
    [moveCal('shelter', 'physical_safety', 'over_promises', 18)],
    [projCal('supply', '72h', 'under_projects', 22)],
  );
  assert.equal(d.summary.overconfident, 2);
  assert.equal(d.summary.underconfident, 0);
  assert.equal(d.lessons.length, 2);
  assert.ok(d.lessons.every((l) => l.biasKind === 'overconfident'));
});

test('under_promises and over_projects both normalize to underconfident (benign)', () => {
  const d = buildRetrospectiveDigest(
    [moveCal('evacuate', 'mobility', 'under_promises', -14)],
    [projCal('financial', '24h', 'over_projects', -12)],
  );
  assert.equal(d.summary.underconfident, 2);
  assert.equal(d.summary.overconfident, 0);
  assert.ok(d.lessons.every((l) => l.biasKind === 'underconfident'));
});

test('well_calibrated and insufficient_data are counted but excluded from lessons', () => {
  const d = buildRetrospectiveDigest(
    [
      moveCal('a', 'supply', 'well_calibrated', 2),
      moveCal('b', 'supply', 'insufficient_data', 40, { sampleCount: 1 }),
    ],
    [
      projCal('health', '6h', 'well_calibrated', 1),
      projCal('comms', '6h', 'insufficient_data', 50, { sampleCount: 1 }),
    ],
  );
  assert.equal(d.lessons.length, 0);
  assert.equal(d.summary.totalCalibrations, 4);
  assert.equal(d.summary.wellCalibrated, 2);
  assert.equal(d.summary.insufficientData, 2);
  assert.ok(/Nothing miscalibrated/.test(d.headline));
});

test('overconfident outranks equal-magnitude underconfident', () => {
  const d = buildRetrospectiveDigest(
    [
      moveCal('benign', 'mobility', 'under_promises', -20, { confidence: 0.7 }),
      moveCal('danger', 'supply', 'over_promises', 20, { confidence: 0.7 }),
    ],
    [],
  );
  assert.ok(d.lessons[0]!.subject.startsWith('danger'));
  assert.equal(d.lessons[0]!.biasKind, 'overconfident');
  assert.equal(d.lessons[1]!.biasKind, 'underconfident');
});

test('among same bias kind, the larger miss ranks first', () => {
  const d = buildRetrospectiveDigest(
    [
      moveCal('small', 'supply', 'over_promises', 12, { confidence: 0.7 }),
      moveCal('big', 'supply', 'over_promises', 28, { confidence: 0.7 }),
    ],
    [],
  );
  assert.ok(d.lessons[0]!.subject.startsWith('big'));
  assert.ok(d.lessons[1]!.subject.startsWith('small'));
});

test('at equal miss and bias kind, higher confidence ranks first', () => {
  const d = buildRetrospectiveDigest(
    [
      moveCal('unsure', 'supply', 'over_promises', 18, { confidence: 0.2 }),
      moveCal('sure', 'security', 'over_promises', 18, { confidence: 0.9 }),
    ],
    [],
  );
  assert.ok(d.lessons[0]!.subject.startsWith('sure'));
  assert.ok(d.lessons[1]!.subject.startsWith('unsure'));
});

test('severity bands follow miss magnitude', () => {
  const d = buildRetrospectiveDigest(
    [
      moveCal('crit', 'supply', 'over_promises', 25),
      moveCal('note', 'mobility', 'over_promises', 15),
      moveCal('min', 'security', 'over_promises', 6),
    ],
    [],
  );
  const bySubject = Object.fromEntries(d.lessons.map((l) => [l.subject.split(' · ')[0], l.severity]));
  assert.equal(bySubject['crit'], 'critical');
  assert.equal(bySubject['note'], 'notable');
  assert.equal(bySubject['min'], 'minor');
});

test('move subjects read "<moveId> · <axis label>"', () => {
  const d = buildRetrospectiveDigest(
    [moveCal('shelter-interior-room', 'physical_safety', 'over_promises', 15)],
    [],
  );
  assert.equal(d.lessons[0]!.subject, 'shelter-interior-room · Physical safety');
  assert.equal(d.lessons[0]!.source, 'move_effect');
});

test('projection subjects read "<axis label> · <horizon>"', () => {
  const d = buildRetrospectiveDigest([], [projCal('energy_water', '48h', 'under_projects', 15)]);
  assert.equal(d.lessons[0]!.subject, 'Energy & water · 48h');
  assert.equal(d.lessons[0]!.source, 'projection');
});

test('the underlying lesson text is carried through verbatim', () => {
  const d = buildRetrospectiveDigest(
    [moveCal('m', 'supply', 'over_promises', 15, { lesson: 'scale it down by 0.60' })],
    [projCal('supply', '24h', 'under_projects', 15, { lesson: 'add +15 before trusting the calm read' })],
  );
  const move = d.lessons.find((l) => l.source === 'move_effect');
  const proj = d.lessons.find((l) => l.source === 'projection');
  assert.equal(move?.lesson, 'scale it down by 0.60');
  assert.equal(proj?.lesson, 'add +15 before trusting the calm read');
});

test('mean lesson confidence averages only the actionable lessons', () => {
  const d = buildRetrospectiveDigest(
    [
      moveCal('a', 'supply', 'over_promises', 15, { confidence: 0.4 }),
      moveCal('b', 'mobility', 'under_promises', -15, { confidence: 0.8 }),
      moveCal('c', 'security', 'well_calibrated', 1, { confidence: 0.99 }), // excluded
    ],
    [],
  );
  assert.ok(Math.abs(d.summary.meanLessonConfidence - (0.4 + 0.8) / 2) < 1e-9);
});

test('the headline names the biggest miss and flags overconfident reads', () => {
  const d = buildRetrospectiveDigest(
    [moveCal('shelter', 'physical_safety', 'over_promises', 27)],
    [projCal('supply', '72h', 'over_projects', -11)],
  );
  assert.ok(/2 calibration lessons/.test(d.headline));
  assert.ok(/1 where the board's read was overconfident/.test(d.headline));
  assert.ok(/Biggest miss: shelter · Physical safety \(27 pts\)/.test(d.headline));
});

test('minMissMagnitude drops small misses below the floor', () => {
  const d = buildRetrospectiveDigest(
    [
      moveCal('tiny', 'supply', 'over_promises', 7),
      moveCal('real', 'security', 'over_promises', 22),
    ],
    [],
    { minMissMagnitude: 10 },
  );
  assert.equal(d.lessons.length, 1);
  assert.ok(d.lessons[0]!.subject.startsWith('real'));
});

test('non-finite calibration fields are sanitized, not propagated as NaN', () => {
  const d = buildRetrospectiveDigest(
    [moveCal('m', 'supply', 'over_promises', Number.NaN, { confidence: Number.POSITIVE_INFINITY })],
    [],
  );
  assert.equal(d.lessons.length, 1);
  const l = d.lessons[0]!;
  assert.equal(Number.isFinite(l.missMagnitude), true);
  assert.equal(Number.isFinite(l.confidence), true);
  assert.equal(Number.isFinite(l.priority), true);
  assert.ok(l.confidence <= 1);
});
