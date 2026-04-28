import assert from 'node:assert/strict';
import test from 'node:test';

import {
  proposeAdjustments,
  type AlgorithmAdjustmentTuning,
  type TunableParameter,
} from '../safe-adjustment.ts';
import type { AlgorithmHealth } from '../algorithm-health.ts';

const NOW = 1_745_000_000_000;

function health(overrides: Partial<AlgorithmHealth> = {}): AlgorithmHealth {
  return {
    algorithmId: 'weather-polygon-v1',
    label: 'Weather polygon match',
    domain: 'weather_polygon',
    criticality: 'safety',
    status: 'failing',
    reason: 'Weighted hit rate 60% is below the 85% floor.',
    recommendedAdjustment: 'Verify saved-place coords.',
    ...overrides,
  };
}

function tuning(parameters: TunableParameter[]): AlgorithmAdjustmentTuning {
  return { algorithmId: 'weather-polygon-v1', parameters };
}

const baseParam: TunableParameter = {
  parameterId: 'polygon-buffer-km',
  current: 5,
  min: 0,
  max: 25,
  step: 2,
  fixDirection: 'increase',
  description: 'Buffer radius around saved-place polygon',
};

// ── Apply path ─────────────────────────────────────────────────────────

test('apply: safety algorithm gets a half-step in the fix direction', () => {
  const proposals = proposeAdjustments(
    { reports: [health()], tunings: [tuning([baseParam])] },
    { now: () => NOW },
  );
  const p = proposals[0]!;
  assert.equal(p.verdict, 'apply');
  assert.equal(p.parameterId, 'polygon-buffer-km');
  assert.equal(p.priorValue, 5);
  // Safety half-step of 2 = 1; current 5 → 6
  assert.equal(p.nextValue, 6);
  assert.equal(p.direction, 'increase');
  assert.match(p.rollback ?? '', /Restore polygon-buffer-km to 5/);
});

test('apply: non-safety algorithm gets a full step', () => {
  const proposals = proposeAdjustments(
    {
      reports: [health({ criticality: 'medium', status: 'degraded' })],
      tunings: [tuning([baseParam])],
    },
    { now: () => NOW },
  );
  const p = proposals[0]!;
  assert.equal(p.verdict, 'apply');
  assert.equal(p.priorValue, 5);
  assert.equal(p.nextValue, 7); // full step of 2
});

test('apply: fixDirection=decrease moves the parameter down', () => {
  const param: TunableParameter = {
    parameterId: 'relevance-threshold',
    current: 0.7,
    min: 0.1,
    max: 1,
    step: 0.05,
    fixDirection: 'decrease',
    description: 'Watchlist relevance threshold',
  };
  const proposals = proposeAdjustments(
    {
      reports: [health({ criticality: 'medium', domain: 'watchlist_relevance', status: 'degraded' })],
      tunings: [{ algorithmId: 'weather-polygon-v1', parameters: [param] }],
    },
    { now: () => NOW },
  );
  const p = proposals[0]!;
  assert.equal(p.verdict, 'apply');
  assert.ok(Math.abs((p.nextValue ?? 0) - 0.65) < 1e-9);
});

// ── At-bound + clamping ───────────────────────────────────────────────

test('at_bound: parameter already at maximum returns at_bound verdict', () => {
  const param: TunableParameter = { ...baseParam, current: 25 };
  const proposals = proposeAdjustments(
    { reports: [health()], tunings: [tuning([param])] },
    { now: () => NOW },
  );
  const p = proposals[0]!;
  assert.equal(p.verdict, 'at_bound');
  assert.equal(p.priorValue, 25);
  assert.match(p.rationale, /maximum safe bound/);
});

test('at_bound: parameter already at minimum (decrease direction)', () => {
  const param: TunableParameter = {
    parameterId: 'threshold',
    current: 0.1,
    min: 0.1,
    max: 1,
    step: 0.05,
    fixDirection: 'decrease',
    description: 'X',
  };
  const proposals = proposeAdjustments(
    {
      reports: [health({ criticality: 'medium', status: 'degraded' })],
      tunings: [{ algorithmId: 'weather-polygon-v1', parameters: [param] }],
    },
    { now: () => NOW },
  );
  assert.equal(proposals[0]?.verdict, 'at_bound');
});

// ── No-op + manual_review + no_tunable ─────────────────────────────────

test('noop: healthy algorithm produces no adjustment', () => {
  const proposals = proposeAdjustments(
    { reports: [health({ status: 'healthy' })], tunings: [tuning([baseParam])] },
    { now: () => NOW },
  );
  assert.equal(proposals[0]?.verdict, 'noop');
});

test('noop: unknown algorithm produces no adjustment', () => {
  const proposals = proposeAdjustments(
    { reports: [health({ status: 'unknown' })], tunings: [tuning([baseParam])] },
    { now: () => NOW },
  );
  assert.equal(proposals[0]?.verdict, 'noop');
});

test('manual_review: unsafe algorithm refuses auto-tune', () => {
  const proposals = proposeAdjustments(
    { reports: [health({ status: 'unsafe' })], tunings: [tuning([baseParam])] },
    { now: () => NOW },
  );
  assert.equal(proposals[0]?.verdict, 'manual_review');
  assert.match(proposals[0]?.rationale ?? '', /Quarantine|too risky/);
});

test('no_tunable: failing algorithm without tunables surfaces as no_tunable', () => {
  const proposals = proposeAdjustments(
    { reports: [health()], tunings: [] },
    { now: () => NOW },
  );
  assert.equal(proposals[0]?.verdict, 'no_tunable');
});

// ── Predicted effect language ──────────────────────────────────────────

test('predictedEffect mentions safety half-step caveat for safety criticality', () => {
  const proposals = proposeAdjustments(
    { reports: [health()], tunings: [tuning([baseParam])] },
    { now: () => NOW },
  );
  assert.match(proposals[0]?.predictedEffect ?? '', /safety half-step/);
});

test('predictedEffect for non-safety has no half-step note', () => {
  const proposals = proposeAdjustments(
    {
      reports: [health({ criticality: 'medium', status: 'degraded' })],
      tunings: [tuning([baseParam])],
    },
    { now: () => NOW },
  );
  assert.doesNotMatch(proposals[0]?.predictedEffect ?? '', /half-step/);
});

// ── Multiple algorithms ────────────────────────────────────────────────

test('proposes one outcome per report', () => {
  const reports: AlgorithmHealth[] = [
    health({ algorithmId: 'a', status: 'failing' }),
    health({ algorithmId: 'b', status: 'healthy' }),
    health({ algorithmId: 'c', status: 'unsafe' }),
  ];
  const tunings: AlgorithmAdjustmentTuning[] = [
    { algorithmId: 'a', parameters: [baseParam] },
  ];
  const proposals = proposeAdjustments({ reports, tunings }, { now: () => NOW });
  assert.equal(proposals.length, 3);
  assert.equal(proposals[0]?.verdict, 'apply');
  assert.equal(proposals[1]?.verdict, 'noop');
  assert.equal(proposals[2]?.verdict, 'manual_review');
});

// ── JSON serializability ───────────────────────────────────────────────

test('proposals are JSON-serializable', () => {
  const proposals = proposeAdjustments(
    { reports: [health()], tunings: [tuning([baseParam])] },
    { now: () => NOW },
  );
  const json = JSON.stringify(proposals);
  const parsed = JSON.parse(json) as { verdict: string }[];
  assert.equal(parsed[0]?.verdict, 'apply');
});
