import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const mem = new Map<string, string>();
let storageWrites = 0;
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    storageWrites += 1;
    mem.set(k, v);
  },
  removeItem: (k: string) => { mem.delete(k); },
};

import {
  brierScore,
  createForecastCalibrationStore,
} from '../forecast-calibration.ts';
import type { PredictionRecord } from '../forecast-calibration.ts';
import {
  dispatchOutcomeResolvers,
  getCalibrationStore,
  recordPrediction,
  recordPredictions,
  resolvePrediction,
  getDomainCalibrationMult,
  _resetCalibrationForTests,
  collectBaselines,
} from '../forecast-calibration-adapter.ts';
import { marketMoveResolver } from '../outcome-resolvers.ts';
import { recordFusedSpotPrices, _resetSpotPriceStoreForTests } from '../../market/spot-price-store.ts';
import {
  getAlgorithmEvaluationLedger,
  resetAlgorithmsState,
} from '../../algorithms/algorithms-state.ts';

function makeRecord(id: string, probability: number, outcome: boolean, domain = 'other'): PredictionRecord {
  return {
    id,
    sourceId: 'test',
    domain: domain as PredictionRecord['domain'],
    claim: 'test claim',
    probability,
    predictedAt: 1_000_000,
    resolveBy: 2_000_000,
    status: outcome ? 'resolved_true' : 'resolved_false',
    resolvedAt: 1_500_000,
  };
}

function boostMultiplierFromRecords(records: PredictionRecord[]): number {
  const resolved = records.filter(r => r.status === 'resolved_true' || r.status === 'resolved_false');
  if (resolved.length < 5) return 1.0;
  const result = brierScore(resolved);
  if (result.score <= 0.10) return 1.2;
  if (result.score <= 0.20) return 1.0;
  if (result.score <= 0.30) return 0.7;
  return 0.4;
}

// ── Original boost-multiplier tests (domain corrected to 'other') ─────────

test('empty store returns 1.0', () => {
  const store = createForecastCalibrationStore();
  const result = boostMultiplierFromRecords(store.all());
  assert.equal(result, 1.0);
});

test('fewer than 5 resolved records returns 1.0', () => {
  const store = createForecastCalibrationStore();
  for (let i = 0; i < 4; i++) {
    store.record(makeRecord(`r${i}`, 0.95, true));
  }
  const result = boostMultiplierFromRecords(store.all());
  assert.equal(result, 1.0);
});

test('5+ sharp records (Brier <= 0.10) returns 1.2', () => {
  const store = createForecastCalibrationStore();
  for (let i = 0; i < 5; i++) {
    store.record(makeRecord(`r${i}`, 0.95, true));
  }
  const records = store.all();
  const bs = brierScore(records);
  assert.ok(bs.score <= 0.10, `expected brier <= 0.10, got ${bs.score}`);
  const result = boostMultiplierFromRecords(records);
  assert.equal(result, 1.2);
});

test('5+ poor records (Brier > 0.30) returns 0.4', () => {
  const store = createForecastCalibrationStore();
  for (let i = 0; i < 5; i++) {
    store.record(makeRecord(`p${i}`, 0.95, false));
  }
  const records = store.all();
  const bs = brierScore(records);
  assert.ok(bs.score > 0.30, `expected brier > 0.30, got ${bs.score}`);
  const result = boostMultiplierFromRecords(records);
  assert.equal(result, 0.4);
});

// ── Persistence tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mem.clear();
  storageWrites = 0;
  _resetCalibrationForTests();
  resetAlgorithmsState();
});

test('recordPrediction persists and reloads', () => {
  recordPrediction({
    id: 'p1', sourceId: 'analyst-loop', domain: 'weather',
    claim: 'test claim', probability: 0.7,
    predictedAt: 1000, resolveBy: 2000, status: 'pending',
  });
  _resetCalibrationForTests();
  assert.equal(getCalibrationStore().get('p1')?.claim, 'test claim');
});

test('recordPredictions persists a batch with one storage write', () => {
  recordPredictions([
    {
      id: 'batch-1', sourceId: 'test', domain: 'weather',
      claim: 'first', probability: 0.7,
      predictedAt: 1000, resolveBy: 2000, status: 'pending',
    },
    {
      id: 'batch-2', sourceId: 'test', domain: 'weather',
      claim: 'second', probability: 0.7,
      predictedAt: 1000, resolveBy: 2000, status: 'pending',
    },
  ]);

  assert.equal(storageWrites, 1);
  assert.equal(getCalibrationStore().all().length, 2);
});

