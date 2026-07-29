/**
 * Fail-closed CoinPaprika spot-price fetch — 3rd crypto fusion source
 * (aggregator, no key, own independence group).
 */

import { fetchQuotesRoute, type QuotesFetchResult } from './quotes-route-fetch';

export function fetchCoinpaprikaPrices(): Promise<QuotesFetchResult> {
  return fetchQuotesRoute('/api/crypto-quotes-coinpaprika');
}
