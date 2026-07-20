import assert from 'node:assert/strict';
import test from 'node:test';

import {
  prioritizeAlerts,
  calibrationAdjusterFromReport,
} from '../alert-prioritization.ts';
import type { AlertSignal } from '../alert-prioritization.ts';
import { buildCalibrationReport } from '../calibration-report.ts';
import type { PredictionRecord } from '../forecast-calibration.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;

function alert(overrides: Partial<AlertSignal>): AlertSignal {
  return { id: 'a', probability: 0.8, impact: 50, ...overrides };
}

// ── Expected-value scoring ───────────────────────────────────────────────────

test('score is expected severity × urgency on a 0..100 scale', () => {
  // impact 100, p 1.0, imminent → 100.
  const [top] = prioritizeAlerts([alert({ impact: 100, probability: 1, timeToDeadlineMs: 0 })]);
  assert.equal(top!.score, 100);
  assert.equal(top!.recommendation, 'act_now');
});

test('a high-impact low-probability alert ranks below a moderate sure thing', () => {
  const ranked = prioritizeAlerts([
    alert({ id: 'unlikely-catastrophe', impact: 100, probability: 0.05, timeToDeadlineMs: 0 }),
    alert({ id: 'likely-moderate', impact: 50, probability: 0.95, timeToDeadlineMs: 0 }),
  ]);
  assert.equal(ranked[0]!.id, 'likely-moderate');
  assert.equal(ranked[1]!.id, 'unlikely-catastrophe');
});

test('time-criticality lifts an imminent alert above a distant equal one', () => {
  const ranked = prioritizeAlerts([
    alert({ id: 'distant', timeToDeadlineMs: 2 * DAY }),
    alert({ id: 'imminent', timeToDeadlineMs: 10 * 60_000 }),
  ]);
  assert.equal(ranked[0]!.id, 'imminent');
  assert.ok(ranked[0]!.score > ranked[1]!.score);
});

test('no deadline → baseline time-criticality, not zero', () => {
  const [a] = prioritizeAlerts([alert({ impact: 100, probability: 1 })], { baselineTimeCriticality: 0.3 });
  assert.equal(a!.components.timeCriticality, 0.3);
  assert.equal(a!.score, 30);
});

test('past deadline is treated as maximally urgent', () => {
  const [a] = prioritizeAlerts([alert({ impact: 100, probability: 1, timeToDeadlineMs: -5 * 60_000 })]);
  assert.equal(a!.components.timeCriticality, 1);
});

test('linear urgency ramp between urgent and not-urgent horizons', () => {
  // Halfway between 1h and 24h, baseline 0 → ~0.5 urgency.
  const mid = (HOUR + DAY) / 2;
  const [a] = prioritizeAlerts([alert({ timeToDeadlineMs: mid })], {
    baselineTimeCriticality: 0,
  });
  assert.ok(Math.abs(a!.components.timeCriticality - 0.5) < 0.02, `${a!.components.timeCriticality}`);
});

test('recommendation ladder maps score → tier', () => {
  const ranked = prioritizeAlerts([
    alert({ id: 'act', impact: 100, probability: 1, timeToDeadlineMs: 0 }),       // 100
    alert({ id: 'prep', impact: 60, probability: 0.6, timeToDeadlineMs: 0 }),     // 36
    alert({ id: 'mon', impact: 40, probability: 0.3, timeToDeadlineMs: 0 }),      // 12
    alert({ id: 'sup', impact: 10, probability: 0.1, timeToDeadlineMs: 0 }),      // 1
  ]);
  const byId = new Map(ranked.map((r) => [r.id, r.recommendation] as const));
  assert.equal(byId.get('act'), 'act_now');
  assert.equal(byId.get('prep'), 'prepare');
  assert.equal(byId.get('mon'), 'monitor');
  assert.equal(byId.get('sup'), 'suppress');
});

test('explanation carries expected severity, urgency, and provenance', () => {
  const [a] = prioritizeAlerts([
    alert({ impact: 70, probability: 0.6, timeToDeadlineMs: 25 * 60_000, provenance: ['NWS', 'radar'] }),
  ]);
  assert.match(a!.explanation, /Expected severity/);
  assert.match(a!.explanation, /sources: NWS, radar/);
  assert.match(a!.explanation, /deadline in 25m/);
});

test('degenerate inputs: non-finite impact/probability do not crash or NaN', () => {
  const [a] = prioritizeAlerts([alert({ impact: Number.NaN, probability: Number.POSITIVE_INFINITY })]);
  assert.ok(Number.isFinite(a!.score));
  assert.equal(a!.components.impact, 0);
});

test('stable sort: equal scores keep input order', () => {
  const ranked = prioritizeAlerts([
    alert({ id: 'first', timeToDeadlineMs: 0 }),
    alert({ id: 'second', timeToDeadlineMs: 0 }),
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ['first', 'second']);
});

// ── Calibration-driven de-biasing ────────────────────────────────────────────

let seq = 0;
function rec(overrides: Partial<PredictionRecord>): PredictionRecord {
  seq += 1;
  return {
    id: `p-${seq}`,
    sourceId: 'src',
    domain: 'macro',
    claim: 'c',
    probability: 0.9,
    predictedAt: 0,
    resolveBy: 1,
    status: 'pending',
    ...overrides,
  };
}

test('calibrationAdjusterFromReport shrinks an overconfident source before ranking', () => {
  // 'hype' predicts 0.9 but only 50% come true → overconfident, positive bias.
  const records: PredictionRecord[] = [];
  for (let i = 0; i < 20; i += 1) {
    records.push(rec({ sourceId: 'hype', probability: 0.9, status: i < 10 ? 'resolved_true' : 'resolved_false' }));
  }
  const report = buildCalibrationReport(records, { minResolvedForVerdict: 10 });
  const adjuster = calibrationAdjusterFromReport(report);

  const ranked = prioritizeAlerts(
    [
      alert({ id: 'hype-alert', sourceId: 'hype', probability: 0.9, impact: 60, timeToDeadlineMs: 0 }),
      alert({ id: 'honest-alert', sourceId: 'unknown', probability: 0.7, impact: 60, timeToDeadlineMs: 0 }),
    ],
    { adjuster },
  );
  const hype = ranked.find((r) => r.id === 'hype-alert')!;
  // Raw 0.9 was de-biased downward (bias ~ +0.4 → ~0.5).
  assert.ok(hype.components.calibratedProbability < 0.9);
  assert.ok(hype.components.calibratedProbability < hype.components.rawProbability);
  assert.match(hype.explanation, /calibrated from raw/);
});

test('calibrationAdjusterFromReport leaves insufficient-data groups untouched', () => {
  const report = buildCalibrationReport([rec({ sourceId: 'thin', status: 'resolved_true' })], {
    minResolvedForVerdict: 10,
  });
  const adjuster = calibrationAdjusterFromReport(report);
  assert.equal(adjuster(0.8, { sourceId: 'thin' }), 0.8);
  assert.equal(adjuster(0.8, { sourceId: 'never-seen' }), 0.8);
});
