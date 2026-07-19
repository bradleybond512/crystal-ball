/**
 * Loader-callable fail-closed fetch for Coinbase public spot prices (no key) —
 * the 2nd crypto source for fusion alongside CoinGecko. Coinbase is used
 * instead of Binance global (HTTP 451 in the US) so the corroboration works
 * from US/restricted regions. Returns { ok: false } on non-2xx, sidecar
 * `degraded`, or a thrown error, so a dead source records a failing fetch.
 */

import { getApiBaseUrl } from '@/services/runtime';
import type { ExchangePrice } from './crypto-fusion-observations';

export interface CoinbaseFetchResult {
  ok: boolean;
  prices: ExchangePrice[];
}

export async function fetchCoinbasePrices(): Promise<CoinbaseFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/crypto-quotes-coinbase`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, prices: [] };
    const data = (await res.json()) as { quotes?: ExchangePrice[]; degraded?: boolean } | null;
    if (!data || data.degraded || !Array.isArray(data.quotes)) return { ok: false, prices: [] };
    const prices = data.quotes.filter(
      (q): q is ExchangePrice => !!q && typeof q.symbol === 'string' && Number.isFinite(q.price),
    );
    // A live 200 with all-null prices is a soft failure — matches coingecko-fetch behaviour.
    if (prices.length === 0) return { ok: false, prices: [] };
    return { ok: true, prices };
  } catch {
    return { ok: false, prices: [] };
  }
}