test('recordPrediction pairs an eligible target with a versioned hierarchical base rate', () => {
  for (let index = 0; index < 30; index += 1) {
    recordPrediction({
      id: `history-${index}`,
      sourceId: 'test-history',
      targetKey: `history-target-${index}`,
      domain: 'markets',
      claim: 'historical outcome',
      probability: 0.5,
      predictedAt: index * 10,
      resolveBy: index * 10 + 5,
      status: index % 2 === 0 ? 'resolved_true' : 'resolved_false',
      resolvedAt: index * 10 + 5,
    });
  }

  recordPrediction({
    id: 'live-weather-forecast',
    sourceId: 'analyst-loop',
    targetKey: 'weather:live-target',
    domain: 'weather',
    claim: 'weather event occurs',
    probability: 0.8,
    predictedAt: 1_000,
    resolveBy: 1_000 + 24 * 60 * 60 * 1_000,
    status: 'pending',
    algorithmVersion: '2.0.0',
  });

  const baseline = getCalibrationStore().all().find(
    (record) => record.sourceId === 'hierarchical-base-rate',
  );
  assert.ok(baseline);
  assert.equal(baseline.targetKey, 'weather:live-target');
  assert.equal(baseline.domain, 'weather');
  assert.equal(baseline.probability, 0.5);
  assert.equal(baseline.predictedAt, 1_000);
  assert.equal(baseline.resolveBy, 1_000 + 24 * 60 * 60 * 1_000);
  assert.equal(baseline.status, 'pending');
  assert.equal(baseline.algorithmVersion, '1.0.0');
  assert.equal(
    getAlgorithmEvaluationLedger().pending().find(
      (record) => record.algorithmId === 'hierarchical-base-rate',
    )?.forecastTarget?.predictionId,
    baseline.id,
  );
});

test('shared target forecasts reuse one hierarchical baseline record', () => {
  for (let index = 0; index < 30; index += 1) {
    recordPrediction({
      id: `shared-history-${index}`,
      sourceId: 'test-history',
      targetKey: `shared-history-target-${index}`,
      domain: 'markets',
      claim: 'historical outcome',
      probability: 0.5,
      predictedAt: index * 10,
      resolveBy: index * 10 + 5,
      status: index % 2 === 0 ? 'resolved_true' : 'resolved_false',
      resolvedAt: index * 10 + 5,
    });
  }
  const shared = {
    targetKey: 'shared-target',
    domain: 'weather' as const,
    probability: 0.7,
    predictedAt: 1_000,
    resolveBy: 2_000,
    status: 'pending' as const,
    algorithmVersion: '1.0.0',
  };

  recordPrediction({
    ...shared,
    id: 'shared-analyst',
    sourceId: 'analyst-loop',
    claim: 'analyst wording',
  });
  assert.doesNotThrow(() => recordPrediction({
    ...shared,
    id: 'shared-superforecast',
    sourceId: 'superforecast',
    claim: 'different superforecast wording',
  }));

  assert.equal(
    getCalibrationStore().all().filter(
      (record) => record.sourceId === 'hierarchical-base-rate',
    ).length,
    1,
  );
});

test('record and resolve bridge an exact authoritative algorithm evaluation', () => {
  recordPrediction({
    id: 'linked-1',
    sourceId: 'analyst-loop',
    targetKey: 'hypothesis:linked-1',
    domain: 'conflict',
    claim: 'linked fixture',
    probability: 0.8,
    predictedAt: 1_000,
    resolveBy: 2_000,
    status: 'pending',
    algorithmVersion: '2.0.0',
  });

  const ledger = getAlgorithmEvaluationLedger();
  assert.equal(ledger.pending().length, 1);
  assert.equal(resolvePrediction('linked-1', true, 1_500, {
    note: 'direct:test',
    provenance: {
      resolverId: 'test-resolver-v1',
      kind: 'direct',
      evidence: [{
        sourceIds: ['fixture-provider'],
        observedAt: 1_500,
        reference: 'fixture:linked-1',
        supportsOutcome: true,
      }],
    },
  }), true);
  const graded = ledger.graded()[0];
  assert.equal(graded?.outcome, 'hit');
  assert.equal(graded?.outcomeOrigin, 'direct');
  assert.equal(graded?.version, '2.0.0');
  assert.equal(graded?.forecastTarget?.targetKey, 'hypothesis:linked-1');
});

