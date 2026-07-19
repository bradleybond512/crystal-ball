import type { BeliefValue } from '@/types/belief';
import { createBelief } from '@/services/intelligence/belief-helpers';

export const EVENT_TAXONOMY = [
  'conflict',
  'protest',
  'riot',
  'military_activity',
  'cyber_incident',
  'internet_disruption',
  'weather_disaster',
  'earthquake',
  'economic_shock',
  'sanctions_action',
  'shipping_disruption',
  'aviation_anomaly',
  'outbreak',
  'humanitarian_update',
  'displacement',
  'food_insecurity',
  'energy_disruption',
  'wildfire',
  'flooding',
] as const;

export type EventType = (typeof EVENT_TAXONOMY)[number];

export type TimestampPrecision = 'exact' | 'hour' | 'day' | 'approximate';

export interface NormalizedTimestamp {
  utc: string;
  sourceOriginal: string;
  precision: TimestampPrecision;
}

export function normalizeTimestamp(raw: string): NormalizedTimestamp {
  let precision: TimestampPrecision;
  if (raw.includes('T')) {
    const timePart = raw.split('T')[1];
    if (timePart && timePart.includes(':') && /\d{2}:\d{2}/.test(timePart)) {
      const colonCount = (timePart.match(/:/g) ?? []).length;
      precision = colonCount >= 2 ? 'exact' : 'hour';
    } else {
      precision = 'hour';
    }
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    precision = 'day';
  } else {
    precision = 'approximate';
  }

  const date = new Date(raw);
  return {
    utc: date.toISOString(),
    sourceOriginal: raw,
    precision,
  };
}

export interface NormalizedLocation {
  lat?: number;
  lon?: number;
  country?: string;
  region?: string;
  admin1?: string;
  sourceLabel?: string;
  confidence: number;
  /** First-class probability view of `confidence` (AI-2 BeliefValue). Optional
   *  because NormalizedLocation is built via spread and not every caller
   *  threads the belief through; populated by `normalizeLocation`. */
  confidenceBelief?: BeliefValue;
}

export function normalizeLocation(input: {
  lat?: number;
  lon?: number;
  country?: string;
  region?: string;
  admin1?: string;
  sourceLabel?: string;
}): NormalizedLocation {
  const hasCoords = input.lat !== undefined && input.lon !== undefined;
  const hasCountry = !!input.country;

  let confidence: number;
  if (hasCoords && hasCountry) {
    confidence = 0.95;
  } else if (hasCoords) {
    confidence = 0.8;
  } else if (hasCountry) {
    confidence = 0.4;
  } else {
    confidence = 0.1;
  }

  return {
    ...input,
    confidence,
    confidenceBelief: createBelief(confidence, {
      provenance: input.sourceLabel ? [input.sourceLabel] : [],
    }),
  };
}

export function SEVERITY_BUCKETS(score: number): string {
  if (score < 20) return 'low';
  if (score < 45) return 'moderate';
  if (score < 65) return 'notable';
  if (score < 85) return 'high';
  return 'critical';
}

export interface NormalizedEvent {
  id: string;
  eventType: EventType;
  timestamp: NormalizedTimestamp;
  location: NormalizedLocation;
  title: string;
  summary?: string;
  severity: number;
  severityLabel: string;
  sourceId: string;
  sourceName: string;
  sourceUrl?: string;
  tags: string[];
  entities: string[];
  rawPayload?: unknown;
  ingestedAt: string;
}

export interface CanonicalEntity {
  id: string;
  name: string;
  aliases: string[];
  type: 'country' | 'actor' | 'organization' | 'location' | 'commodity' | 'other';
  metadata: Record<string, unknown>;
}

export interface EntityRelationship {
  fromEntityId: string;
  toEntityId: string;
  relationshipType: string;
  confidence: number;
  evidenceEventIds: string[];
}

export interface CorrelationResult {
  id: string;
  eventIds: string[];
  entityIds: string[];
  score: number;
  scoreLabel: string;
  clusterType: string;
  timespan: { start: string; end: string };
  location?: NormalizedLocation;
  summary: string;
  createdAt: string;
}

export interface CorrelationAlert {
  id: string;
  correlationId: string;
  alertType: string;
  severity: number;
  severityLabel: string;
  title: string;
  body: string;
  triggeredAt: string;
  acknowledged: boolean;
}
