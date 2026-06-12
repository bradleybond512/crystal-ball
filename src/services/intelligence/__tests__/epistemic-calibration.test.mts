import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gradeMetaConfidenceOnResolution,
  registerConfirmedCounterfactual,
  wireEpistemicCalibration,
  COUNTERFACTUAL_ASSUMPTION_TTL_MS,
  META_CONFIDENCE_ALGORITHM_ID,
} from '../epistemic-calibration.ts';
import {
  MetaConfidenceService,
  __internals as metaInternals,
  type EstimateInput,
  type MetaConfidenceEstimate,
} from '../meta-confidence.ts';
import { AssumptionTrackerService } from '../assumption-tracker-v2.ts';
import { SituationLifecycleTrackerService } from '../situation-lifecycle-tracker.ts';
import type { ObservationEvent } from '../observation-adapters.ts';
import type { EvaluationRecord } from '../../algorithms/algorithm-evaluation-ledger.ts';

const NOW = 1_750_000_000_000;
const BIAS_DAMPING_FACTOR = metaInternals.BIAS_DAMPING_FACTOR;

function makeObs(domain: string, id: string): ObservationEvent {
  return {
    id,
    sourceId: `src-${domain}`,
    domain,
    timestamp: NOW,
    severity: 'HIGH',
    title: `${domain} signal`,
    raw: null,
    entityIds: [],
    tags: [],
  };
}

function baseEstimateInput(): EstimateInput {
  return {
    targetId: 'sit-1',
    targetType: 'situation',
    reportedConfidence: 0.8,
    observations: [
      makeObs('weather', 'o-1'),
      makeObs('cyber', 'o-2'),
      makeObs('maritime', 'o-3'),
      makeObs('aviation', 'o-4'),
    ],
  };
}

function makeFakeEstimate(metaConfidence: number): MetaConfidenceEstimate {
  return {
    targetId: 'sit-1',
    targetType: 'situation',
    reportedConfidence: 0.8,
    metaConfidence,
    reliability: 'moderate',
    evidenceBreadth: 0.4,
    evidenceConsistency: 1,
    temporalStability: 0.5,
    sampleSize: 4,
    confidenceInterval: [0.7, 0.9],
    explanation: 'fake',
    computedAt: new Date(NOW),
  };
}

test('situation resolution triggers a meta-confidence evaluation record', () => {
  const lifecycleTracker = new SituationLifecycleTrackerService({
    storage: null,
    now: () => NOW,
  });
  const metaService = {
    getEstimate: (id: string) =>
      id === 'sit-1' ? makeFakeEstimate(0.64) : undefined,
  };
  const recorded: Array<{ algorithmId: string; score?: number }> = [];
  const recordEvaluation = ((algorithmId: string, input: { score?: number }) => {
    recorded.push({ algorithmId, score: input.score });
    return { id: `eval-${recorded.length}` } as EvaluationRecord;
  }) as unknown as Parameters<typeof wireEpistemicCalibration>[0]['recordEvaluation'];

  const unsubscribe = wireEpistemicCalibration({
    lifecycleTracker,
    metaService,
    recordEvaluation,
    // resolved situation that genuinely materialized → actual outcome 1.
    resolutionOutcome: () => 1,
  });

  lifecycleTracker.recordTransition('sit-1', 'weather', 'resolved');
  unsubscribe();

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.algorithmId, META_CONFIDENCE_ALGORITHM_ID);
  // deviation = |actual(1) − metaConfidence(0.64)| = 0.36
  assert.ok(Math.abs((recorded[0]!.score ?? -1) - 0.36) < 1e-9);
});

test('grade returns null when no estimate was made for the situation', () => {
  const calls: number[] = [];
  const result = gradeMetaConfidenceOnResolution(
    { situationId: 'never-estimated', actualOutcome: 1 },
    {
      metaService: { getEstimate: () => undefined },
      recordEvaluation: (() => {
        calls.push(1);
        return { id: 'x' } as EvaluationRecord;
      }) as unknown as Parameters<typeof gradeMetaConfidenceOnResolution>[1]['recordEvaluation'],
    },
  );
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test('confirmed counterfactual registers in tracker-v2 with correct 48h TTL', () => {
  const tracker = new AssumptionTrackerService({ storage: null, clock: () => NOW });
  const assumption = registerConfirmedCounterfactual(
    {
      id: 'cf-1',
      situationId: 'sit-9',
      domain: 'weather',
      falsificationCondition: 'Radar feed was stale at assessment time.',
    },
    { tracker, now: () => NOW },
  );

  assert.equal(assumption.label, 'Radar feed was stale at assessment time.');
  assert.equal(assumption.confidence, 'high');
  assert.equal(assumption.algorithmId, 'counterfactual-reasoning');
  assert.equal(assumption.outputId, 'cf-1');
  assert.equal(assumption.domain, 'weather');
  assert.equal(assumption.status, 'active');
  assert.equal(assumption.createdAt, NOW);
  assert.equal(assumption.expiresAt, NOW + COUNTERFACTUAL_ASSUMPTION_TTL_MS);
  assert.equal(assumption.expiresAt! - assumption.createdAt, 48 * 60 * 60 * 1000);

  // The assumption is visible in the active set the lifecycle panel reads.
  const active = tracker.getAssumptions({ status: 'active' });
  assert.equal(active.length, 1);
  assert.equal(active[0]!.id, assumption.id);
});

test('unacknowledged high-severity bias detection reduces the meta estimate by the damping factor', () => {
  const svc = new MetaConfidenceService({ clock: () => NOW });
  const base = svc.estimate(baseEstimateInput());
  const damped = svc.estimate({
    ...baseEstimateInput(),
    targetId: 'sit-2',
    biasDetections: [{ severity: 'alert', acknowledged: false }],
  });

  assert.ok(damped.metaConfidence < base.metaConfidence);
  assert.ok(
    Math.abs(damped.metaConfidence - base.metaConfidence * BIAS_DAMPING_FACTOR) < 1e-3,
    `expected ~${base.metaConfidence * BIAS_DAMPING_FACTOR}, got ${damped.metaConfidence}`,
  );
  assert.match(damped.explanation, /bias detection/);
});

test('acknowledged bias detection does NOT reduce the meta estimate', () => {
  const svc = new MetaConfidenceService({ clock: () => NOW });
  const base = svc.estimate(baseEstimateInput());
  const acknowledged = svc.estimate({
    ...baseEstimateInput(),
    targetId: 'sit-3',
    biasDetections: [{ severity: 'alert', acknowledged: true }],
  });
  assert.equal(acknowledged.metaConfidence, base.metaConfidence);

  // A lower-severity unacknowledged signal also must not damp.
  const warning = svc.estimate({
    ...baseEstimateInput(),
    targetId: 'sit-4',
    biasDetections: [{ severity: 'warning', acknowledged: false }],
  });
  assert.equal(warning.metaConfidence, base.metaConfidence);
});
