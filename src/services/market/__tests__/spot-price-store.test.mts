import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { FusedFact } from '../../providers/fusion-ingest.ts';

const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
};

import {
  MAX_SPOT_SAMPLES_PER_SYMBOL,
  _resetSpotPriceStoreForTests,
  getLatestSpotPrice,
  getSpotPriceDiagnostics,
  getSpotPriceHistory,
  recordFusedSpotPrices,
} from '../spot-price-store.ts';

function fact(
  symbol: string,
  price: number,
  observedAt: number,
  independentSourceCount = 2,
): FusedFact {
  const providerIds = independentSourceCount > 1
    ? ['yahoo-finance', 'finnhub']
    : ['yahoo-finance'];
  return {
    key: symbol,
    value: price,
    lat: 0,
    lon: 0,
    occurredAt: observedAt,
    providerIds,
    fingerprints: {},
    fusion: {
      confidenceMultiplier: independentSourceCount > 1 ? 0.82 : 0.51,
      label: independentSourceCount > 1 ? 'very_high' : 'moderate',
      components: {
        freshness: { score: 1, reason: 'fixture' },
        reliability: { score: 0.8, reason: 'fixture' },
        corroboration: { score: independentSourceCount > 1 ? 0.8 : 0.5, reason: 'fixture' },
      },
      disagreements: [],
      independentSourceCount,
    },
  };
}

beforeEach(() => {
  memory.clear();
  _resetSpotPriceStoreForTests({ clearPersistence: true });
});

test('records fused observations case-insensitively and returns an as-of price', () => {
  recordFusedSpotPrices([fact('aapl', 210.5, 1_000)]);
  recordFusedSpotPrices([fact('AAPL', 211, 2_000)]);

  assert.equal(getLatestSpotPrice('AAPL')?.price, 211);
  assert.equal(getLatestSpotPrice('aapl', 1_500)?.price, 210.5);
  assert.equal(getLatestSpotPrice('AAPL', 999), null);
  assert.equal(getLatestSpotPrice('MSFT'), null);
});

test('history queries are sorted, bounded, and never include future observations', () => {
  recordFusedSpotPrices([
    fact('AAPL', 103, 3_000),
    fact('AAPL', 101, 1_000),
    fact('AAPL', 102, 2_000),
  ]);

  assert.deepEqual(
    getSpotPriceHistory('AAPL', { sinceExclusive: 1_000, untilInclusive: 2_500 })
      .map((sample) => sample.observedAt),
    [2_000],
  );
});

test('same-timestamp duplicates keep the better-corroborated fused observation', () => {
  recordFusedSpotPrices([fact('AAPL', 100, 1_000, 1)]);
  recordFusedSpotPrices([fact('AAPL', 100.2, 1_000, 2)]);
  recordFusedSpotPrices([fact('AAPL', 99, 1_000, 1)]);

  const history = getSpotPriceHistory('AAPL');
  assert.equal(history.length, 1);
  assert.equal(history[0]?.price, 100.2);
  assert.equal(history[0]?.independentSourceCount, 2);
});

test('ground-truth provenance excludes providers that fusion marked as disagreeing', () => {
  const disagreed = fact('AAPL', 100, 1_000, 2);
  disagreed.fusion.independentSourceCount = 1;
  disagreed.fusion.disagreements = [{
    providerIds: ['finnhub'],
    value: 97,
    reason: 'fixture disagreement',
  }];
  recordFusedSpotPrices([disagreed]);

  assert.deepEqual(
    getLatestSpotPrice('AAPL')?.providerIds,
    ['yahoo-finance'],
  );
});

test('rejects malformed external price observations', () => {
  recordFusedSpotPrices([
    fact('', 100, 1_000),
    fact('AAPL', 0, 1_000),
    fact('MSFT', Number.NaN, 1_000),
    fact('TSLA', 100, Number.POSITIVE_INFINITY),
  ]);
  assert.deepEqual(getSpotPriceDiagnostics(2_000), {
    symbolCount: 0,
    sampleCount: 0,
    latestObservedAt: null,
    staleSymbolCount: 0,
  });
});

test('retention is bounded per symbol', () => {
  for (let i = 0; i < MAX_SPOT_SAMPLES_PER_SYMBOL + 5; i += 1) {
    recordFusedSpotPrices([fact('AAPL', 100 + i, 1_000 + i)]);
  }

  const history = getSpotPriceHistory('AAPL');
  assert.equal(history.length, MAX_SPOT_SAMPLES_PER_SYMBOL);
  assert.equal(history[0]?.observedAt, 1_005);
});

test('bounded history reloads from persistence after an app restart', () => {
  recordFusedSpotPrices([fact('AAPL', 210.5, 1_000)]);
  _resetSpotPriceStoreForTests();

  assert.equal(getLatestSpotPrice('AAPL')?.price, 210.5);
});
