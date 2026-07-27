import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createForecastCalibrationStore,
  brierScore,
  perDomainAccuracy,
  perSourceMultipliers,
} from '../forecast-calibration.ts';
import type { PredictionRecord } from '../forecast-calibration.ts';

const NOW = 1_745_000_000_000;

function pred(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    id: 'p-1',
    sourceId: 'wheat-model',
    domain: 'macro',
    claim: 'Wheat shortage rising in Black Sea',
    probability: 0.7,
    predictedAt: NOW,
    resolveBy: NOW + 30 * 24 * 60 * 60 * 1000, // 30 days out
    status: 'pending',
    ...overrides,
  };
}

// ── Recording + resolution ─────────────────────────────────────────────

test('record + get', () => {
  const s = createForecastCalibrationStore();
  s.record(pred());
  assert.equal(s.get('p-1')?.claim, 'Wheat shortage rising in Black Sea');
});

test('record + get isolates resolver criteria from caller mutation', () => {
  const s = createForecastCalibrationStore();
  s.record(pred({
    criteria: {
      kind: 'market_move',
      symbol: 'AAPL',
      direction: 'up',
      minAbsPct: 3,
      basisPrice: 100,
      basisObservedAt: NOW,
    },
  }));
  const read = s.get('p-1');
  if (read?.criteria?.kind === 'market_move') read.criteria.basisPrice = 0;

  assert.equal(
    s.get('p-1')?.criteria?.kind === 'market_move'
      ? s.get('p-1')?.criteria.basisPrice
      : undefined,
    100,
  );
});

test('resolve: true outcome marks resolved_true', () => {
  const s = createForecastCalibrationStore();
  s.record(pred());
  const ok = s.resolve('p-1', true, NOW + 1000, {
    note: 'direct:market_move AAPL crossed +3%',
    provenance: {
      resolverId: 'market-move-v1',
      kind: 'direct',
      evidence: [{
        sourceIds: ['yahoo-finance', 'finnhub'],
        observedAt: NOW + 1000,
        value: 103.2,
        supportsOutcome: true,
      }],
    },
  });
  assert.equal(ok, true);
  assert.equal(s.get('p-1')?.status, 'resolved_true');
  assert.equal(s.get('p-1')?.resolvedAt, NOW + 1000);
  assert.equal(s.get('p-1')?.resolutionNote, 'direct:market_move AAPL crossed +3%');
  assert.equal(s.get('p-1')?.resolutionProvenance?.resolverId, 'market-move-v1');
});

test('resolve: false outcome marks resolved_false', () => {
  const s = createForecastCalibrationStore();
  s.record(pred());
  s.resolve('p-1', false);
  assert.equal(s.get('p-1')?.status, 'resolved_false');
});

test('resolve: returns false for unknown id', () => {
  const s = createForecastCalibrationStore();
  assert.equal(s.resolve('nope', true), false);
});

test('resolve: refuses to re-resolve', () => {
  const s = createForecastCalibrationStore();
  s.record(pred());
  s.resolve('p-1', true);
  const second = s.resolve('p-1', false);
  assert.equal(second, false);
  assert.equal(s.get('p-1')?.status, 'resolved_true');
});

test('resolve: rejects malformed and contradictory structured evidence', () => {
  const s = createForecastCalibrationStore();
  s.record(pred());

  assert.equal(s.resolve('p-1', true, NOW + 1000, {
    note: 'proxy:conflicting providers',
    provenance: {
      resolverId: 'fixture-v1',
      kind: 'proxy',
      evidence: [
        {
          sourceIds: ['provider-a'],
          observedAt: NOW + 500,
          supportsOutcome: true,
        },
        {
          sourceIds: ['provider-b'],
          observedAt: NOW + 600,
          supportsOutcome: false,
        },
      ],
    },
  }), false);
  assert.equal(s.get('p-1')?.status, 'pending');
});

test('record: conflicting reuse of a prediction id fails closed', () => {
  const s = createForecastCalibrationStore();
  s.record(pred());
  s.record(pred());
  assert.throws(
    () => s.record(pred({ targetKey: 'different-target' })),
    /conflicting prediction id/i,
  );
  assert.equal(s.get('p-1')?.targetKey, undefined);
});

test('expirePending: marks past-resolveBy predictions as expired', () => {
  const s = createForecastCalibrationStore();
  s.record(pred({ id: 'old', resolveBy: NOW - 1000 }));
  s.record(pred({ id: 'new', resolveBy: NOW + 30 * 24 * 60 * 60 * 1000 }));
  const expired = s.expirePending(NOW);
  assert.equal(expired, 1);
  assert.equal(s.get('old')?.status, 'expired');
  assert.equal(s.get('new')?.status, 'pending');
});

