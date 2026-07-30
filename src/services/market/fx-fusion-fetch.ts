/**
 * Fail-closed fetches + pure adapter for the fx_rates fusion domain:
 * Frankfurter (the ECB daily reference fixing) + open.er-api (a
 * continuously-updated aggregator). Rates are USD-based and matched by
 * currency code, so `value` is units per USD and there is no geography.
 */

import { getApiBaseUrl } from '@/services/runtime';
import type { DomainObservation } from '@/services/providers/fusion-ingest';

export interface FxFetchResult {
  ok: boolean;
  rates: Record<string, number>;
  /** When the quote was struck — NOT the fetch time. */
  observedAt: number;
}

/**
 * The currency codes fused across both sources. Frankfurter exposes 29 codes
 * and open.er-api 166; only the intersection can corroborate, and any code
 * carried by just one source would fuse as a permanent single-vote fact. All
 * seven verified present in both (probe 2026-07-30).
 */
export const FUSED_CURRENCIES = ['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY'] as const;

const FAILED: FxFetchResult = { ok: false, rates: {}, observedAt: 0 };

function failed(): FxFetchResult {
  return { ...FAILED };
}

/** Keep only fusable codes carrying a usable rate. */
function pickFusableRates(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const code of FUSED_CURRENCIES) {
    const value = source[code];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[code] = value;
  }
  return out;
}

export async function fetchFrankfurterRates(): Promise<FxFetchResult> {
  try {
    const url = `${getApiBaseUrl()}/api/fx-rates?base=USD&symbols=${FUSED_CURRENCIES.join(',')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return failed();
    const data = (await res.json()) as { rates?: unknown; date?: unknown; degraded?: boolean } | null;
    if (!data || data.degraded) return failed();
    // Frankfurter's `date` is the ECB fixing DATE with no time component,
    // which Date.parse correctly reads as UTC midnight — the instant the rate
    // actually refers to. Deliberately NOT stamped with the fetch time: a
    // Frankfurter serving a three-week-old fixing must look three weeks old.
    const observedAt = typeof data.date === 'string' ? Date.parse(data.date) : Number.NaN;
    if (!Number.isFinite(observedAt) || observedAt <= 0) return failed();
    const rates = pickFusableRates(data.rates);
    if (Object.keys(rates).length === 0) return failed();
    return { ok: true, rates, observedAt };
  } catch {
    return failed();
  }
}

export async function fetchErApiRates(): Promise<FxFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/fx-rates-erapi`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return failed();
    const data = (await res.json()) as { rates?: unknown; time_last_update_unix?: unknown; degraded?: boolean } | null;
    if (!data || data.degraded) return failed();
    // open.er-api stamps in epoch SECONDS, unlike every ms-based timestamp
    // elsewhere in this layer.
    const unixSeconds = data.time_last_update_unix;
    if (typeof unixSeconds !== 'number' || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return failed();
    const rates = pickFusableRates(data.rates);
    if (Object.keys(rates).length === 0) return failed();
    return { ok: true, rates, observedAt: unixSeconds * 1000 };
  } catch {
    return failed();
  }
}

export function fxRatesToObservations(
  providerId: string,
  rates: Record<string, number>,
  observedAt: number,
): DomainObservation[] {
  // A NaN occurredAt would defeat clustering's `Math.abs(delta) > max` time
  // guard (NaN > n is false), silently matching unrelated observations.
  if (!Number.isFinite(observedAt) || observedAt <= 0) return [];
  const out: DomainObservation[] = [];
  for (const [code, value] of Object.entries(rates)) {
    // A row without a currency code would fuse under matchBy:'key' as
    // key === undefined — findHomeCluster's `o.key !== undefined` guard means
    // it can never join a cluster, so it would silently become a permanent
    // 1-vote singleton rather than raising an error anywhere.
    if (!code) continue;
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push({ providerId, key: code.toUpperCase(), value, lat: 0, lon: 0, occurredAt: observedAt });
  }
  return out;
}
