/**
 * Loader-callable fetch for Binance public spot prices (no key) — the 2nd
 * crypto source for fusion alongside CoinGecko. Fail-closed: returns
 * { ok: false } on non-2xx, sidecar `degraded`, or a thrown error, so a dead
 * Binance source records a failing fetch (provider health drops) rather than
 * masquerading as healthy-but-empty.
 */

import { getApiBaseUrl } from '@/services/runtime';
import type { ExchangePrice } from './crypto-fusion-observations';

export interface BinanceFetchResult {
  ok: boolean;
  prices: ExchangePrice[];
}

export async function fetchBinancePrices(): Promise<BinanceFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/crypto-quotes-binance`, {
      signal: AbortSignal.timeout(10_000),
    });
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