test('expirePending: leaves criteria-owned records to their resolver', () => {
  const s = createForecastCalibrationStore();
  s.record(pred({
    id: 'market',
    resolveBy: NOW,
    criteria: {
      kind: 'market_move',
      symbol: 'AAPL',
      direction: 'up',
      minAbsPct: 3,
      basisPrice: 100,
      basisObservedAt: NOW - 60_000,
    },
  }));

  assert.equal(s.expirePending(NOW + 29 * 60_000), 0);
  assert.equal(s.get('market')?.status, 'pending');
  assert.equal(s.expirePending(NOW + 31 * 60_000), 0);
  assert.equal(s.get('market')?.status, 'pending');
  assert.equal(s.expire('market', NOW + 31 * 60_000, 'unresolved:market-move-v1 insufficient coverage'), true);
  assert.equal(s.get('market')?.status, 'expired');
  assert.equal(
    s.get('market')?.resolutionNote,
    'unresolved:market-move-v1 insufficient coverage',
  );
});

// ── Brier score ────────────────────────────────────────────────────────

test('brier: perfect prediction → 0', () => {
  const records: PredictionRecord[] = [
    pred({ id: 'a', probability: 1, status: 'resolved_true' }),
    pred({ id: 'b', probability: 0, status: 'resolved_false' }),
  ];
  const result = brierScore(records);
  assert.equal(result.score, 0);
  assert.equal(result.evaluated, 2);
});

test('brier: random 0.5 prediction → 0.25', () => {
  const records: PredictionRecord[] = [
    pred({ id: 'a', probability: 0.5, status: 'resolved_true' }),
    pred({ id: 'b', probability: 0.5, status: 'resolved_false' }),
  ];
  const result = brierScore(records);
  assert.equal(result.score, 0.25);
});

test('brier: pending predictions are not counted', () => {
  const records: PredictionRecord[] = [
    pred({ id: 'a', probability: 0.7, status: 'pending' }),
    pred({ id: 'b', probability: 0.7, status: 'resolved_true' }),
  ];
  const result = brierScore(records);
  assert.equal(result.evaluated, 1);
});

test('brier: empty input returns score 0 evaluated 0', () => {
  const result = brierScore([]);
  assert.deepEqual(result, { score: 0, resolvedCount: 0, evaluated: 0 });
});

// ── Per-domain accuracy ────────────────────────────────────────────────

test('perDomainAccuracy: separates by domain', () => {
  const records: PredictionRecord[] = [
    pred({ id: 'wx-1', domain: 'weather', probability: 0.9, status: 'resolved_true' }),
    pred({ id: 'wx-2', domain: 'weather', probability: 0.8, status: 'resolved_true' }),
    pred({ id: 'm-1', domain: 'markets', probability: 0.6, status: 'resolved_false' }),
  ];
  const result = perDomainAccuracy(records);
  const wx = result.find((d) => d.domain === 'weather')!;
  const mk = result.find((d) => d.domain === 'markets')!;
  assert.equal(wx.predictionCount, 2);
  assert.equal(mk.predictionCount, 1);
  assert.equal(wx.hitRate, 1); // both true
  assert.equal(mk.hitRate, 0); // resolved_false
});

test('perDomainAccuracy: calibrationError = |meanProb - hitRate|', () => {
  const records: PredictionRecord[] = [
    pred({ id: 'a', domain: 'cyber', probability: 0.8, status: 'resolved_true' }),
    pred({ id: 'b', domain: 'cyber', probability: 0.8, status: 'resolved_true' }),
    pred({ id: 'c', domain: 'cyber', probability: 0.8, status: 'resolved_false' }),
  ];
  const result = perDomainAccuracy(records);
  const cyber = result.find((d) => d.domain === 'cyber')!;
  // meanProb = 0.8, hitRate = 2/3 ≈ 0.667 → calibrationError ≈ 0.133
  assert.ok(Math.abs(cyber.calibrationError - 0.133) < 0.01);
});

test('perDomainAccuracy: domain with only pending predictions reports 0 stats', () => {
  const records: PredictionRecord[] = [
    pred({ id: 'a', domain: 'aviation', status: 'pending' }),
  ];
  const result = perDomainAccuracy(records);
  const av = result.find((d) => d.domain === 'aviation')!;
  assert.equal(av.predictionCount, 1);
  assert.equal(av.brier, 0);
  assert.equal(av.hitRate, 0);
});

// ── Per-source multipliers ─────────────────────────────────────────────

