import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAlgorithmDiagnosticsSnapshot,
  type BuildAlgorithmDiagnosticsInput,
} from '../algorithm-diagnostics.ts';
import type { PredictionRecord } from '../../intelligence/forecast-calibration.ts';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function baseInput(): BuildAlgorithmDiagnosticsInput {
  return {
    generatedAt: NOW,
    definitions: [
      {
        algorithmId: 'fast-algo',
        label: 'Fast algorithm',
        domain: 'other',
        criticality: 'medium',
        minGradedSamples: 2,
        minWeightedHitRate: 0.5,
        maxMeanDurationMs: 500,
      },
    ],
    records: [
      {
        id: 'eval-1',
        algorithmId: 'fast-algo',
        domain: 'other',
        at: NOW - 2_000,
        durationMs: 10,
        label: 'matched',
        outcome: 'hit',
        outcomeAt: NOW - 1_000,
        outcomeReason: 'confirmed',
        outcomeOrigin: 'direct',
      },
      {
        id: 'eval-2',
        algorithmId: 'fast-algo',
        domain: 'other',
        at: NOW - 1_000,
        durationMs: 30,
        label: 'error',
        outcome: 'miss',
        outcomeAt: NOW,
        outcomeReason: 'rejected',
        outcomeOrigin: 'llm',
      },
    ],
    forecastPredictions: [
      {
        id: 'forecast-1',
        sourceId: 'superforecast',
        domain: 'conflict',
        claim: 'sensitive fixture claim',
        probability: 0.8,
        predictedAt: NOW - 10_000,
        resolveBy: NOW - 5_000,
        status: 'resolved_true',
        resolvedAt: NOW - 6_000,
        criteria: {
          kind: 'market_move',
          symbol: 'AAPL',
          direction: 'up',
          minAbsPct: 3,
          basisPrice: 100,
          basisObservedAt: NOW - 10_000,
        },
        resolutionNote: 'direct:market_move fixture',
        resolutionProvenance: {
          resolverId: 'market-move-v1',
          kind: 'direct',
          evidence: [{
            sourceIds: ['yahoo-finance', 'finnhub'],
            observedAt: NOW - 6_000,
            value: 104,
            supportsOutcome: true,
          }],
        },
      },
      {
        id: 'forecast-2',
        sourceId: 'analyst-loop',
        domain: 'cyber',
        claim: 'another fixture claim',
        probability: 0.6,
        predictedAt: NOW - 8_000,
        resolveBy: NOW - 20 * 60_000,
        status: 'pending',
      },
      {
        id: 'forecast-3',
        sourceId: 'mode-forecast:cyber',
        domain: 'cyber',
        claim: 'expired fixture claim',
        probability: 0.4,
        predictedAt: NOW - 20_000,
        resolveBy: NOW - 10_000,
        status: 'expired',
        resolvedAt: NOW - 9_000,
        resolutionNote: 'unresolved:market-move-v1 no in-window verdict after resolver grace',
      },
    ],
    marketSpotPrices: {
      symbolCount: 4,
      sampleCount: 48,
      latestObservedAt: NOW - 1_000,
      staleSymbolCount: 0,
    },
    weatherReportBatch: {
      reports: [{
        id: 'lsr-1',
        type: 'tornado',
        lat: 35.2,
        lon: -97.4,
        reportedAt: NOW - 2_000,
      }],
      fetchedAt: NOW - 1_000,
      coverageStart: NOW - 24 * 60 * 60_000,
      coverageEnd: NOW - 1_000,
      complete: true,
    },
    persistence: {
      lastLoadStatus: 'ok',
      lastLoadedAt: NOW - 10_000,
      lastSaveStatus: 'ok',
      lastSavedAt: NOW - 500,
      recordCount: 2,
      trimmedCount: 0,
      trimmedGradedCount: 0,
      trimmedPendingCount: 0,
      gradedRecordCount: 2,
      pendingRecordCount: 0,
      oldestPendingAt: null,
      pendingCoverageMs: 0,
      rejectedCount: 0,
      lastError: null,
    },
    tunings: [{
      algorithmId: 'fast-algo',
      parameters: [{
        parameterId: 'threshold',
        current: 0.5,
        min: 0.2,
        max: 0.8,
        step: 0.1,
        fixDirection: 'increase',
        description: 'Decision threshold.',
      }],
    }],
    tuningDecisions: [{
      at: NOW - 500,
      algorithmId: 'fast-algo',
      parameterId: 'threshold',
      priorValue: 0.4,
      nextValue: 0.5,
      kind: 'applied',
      ruleId: 'test-rule',
      reason: 'fixture',
    }],
  };
}

