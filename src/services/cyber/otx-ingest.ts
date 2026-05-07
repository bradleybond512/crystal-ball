/**
 * Live OTX ingestion → APT tracker activity ledger.
 *
 * Pure transformer + thin fetcher. The sidecar route `/api/otx/pulses`
 * maintains the rolling 200-pulse window; this module fetches it, runs
 * each pulse through `matchPulseToGroup` + `pulseToActivityEvent` from
 * apt-tracker.ts, and returns the resulting AptActivityEvent[].
 *
 * Pulses that don't match any known APT group are dropped — the apt
 * tracker only cares about pulses attributable to a tracked actor.
 */

import {
  type AptGroup,
  type AptActivityEvent,
  type OtxPulse,
  matchPulseToGroup,
  pulseToActivityEvent,
} from './apt-tracker';

export interface OtxPulsesResponse {
  pulses: OtxPulse[];
  count: number;
  source: string;
  updatedAt: number;
  lastPolledAt: number;
  lastModifiedIso: string;
  degraded?: boolean;
  reason?: string;
  staleAfterError?: string;
}

export async function fetchOtxPulses(apiBaseUrl: string): Promise<OtxPulsesResponse> {
  const url = `${apiBaseUrl}/api/otx/pulses`;
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`/api/otx/pulses HTTP ${r.status}`);
  const payload = (await r.json()) as OtxPulsesResponse;
  if (!Array.isArray(payload?.pulses)) {
    throw new TypeError('/api/otx/pulses: malformed payload (pulses not array)');
  }
  return payload;
}

/** Convert a pulses array into apt-tracker activity events.
 *  Drops pulses with no matching group (apt-tracker tracks named actors
 *  only — generic IOC pulses go nowhere). Pure: no I/O. */
export function pulsesToActivityEvents(
  pulses: readonly OtxPulse[],
  groups: readonly AptGroup[],
): AptActivityEvent[] {
  const out: AptActivityEvent[] = [];
  for (const pulse of pulses) {
    const group = matchPulseToGroup(pulse, groups);
    if (!group) continue;
    const ev = pulseToActivityEvent(pulse, group);
    if (ev) out.push(ev);
  }
  return out;
}

/** Fetch + transform in one call. */
export async function refreshOtxActivity(
  apiBaseUrl: string,
  groups: readonly AptGroup[],
): Promise<{ events: AptActivityEvent[]; response: OtxPulsesResponse }> {
  const response = await fetchOtxPulses(apiBaseUrl);
  const events = pulsesToActivityEvents(response.pulses, groups);
  return { events, response };
}