test('outcome resolver dispatch persists direct store mutations before reload', () => {
  recordPrediction({
    id: 'market-1',
    sourceId: 'analyst-loop',
    domain: 'markets',
    claim: 'AAPL rallies',
    probability: 0.7,
    predictedAt: 1_000,
    resolveBy: 10_000,
    status: 'pending',
    criteria: {
      kind: 'market_move',
      symbol: 'AAPL',
      direction: 'up',
      minAbsPct: 3,
      basisPrice: 100,
      basisObservedAt: 900,
    },
  });
  dispatchOutcomeResolvers({
    now: 2_000,
    spotHistoryFor: () => [{
      symbol: 'AAPL',
      price: 104,
      observedAt: 1_500,
      providerIds: ['yahoo-finance'],
      independentSourceCount: 1,
      confidence: 0.5,
    }],
    queryObservations: () => [],
  }, [marketMoveResolver]);

  _resetCalibrationForTests();
  assert.equal(getCalibrationStore().get('market-1')?.status, 'resolved_true');
  assert.equal(
    getCalibrationStore().get('market-1')?.resolutionProvenance?.resolverId,
    'market-move-v1',
  );
});

test('store caps at 500 records, oldest dropped', () => {
  for (let i = 0; i < 510; i++) {
    recordPrediction({
      id: `p${i}`, sourceId: 's', domain: 'weather', claim: 'c',
      probability: 0.5, predictedAt: i, resolveBy: i + 100, status: 'pending',
    });
  }
  assert.equal(getCalibrationStore().all().length, 500);
  assert.equal(getCalibrationStore().get('p0'), undefined);
});

// ── Domain calibration multiplier tests ──────────────────────────────────

test('domain multiplier is neutral below 10 resolved', () => {
  assert.equal(getDomainCalibrationMult('weather'), 1);
});

test('well-calibrated domain boosts; badly calibrated damps', () => {
  // 12 resolved, perfect calibration (p=0.9 all true) → low brier → boost
  for (let i = 0; i < 12; i++) {
    recordPrediction({
      id: `g${i}`, sourceId: 's', domain: 'weather', claim: 'c',
      probability: 0.9, predictedAt: i, resolveBy: i + 10,
      status: 'resolved_true', resolvedAt: i + 1,
    });
  }
  assert.ok(getDomainCalibrationMult('weather') > 1);

  for (let i = 0; i < 12; i++) {
    recordPrediction({
      id: `b${i}`, sourceId: 's', domain: 'markets', claim: 'c',
      probability: 0.9, predictedAt: i, resolveBy: i + 10,
      status: 'resolved_false', resolvedAt: i + 1,
    });
  }
  assert.ok(getDomainCalibrationMult('markets') < 1);
});

const H2 = 3_600_000;

// ── ACC-302: adapter-path baseline emission ──────────────────────────────

test('ACC-302: recordPredictions is batch-order independent for persistence emission', () => {
  const T = Date.UTC(2026, 6, 1, 12, 0, 0);
  const H = 3_600_000;
  const prior: PredictionRecord = {
    id: 'acc302-prior', sourceId: 'mode-forecast', targetKey: 'mode:finance',
    domain: 'markets', claim: 'pressure elevated', probability: 0.6,
    predictedAt: T - 48 * H, resolveBy: T - 36 * H,
    status: 'resolved_true', resolvedAt: T - 40 * H, resolutionNote: 'direct:test',
  } as PredictionRecord;
  const pending: PredictionRecord = {
    id: 'acc302-pending', sourceId: 'mode-forecast', targetKey: 'mode:finance',
    domain: 'markets', claim: 'pressure stays elevated', probability: 0.6,
    predictedAt: T, resolveBy: T + 24 * H, status: 'pending',
  } as PredictionRecord;

  // Worst-case order: the pending forecast BEFORE its resolved prior.
  recordPredictions([pending, prior]);
  const persistence = getCalibrationStore()
    .all()
    .filter((r) => r.sourceId === 'persistence-baseline');
  assert.equal(persistence.length, 1, 'baseline emitted regardless of batch order');
  assert.ok(Math.abs(persistence[0]!.probability - 2 / 3) < 1e-9);
});

