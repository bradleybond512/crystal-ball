/**
 * Unified diagnostic event bus — per
 * docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md PR 1
 * (lines 397-410). The single chokepoint that every service / panel /
 * notification path emits its observability events through.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time
 * (the singleton bus is created lazily so tests can isolate). The
 * bus keeps a bounded ring buffer + per-kind counters and emits to
 * subscribers synchronously.
 *
 * Plan invariants:
 *   - Every diagnostic record must be inspectable by humans + machines.
 *   - The event bus must not crash callers — subscriber errors are
 *     caught and logged to a dead-letter ring.
 *   - Bus is bounded; old events fall off the back.
 */

import type {
  FeatureId,
  PanelId,
  ProviderId,
  ServiceId,
  SourceId,
} from './system-health-types';

// ── Public types ─────────────────────────────────────────────────────────

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical';

export type DiagnosticEventKind =
  | 'service_started'
  | 'service_success'
  | 'service_empty'
  | 'service_failure'
  | 'service_stale'
  | 'provider_success'
  | 'provider_failure'
  | 'panel_mounted'
  | 'panel_rendered'
  | 'panel_error'
  | 'notification_candidate'
  | 'notification_suppressed'
  | 'notification_dispatched'
  | 'feature_degraded'
  | 'feature_recovered';

export interface DiagnosticEvent {
  /** Stable id — unique per event, monotonic per bus instance. */
  id: string;
  /** ms epoch. */
  at: number;
  severity: DiagnosticSeverity;
  kind: DiagnosticEventKind;
  featureId?: FeatureId;
  panelId?: PanelId;
  serviceId?: ServiceId;
  sourceId?: SourceId;
  providerId?: ProviderId;
  message: string;
  /** Optional structured detail — must be JSON-serializable. */
  detail?: Record<string, unknown>;
}

/** Subscriber callback. Throwing is safe — the bus catches and routes
 *  the error to its dead-letter ring. */
export type DiagnosticSubscriber = (event: DiagnosticEvent) => void;

export interface DiagnosticEventBusOptions {
  /** Max events kept in the ring. Default 500. Older events are
   *  dropped on the next emit. */
  capacity?: number;
  /** Optional clock for tests. */
  now?: () => number;
}

export interface DiagnosticEventFilter {
  severity?: readonly DiagnosticSeverity[];
  kind?: readonly DiagnosticEventKind[];
  featureId?: FeatureId;
  panelId?: PanelId;
  serviceId?: ServiceId;
  sourceId?: SourceId;
  providerId?: ProviderId;
  /** Only events at-or-after this ms timestamp. */
  since?: number;
}

/** Lightweight summary for the inspector UI. */
export interface DiagnosticEventCounts {
  totalEvents: number;
  bySeverity: Record<DiagnosticSeverity, number>;
  byKind: Record<DiagnosticEventKind, number>;
  /** Number of subscriber errors caught since bus creation. */
  subscriberErrors: number;
}

// ── Bus ──────────────────────────────────────────────────────────────────

export interface DiagnosticEventBus {
  emit: (event: Omit<DiagnosticEvent, 'id' | 'at'> & { id?: string; at?: number }) => DiagnosticEvent;
  subscribe: (subscriber: DiagnosticSubscriber) => () => void;
  query: (filter?: DiagnosticEventFilter) => DiagnosticEvent[];
  counts: () => DiagnosticEventCounts;
  clear: () => void;
  /** Dead-letter queue for subscriber errors — capped at 50. */
  deadLetters: () => readonly { error: string; eventId: string; at: number }[];
}

const DEFAULT_CAPACITY = 500;
const DEAD_LETTER_CAPACITY = 50;

