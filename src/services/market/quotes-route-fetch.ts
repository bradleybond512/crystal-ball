/**
 * Shared fail-closed fetch for sidecar quote routes that return
 * `{ quotes: ExchangePrice[], degraded?, error? }`. Any soft failure —
 * non-2xx, degraded (incl. missing key), error payload, malformed body,
 * or zero valid rows — resolves { ok: false } so a dead source records a
 * failing fetch (provider health drops) instead of looking healthy-but-empty.
 *
 * Used by the fusion sources whose routes share this exact payload shape:
 * Coinbase, CoinPaprika, Kraken, Yahoo, Finnhub. CoinGecko keeps its own
 * fetch (id-mapped payload); FMP keeps its own (rows carry observedAt).
 */

import { getApiBaseUrl } from '@/services/runtime';
import type { ExchangePrice } from './crypto-fusion-observations';

export interface QuotesFetchResult {
  ok: boolean;
  prices: ExchangePrice[];
}

export async function fetchQuotesRoute(path: string): Promise<QuotesFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, prices: [] };
    const data = (await res.json()) as { quotes?: ExchangePrice[]; degraded?: boolean; error?: string } | null;
    if (!data || data.degraded || data.error || !Array.isArray(data.quotes)) return { ok: false, prices: [] };
    const prices = data.quotes.filter(
      (q): q is ExchangePrice => !!q && typeof q.symbol === 'string' && Number.isFinite(q.price) && q.price > 0,
    );
    if (prices.length === 0) return { ok: false, prices: [] };
    return { ok: true, prices };
  } catch {
    return { ok: false, prices: [] };
  }
}