test('ACC-302: recordPrediction emits a momentum baseline from the bounded spot accessor', () => {
  _resetSpotPriceStoreForTests();
  const T = Date.UTC(2026, 6, 1, 12, 0, 0);
  const fusedFact = (occurredAt: number, value: number) => ({
    key: 'AAPL', value, occurredAt,
    providerIds: ['yahoo'],
    fusion: { independentSourceCount: 1, confidenceMultiplier: 1, disagreements: [] },
  }) as never;
  // Rising pre-forecast series + one POST-forecast spike the accessor must ignore.
  const pre = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
    fusedFact(T - (8 - i) * 30 * 60_000, 196 + i * 0.5));
  recordFusedSpotPrices([...pre, fusedFact(T + 60_000, 400)]);

  recordPrediction({
    id: 'acc302-mkt', sourceId: 'analyst-loop', targetKey: 'hypothesis:acc302-mkt',
    domain: 'markets', claim: 'AAPL up 3%', probability: 0.7,
    predictedAt: T, resolveBy: T + 24 * H2,
    status: 'pending',
    criteria: {
      kind: 'market_move', symbol: 'AAPL', direction: 'up',
      minAbsPct: 3, basisPrice: 196, basisObservedAt: T - 4 * H2,
    },
  } as PredictionRecord);

  const momentum = getCalibrationStore()
    .all()
    .filter((r) => r.sourceId === 'momentum-baseline');
  assert.equal(momentum.length, 1, 'momentum baseline emitted via the adapter accessor');
  assert.ok(momentum[0]!.probability > 0.5, 'rising series must lift P(up)');
  assert.ok(momentum[0]!.probability <= 0.95);
  assert.deepEqual(momentum[0]!.criteria, ({
    kind: 'market_move', symbol: 'AAPL', direction: 'up',
    minAbsPct: 3, basisPrice: 196, basisObservedAt: T - 4 * H2,
  }), 'criteria inherited for paired resolution');
  // The post-cutoff 400 spike must not have entered the estimate: with it,
  // the slope would be absurd and probability pinned at the 0.95 ceiling
  // AND the accessor window simply cannot return it. Re-run without the
  // spike and require the identical probability.
  _resetSpotPriceStoreForTests();
  recordFusedSpotPrices(pre);
  _resetCalibrationForTests();
  recordPrediction({
    id: 'acc302-mkt2', sourceId: 'analyst-loop', targetKey: 'hypothesis:acc302-mkt',
    domain: 'markets', claim: 'AAPL up 3%', probability: 0.7,
    predictedAt: T, resolveBy: T + 24 * H2,
    status: 'pending',
    criteria: {
      kind: 'market_move', symbol: 'AAPL', direction: 'up',
      minAbsPct: 3, basisPrice: 196, basisObservedAt: T - 4 * H2,
    },
  } as PredictionRecord);
  const momentum2 = getCalibrationStore().all().filter((r) => r.sourceId === 'momentum-baseline');
  assert.equal(momentum2[0]!.probability, momentum[0]!.probability, 'post-cutoff sample changed nothing');
});

