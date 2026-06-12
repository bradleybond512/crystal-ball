/**
 * Provider health: pure record/derive over a per-provider ring buffer of
 * fetch outcomes. Callers report outcomes; this module derives status.
 * No timers, no Date.now() — `now` is always caller-supplied.
 */

import type { FetchOutcome, ProviderHealth } from './provider-types.ts';
import { getProviderDefinition } from './provider-registry.ts';

export const OUTCOME_RING_LIMIT = 50;
export const DOWN_CONSECUTIVE_FAILURES = 3;
export const DEGRADED_SUCCESS_RATE = 0.7;
const QUOTA_LOOKBACK = 10;

export interface ProviderHealthState {
  /** providerId → outcomes, oldest first, bounded to OUTCOME_RING_LIMIT. */
  readonly outcomes: Readonly<Record<string, readonly FetchOutcome[]>>;
}

export function emptyProviderHealthState(): ProviderHealthState {
  return { outcomes: {} };
}

export function recordFetchOutcome(
  state: ProviderHealthState,
  providerId: string,
  outcome: FetchOutcome,
): ProviderHealthState {
  if (!getProviderDefinition(providerId)) return state; // unknown provider: no-op
  const prev = state.outcomes[providerId] ?? [];
  const next = [...prev, outcome].slice(-OUTCOME_RING_LIMIT);
  return { outcomes: { ...state.outcomes, [providerId]: next } };
}

export function deriveProviderHealth(
  state: ProviderHealthState,
  providerId: string,
  now: number,
): ProviderHealth {
  const def = getProviderDefinition(providerId);
  if (!def) {
    return {
      providerId, status: 'unknown_provider', successRate: 0, p50LatencyMs: 0,
      quotaSuspected: false, reason: `Provider '${providerId}' is not in the registry.`,
    };
  }
  const outcomes = state.outcomes[providerId] ?? [];
  if (outcomes.length === 0) {
    return {
      providerId, status: 'stale', successRate: 1, p50LatencyMs: 0,
      quotaSuspected: false, reason: 'No fetch outcomes recorded yet.',
    };
  }

  const successes = outcomes.filter((o) => o.ok);
  const successRate = successes.length / outcomes.length;
  const lastSuccessAt = successes.length > 0 ? successes[successes.length - 1]!.at : undefined;
  const lastFailure = [...outcomes].reverse().find((o) => !o.ok);

  let consecutiveFailures = 0;
  for (let i = outcomes.length - 1; i >= 0 && outcomes[i] && !outcomes[i]!.ok; i--) consecutiveFailures += 1;

  const recent = outcomes.slice(-QUOTA_LOOKBACK);
  const has429 = recent.some((o) => o.httpStatus === 429);
  const forbidden = recent.filter((o) => o.httpStatus === 403).length;
  const quotaSuspected = has429 || (forbidden >= 2 && successes.length > 0);

  let status: ProviderHealth['status'];
  let reason: string;
  if (consecutiveFailures >= DOWN_CONSECUTIVE_FAILURES) {
    status = 'down';
    reason = `${consecutiveFailures} consecutive failures.`;
  } else if (successRate < DEGRADED_SUCCESS_RATE) {
    status = 'degraded';
    reason = `Success rate ${Math.round(successRate * 100)}% over last ${outcomes.length} fetches.`;
  } else if (lastSuccessAt === undefined || now - lastSuccessAt > def.freshnessTtlMs) {
    status = 'stale';
    const agoStr = lastSuccessAt === undefined ? 'never' : `${Math.round((now - lastSuccessAt) / 60_000)} min ago`;
    reason = `Last success ${agoStr}; TTL ${Math.round(def.freshnessTtlMs / 60_000)} min.`;
  } else {
    status = 'healthy';
    reason = `Success rate ${Math.round(successRate * 100)}%, fresh within TTL.`;
  }

  return {
    providerId, status, successRate,
    p50LatencyMs: median(successes.map((o) => o.latencyMs)),
    quotaSuspected, lastSuccessAt,
    lastError: lastFailure?.errorMessage,
    reason,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
