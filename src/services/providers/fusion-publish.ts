/**
 * Fusion publish: the live coordination point between per-domain fetchers
 * and the provider-redundancy report. Fetchers call recordDomainObservations()
 * for their provider; this records the fetch outcome, finds which fusion
 * domain the provider belongs to (via FUSION_DOMAINS), re-runs fusion across
 * that domain's providers, and exposes fingerprinted ProviderSnapshots that
 * the insights bridge overlays onto the redundancy report.
 *
 * Domain-agnostic: any fact-type declared in FUSION_DOMAINS is fused — adding
 * a domain needs only a FUSION_DOMAINS entry + provider registrations + an
 * adapter that calls recordDomainObservations. (Phase 0 hardcoded earthquakes;
 * this generalizes it so the redundancy work widens to every fused domain.)
 *
 * Singleton (like providers-state.ts) — not pure. The adapters that build
 * DomainObservation[] and the fusion math are pure + fixture-tested.
 */

import type { ProviderSnapshot } from '../diagnostics/provider-redundancy.ts';
import { ingestDomain, type DomainObservation, type IngestResult } from './fusion-ingest.ts';
import { recordProviderFetchOutcome, getProviderHealthState } from './providers-state.ts';
import { snapshotsFromRegistry } from './provider-bridge.ts';
import { FUSION_DOMAINS } from './provider-domain-map.ts';

let latestByProvider: Record<string, DomainObservation[]> = {};
/** Current fingerprint per provider, across all fused domains. */
let fingerprintsByProvider: Record<string, string> = {};

/** Which fusion-domain key a provider belongs to (first match wins). */
function domainKeyForProvider(providerId: string): string | undefined {
  for (const [key, cfg] of Object.entries(FUSION_DOMAINS)) {
    if (cfg.providerIds.includes(providerId)) return key;
  }
  return undefined;
}

/** Called by a fetcher after it loads (or fails to load) its observations.
 *  The fusion domain is derived from the providerId, so call sites stay
 *  identical across domains. */
export function recordDomainObservations(
  providerId: string,
  observations: DomainObservation[],
  ok: boolean,
  now = Date.now(),
): void {
  latestByProvider[providerId] = observations;
  recordProviderFetchOutcome(providerId, { ok, latencyMs: 0, at: now });

  const key = domainKeyForProvider(providerId);
  if (!key) return; // provider isn't part of any fused domain — nothing to recompute
  const cfg = FUSION_DOMAINS[key as keyof typeof FUSION_DOMAINS];
  const all = cfg.providerIds.flatMap((id) => latestByProvider[id] ?? []);
  const { providerFingerprints } = ingestDomain(key, all, getProviderHealthState(), now);
  // Replace this domain's providers' fingerprints (clear stale, set fresh).
  for (const id of cfg.providerIds) delete fingerprintsByProvider[id];
  Object.assign(fingerprintsByProvider, providerFingerprints);
}

/** Fingerprinted snapshots for every ACTIVE fused domain (a domain is active
 *  once at least one of its providers has recorded observations), so a domain
 *  never appears in the report until it's actually flowing. */
export function getFusionProviderSnapshots(now = Date.now()): readonly ProviderSnapshot[] {
  const activeProviderIds = new Set<string>();
  for (const cfg of Object.values(FUSION_DOMAINS)) {
    if (cfg.providerIds.some((id) => latestByProvider[id] !== undefined)) {
      for (const id of cfg.providerIds) activeProviderIds.add(id);
    }
  }
  if (activeProviderIds.size === 0) return [];
  return snapshotsFromRegistry(getProviderHealthState(), now, undefined, fingerprintsByProvider).filter(
    (s) => activeProviderIds.has(s.providerId),
  );
}

/** The full fused-fact result for a given fusion domain (for diagnostics/UI). */
export function getLatestFusion(domainKey: string, now = Date.now()): IngestResult {
  const cfg = FUSION_DOMAINS[domainKey as keyof typeof FUSION_DOMAINS];
  if (!cfg) return { facts: [], providerFingerprints: {} };
  const all = cfg.providerIds.flatMap((id) => latestByProvider[id] ?? []);
  return ingestDomain(domainKey, all, getProviderHealthState(), now);
}

/** Back-compat convenience for the earthquake keystone. */
export function getLatestEarthquakeFusion(now = Date.now()): IngestResult {
  return getLatestFusion('earthquakes', now);
}

export function resetFusionPublishForTest(): void {
  latestByProvider = {};
  fingerprintsByProvider = {};
}
