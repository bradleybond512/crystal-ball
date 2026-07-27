import assert from 'node:assert/strict';
import test from 'node:test';
import { createForecastCalibrationStore } from '../forecast-calibration.ts';
import type {
  MarketMoveCriteria,
  PredictionRecord,
} from '../forecast-calibration.ts';
import {
  MARKET_DEADLINE_COVERAGE_MS,
  marketMoveResolver,
  runOutcomeResolvers,
} from '../outcome-resolvers.ts';
import type { SpotPriceObservation } from '../../market/spot-price-store.ts';

const HOUR = 60 * 60 * 1000;
const RESOLVE_BY = 2 * HOUR;

function prediction(overrides: Partial<MarketMoveCriteria> = {}): PredictionRecord {
  return {
    id: 'hyp:aapl:1',
    sourceId: 'analyst-loop',
    targetKey: 'hypothesis:aapl',
    domain: 'markets',
    claim: 'AAPL rallies',
    probability: 0.6,
    predictedAt: 0,
    resolveBy: RESOLVE_BY,
    status: 'pending',
    criteria: {
      kind: 'market_move',
      symbol: 'AAPL',
      direction: 'up',
      minAbsPct: 3,
      basisPrice: 100,
      basisObservedAt: 0,
      ...overrides,
    },
  };
}

function spot(price: number, observedAt: number): SpotPriceObservation {
  return {
    symbol: 'AAPL',
    price,
    observedAt,
    providerIds: ['yahoo-finance', 'finnhub'],
    independentSourceCount: 2,
    confidence: 0.82,
  };
}

function context(samples: readonly SpotPriceObservation[], now: number) {
  return {
    now,
    spotHistoryFor: (_symbol: string, sinceExclusive: number, untilInclusive: number) =>
      samples.filter((sample) =>
        sample.observedAt > sinceExclusive && sample.observedAt <= untilInclusive),
    queryObservations: () => [],
  };
}

test('first threshold cross in the predicted direction resolves true with direct provenance', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([spot(101, 10), spot(103.5, 20)], 20),
  );

  assert.equal(verdict?.outcome, true);
  assert.match(verdict?.metadata.note ?? '', /^direct:market_move/);
  assert.deepEqual(verdict?.metadata.provenance.evidence[0]?.sourceIds, [
    'yahoo-finance',
    'finnhub',
  ]);
  assert.equal(verdict?.metadata.provenance.evidence[0]?.observedAt, 20);
});

test('first threshold cross against the predicted direction resolves false', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([spot(96.5, 20)], 20),
  );

  assert.equal(verdict?.outcome, false);
  assert.match(verdict?.metadata.note ?? '', /^direct:market_move/);
});

test('first crossing wins instead of cherry-picking a later reversal', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([spot(96, 10), spot(104, 20)], 20),
  );

  assert.equal(verdict?.outcome, false);
  assert.equal(verdict?.metadata.provenance.evidence[0]?.observedAt, 10);
});

test('no cross before the deadline stays pending', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([spot(101, HOUR)], HOUR),
  );
  assert.equal(verdict, null);
});

test('post-deadline samples are ignored and cannot create look-ahead leakage', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([spot(104, RESOLVE_BY + 1)], RESOLVE_BY + HOUR),
  );
  assert.equal(verdict, null);
});

test('deadline miss requires fresh in-window coverage and is proxy-marked', () => {
  const covered = Array.from(
    { length: RESOLVE_BY / (10 * 60_000) },
    (_, index) => spot(101, (index + 1) * 10 * 60_000),
  );
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context(covered, RESOLVE_BY + 1),
  );

  assert.equal(verdict?.outcome, false);
  assert.match(verdict?.metadata.note ?? '', /^proxy:market_move/);
  assert.equal(verdict?.metadata.provenance.kind, 'proxy');
});

test('deadline miss stays ungraded when the final observation is too old', () => {
  const stale = spot(101, RESOLVE_BY - MARKET_DEADLINE_COVERAGE_MS - 1);
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([stale], RESOLVE_BY + HOUR),
  );
  assert.equal(verdict, null);
});

test('deadline miss stays ungraded when the in-window history has a coverage gap', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([
      spot(100.5, 10 * 60_000),
      spot(101, RESOLVE_BY - 5 * 60_000),
    ], RESOLVE_BY + 1),
  );
  assert.equal(verdict, null);
});

test('dispatcher skips legacy records, resolves once, and persists resolution metadata', () => {
  const store = createForecastCalibrationStore();
  store.record(prediction());
  store.record({ ...prediction(), id: 'legacy', criteria: undefined });
  const ctx = context([spot(104, 20)], 20);

  assert.equal(runOutcomeResolvers(store, ctx, [marketMoveResolver]), 1);
  assert.equal(runOutcomeResolvers(store, ctx, [marketMoveResolver]), 0);
  assert.equal(store.get('hyp:aapl:1')?.status, 'resolved_true');
  assert.equal(store.get('hyp:aapl:1')?.resolutionProvenance?.resolverId, 'market-move-v1');
  assert.equal(store.get('legacy')?.status, 'pending');
});

test('dispatcher explicitly expires resolver-owned records that lack evidence after grace', () => {
  const store = createForecastCalibrationStore();
  store.record(prediction());
  const now = RESOLVE_BY + 31 * 60_000;

  assert.equal(
    runOutcomeResolvers(store, context([], now), [marketMoveResolver]),
    0,
  );
  assert.equal(store.get('hyp:aapl:1')?.status, 'expired');
  assert.match(store.get('hyp:aapl:1')?.resolutionNote ?? '', /^unresolved:market-move-v1/);
});

test('malformed criteria fail closed instead of producing a label', () => {
  const malformed = prediction({ basisPrice: 0 });
  assert.equal(
    marketMoveResolver.resolve(malformed, context([spot(104, 20)], 20)),
    null,
  );
});
