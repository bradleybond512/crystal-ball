/**
 * Pure adapter for the internet_outages fusion domain: per-country outage
 * counts from IODA and Cloudflare Radar, matched by ISO2 country code.
 *
 * A country has no single coordinate worth fusing on, so `lat`/`lon` are 0 and
 * matching is by key (see FUSION_DOMAINS.internet_outages).
 */

import type { DomainObservation } from '@/services/providers/fusion-ingest';

/** One outage onset attributed to a country. */
export interface OutageEvent {
  /** ISO2 country code. */
  country: string;
  /** Epoch ms the outage started. */
  startedAt: number;
}

/**
 * Both sources are counted over the same trailing window so their per-country
 * numbers are comparable. 6 h, matching FUSION_DOMAINS.internet_outages'
 * match window.
 */
export const OUTAGE_COUNT_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Count of outage onsets per country in the trailing window, as one key-matched
 * observation each. `now` is the wall clock and is used for BOTH the window
 * cutoff and `occurredAt` — the count describes the window ending now, not any
 * single upstream instant, so stamping it with an event time would misreport
 * the fact's age.
 */
export function outageCountsToObservations(
  providerId: string,
  events: readonly OutageEvent[],
  now: number,
): DomainObservation[] {
  const cutoff = now - OUTAGE_COUNT_WINDOW_MS;
  const counts = new Map<string, number>();
  for (const event of events) {
    // Under matchBy:'key' an undefined/empty key is worse than a dropped row:
    // it is either a permanent singleton or — if BOTH providers emit '' — a
    // bogus 2-vote "fact" fusing two unrelated junk rows.
    const country = typeof event.country === 'string' ? event.country.trim().toUpperCase() : '';
    if (!country) continue;
    // No upper bound on startedAt: a brand-new outage stamped a few seconds
    // ahead of our clock by a skewed upstream is the single most important row
    // in the feed, and dropping it would be the worst possible failure here.
    if (!Number.isFinite(event.startedAt) || event.startedAt < cutoff) continue;
    counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return [...counts].map(([country, count]) => ({
    providerId,
    key: country,
    value: count,
    lat: 0,
    lon: 0,
    occurredAt: now,
  }));
}
