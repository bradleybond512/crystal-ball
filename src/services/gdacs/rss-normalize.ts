/**
 * GDACS RSS envelope normaliser — pure, no DOM or fetch.
 *
 * `/api/disasters/gdacs` normally returns
 *   { events, count, fetchedAt, degraded, reason? }
 *
 * but a stubbed endpoint (panel-smoke harness, sidecar failure, partial
 * upstream parse) can return `{ ok: true, items: [], data: [] }` or
 * similar. Reading `events.length` on an undefined field crashed the
 * renderer. This helper coerces missing / non-array `events` to `[]` at
 * the boundary so the panel always sees a well-formed envelope.
 */

export interface GdacsRssEvent {
  id: string;
  eventType: string;
  name: string;
  alertLevel: 'Green' | 'Orange' | 'Red';
  score: number;
  country: string;
  coordinates: [number, number] | null;
  fromDate: string;
  severity: string;
  url: string;
}

export interface GdacsRssEnvelope {
  events: GdacsRssEvent[];
  count: number;
  fetchedAt: number;
  degraded: boolean;
  reason?: string;
}

export function normalizeGdacsRssEnvelope(raw: unknown): GdacsRssEnvelope {
  if (!raw || typeof raw !== 'object') {
    return { events: [], count: 0, fetchedAt: Date.now(), degraded: true, reason: 'invalid envelope' };
  }
  const r = raw as Record<string, unknown>;
  const events = Array.isArray(r.events) ? r.events as GdacsRssEvent[] : [];
  const count = typeof r.count === 'number' && Number.isFinite(r.count) ? r.count : events.length;
  const fetchedAt = typeof r.fetchedAt === 'number' && Number.isFinite(r.fetchedAt) ? r.fetchedAt : Date.now();
  const degraded = r.degraded === true || !Array.isArray(r.events);
  const fallbackReason = Array.isArray(r.events) ? undefined : 'missing events array';
  const reason = typeof r.reason === 'string' ? r.reason : fallbackReason;
  return reason === undefined
    ? { events, count, fetchedAt, degraded }
    : { events, count, fetchedAt, degraded, reason };
}