test('ACC-303 PHASE EXIT (adapter path): every production family emits ≥1 baseline through recordPrediction', () => {
  const T = Date.UTC(2026, 6, 1, 12, 0, 0);
  // Seed resolved global history + same-key priors directly into the store.
  const seed: PredictionRecord[] = [];
  for (let i = 0; i < 35; i++) {
    const predictedAt = T - (100 + i * 30) * H2;
    seed.push({
      id: `seed-${i}`, sourceId: 'mode-forecast', targetKey: `mode:seed${i % 4}`,
      domain: 'markets', claim: 's', probability: 0.5,
      predictedAt, resolveBy: predictedAt + 12 * H2,
      status: i % 2 === 0 ? 'resolved_true' : 'resolved_false',
      resolvedAt: predictedAt + 6 * H2, resolutionNote: 'direct:seed',
    } as PredictionRecord);
  }
  seed.push({ ...seed[0]!, id: 'seed-mode-fin', targetKey: 'mode:finance' });
  seed.push({ ...seed[1]!, id: 'seed-short-wheat', targetKey: 'shortage:wheat:global' });
  getCalibrationStore().loadJson(seed);
  _resetSpotPriceStoreForTests();
  recordFusedSpotPrices([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
    key: 'COVR', value: 200, occurredAt: T - 5 * 60_000 - (7 - i) * 30 * 60_000,
    providerIds: ['yahoo'],
    fusion: { independentSourceCount: 1, confidenceMultiplier: 1, disagreements: [] },
  }) as never));

  const families: [string, PredictionRecord, number][] = [
    ['mode', {
      id: 'cov-mode', sourceId: 'mode-forecast', targetKey: 'mode:finance',
      domain: 'markets', claim: 'c', probability: 0.6,
      predictedAt: T, resolveBy: T + 24 * H2, status: 'pending',
    } as PredictionRecord, 2],
    ['shortage', {
      id: 'cov-short', sourceId: 'shortage-forecast', targetKey: 'shortage:wheat:global',
      domain: 'infra', claim: 'c', probability: 0.6,
      predictedAt: T, resolveBy: T + 24 * H2, status: 'pending',
    } as PredictionRecord, 2],
    ['market hypothesis', {
      id: 'cov-mkt', sourceId: 'analyst-loop', targetKey: 'hypothesis:cov-mkt',
      domain: 'markets', claim: 'c', probability: 0.6,
      predictedAt: T, resolveBy: T + 24 * H2, status: 'pending',
      criteria: {
        kind: 'market_move', symbol: 'COVR', direction: 'up',
        minAbsPct: 3, basisPrice: 200, basisObservedAt: T - 60_000,
      },
    } as PredictionRecord, 2],
    ['non-market hypothesis', {
      id: 'cov-geo', sourceId: 'analyst-loop', targetKey: 'hypothesis:cov-geo',
      domain: 'conflict', claim: 'c', probability: 0.6,
      predictedAt: T, resolveBy: T + 24 * H2, status: 'pending',
    } as PredictionRecord, 1],
    ['warning verification', {
      id: 'cov-warn', sourceId: 'warning-verification-bridge', targetKey: 'nws-warning:cov',
      domain: 'weather', claim: 'c', probability: 0.6,
      predictedAt: T, resolveBy: T + 24 * H2, status: 'pending',
    } as PredictionRecord, 1],
  ];
  for (const [label, target, minimum] of families) {
    const before = new Set(getCalibrationStore().all().map((r) => r.id));
    recordPrediction(target);
    const emitted = getCalibrationStore()
      .all()
      .filter((r) => !before.has(r.id) && r.id !== target.id
        && ['hierarchical-base-rate', 'persistence-baseline', 'momentum-baseline'].includes(r.sourceId));
    assert.ok(
      emitted.length >= minimum,
      `${label}: expected ≥${minimum} baseline(s) via the real adapter, got ${emitted.length}`,
    );
  }
});

test('ACC-303: a second producer on the same target/window still gets pairable baselines', () => {
  const T = Date.UTC(2026, 6, 1, 12, 0, 0);
  const seed: PredictionRecord[] = [];
  for (let i = 0; i < 35; i++) {
    const predictedAt = T - (100 + i * 30) * H2;
    seed.push({
      id: `p2seed-${i}`, sourceId: 'mode-forecast', targetKey: `mode:p2s${i % 4}`,
      domain: 'markets', claim: 's', probability: 0.5,
      predictedAt, resolveBy: predictedAt + 12 * H2,
      status: i % 2 === 0 ? 'resolved_true' : 'resolved_false',
      resolvedAt: predictedAt + 6 * H2, resolutionNote: 'direct:seed',
    } as PredictionRecord);
  }
  getCalibrationStore().loadJson(seed);
  const mk = (id: string, sourceId: string): PredictionRecord => ({
    id, sourceId, targetKey: 'hypothesis:shared', domain: 'markets', claim: 'c',
    probability: 0.6, predictedAt: T, resolveBy: T + 24 * H2, status: 'pending',
  } as PredictionRecord);
  const store = getCalibrationStore();
  const first = collectBaselines(store, mk('shared-a', 'analyst-loop'), store.all());
  assert.ok(first.recorded.length >= 1, 'first producer records the baseline');
  const second = collectBaselines(store, mk('shared-b', 'superforecast'), store.all());
  assert.equal(second.recorded.length, 0, 'baseline already exists — nothing re-recorded');
  assert.ok(second.pairable.length >= 1, 'REGRESSION: second producer still gets pairable baselines');
  assert.equal(second.pairable[0]!.sourceId, 'hierarchical-base-rate');
});
