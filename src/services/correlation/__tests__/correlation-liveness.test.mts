import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import * as liveness from '../correlation-liveness.ts';
import { syncLearnedRules } from '../learned-rules.ts';
import {
  SituationStoreV2,
  type SituationStoreV2Options,
} from '../../intelligence/situation-store-v2.ts';
import type { CorrelationRule } from '../../intelligence/correlate-engine.ts';
import type { ObservationEvent } from '../../../types/intelligence.ts';

const NOW = 1_800_000_000_000;

interface CorrelationLivenessApi {
  __resetCorrelationLivenessForTests(): void;
  registerCorrelationRuntime(runtime: object, mode: 'live' | 'offline_replay'): void;
  recordLearnedRulesInstalled(runtime: object, count: number): void;
  recordCorrelationBatch(
    runtime: object,
    observationCount: number,
    pairs: readonly { ruleId: string }[],
    at: number,
  ): void;
}

const telemetry = liveness as typeof liveness & CorrelationLivenessApi;

beforeEach(() => {
  if (typeof telemetry.__resetCorrelationLivenessForTests === 'function') {
    telemetry.__resetCorrelationLivenessForTests();
  }
});

test('diagnoses installed learned rules as degraded when recent live batches are all singletons', () => {
  assert.equal(typeof telemetry.registerCorrelationRuntime, 'function');
  const runtime = {};
  telemetry.registerCorrelationRuntime(runtime, 'live');
  telemetry.recordLearnedRulesInstalled(runtime, 2);
  for (let index = 0; index < 3; index += 1) {
    telemetry.recordCorrelationBatch(runtime, 1, [], NOW - index);
  }

  const diagnostics = telemetry.getCorrelationLivenessDiagnostics(NOW);

  assert.equal(diagnostics.status, 'degraded');
  assert.equal(diagnostics.reason, 'learned_rules_dormant_on_singletons');
  assert.equal(diagnostics.live.learnedRulesInstalled, 2);
  assert.equal(diagnostics.live.batchCount, 3);
  assert.equal(diagnostics.live.batchSizeDistribution.singleton, 3);
  assert.equal(diagnostics.live.learnedPairsEmitted, 0);
});

test('diagnoses the last three eligible singleton batches and recovers on new learned-pair activity', () => {
  const runtime = {};
  telemetry.registerCorrelationRuntime(runtime, 'live');
  telemetry.recordLearnedRulesInstalled(runtime, 1);
  for (const [index, observationCount] of [2, 1, 1, 1].entries()) {
    telemetry.recordCorrelationBatch(runtime, observationCount, [], NOW - 4 + index);
  }
  telemetry.recordCorrelationBatch(
    runtime,
    2,
    [{ ruleId: 'learned:future->pair' }],
    NOW + 1,
  );

  const degraded = telemetry.getCorrelationLivenessDiagnostics(NOW);

  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.reason, 'learned_rules_dormant_on_singletons');
  assert.deepEqual(degraded.live.batchSizeDistribution, {
    singleton: 3,
    small: 1,
    medium: 0,
    large: 0,
  });
  assert.equal(degraded.live.learnedPairsEmitted, 0);

  telemetry.recordCorrelationBatch(
    runtime,
    2,
    [{ ruleId: 'learned:weather->infra' }],
    NOW,
  );
  const recovered = telemetry.getCorrelationLivenessDiagnostics(NOW);

  assert.equal(recovered.status, 'healthy');
  assert.equal(recovered.reason, 'learned_rules_active');
  assert.equal(recovered.live.learnedPairsEmitted, 1);
});

test('live situation ingest and learned-rule sync automatically feed liveness diagnostics', () => {
  const options = {
    clock: () => NOW,
    diagnosticsMode: 'live',
  } as SituationStoreV2Options;
  const store = new SituationStoreV2(options);
  const learnedRule: CorrelationRule = {
    id: 'learned:weather->infra',
    name: 'fixture learned rule',
    description: 'fixture',
    domains: ['weather', 'infra'],
    timeWindowMs: 60_000,
    edgeType: 'causal-candidate',
    matchFn: (a, b) => a.domain === 'weather' && b.domain === 'infra',
  };
  syncLearnedRules(store.getEngine(), [learnedRule]);

  for (let index = 0; index < 3; index += 1) {
    const observation: ObservationEvent = {
      id: `PRIVATE-OBSERVATION-${index}`,
      sourceId: 'PRIVATE-SOURCE',
      domain: 'weather',
      timestamp: NOW - index,
      severity: 'LOW',
      title: 'PRIVATE-TITLE',
      raw: { private: true },
      entityIds: ['PRIVATE-ENTITY'],
      tags: ['PRIVATE-TAG'],
    };
    store.ingest([observation]);
  }

  const diagnostics = telemetry.getCorrelationLivenessDiagnostics(NOW);
  assert.equal(diagnostics.status, 'degraded');
  assert.equal(diagnostics.live.learnedRulesInstalled, 1);
  assert.equal(diagnostics.live.batchCount, 3);
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE/);
});

