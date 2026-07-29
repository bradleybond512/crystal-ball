/**
 * Fail-closed Financial Modeling Prep stock quotes — 3rd equities fusion
 * source, keyed. Real per-quote timestamps (not EOD/synthetic), so it
 * corroborates against Yahoo/Finnhub whenever FMP_API_KEY is set.
 */
import { getApiBaseUrl } from '@/services/runtime';

export interface FmpQuote { symbol: string; price: number; observedAt: number }
export interface FmpFetchResult { ok: boolean; quotes: FmpQuote[] }

export async function fetchFmpPrices(): Promise<FmpFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/stocks-fmp`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, quotes: [] };
    const data = (await res.json()) as { quotes?: FmpQuote[]; degraded?: boolean; error?: string } | null;
    if (!data || data.degraded || data.error || !Array.isArray(data.quotes)) return { ok: false, quotes: [] };
    const quotes = data.quotes.filter((q): q is FmpQuote =>
      !!q && typeof q.symbol === 'string' && Number.isFinite(q.price) && q.price > 0 && Number.isFinite(q.observedAt));
    if (quotes.length === 0) return { ok: false, quotes: [] };
    return { ok: true, quotes };
  } catch {
    return { ok: false, quotes: [] };
  }
}
