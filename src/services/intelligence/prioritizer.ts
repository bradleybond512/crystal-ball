import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import type { SavedPlace } from '@/services/saved-places';
import { haversineKm } from '@/services/proximity-filter';

export interface PrioritizedEvent extends ObservationEvent {
  relevanceScore: number;
  relevanceReason: string;
}

export interface PrioritizeOptions {
  correlatedEventIds?: ReadonlySet<string>;
  domainWeights?: Record<string, number>;
}

const SEVERITY_SCORES: Record<ObservationSeverity, number> = {
  CRITICAL: 30,
  HIGH: 20,
  MEDIUM: 10,
  LOW: 5,
  INFO: 0,
};

function proximityBonus(event: ObservationEvent, savedPlaces: SavedPlace[]): number {
  if (!event.location || savedPlaces.length === 0) return 0;
  const { lat, lon } = event.location;
  let best = Infinity;
  for (const place of savedPlaces) {
    const d = haversineKm(lat, lon, place.lat, place.lon);
    if (d < best) best = d;
  }
  if (best <= 100) return 40;
  if (best <= 500) return 25;
  return 0;
}

function recencyBonus(timestamp: number, nowMs: number): number {
  const ageMs = nowMs - timestamp;
  if (ageMs <= 5 * 60_000) return 10;
  if (ageMs <= 30 * 60_000) return 5;
  if (ageMs <= 2 * 60 * 60_000) return 2;
  return 0;
}

function buildReason(
  prox: number,
  sev: number,
  rec: number,
  corr: number,
  weight: number,
): string {
  const parts: string[] = [];
  if (prox > 0) parts.push(`proximity +${prox}`);
  if (sev > 0) parts.push(`severity +${sev}`);
  if (rec > 0) parts.push(`recency +${rec}`);
  if (corr > 0) parts.push(`correlated +${corr}`);
  if (weight !== 1) parts.push(`domain ×${weight}`);
  return parts.join(', ') || 'base score';
}

export function prioritize(
  events: ObservationEvent[],
  savedPlaces: SavedPlace[],
  opts: PrioritizeOptions = {},
  nowMs: number = Date.now(),
): PrioritizedEvent[] {
  const { correlatedEventIds, domainWeights = {} } = opts;

  return events
    .map((event): PrioritizedEvent => {
      const prox = proximityBonus(event, savedPlaces);
      const sev = SEVERITY_SCORES[event.severity] ?? 0;
      const rec = recencyBonus(event.timestamp, nowMs);
      const corr = correlatedEventIds?.has(event.id) ? 10 : 0;
      const weight = domainWeights[event.domain] ?? 1;

      const raw = (prox + sev + rec + corr) * weight;
      const relevanceScore = Math.min(100, Math.max(0, Math.round(raw)));

      return {
        ...event,
        relevanceScore,
        relevanceReason: buildReason(prox, sev, rec, corr, weight),
      };
    })
    .sort((a, b) =>
      b.relevanceScore === a.relevanceScore
        ? b.timestamp - a.timestamp
        : b.relevanceScore - a.relevanceScore,
    );
}
