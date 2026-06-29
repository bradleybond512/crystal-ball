/**
 * Loader-callable fail-closed fetches for the two no-key stock-price sources
 * used in fusion: Stooq (batch CSV) + Yahoo Finance (chart). Both are no-key so
 * the corroboration works without anyone's API key. Returns { ok: false } on
 * non-2xx, sidecar `degraded`, or a thrown error so a dead source records a
 * failing fetch (provider health drops) instead of looking healthy-but-empty.
 */

import { getApiBaseUrl } from '@/services/runtime';
import type { ExchangePrice } from './crypto-fusion-observations';

export interface StockFetchResult {
  ok: boolean;
  prices: ExchangePrice[];
}

async function fetchStockRoute(path: string): Promise<StockFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, prices: [] };
    const data = (await res.json()) as { quotes?: ExchangePrice[]; degraded?: boolean } | null;
    if (!data || data.degraded || !Array.isArray(data.quotes)) return { ok: false, prices: [] };
    const prices = data.quotes.filter(
      (q): q is ExchangePrice => !!q && typeof q.symbol === 'string' && Number.isFinite(q.price),
    );
    return { ok: true, prices };
  } catch {
    return { ok: false, prices: [] };
  }
}

export function fetchStooqPrices(): Promise<StockFetchResult> {
  return fetchStockRoute('/api/stocks-stooq');
}

export function fetchYahooPrices(): Promise<StockFetchResult> {
  return fetchStockRoute('/api/stocks-yahoo');
}
