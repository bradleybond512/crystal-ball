/**
 * Fail-closed Kraken public-ticker fetch — 4th crypto fusion source
 * (US-reachable exchange, no key, own independence group).
 */

import { fetchQuotesRoute, type QuotesFetchResult } from './quotes-route-fetch';

export function fetchKrakenPrices(): Promise<QuotesFetchResult> {
  return fetchQuotesRoute('/api/crypto-quotes-kraken');
}
