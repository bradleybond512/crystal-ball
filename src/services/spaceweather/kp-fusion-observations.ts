/**
 * Pure adapter for the space_weather fusion domain: planetary Kp samples from
 * NOAA SWPC and GFZ Potsdam, matched by their 3-hour bin so the two agencies'
 * readings for the same interval corroborate each other.
 *
 * Kp is a planetary index with no geography, so `lat`/`lon` are 0 and matching
 * is by key (see FUSION_DOMAINS.space_weather).
 */

import type { DomainObservation } from '@/services/providers/fusion-ingest';

/** Kp is published in fixed 3-hour intervals: 00, 03, 06, ... UTC. */
export const KP_BIN_MS = 3 * 60 * 60 * 1000;

export interface KpSample {
  /** Epoch ms of the bin the reading covers. */
  observedAt: number;
  kp: number;
}

export function kpToObservations(providerId: string, samples: KpSample[]): DomainObservation[] {
  const out: DomainObservation[] = [];
  for (const sample of samples) {
    const { observedAt, kp } = sample;
    // An unparseable timestamp cannot produce a bin key, and under
    // matchBy:'key' an undefined/empty key is worse than a dropped row: it is
    // either a permanent singleton or — if BOTH providers emit '' — a bogus
    // 2-vote "fact" fusing two unrelated junk readings.
    if (!Number.isFinite(observedAt) || observedAt <= 0) continue;
    // Kp is bounded 0..9 by definition; anything outside is a sentinel or a
    // parse artifact, never a reading. `0` and `9` are both legitimate.
    if (!Number.isFinite(kp) || kp < 0 || kp > 9) continue;
    const binStart = Math.floor(observedAt / KP_BIN_MS) * KP_BIN_MS;
    out.push({
      providerId,
      key: new Date(binStart).toISOString(),
      value: kp,
      lat: 0,
      lon: 0,
      // The raw instant, not the bin start — the clustering time window then
      // measures real staleness between the two sources.
      occurredAt: observedAt,
    });
  }
  return out;
}

export interface KpVote {
  observations: DomainObservation[];
  ok: boolean;
}

/**
 * The health verdict and the recorded observations must come from the SAME
 * array. The fetches accept any finite kp, but kpToObservations drops values
 * outside 0..9 — so a source stuck on a sentinel (-1) would pass the fetch's
 * "I got rows" check and still contribute nothing, leaving the provider green
 * while the domain quietly runs single-source. Deriving `ok` from the output
 * makes the two predicates incapable of drifting apart.
 */
export function kpVote(providerId: string, fetchOk: boolean, samples: KpSample[]): KpVote {
  const observations = kpToObservations(providerId, samples);
  return { observations, ok: fetchOk && observations.length > 0 };
}