test('offline replay is reported separately and cannot mask degraded live liveness', () => {
  const liveRuntime = {};
  const replayRuntime = {};
  telemetry.registerCorrelationRuntime(liveRuntime, 'live');
  telemetry.registerCorrelationRuntime(replayRuntime, 'offline_replay');
  telemetry.recordLearnedRulesInstalled(liveRuntime, 2);
  telemetry.recordLearnedRulesInstalled(replayRuntime, 4);
  for (let index = 0; index < 3; index += 1) {
    telemetry.recordCorrelationBatch(liveRuntime, 1, [], NOW - index);
  }
  telemetry.recordCorrelationBatch(replayRuntime, 20, [{ ruleId: 'learned:secret->pair' }], 1);

  const diagnostics = telemetry.getCorrelationLivenessDiagnostics(NOW);

  assert.equal(diagnostics.status, 'degraded');
  assert.equal(diagnostics.live.batchCount, 3);
  assert.equal(diagnostics.live.learnedPairsEmitted, 0);
  assert.equal(diagnostics.offlineReplay.batchCount, 1);
  assert.equal(diagnostics.offlineReplay.learnedPairsEmitted, 1);
  assert.equal(diagnostics.offlineReplay.learnedRulesInstalled, 4);
});

test('learned pair emission proves live rule activity', () => {
  const runtime = {};
  telemetry.registerCorrelationRuntime(runtime, 'live');
  telemetry.recordLearnedRulesInstalled(runtime, 1);
  telemetry.recordCorrelationBatch(runtime, 2, [{ ruleId: 'learned:a->b' }], NOW - 2);
  telemetry.recordCorrelationBatch(runtime, 1, [], NOW - 1);
  telemetry.recordCorrelationBatch(runtime, 1, [], NOW);

  const diagnostics = telemetry.getCorrelationLivenessDiagnostics(NOW);

  assert.equal(diagnostics.status, 'healthy');
  assert.equal(diagnostics.reason, 'learned_rules_active');
  assert.equal(diagnostics.live.learnedPairsEmitted, 1);
  assert.deepEqual(diagnostics.live.batchSizeDistribution, {
    singleton: 2,
    small: 1,
    medium: 0,
    large: 0,
  });
});

test('retains only bounded anonymous distributions and ignores invalid or unregistered telemetry', () => {
  const runtime = {};
  const unregistered = {};
  telemetry.registerCorrelationRuntime(runtime, 'live');
  telemetry.recordLearnedRulesInstalled(runtime, Number.MAX_SAFE_INTEGER);
  telemetry.recordLearnedRulesInstalled(unregistered, 99);
  telemetry.recordCorrelationBatch(unregistered, 99, [{ ruleId: 'learned:PRIVATE' }], NOW);
  telemetry.recordCorrelationBatch(runtime, 0, [], NOW);
  telemetry.recordCorrelationBatch(runtime, Number.NaN, [], NOW);
  for (let index = 0; index < 30; index += 1) {
    const size = index % 4 === 0 ? 1 : index % 4 === 1 ? 4 : index % 4 === 2 ? 16 : 17;
    telemetry.recordCorrelationBatch(
      runtime,
      size,
      [{ ruleId: `learned:PRIVATE-${index}` }],
      NOW - (29 - index),
    );
  }

  const diagnostics = telemetry.getCorrelationLivenessDiagnostics(NOW);
  const json = JSON.stringify(diagnostics);

  assert.equal(diagnostics.live.batchCount, 24);
  assert.equal(diagnostics.live.learnedPairsEmitted, 24);
  assert.equal(diagnostics.live.learnedRulesInstalled, 100);
  assert.deepEqual(diagnostics.live.batchSizeDistribution, {
    singleton: 6,
    small: 6,
    medium: 6,
    large: 6,
  });
  assert.doesNotMatch(json, /PRIVATE/);
  assert.equal('batches' in diagnostics.live, false);
  assert.equal('ruleIds' in diagnostics.live, false);
});

test('stale and future live samples fail neutral instead of driving a diagnosis', () => {
  const runtime = {};
  telemetry.registerCorrelationRuntime(runtime, 'live');
  telemetry.recordLearnedRulesInstalled(runtime, 1);
  telemetry.recordCorrelationBatch(
    runtime,
    1,
    [],
    NOW - liveness.CORRELATION_LIVENESS_WINDOW_MS - 1,
  );
  telemetry.recordCorrelationBatch(runtime, 1, [], NOW + 1);

  const diagnostics = telemetry.getCorrelationLivenessDiagnostics(NOW);

  assert.equal(diagnostics.status, 'unavailable');
  assert.equal(diagnostics.reason, 'no_live_activity');
  assert.equal(diagnostics.live.batchCount, 0);
});
