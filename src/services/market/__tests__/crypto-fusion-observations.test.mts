import assert from 'node:assert/strict';
import test from 'node:test';

import { coingeckoToObservations, binanceToObservations, type ExchangePrice } from '../crypto-fusion-observations.ts';
import type { CryptoData } from '@/types';

const NOW = 1_745_000_000_000;

function cg(o: Partial<CryptoData> = {}): CryptoData {
  return { name: 'Bitcoin', symbol: 'BTC', price: 95_000, change: 1.2, ...o };
}

test('CoinGecko adapter maps symbol(key)+price to a DomainObservation', () => {
  const obs = coingeckoToObservations([cg({ symbol: 'btc', price: 95_500 })], NOW);
  assert.equal(obs.length, 1);
  assert.deepEqual(obs[0], { providerId: 'coingecko', key: 'BTC', value: 95_500, lat: 0, lon: 0, occurredAt: NOW });
});

test('CoinGecko adapter skips non-positive / non-finite prices', () => {
  assert.equal(coingeckoToObservations([cg({ price: 0 })], NOW).length, 0);
  assert.equal(coingeckoToObservations([cg({ price: Number.NaN })], NOW).length, 0);
});

test('Binance adapter maps normalized exchange prices', () => {
  const prices: ExchangePrice[] = [{ symbol: 'BTC', price: 95_400 }, { symbol: 'eth', price: 3_500 }];
  const obs = binanceToObservations(prices, NOW);
  assert.equal(obs.length, 2);
  assert.equal(obs[0]!.providerId, 'binance-public');
  assert.equal(obs[0]!.key, 'BTC');
  assert.equal(obs[1]!.key, 'ETH');
});

test('Binance adapter skips invalid prices', () => {
  assert.equal(binanceToObservations([{ symbol: 'BTC', price: -1 }], NOW).length, 0);
});
