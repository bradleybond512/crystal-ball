/**
 * Loader-callable fail-closed fetch for CoinGecko spot prices, used as the
 * fusion signal (distinct from the panel's fetchCrypto(), which returns a
 * stale cache on failure — that would falsely mark the provider healthy).
 * Returns { ok: false } on non-2xx, an error response, or a thrown error.
 */

import { getApiBaseUrl } from '@/services/runtime';
import type { ExchangePrice } from './crypto-fusion-observations';

const ID_TO_SYMBOL: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  ripple: 'XRP',
};

interface CoingeckoQuote { id?: string; price?: number | null }

export interface CoingeckoFetchResult {
  ok: boolean;
  prices: ExchangePrice[];
}

export async function fetchCoingeckoPrices(): Promise<CoingeckoFetchResult> {
  try {
    const ids = Object.keys(ID_TO_SYMBOL).join(',');
    const res = await fetch(`${getApiBaseUrl()}/api/crypto-quotes?ids=${encodeURIComponent(ids)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, prices: [] };
    const data = (await res.json()) as { quotes?: CoingeckoQuote[]; error?: string } | null;
    if (!data || data.error || !Array.isArray(data.quotes)) return { ok: false, prices: [] };
    const prices: ExchangePrice[] = [];
    for (const q of data.quotes) {
      if (!q?.id || q.price == null || !Number.isFinite(q.price) || q.price <= 0) continue;
      prices.push({ symbol: ID_TO_SYMBOL[q.id] ?? q.id.toUpperCase(), price: q.price });
    }
    // A live 200 with all-null prices (CoinGecko soft failure) is not a success.
    if (prices.length === 0) return { ok: false, prices: [] };
    return { ok: true, prices };
  } catch {
    return { ok: false, prices: [] };
  }
}
