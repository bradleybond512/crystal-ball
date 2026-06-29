import assert from 'node:assert/strict';
import test from 'node:test';

import { exchangePricesToObservations, type ExchangePrice } from '../crypto-fusion-observations.ts';

const NOW = 1_745_000_000_000;

test('maps normalized exchange prices to keyed DomainObservations', () => {
  const prices: ExchangePrice[] = [{ symbol: 'btc', price: 95_500 }, { symbol: 'ETH', price: 3_500 }];
  const obs = exchangePricesToObservations('coingecko', prices, NOW);
  assert.equal(obs.length, 2);
  assert.deepEqual(obs[0], { providerId: 'coingecko', key: 'BTC', value: 95_500, lat: 0, lon: 0, occurredAt: NOW });
  assert.equal(obs[1]!.key, 'ETH');
});

test('carries the providerId through (coinbase)', () => {
  const obs = exchangePricesToObservations('coinbase', [{ symbol: 'BTC', price: 95_400 }], NOW);
  assert.equal(obs[0]!.providerId, 'coinbase');
});

test('skips non-positive / non-finite prices and empty symbols', () => {
  assert.equal(exchangePricesToObservations('coingecko', [{ symbol: 'BTC', price: 0 }], NOW).length, 0);
  assert.equal(exchangePricesToObservations('coingecko', [{ symbol: 'BTC', price: Number.NaN }], NOW).length, 0);
  assert.equal(exchangePricesToObservations('coingecko', [{ symbol: '', price: 1 }], NOW).length, 0);
});
