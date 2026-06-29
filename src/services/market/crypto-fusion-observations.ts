/**
 * Pure adapters: convert each crypto source's quote shape into the generic
 * DomainObservation the fusion-ingest layer consumes — matched by SYMBOL
 * (key), value = USD price, no geography. No DOM, no fetch, no globals.
 */

import type { CryptoData } from '@/types';
import type { DomainObservation } from '@/services/providers/fusion-ingest';

/** A normalized exchange price keyed by base symbol (e.g. { symbol: 'BTC', price: 95000 }). */
export interface ExchangePrice {
  symbol: string;
  price: number;
}

export function coingeckoToObservations(data: readonly CryptoData[], now = Date.now()): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const c of data) {
    if (!c.symbol || !Number.isFinite(c.price) || c.price <= 0) continue;
    out.push({ providerId: 'coingecko', key: c.symbol.toUpperCase(), value: c.price, lat: 0, lon: 0, occurredAt: now });
  }
  return out;
}

export function binanceToObservations(prices: readonly ExchangePrice[], now = Date.now()): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const p of prices) {
    if (!p.symbol || !Number.isFinite(p.price) || p.price <= 0) continue;
    out.push({ providerId: 'binance-public', key: p.symbol.toUpperCase(), value: p.price, lat: 0, lon: 0, occurredAt: now });
  }
  return out;
}
