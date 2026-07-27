import assert from 'node:assert/strict';
import test from 'node:test';

import type { PredictionRecord } from '../forecast-calibration.ts';
import {
  buildHierarchicalBaseRatePrediction,
  HIERARCHICAL_BASE_RATE_SOURCE_ID,
} from '../hierarchical-base-rate.ts';

const DAY = 24 * 60 * 60 * 1_000;
const CUTOFF = 100 * DAY;

function outcome(
  index: number,
  resolvedTrue: boolean,
  overrides: Partial<PredictionRecord> = {},
): PredictionRecord {
  return {
    id: `outcome-${index}`,
    sourceId: 'historical-model',
    targetKey: `historical-target-${index}`,
    domain: 'markets',
    claim: 'historical event',
    probability: 0.5,
    predictedAt: index * DAY,
    resolveBy: index * DAY + DAY,
    status: resolvedTrue ? 'resolved_true' : 'resolved_false',
    resolvedAt: index * DAY + DAY,
    ...overrides,
  };
}

function target(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    id: 'target-forecast',
    sourceId: 'analyst-loop',
    targetKey: 'target:event',
    domain: 'weather',
    claim: 'target event',
    probability: 0.8,
    predictedAt: CUTOFF,
    resolveBy: CUTOFF + DAY,
    status: 'pending',
    algorithmVersion: '2.0.0',
    ...overrides,
  };
}

test('base-rate training deduplicates shared targets and excludes future and proxy labels', () => {
  const history = Array.from(
    { length: 30 },
    (_, index) => outcome(index, index % 2 === 0),
  );
  history.push(
    outcome(30, true, {
      id: 'duplicate-model-view',
      targetKey: history[0]!.targetKey,
      resolveBy: history[0]!.resolveBy,
      resolvedAt: history[0]!.resolvedAt,
    }),
    outcome(31, true, {
      resolvedAt: CUTOFF + 1,
    }),
    outcome(32, true, {
      resolutionNote: 'proxy:uncorroborated',
    }),
    outcome(33, true, {
      sourceId: HIERARCHICAL_BASE_RATE_SOURCE_ID,
    }),
    outcome(34, true, {
      predictedAt: CUTOFF + 1,
      resolvedAt: CUTOFF - 1,
    }),
    outcome(35, true, {
      resolutionProvenance: {
        resolverId: 'future-evidence',
        kind: 'direct',
        evidence: [{
          sourceIds: ['future-provider'],
          observedAt: CUTOFF + 1,
          supportsOutcome: true,
        }],
      },
    }),
  );

  const baseline = buildHierarchicalBaseRatePrediction(target(), history);

  assert.ok(baseline);
  assert.equal(baseline.probability, 0.5);
});

test('base-rate training excludes outcomes with invalid historical horizons', () => {
  const history = Array.from(
    { length: 30 },
    (_, index) => outcome(index, index % 2 === 0),
  );
  history.push(
    outcome(30, true, {
      predictedAt: 31 * DAY,
      resolveBy: 31 * DAY - 1,
      resolvedAt: 31 * DAY,
    }),
    outcome(31, true, {
      predictedAt: 32 * DAY,
      resolveBy: Number.NaN,
      resolvedAt: 32 * DAY,
    }),
  );

  const baseline = buildHierarchicalBaseRatePrediction(target(), history);

  assert.ok(baseline);
  assert.equal(baseline.probability, 0.5);
});

test('base rate shrinks domain and horizon evidence through the global prior', () => {
  const history = Array.from({ length: 30 }, (_, index) => {
    if (index < 20) {
      return outcome(index, index < 15, {
        domain: 'weather',
        resolveBy: index * DAY + (index < 10 ? 2 * DAY : 10 * DAY),
        resolvedAt: index * DAY + DAY,
      });
    }
    return outcome(index, false);
  });

  const baseline = buildHierarchicalBaseRatePrediction(
    target({ resolveBy: CUTOFF + 2 * DAY }),
    history,
  );

  assert.ok(baseline);
  assert.ok(Math.abs(baseline.probability - 37 / 44) < 1e-12);
});

test('base rate fails closed for an invalid target horizon', () => {
  const history = Array.from(
    { length: 30 },
    (_, index) => outcome(index, index % 2 === 0),
  );

  assert.equal(
    buildHierarchicalBaseRatePrediction(
      target({ resolveBy: CUTOFF - 1 }),
      history,
    ),
    null,
  );
});

test('sparse domains fall back to the Beta-smoothed global rate', () => {
  const history = Array.from({ length: 30 }, (_, index) => outcome(
    index,
    index < 20,
    index < 4 ? { domain: 'weather' } : {},
  ));

  const baseline = buildHierarchicalBaseRatePrediction(target(), history);

  assert.ok(baseline);
  assert.equal(baseline.probability, 21 / 32);
});