function resolvedForecastsForEvaluation(): PredictionRecord[] {
  return Array.from({ length: 100 }, (_, index) => {
    const goodCohort = index % 2 === 0;
    const outcome = index % 4 < 2;
    const predictedAt = NOW - (100 - index) * DAY;
    return {
      id: `holdout-${index}`,
      sourceId: goodCohort ? 'model-good' : 'model-bad',
      domain: goodCohort ? 'weather' : 'cyber',
      claim: index === 99 ? 'SECRET-CLAIM-DO-NOT-EXPORT' : `claim-${index}`,
      probability: goodCohort
        ? (outcome ? 0.9 : 0.1)
        : (outcome ? 0.1 : 0.9),
      predictedAt,
      resolveBy: predictedAt + (goodCohort ? 2 * HOUR : 2 * DAY),
      status: outcome ? 'resolved_true' : 'resolved_false',
      resolvedAt: predictedAt + HOUR,
      algorithmVersion: 'v1',
      ...(index === 99
        ? {
            criteria: {
              kind: 'warning_verification' as const,
              polygon: {
                rings: [[
                  [-97.123456, 35.654321] as const,
                  [-97.223456, 35.754321] as const,
                  [-97.323456, 35.854321] as const,
                ]],
              },
              reportTypes: ['tornado'],
              sentAt: predictedAt,
            },
            resolutionNote: 'direct: SECRET-RESOLUTION-NOTE',
            resolutionProvenance: {
              resolverId: 'fixture-direct-v1',
              kind: 'direct' as const,
              evidence: [{
                sourceIds: ['fixture-source'],
                observedAt: predictedAt + HOUR,
                reference: 'SECRET-EVIDENCE-REFERENCE',
                supportsOutcome: true,
              }],
            },
          }
        : {
            resolutionProvenance: {
              resolverId: 'fixture-direct-v1',
              kind: 'direct' as const,
              evidence: [{
                sourceIds: ['fixture-source'],
                observedAt: predictedAt + HOUR,
                supportsOutcome: true,
              }],
            },
          }),
    };
  });
}

test('buildAlgorithmDiagnosticsSnapshot joins health, runtime, tuning, and persistence', () => {
  const snapshot = buildAlgorithmDiagnosticsSnapshot(baseInput());

  assert.equal(snapshot.schemaVersion, 1);
  assert.deepEqual(snapshot.ledger, {
    total: 2,
    graded: 2,
    pending: 0,
    lastEvaluationAt: NOW - 1_000,
    outcomeOrigins: {
      direct: 1,
      proxy: 0,
      manual: 0,
      llm: 1,
    },
    persistence: baseInput().persistence,
  });
  assert.equal(snapshot.health.status, 'healthy');
  assert.equal(snapshot.runtime[0]?.totalRuns, 2);
  assert.equal(snapshot.runtime[0]?.errors, 1);
  assert.equal(snapshot.runtime[0]?.latencyMs.p50, 30);
  assert.equal(snapshot.runtime[0]?.latencyMs.p95, 30);
  assert.equal(snapshot.runtime[0]?.latencyMs.max, 30);
  assert.deepEqual(snapshot.forecastCalibration.summary, {
    total: 3,
    resolved: 1,
    pending: 1,
    expired: 1,
    overduePending: 1,
    oldestPendingAt: NOW - 8_000,
    brierScore: 0.04,
    criteriaDeclared: 1,
    directResolved: 1,
    proxyResolved: 0,
    unattributedResolved: 0,
    resolverExpired: 1,
  });
  assert.deepEqual(snapshot.forecastCalibration.resolutionQuality.summary, {
    total: 3,
    resolved: 1,
    resolutionCoverage: 0.333,
    origins: {
      direct: 1,
      proxy: 0,
      manual: 0,
    },
    malformed: 0,
    labelLeakage: 0,
    duplicateOutcomes: 0,
    lateResolutions: 0,
    contradictoryEvidence: 0,
    uncertainProxy: 0,
  });
  assert.deepEqual(
    snapshot.forecastCalibration.resolutionQuality.byDomain.map((row) => ({
      domain: row.domain,
      coverage: row.resolutionCoverage,
      origins: row.origins,
    })),
    [
      {
        domain: 'cyber',
        coverage: 0,
        origins: { direct: 0, proxy: 0, manual: 0 },
      },
      {
        domain: 'conflict',
        coverage: 1,
        origins: { direct: 1, proxy: 0, manual: 0 },
      },
    ],
  );
  assert.deepEqual(snapshot.forecastCalibration.byResolver, [{
    resolverId: 'market-move-v1',
    resolved: 1,
    resolvedTrue: 1,
    resolvedFalse: 0,
    expired: 1,
    lastResolvedAt: NOW - 6_000,
  }]);
  assert.deepEqual(
    snapshot.forecastCalibration.marketSpots,
    baseInput().marketSpotPrices,
  );
  assert.deepEqual(snapshot.forecastCalibration.weatherReports, {
    status: 'fresh',
    reportCount: 1,
    validReportCount: 1,
    invalidReportCount: 0,
    pendingWarningPredictions: 0,
    fetchedAt: NOW - 1_000,
    ageMs: 1_000,
    coverageStart: NOW - 24 * 60 * 60_000,
    coverageEnd: NOW - 1_000,
    complete: true,
  });
  assert.equal(snapshot.forecastCalibration.bySource[0]?.sourceId, 'superforecast');
  assert.doesNotMatch(JSON.stringify(snapshot.forecastCalibration), /sensitive fixture claim/);
  assert.equal(snapshot.tunings[0]?.parameters[0]?.current, 0.5);
  assert.equal(snapshot.recentTuningDecisions[0]?.kind, 'applied');
});