test('perSourceMultipliers: well-calibrated source → multiplier ~1.5', () => {
  const records: PredictionRecord[] = Array.from({ length: 10 }).map((_, i) => pred({
    id: `s-${i}`,
    sourceId: 'great-source',
    probability: 1,
    status: i < 9 ? 'resolved_true' : 'resolved_true', // perfect record
  }));
  const result = perSourceMultipliers(records);
  const s = result.find((m) => m.sourceId === 'great-source')!;
  // Brier ≈ 0 → multiplier ≈ 1.5
  assert.ok(s.multiplier >= 1.4);
});

test('perSourceMultipliers: badly-calibrated source → multiplier near 0.5', () => {
  const records: PredictionRecord[] = Array.from({ length: 10 }).map((_, i) => pred({
    id: `s-${i}`,
    sourceId: 'bad-source',
    probability: 1, // confident
    status: 'resolved_false', // always wrong
  }));
  const result = perSourceMultipliers(records);
  const s = result.find((m) => m.sourceId === 'bad-source')!;
  // Brier = 1 → multiplier clamped to 0.5.
  assert.equal(s.multiplier, 0.5);
});

test('perSourceMultipliers: source below minResolvedForMultiplier defaults to 1.0', () => {
  const records: PredictionRecord[] = [
    pred({ id: 'a', sourceId: 'new-source', probability: 1, status: 'resolved_true' }),
  ];
  const result = perSourceMultipliers(records, { minResolvedForMultiplier: 5 });
  const s = result.find((m) => m.sourceId === 'new-source')!;
  assert.equal(s.multiplier, 1);
});

test('perSourceMultipliers: results sorted by multiplier desc', () => {
  const records: PredictionRecord[] = [
    ...Array.from({ length: 10 }).map((_, i) => pred({
      id: `b-${i}`, sourceId: 'bad', probability: 1, status: 'resolved_false' as const,
    })),
    ...Array.from({ length: 10 }).map((_, i) => pred({
      id: `g-${i}`, sourceId: 'good', probability: 1, status: 'resolved_true' as const,
    })),
  ];
  const result = perSourceMultipliers(records);
  assert.equal(result[0]!.sourceId, 'good');
  assert.equal(result[1]!.sourceId, 'bad');
});

// ── Store integration ──────────────────────────────────────────────────

test('store: brier + byDomain + bySource roll up correctly', () => {
  const s = createForecastCalibrationStore();
  for (let i = 0; i < 10; i += 1) {
    s.record(pred({ id: `s-${i}`, sourceId: 'wheat-model', probability: 0.8, status: i < 8 ? 'resolved_true' : 'resolved_false' }));
  }
  const b = s.brier();
  assert.ok(b.score < 0.25); // better than random
  const dom = s.byDomain();
  assert.equal(dom[0]!.predictionCount, 10);
  const src = s.bySource();
  assert.equal(src[0]!.sourceId, 'wheat-model');
});

// ── Persistence ────────────────────────────────────────────────────────

test('toJson + loadJson roundtrip', () => {
  const a = createForecastCalibrationStore();
  a.record(pred({
    criteria: {
      kind: 'market_move',
      symbol: 'AAPL',
      direction: 'up',
      minAbsPct: 3,
      basisPrice: 100,
      basisObservedAt: NOW,
    },
  }));
  a.resolve('p-1', true, NOW + 1, {
    note: 'direct:market_move fixture',
    provenance: {
      resolverId: 'market-move-v1',
      kind: 'direct',
      evidence: [{
        sourceIds: ['yahoo-finance'],
        observedAt: NOW + 1,
        value: 103,
        supportsOutcome: true,
      }],
    },
  });
  const json = a.toJson();
  const b = createForecastCalibrationStore();
  b.loadJson(json);
  assert.equal(b.get('p-1')?.status, 'resolved_true');
  assert.equal(b.get('p-1')?.criteria?.kind, 'market_move');
  assert.equal(b.get('p-1')?.resolutionProvenance?.evidence[0]?.value, 103);
});

// ── Determinism ────────────────────────────────────────────────────────

test('determinism: same inputs → same metrics', () => {
  const records: PredictionRecord[] = [
    pred({ id: 'a', probability: 0.6, status: 'resolved_true' }),
    pred({ id: 'b', probability: 0.7, status: 'resolved_false' }),
  ];
  const a = brierScore(records);
  const b = brierScore(records);
  assert.deepEqual(a, b);
});

// ── Plan invariants ────────────────────────────────────────────────────

test('invariant: every prediction logged includes algorithmVersion when supplied', () => {
  const s = createForecastCalibrationStore();
  s.record(pred({ algorithmVersion: 'wheat-model-v2' }));
  assert.equal(s.get('p-1')?.algorithmVersion, 'wheat-model-v2');
});
