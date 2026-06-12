/**
 * Singleton provider-health state. Fetch sites call
 * recordProviderFetchOutcome(); readers derive via the pure modules.
 * In-memory only for this batch (no persistence across restarts).
 */

import type { FetchOutcome } from './provider-types.ts';
import type { ProviderHealthState } from './provider-health.ts';
import { emptyProviderHealthState, recordFetchOutcome } from './provider-health.ts';

let state: ProviderHealthState = emptyProviderHealthState();

export function recordProviderFetchOutcome(providerId: string, outcome: FetchOutcome): void {
  state = recordFetchOutcome(state, providerId, outcome);
}

export function getProviderHealthState(): ProviderHealthState {
  return state;
}

export function resetProvidersStateForTest(): void {
  state = emptyProviderHealthState();
}