export function createDiagnosticEventBus(options: DiagnosticEventBusOptions = {}): DiagnosticEventBus {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const now = options.now ?? (() => Date.now());

  const ring: DiagnosticEvent[] = [];
  const subscribers = new Set<DiagnosticSubscriber>();
  const deadLetters: { error: string; eventId: string; at: number }[] = [];
  const counts: DiagnosticEventCounts = {
    totalEvents: 0,
    bySeverity: { info: 0, warning: 0, error: 0, critical: 0 },
    byKind: emptyKindMap(),
    subscriberErrors: 0,
  };
  let nextId = 1;

  function emit(input: Omit<DiagnosticEvent, 'id' | 'at'> & { id?: string; at?: number }): DiagnosticEvent {
    const event: DiagnosticEvent = {
      id: input.id ?? `de-${nextId++}`,
      at: input.at ?? now(),
      severity: input.severity,
      kind: input.kind,
      message: input.message,
      featureId: input.featureId,
      panelId: input.panelId,
      serviceId: input.serviceId,
      sourceId: input.sourceId,
      providerId: input.providerId,
      detail: input.detail,
    };
    ring.push(event);
    if (ring.length > capacity) ring.shift();
    counts.totalEvents += 1;
    counts.bySeverity[event.severity] += 1;
    counts.byKind[event.kind] += 1;
    fanOut(event);
    return event;
  }

  function fanOut(event: DiagnosticEvent): void {
    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        counts.subscriberErrors += 1;
        deadLetters.push({
          error: error instanceof Error ? error.message : String(error),
          eventId: event.id,
          at: event.at,
        });
        if (deadLetters.length > DEAD_LETTER_CAPACITY) deadLetters.shift();
      }
    }
  }

  function subscribe(subscriber: DiagnosticSubscriber): () => void {
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
  }

  function query(filter: DiagnosticEventFilter = {}): DiagnosticEvent[] {
    return ring.filter((e) => matchesFilter(e, filter));
  }

  function clear(): void {
    ring.length = 0;
    counts.totalEvents = 0;
    counts.subscriberErrors = 0;
    counts.bySeverity = { info: 0, warning: 0, error: 0, critical: 0 };
    counts.byKind = emptyKindMap();
    deadLetters.length = 0;
  }

  return {
    emit,
    subscribe,
    query,
    counts: () => ({
      totalEvents: counts.totalEvents,
      bySeverity: { ...counts.bySeverity },
      byKind: { ...counts.byKind },
      subscriberErrors: counts.subscriberErrors,
    }),
    clear,
    deadLetters: () => [...deadLetters],
  };
}

// ── Default singleton — convenience for app code ─────────────────────────

let defaultBus: DiagnosticEventBus | undefined;

export function getDefaultDiagnosticBus(): DiagnosticEventBus {
  defaultBus ??= createDiagnosticEventBus();
  return defaultBus;
}

/** Reset the default singleton. Tests use this; app code does not. */
export function resetDefaultDiagnosticBus(): void {
  defaultBus = undefined;
}

// ── Filter helpers ──────────────────────────────────────────────────────

const ID_FILTERS: readonly (keyof DiagnosticEventFilter & keyof DiagnosticEvent)[] = [
  'featureId', 'panelId', 'serviceId', 'sourceId', 'providerId',
];

function matchesFilter(event: DiagnosticEvent, filter: DiagnosticEventFilter): boolean {
  if (filter.severity && filter.severity.length > 0 && !filter.severity.includes(event.severity)) return false;
  if (filter.kind && filter.kind.length > 0 && !filter.kind.includes(event.kind)) return false;
  for (const key of ID_FILTERS) {
    const wanted = filter[key];
    if (typeof wanted === 'string' && event[key] !== wanted) return false;
  }
  if (filter.since !== undefined && event.at < filter.since) return false;
  return true;
}

function emptyKindMap(): Record<DiagnosticEventKind, number> {
  return {
    service_started: 0,
    service_success: 0,
    service_empty: 0,
    service_failure: 0,
    service_stale: 0,
    provider_success: 0,
    provider_failure: 0,
    panel_mounted: 0,
    panel_rendered: 0,
    panel_error: 0,
    notification_candidate: 0,
    notification_suppressed: 0,
    notification_dispatched: 0,
    feature_degraded: 0,
    feature_recovered: 0,
  };
}
