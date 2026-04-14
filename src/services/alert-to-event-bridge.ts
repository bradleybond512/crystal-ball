import type { NormalizedEvent } from '../types/correlation-engine.ts';
import { normalizeTimestamp, normalizeLocation, SEVERITY_BUCKETS } from '../types/correlation-engine.ts';
import { mapSourceToEventType } from './event-taxonomy-mapper.ts';

const SEVERITY_SCORE_MAP: Record<string, number> = {
  critical: 100,
  high: 80,
  medium: 50,
  low: 20,
  info: 5,
};

export function unifiedAlertToNormalizedEvent(alert: {
  id: string;
  source: string;
  severity: string;
  title: string;
  body: string;
  timestamp: number;
  location?: { lat: number; lon: number; label?: string };
  relevanceScore: number;
  [key: string]: unknown;
}): NormalizedEvent {
  const severityScore = SEVERITY_SCORE_MAP[alert.severity] ?? 30;
  const eventType = mapSourceToEventType(alert.source, alert.title);

  return {
    id: alert.id,
    eventType,
    timestamp: normalizeTimestamp(new Date(alert.timestamp).toISOString()),
    location: normalizeLocation({
      lat: alert.location?.lat,
      lon: alert.location?.lon,
      sourceLabel: alert.location?.label,
    }),
    title: alert.title,
    summary: alert.body,
    severity: severityScore,
    severityLabel: SEVERITY_BUCKETS(severityScore),
    sourceId: alert.source,
    sourceName: alert.source,
    tags: [],
    entities: [],
    ingestedAt: new Date().toISOString(),
  };
}
