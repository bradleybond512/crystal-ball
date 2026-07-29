/**
 * Fail-closed CoinPaprika spot-price fetch — 3rd crypto fusion source.
 * { ok:false } on non-2xx, error payload, or empty quotes (soft failure).
 */
import { getApiBaseUrl } from '@/services/runtime';
import type { ExchangePrice } from './crypto-fusion-observations';

export interface CryptoQuoteFetchResult { ok: boolean; prices: ExchangePrice[] }

export async function fetchCoinpaprikaPrices(): Promise<CryptoQuoteFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/crypto-quotes-coinpaprika`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, prices: [] };
    const data = (await res.json()) as { quotes?: ExchangePrice[]; degraded?: boolean; error?: string } | null;
    if (!data || data.degraded || data.error || !Array.isArray(data.quotes)) return { ok: false, prices: [] };
    const prices = data.quotes.filter((q): q is ExchangePrice => !!q && typeof q.symbol === 'string' && Number.isFinite(q.price) && q.price > 0);
    if (prices.length === 0) return { ok: false, prices: [] };
    return { ok: true, prices };
  } catch {
    return { ok: false, prices: [] };
  }
}