test('buildAlgorithmDiagnosticsSnapshot bounds recent evaluations and omits raw detail', () => {
  const input = baseInput();
  input.records = Array.from({ length: 40 }, (_, index) => ({
    id: `eval-${index}`,
    algorithmId: 'fast-algo',
    domain: 'other',
    at: NOW - (40 - index),
    durationMs: index,
    inputHash: `private-${index}`,
    notes: `raw note ${index}`,
    detail: { raw: `payload-${index}` },
  }));

  const snapshot = buildAlgorithmDiagnosticsSnapshot(input);

  assert.equal(snapshot.recentEvaluations.length, 20);
  assert.equal(snapshot.recentEvaluations[0]?.id, 'eval-39');
  assert.equal('detail' in snapshot.recentEvaluations[0]!, false);
  assert.equal('notes' in snapshot.recentEvaluations[0]!, false);
  assert.equal('inputHash' in snapshot.recentEvaluations[0]!, false);
});

test('forecast evaluation diagnostics expose bounded leakage-safe holdout cohorts', () => {
  const input = baseInput();
  input.forecastPredictions = resolvedForecastsForEvaluation();

  const diagnostics = buildAlgorithmDiagnosticsSnapshot(input)
    .forecastCalibration.evaluation;

  assert.deepEqual(diagnostics.split, {
    strategy: 'chronological_60_40',
    trainingRecords: 60,
    evaluationRecords: 40,
    evaluationWindowStart: NOW - 40 * DAY,
  });
  assert.equal(diagnostics.overall.brier.status, 'ok');
  assert.equal(diagnostics.overall.brier.sampleSize, 40);
  assert.equal(diagnostics.worstCohorts.length, 2);
  assert.equal(diagnostics.worstCohorts[0]?.sourceId, 'model-bad');
  assert.equal(diagnostics.worstCohorts[0]?.domain, 'cyber');
  assert.equal(diagnostics.worstCohorts[0]?.horizon, '1d-7d');
  assert.deepEqual(diagnostics.worstCohorts[0]?.brier, {
    status: 'ok',
    sampleSize: 20,
    value: 0.81,
  });
  assert.deepEqual(diagnostics.resolutionBacklog, {
    pending: 0,
    overduePending: 0,
    expired: 0,
    oldestPendingAt: null,
  });
  assert.deepEqual(diagnostics.labelOrigins, {
    direct: 100,
    proxy: 0,
    manual: 0,
    unattributed: 0,
  });
  assert.equal(diagnostics.cohortLimit, 10);
  assert.equal(diagnostics.cohortCount, 2);
  assert.equal(diagnostics.omittedCohortCount, 0);

  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(
    serialized,
    /SECRET-CLAIM|SECRET-RESOLUTION|SECRET-EVIDENCE|-97\.123456|35\.654321/,
  );
  assert.doesNotMatch(
    serialized,
    /"(?:claim|criteria|evidence|targetKey|scoredRecords)"/,
  );
});

