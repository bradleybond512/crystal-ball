import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getChampionRegistry } from '../champion-registry.js';
import { buildChampionStatusView, type ChampionStatusView } from '../champion-status-view.js';
import {
  evaluatePromotionGate,
  safetyEvidenceFromBaselineRegression,
} from '../promotion-gate.js';
import { collectJoinedEvidence, RUN_IDS } from '../shadow-rollout.js';
import { runReplay } from '../../ops/replay-harness.js';
import { buildCatalogReplayFixtures } from '../../ops/replay-fixtures-catalog.js';
import type { ReplayBaseline } from '../../ops/replay-baseline.js';
import replayBaseline from '../../ops/replay-baseline.json' with { type: 'json' };

const T0 = Date.UTC(2026, 7, 3, 12, 0, 0);

interface RuntimeSnapshot {
  view: ChampionStatusView;
  history: readonly {
    slot: string;
    modelId: string;
    version?: string;
    activatedAt: number;
    reason: 'initial' | 'promotion' | 'rollback';
  }[];
}

interface RuntimeModule {
  composeChampionStatusRuntime(): RuntimeSnapshot;
  buildEvaluationReportProjectionV1(input: unknown, clock?: () => number): unknown;
}

async function runtimeModule(): Promise<RuntimeModule> {
  const loaded: unknown = await import('../champion-status-runtime.js');
  assert.equal(typeof (loaded as Partial<RuntimeModule>).composeChampionStatusRuntime, 'function');
  assert.equal(typeof (loaded as Partial<RuntimeModule>).buildEvaluationReportProjectionV1, 'function');
  return loaded as RuntimeModule;
}

function validForecast(): Record<string, unknown> {
  return {
    total: 20,
    resolved: 12,
    pending: 5,
    overduePending: 2,
    expired: 3,
    resolutionCoverage: 0.6,
    expirationRate: 0.15,
    metrics: {
      brier: { status: 'ok', sampleSize: 12, value: 0.2 },
      logLoss: { status: 'ok', sampleSize: 12, value: 0.7 },
      brierSkill: { status: 'insufficient_evidence', sampleSize: 12, minSampleSize: 30 },
      equalMassEce: { status: 'unavailable' },
      secretToken: 'METRIC_SENTINEL',
    },
    largestVersionLossShare: 0.25,
    quarantinedCount: 1,
    targetKey: 'FORECAST_SENTINEL',
  };
}

function validChampion(): Record<string, unknown> {
  const domains = {
    weather: 1,
    cyber: 2,
    aviation: 3,
    maritime: 4,
    markets: 5,
    conflict: 6,
    humanitarian: 7,
    space: 8,
    infra: 9,
    macro: 10,
    other: 11,
  };
  return {
    view: {
      slot: 'forecast-primary',
      championId: 'production',
      championVersion: 'prod_1.2-rc',
      championActivatedAt: T0,
      championActivationReason: 'ACTIVATION_SENTINEL',
      challengers: [{
        runId: 'RUN_SENTINEL',
        challengerId: 'superforecast',
        challengerVersion: 'CHALLENGER_VERSION_SENTINEL',
        status: 'promotable',
        evidenceCount: 12,
        proxyShare: 0.25,
        perDomainCounts: domains,
        deltas: [
          { metric: 'brier', delta: 0.1, ciLow: 0.01, ciHigh: 0.2, better: true, explanation: 'DELTA_SENTINEL' },
          { metric: 'log-loss', delta: 0.2, ciLow: 0.02, ciHigh: 0.3, better: true, explanation: 'DELTA_SENTINEL' },
        ],
        reasons: ['REASON_SENTINEL'],
      }],
      recentActivity: [{ at: T0, kind: 'initial', summary: 'ACTIVITY_SENTINEL' }],
    },
    history: [{
      slot: 'forecast-primary',
      modelId: 'production',
      version: 'prod_1.2-rc',
      activatedAt: T0,
      reason: 'initial',
      evidenceRef: 'EVIDENCE_SENTINEL',
    }],
    sourcePath: 'PATH_SENTINEL',
  };
}

function projectionInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generatedAt: T0,
    forecast: validForecast(),
    champion: validChampion(),
    error: 'TOP_LEVEL_SENTINEL',
    ...overrides,
  };
}

function legacyComposition(): ChampionStatusView {
  const slot = 'forecast-primary';
  const registry = getChampionRegistry();
  const active = registry.getActiveChampion(slot);
  const fixtures = buildCatalogReplayFixtures();
  const safety = safetyEvidenceFromBaselineRegression(
    runReplay({ fixtures }),
    fixtures,
    replayBaseline as ReplayBaseline,
  );
  const incumbentId = active?.modelId ?? 'production';
  const challengerRuns = [
    { runId: RUN_IDS.SUPERFORECAST, challengerId: 'superforecast' },
    { runId: RUN_IDS.BASELINE_HIERARCHICAL, challengerId: 'hierarchical-base-rate' },
    { runId: RUN_IDS.BASELINE_PERSISTENCE, challengerId: 'persistence-baseline' },
    { runId: RUN_IDS.BASELINE_MOMENTUM, challengerId: 'momentum-baseline' },
  ] as const;
  return buildChampionStatusView({
    slot,
    ...(active === undefined ? {} : { active }),
    history: registry.getHistory(slot),
    challengers: challengerRuns.map(({ runId, challengerId }) => {
      const pairs = collectJoinedEvidence(runId);
      return {
        runId,
        challengerId,
        pairs,
        decision: evaluatePromotionGate({
          challengerId,
          incumbentId,
          pairs,
          enabledDomains: [],
          safety,
          evaluatedAt: Date.now(),
        }),
      };
    }),
  });
}

