// Pure, browser-safe helpers for the Temporal World Store.
//
// This module is the canonical home for the event-log's query/partition/
// retention/validation semantics. It contains NO sqlite and NO I/O so it can
// run in the renderer (EventStorePanel imports it) and be unit-tested directly.
// The sidecar's event-store.mjs implements the same semantics against a real
// node:sqlite database; the .mts test suite drives both for parity.

export const EVENT_TYPES = [
  'observation',
  'situation_created',
  'situation_updated',
  'situation_closed',
  'alert_fired',
  'score_updated',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface EventRecord {
  id: string;
  event_type: string;
  occurred_at: string;
  domain: string | null;
  entity_ids: string; // JSON array string
  source_id: string | null;
  severity: number | null;
  payload: string; // JSON string (may be malformed — stored verbatim)
  partition_key: string; // 'YYYY-MM'
}

export interface QueryOpts {
  from?: string;
  to?: string;
  domain?: string;
  eventTypes?: string[];
  entityIds?: string[];
  sourceId?: string;
  limit?: number;
  offset?: number;
}

export interface CountOpts {
  domain?: string;
  from?: string;
  to?: string;
}

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);

export function isValidEventType(t: unknown): t is EventType {
  return typeof t === 'string' && EVENT_TYPE_SET.has(t);
}

const SEVERITY_LABEL_SCORES: Record<string, number> = {
  CRITICAL: 0.95,
  HIGH: 0.85,
  MEDIUM: 0.7,
  LOW: 0.55,
  INFO: 0.4,
};

export function severityLabelToScore(label: string): number | null {
  if (typeof label !== 'string') return null;
  const key = label.trim().toUpperCase();
  return SEVERITY_LABEL_SCORES[key] ?? null;
}

export function partitionKeyForTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`partitionKeyForTimestamp: unparseable timestamp ${String(iso)}`);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function retentionCutoffISO(months: number, now: string | Date): string {
  const base = new Date(now instanceof Date ? now.getTime() : now);
  if (Number.isNaN(base.getTime())) {
    throw new TypeError('retentionCutoffISO: invalid now');
  }
  base.setUTCMonth(base.getUTCMonth() - Math.max(0, Math.floor(months)));
  return base.toISOString();
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function normalizeSeverity(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return clamp01(raw);
  if (typeof raw === 'string') return severityLabelToScore(raw);
  return null;
}

export interface NormalizeOpts {
  id?: string;
  now?: string;
}

// Accepts a loose input (renderer ObservationEvent, situation, etc.) and
// produces a fully-formed EventRecord ready for insertion. Throws on an
// invalid event_type or a missing payload — these are programmer errors, not
// runtime data we should silently drop.
export function normalizeEventInput(input: Record<string, unknown>, opts: NormalizeOpts = {}): EventRecord {
  if (!input || typeof input !== 'object') {
    throw new Error('normalizeEventInput: input must be an object');
  }
  const eventType = input.event_type;
  if (!isValidEventType(eventType)) {
    throw new Error(`normalizeEventInput: invalid event_type ${String(eventType)}`);
  }
  if (input.payload === undefined || input.payload === null) {
    throw new Error('normalizeEventInput: payload is required');
  }

  const occurredAt =
    typeof input.occurred_at === 'string' && input.occurred_at.length > 0
      ? input.occurred_at
      : (opts.now ?? new Date().toISOString());

  const entityIdsRaw = input.entityIds ?? input.entity_ids;
  const entityIds = Array.isArray(entityIdsRaw)
    ? entityIdsRaw.map((x) => String(x))
    : [];

  const sourceId =
    (typeof input.sourceId === 'string' && input.sourceId) ||
    (typeof input.source_id === 'string' && input.source_id) ||
    null;

  const payload = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload);

  return {
    id: opts.id ?? (typeof input.id === 'string' && input.id ? input.id : cryptoRandomId()),
    event_type: eventType,
    occurred_at: occurredAt,
    domain: typeof input.domain === 'string' && input.domain.length > 0 ? input.domain : null,
    entity_ids: JSON.stringify(entityIds),
    source_id: sourceId,
    severity: normalizeSeverity(input.severity),
    payload,
    partition_key: partitionKeyForTimestamp(occurredAt),
  };
}