test('forecast evaluation diagnostics cap low-evidence cohorts deterministically', () => {
  const input = baseInput();
  input.forecastPredictions = Array.from({ length: 40 }, (_, index) => ({
    id: `bounded-${index}`,
    sourceId: `source-${String(index).padStart(2, '0')}`,
    domain: 'other',
    claim: `bounded claim ${index}`,
    probability: 0.5,
    predictedAt: NOW - (40 - index) * HOUR,
    resolveBy: NOW + HOUR,
    status: 'resolved_false',
    resolvedAt: NOW - (40 - index) * HOUR + 1,
  }));

  const diagnostics = buildAlgorithmDiagnosticsSnapshot(input)
    .forecastCalibration.evaluation;

  assert.equal(diagnostics.cohortCount, 16);
  assert.equal(diagnostics.worstCohorts.length, 10);
  assert.equal(diagnostics.omittedCohortCount, 6);
  assert.deepEqual(
    diagnostics.worstCohorts.map((cohort) => cohort.sourceId),
    Array.from({ length: 10 }, (_, index) =>
      `source-${String(index + 24).padStart(2, '0')}`),
  );
  assert.ok(diagnostics.worstCohorts.every(
    (cohort) => cohort.brier.status === 'insufficient_evidence',
  ));
});

test('diagnostics report label origins and linked state without exposing forecast identifiers', () => {
  const input = baseInput();
  input.records = [{
    id: 'opaque-evaluation-id',
    algorithmId: 'fast-algo',
    domain: 'other',
    version: '2.0.0',
    at: NOW - 1_000,
    durationMs: 4,
    forecastTarget: {
      predictionId: 'private-prediction-id',
      targetKey: 'private-target-key',
      predictedAt: NOW - 2_000,
      resolveBy: NOW + 2_000,
    },
    outcome: 'hit',
    outcomeAt: NOW,
    outcomeReason: 'confirmed',
    outcomeOrigin: 'proxy',
  }];

  const snapshot = buildAlgorithmDiagnosticsSnapshot(input);
  assert.deepEqual(snapshot.ledger.outcomeOrigins, {
    direct: 0,
    proxy: 1,
    manual: 0,
    llm: 0,
  });
  assert.equal(snapshot.recentEvaluations[0]?.forecastLinked, true);
  assert.equal(snapshot.recentEvaluations[0]?.version, '2.0.0');
  assert.equal(snapshot.recentEvaluations[0]?.outcomeOrigin, 'proxy');
  assert.doesNotMatch(JSON.stringify(snapshot), /private-prediction-id|private-target-key/);
});

test('runtime diagnostics isolate the active algorithm version from historical latency', () => {
  const input = baseInput();
  input.definitions = [{
    ...input.definitions[0]!,
    version: '2.0.0',
  }];
  input.records = [
    {
      id: 'legacy',
      algorithmId: 'fast-algo',
      domain: 'other',
      version: '1.0.0',
      at: NOW - 2_000,
      durationMs: 120_000,
    },
    {
      id: 'current',
      algorithmId: 'fast-algo',
      domain: 'other',
      version: '2.0.0',
      at: NOW - 1_000,
      durationMs: 8,
    },
  ];

  const snapshot = buildAlgorithmDiagnosticsSnapshot(input);
  const runtime = snapshot.runtime[0]!;

  assert.equal(runtime.version, '2.0.0');
  assert.equal(runtime.totalRuns, 1);
  assert.equal(runtime.historicalRuns, 1);
  assert.equal(runtime.latencyMs.p95, 8);
});

test('weather verification diagnostics expose stale and malformed report evidence', () => {
  const input = baseInput();
  input.forecastPredictions = [{
    id: 'nwswarn:test',
    sourceId: 'nws-warning',
    domain: 'weather',
    claim: 'warning fixture',
    probability: 0.7,
    predictedAt: NOW - 60_000,
    resolveBy: NOW + 60_000,
    status: 'pending',
    criteria: {
      kind: 'warning_verification',
      polygon: {
        rings: [[[-98, 34], [-96, 34], [-97, 36]]],
      },
      reportTypes: ['tornado'],
      sentAt: NOW - 120_000,
    },
  }];
  input.weatherReportBatch = {
    reports: [{
      id: 'bad',
      type: 'tornado',
      lat: Number.NaN,
      lon: -97,
      reportedAt: NOW - 60_000,
    }],
    fetchedAt: NOW - 31 * 60_000,
    coverageStart: NOW - 25 * 60 * 60_000,
    coverageEnd: NOW - 31 * 60_000,
    complete: false,
  };

  assert.deepEqual(
    buildAlgorithmDiagnosticsSnapshot(input).forecastCalibration.weatherReports,
    {
      status: 'stale',
      reportCount: 1,
      validReportCount: 0,
      invalidReportCount: 1,
      pendingWarningPredictions: 1,
      fetchedAt: NOW - 31 * 60_000,
      ageMs: 31 * 60_000,
      coverageStart: NOW - 25 * 60 * 60_000,
      coverageEnd: NOW - 31 * 60_000,
      complete: false,
    },
  );
});
