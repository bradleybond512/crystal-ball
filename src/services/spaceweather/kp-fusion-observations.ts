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
