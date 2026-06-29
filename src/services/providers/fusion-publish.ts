/**
 * Fusion publish: the live coordination point between per-domain fetchers
 * and the provider-redundancy report. Fetchers call recordDomainObservations()
 * for their provider; this records the fetch outcome, re-runs fusion across
 * all providers of the fact-type, and exposes fingerprinted ProviderSnapshots
 * that the insights bridge overlays onto the redundancy report.
 *
 * Singleton (like providers-state.ts) — not pure. The adapters that build
 * DomainObservation[] and the fusion math are pure + fixture-tested.
 */

import type { ProviderSnapshot } from '../diagnostics/provider-redundancy.ts';
import { ingestDomain, type DomainObservation, type IngestResult } from './fusion-ingest.ts';
import { recordProviderFetchOutcome, getProviderHealthState } from './providers-state.ts';
import { snapshotsFromRegistry } from './provider-bridge.ts';

/** Earthquake providers (disasters domain) that fusion-publish manages.
 *  NOTE: Phase 0 fuses the seismic sub-slice of the broader 'disasters'
 *  domain only. The other disasters providers (gdacs/open-meteo-flood/
 *  nasa-eonet) are not yet fused, so the disasters redundancy verdict
 *  currently reflects seismic corroboration, not the whole domain. Widening
 *  this is Phase 1 work. */
const EARTHQUAKE_PROVIDERS = ['usgs-earthquakes', 'emsc-seismic'] as const;

let latestByProvider: Record<string, DomainObservation[]> = {};
let latestFingerprints: Record<string, string> = {};

/** Called by a fetcher after it loads (or fails to load) its observations. */
export function recordDomainObservations(
  providerId: string,
  observations: DomainObservation[],
  ok: boolean,
  now = Date.now(),
): void {
  latestByProvider[providerId] = observations;
  recordProviderFetchOutcome(providerId, { ok, latencyMs: 0, at: now });
  const all = EARTHQUAKE_PROVIDERS.flatMap((id) => latestByProvider[id] ?? []);
  latestFingerprints = ingestDomain('earthquakes', all, getProviderHealthState(), now).providerFingerprints;
}

/** Fingerprinted snapshots for the earthquake providers, health derived live. */
export function getFusionProviderSnapshots(now = Date.now()): readonly ProviderSnapshot[] {
  if (Object.keys(latestByProvider).length === 0) return [];
  return snapshotsFromRegistry(getProviderHealthState(), now, 'disasters', latestFingerprints).filter(
    (s) => (EARTHQUAKE_PROVIDERS as readonly string[]).includes(s.providerId),
  );
}

/** The full fused-fact result for the earthquake domain (for diagnostics/UI). */
export function getLatestEarthquakeFusion(now = Date.now()): IngestResult {
  const all = EARTHQUAKE_PROVIDERS.flatMap((id) => latestByProvider[id] ?? []);
  return ingestDomain('earthquakes', all, getProviderHealthState(), now);
}

export function resetFusionPublishForTest(): void {
  latestByProvider = {};
  latestFingerprints = {};
}
