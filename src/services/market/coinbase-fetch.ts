/**
 * Fail-closed fetch for Coinbase public spot prices (no key) — 2nd crypto
 * fusion source alongside CoinGecko. Coinbase is used instead of Binance
 * global (HTTP 451 in the US) so the corroboration works from US/restricted
 * regions.
 */

import { fetchQuotesRoute, type QuotesFetchResult } from './quotes-route-fetch';

export function fetchCoinbasePrices(): Promise<QuotesFetchResult> {
  return fetchQuotesRoute('/api/crypto-quotes-coinbase');
}