let idCounter = 0;
function cryptoRandomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Monotonic fallback for environments without webcrypto — not a security id.
  idCounter += 1;
  return `evt-${Date.now()}-${idCounter}`;
}

export function parseEntityIds(entityIds: string): string[] {
  try {
    const parsed: unknown = JSON.parse(entityIds);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x: unknown) => String(x));
  } catch {
    return [];
  }
}

export function parsePayloadSafe(payload: string): { ok: boolean; value: unknown } {
  if (typeof payload !== 'string') return { ok: false, value: null };
  try {
    return { ok: true, value: JSON.parse(payload) };
  } catch {
    return { ok: false, value: null };
  }
}

// In-memory mirror of the SQL query semantics. Newest-first ordering, inclusive
// date bounds, entity overlap, then offset/limit. Used by the tests to pin the
// contract and available to the renderer for client-side slicing.
export function filterEventsInMemory(events: EventRecord[], opts: QueryOpts = {}): EventRecord[] {
  const filtered = events.filter((e) => {
    if (opts.from && e.occurred_at < opts.from) return false;
    if (opts.to && e.occurred_at > opts.to) return false;
    if (opts.domain && e.domain !== opts.domain) return false;
    if (opts.eventTypes && opts.eventTypes.length > 0 && !opts.eventTypes.includes(e.event_type)) return false;
    if (opts.sourceId && e.source_id !== opts.sourceId) return false;
    if (opts.entityIds && opts.entityIds.length > 0) {
      const own = new Set(parseEntityIds(e.entity_ids));
      if (!opts.entityIds.some((id) => own.has(id))) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (a.occurred_at < b.occurred_at) return 1;
    if (a.occurred_at > b.occurred_at) return -1;
    if (a.id < b.id) return 1;
    if (a.id > b.id) return -1;
    return 0;
  });

  const offset = Math.max(0, opts.offset ?? 0);
  const limit = opts.limit ?? 1000;
  return filtered.slice(offset, offset + limit);
}

export function countEventsInMemory(events: EventRecord[], opts: CountOpts = {}): number {
  return events.filter((e) => {
    if (opts.domain && e.domain !== opts.domain) return false;
    if (opts.from && e.occurred_at < opts.from) return false;
    if (opts.to && e.occurred_at > opts.to) return false;
    return true;
  }).length;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export interface DomainBar {
  domain: string;
  count: number;
  pct: number;
}

export function buildDomainBars(countsByDomain: Record<string, number>): DomainBar[] {
  const entries = Object.entries(countsByDomain ?? {});
  const total = entries.reduce((sum, [, c]) => sum + c, 0);
  return entries
    .map(([domain, count]) => ({
      domain,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

export interface EventStoreHealth {
  totalEvents: number;
  oldestEvent: string | null;
  latestEvent: string | null;
  dbSizeBytes: number;
  partitions: string[];
}

export interface HealthSummary {
  totalEvents: number;
  oldestEvent: string | null;
  latestEvent: string | null;
  dbSizeBytes: number;
  dbSizeLabel: string;
  partitions: string[];
}

export function summarizeHealth(h: Partial<EventStoreHealth> | null | undefined): HealthSummary {
  const totalEvents = h?.totalEvents ?? 0;
  const dbSizeBytes = h?.dbSizeBytes ?? 0;
  return {
    totalEvents,
    oldestEvent: h?.oldestEvent ?? null,
    latestEvent: h?.latestEvent ?? null,
    dbSizeBytes,
    dbSizeLabel: formatBytes(dbSizeBytes),
    partitions: Array.isArray(h?.partitions) ? h!.partitions : [],
  };
}