describe('champion-status-runtime', () => {
  it('provides the privacy-safe ACC-702 runtime projection boundary', async () => {
    await runtimeModule();
  });

  it('preserves the pre-extraction panel composition exactly', async () => {
    const runtime = await runtimeModule();
    const originalNow = Date.now;
    Date.now = () => T0;
    try {
      const snapshot = runtime.composeChampionStatusRuntime();
      assert.deepEqual(snapshot.view, legacyComposition());
      assert.deepEqual(snapshot.history, getChampionRegistry().getHistory('forecast-primary'));
    } finally {
      Date.now = originalNow;
    }
  });

  it('builds only the approved V1 fields and omits every free-form privacy sentinel', async () => {
    const runtime = await runtimeModule();
    const projection = runtime.buildEvaluationReportProjectionV1(projectionInput());
    assert.deepEqual(projection, {
      schemaVersion: 1,
      generatedAt: T0,
      forecast: {
        total: 20,
        resolved: 12,
        pending: 5,
        overduePending: 2,
        expired: 3,
        resolutionCoverage: 0.6,
        expirationRate: 0.15,
        metrics: {
          brier: { status: 'ok', sampleSize: 12, value: 0.2 },
          logLoss: { status: 'ok', sampleSize: 12, value: 0.7 },
          brierSkill: { status: 'insufficient_evidence', sampleSize: 12, minSampleSize: 30 },
          equalMassEce: { status: 'unavailable' },
        },
        largestVersionLossShare: 0.25,
        quarantinedCount: 1,
      },
      champion: {
        availability: 'available',
        active: { model: 'production', version: 'prod_1.2-rc', activatedAt: T0 },
        challengers: [{
          model: 'superforecast',
          status: 'promotable',
          evidenceCount: 12,
          proxyShare: 0.25,
          perDomain: [
            { domain: 'weather', count: 1 },
            { domain: 'cyber', count: 2 },
            { domain: 'aviation', count: 3 },
            { domain: 'maritime', count: 4 },
            { domain: 'markets', count: 5 },
            { domain: 'conflict', count: 6 },
            { domain: 'humanitarian', count: 7 },
            { domain: 'space', count: 8 },
            { domain: 'infra', count: 9 },
            { domain: 'macro', count: 10 },
            { domain: 'other', count: 11 },
          ],
          deltas: [
            { metric: 'brier', delta: 0.1, ciLow: 0.01, ciHigh: 0.2 },
            { metric: 'logLoss', delta: 0.2, ciLow: 0.02, ciHigh: 0.3 },
          ],
        }],
        promotions: [{ at: T0, kind: 'initial', model: 'production' }],
        rejectionHistory: { availability: 'unavailable', reasonCode: 'no_runtime_rejection_history' },
      },
    });
    const serialized = JSON.stringify(projection);
    for (const sentinel of [
      'METRIC_SENTINEL', 'FORECAST_SENTINEL', 'ACTIVATION_SENTINEL',
      'CHALLENGER_VERSION_SENTINEL', 'RUN_SENTINEL', 'DELTA_SENTINEL',
      'REASON_SENTINEL', 'ACTIVITY_SENTINEL', 'EVIDENCE_SENTINEL',
      'PATH_SENTINEL', 'TOP_LEVEL_SENTINEL',
    ]) {
      assert.doesNotMatch(serialized, new RegExp(sentinel));
    }
  });

  it('caps challengers, deltas, and promotion activity without spilling later sentinels', async () => {
    const runtime = await runtimeModule();
    const champion = validChampion();
    const view = champion.view as Record<string, unknown>;
    const base = (view.challengers as unknown[])[0] as Record<string, unknown>;
    view.challengers = Array.from({ length: 6 }, (_, index) => ({
      ...base,
      challengerId: index === 5 ? 'LATE_CHALLENGER_SENTINEL' : 'superforecast',
      deltas: [
        ...(base.deltas as unknown[]),
        { metric: 'brier', delta: 0.3, ciLow: 0.1, ciHigh: 0.4, explanation: 'THIRD_DELTA_SENTINEL' },
      ],
    }));
    champion.history = Array.from({ length: 8 }, (_, index) => ({
      slot: 'forecast-primary',
      modelId: index === 0 ? 'LATE_ACTIVITY_SENTINEL' : 'production',
      activatedAt: T0 + index,
      reason: 'promotion',
    }));
    const projection = runtime.buildEvaluationReportProjectionV1(projectionInput({ champion })) as {
      champion: { challengers: unknown[]; promotions: unknown[] };
    };
    assert.equal(projection.champion.challengers.length, 4);
    assert.equal((projection.champion.challengers[0] as { deltas: unknown[] }).deltas.length, 2);
    assert.equal(projection.champion.promotions.length, 6);
    assert.doesNotMatch(JSON.stringify(projection), /LATE_CHALLENGER_SENTINEL|THIRD_DELTA_SENTINEL|LATE_ACTIVITY_SENTINEL/);
  });

  it('maps unknown models, nulls unsafe versions, and allowlists domains', async () => {
    const runtime = await runtimeModule();
    const champion = validChampion();
    const view = champion.view as Record<string, unknown>;
    view.championId = 'MODEL_SENTINEL';
    view.championVersion = '../../unsafe token';
    const challenger = (view.challengers as Record<string, unknown>[])[0]!;
    challenger.challengerId = 'CHALLENGER_MODEL_SENTINEL';
    challenger.perDomainCounts = { markets: 2, forbidden_domain: 7 };
    const projection = runtime.buildEvaluationReportProjectionV1(projectionInput({ champion })) as {
      champion: {
        active: { model: string; version: string | null };
        challengers: { model: string; perDomain: unknown[] }[];
      };
    };
    assert.deepEqual(projection.champion.active, { model: 'unknown', version: null, activatedAt: T0 });
    assert.equal(projection.champion.challengers[0]!.model, 'unknown');
    assert.deepEqual(projection.champion.challengers[0]!.perDomain, [{ domain: 'markets', count: 2 }]);
    assert.doesNotMatch(JSON.stringify(projection), /MODEL_SENTINEL|unsafe token|forbidden_domain/);
  });

  it('maps the view-model insufficient-evidence status to the approved wire enum', async () => {
    const runtime = await runtimeModule();
    const champion = validChampion();
    const view = champion.view as Record<string, unknown>;
    (view.challengers as Record<string, unknown>[])[0]!.status = 'insufficient-evidence';
    const projection = runtime.buildEvaluationReportProjectionV1(projectionInput({ champion })) as {
      champion: { challengers: { status: string }[] };
    };
    assert.equal(projection.champion.challengers[0]!.status, 'insufficient_evidence');
  });

  it('fails the champion section closed on invalid required enums or numbers', async () => {
    const runtime = await runtimeModule();
    for (const mutate of [
      (view: Record<string, unknown>) => { (view.challengers as Record<string, unknown>[])[0]!.status = 'STATUS_SENTINEL'; },
      (view: Record<string, unknown>) => { (view.challengers as Record<string, unknown>[])[0]!.evidenceCount = -1; },
      (view: Record<string, unknown>) => { (view.challengers as Record<string, unknown>[])[0]!.proxyShare = Number.NaN; },
      (view: Record<string, unknown>) => {
        ((view.challengers as Record<string, unknown>[])[0]!.deltas as Record<string, unknown>[])[0]!.delta = 101;
      },
    ]) {
      const champion = validChampion();
      mutate(champion.view as Record<string, unknown>);
      const projection = runtime.buildEvaluationReportProjectionV1(projectionInput({ champion })) as {
        champion: Record<string, unknown>;
      };
      assert.deepEqual(projection.champion, {
        availability: 'unavailable',
        active: null,
        challengers: [],
        promotions: [],
        rejectionHistory: { availability: 'unavailable', reasonCode: 'no_runtime_rejection_history' },
      });
    }
  });

  it('turns invalid metric payloads into unavailable and rejects invalid top-level required values', async () => {
    const runtime = await runtimeModule();
    const forecast = validForecast();
    forecast.metrics = {
      brier: { status: 'ok', sampleSize: 3, value: 1.01 },
      logLoss: { status: 'ok', sampleSize: -1, value: 0.5 },
      brierSkill: { status: 'insufficient_evidence', sampleSize: 2, minSampleSize: Number.NaN },
      equalMassEce: { status: 'STATUS_SENTINEL' },
    };
    const projection = runtime.buildEvaluationReportProjectionV1(projectionInput({ forecast })) as {
      forecast: { metrics: Record<string, unknown> };
    };
    assert.deepEqual(projection.forecast.metrics, {
      brier: { status: 'unavailable' },
      logLoss: { status: 'unavailable' },
      brierSkill: { status: 'unavailable' },
      equalMassEce: { status: 'unavailable' },
    });
    assert.equal(runtime.buildEvaluationReportProjectionV1(projectionInput({ generatedAt: Number.NaN })), null);
    assert.equal(runtime.buildEvaluationReportProjectionV1(projectionInput({ generatedAt: -1 })), null);
    assert.equal(runtime.buildEvaluationReportProjectionV1(projectionInput({ forecast: { ...validForecast(), total: 1.5 } })), null);
    const badRatio = runtime.buildEvaluationReportProjectionV1(
      projectionInput({ forecast: { ...validForecast(), resolutionCoverage: 2 } }),
    ) as { forecast: { resolutionCoverage: number | null } };
    assert.equal(badRatio.forecast.resolutionCoverage, null);
  });

  it('accepts generatedAt at the five-minute future boundary and rejects one millisecond beyond it', async () => {
    const runtime = await runtimeModule();
    const clock = () => T0;
    assert.notEqual(
      runtime.buildEvaluationReportProjectionV1(projectionInput({ generatedAt: T0 + 5 * 60_000 }), clock),
      null,
    );
    assert.equal(
      runtime.buildEvaluationReportProjectionV1(projectionInput({ generatedAt: T0 + 5 * 60_000 + 1 }), clock),
      null,
    );
  });
});
