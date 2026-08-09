/**
 * Fail-closed fetches for the live stock-price fusion sources: Yahoo Finance
 * (no-key chart) + Finnhub (keyed). The third equities source, FMP, lives in
 * fmp-fetch.ts because its rows carry real per-quote timestamps rather than
 * fetch-time stamps.
 */

import { fetchQuotesRoute, type QuotesFetchResult } from './quotes-route-fetch';

export function fetchFinnhubPrices(): Promise<QuotesFetchResult> {
  return fetchQuotesRoute('/api/stocks-finnhub');
}

export function fetchYahooPrices(): Promise<QuotesFetchResult> {
  return fetchQuotesRoute('/api/stocks-yahoo');
}
