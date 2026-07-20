/**
 * Unified Intelligence Timeline (Phase 7A).
 *
 * Pure-deterministic event-stream aggregator. Composes five sources
 * into a single newest-first sequence the panel can render directly:
 *
 *   • alerts        — UnifiedAlert rows from the renderer-side ring
 *   • situations    — Situation rows from situation-store
 *   • what-changed  — items projected from a WhatChangedReport
 *   • notifications — NotificationHistoryEntry rows
 *   • diagnostics   — feed-health state changes (caller-supplied)
 *
 * Acknowledgments are an out-of-band entry type: any caller can push
 * `{ type: 'acknowledgment', ... }` items into `buildTimeline` via the
 * `extra` channel and they will merge cleanly with the rest.
 *
 * No DOM, no fetch. The panel and the sidecar route both go through
 * `buildTimeline()` so the rendered timeline and the JSON-export
 * timeline come from the same merge logic.
 */

import type { UnifiedAlert } from '@/services/unified-alerts';
import type { Situation, SituationSeverity } from '@/types/intelligence';
import type { NotificationHistoryEntry, HistorySeverity } from '@/services/notifications/notification-history-service';
import type { WhatChangedReport } from './what-changed';
import { projectWhatChanged } from './command-center-summary';

// ─── Public types ─────────────────────────────────────────────────────

export type TimelineEventType =
  | 'alert'
  | 'situation'
  | 'what-changed'
  | 'notification'
  | 'diagnostic'
  | 'acknowledgment';

export type TimelineSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface TimelineEvent {
  /** Stable id used for dedupe across refreshes. */
  id: string;
  /** ms-epoch the event occurred (not when it was ingested). */
  timestamp: number;
  type: TimelineEventType;
  /** Coarse domain tag — e.g. 'earthquake', 'cyber', 'maritime'. May be 'unknown'. */
  domain: string;
  severity: TimelineSeverity;
  title: string;
  summary: string;
  /** Provider / source ids that produced or contributed to the event. */
  sourceIds: string[];
  /** 0-1 confidence for situation / correlation rows; null otherwise. */
  confidence: number | null;
  /** Panel ids the user can click through to. */
  linkedPanelIds: string[];
  /** Raw source row preserved for the inline-expansion view in the
   *  panel — JSON-serializable. */
  raw: unknown;
}

// ─── Severity mapping ─────────────────────────────────────────────────

const SEV_ORDER: Record<TimelineSeverity, number> = {
  info: 0, low: 1, medium: 2, high: 3, critical: 4,
};

function fromSituationSeverity(s: SituationSeverity): TimelineSeverity {
  switch (s) {
    case 'info': { return 'info';
    }
    case 'low': { return 'low';
    }
    case 'moderate': { return 'medium';
    }
    case 'high': { return 'high';
    }
    case 'critical': { return 'critical';
    }
  }
}

function fromHistorySeverity(s: HistorySeverity): TimelineSeverity {
  switch (s) {
    case 'low': { return 'low';
    }
    case 'medium': { return 'medium';
    }
    case 'high': { return 'high';
    }
    case 'critical': { return 'critical';
    }
  }
}

function fromAlertSeverity(s: UnifiedAlert['severity']): TimelineSeverity {
  switch (s) {
    case 'info': { return 'info';
    }
    case 'low': { return 'low';
    }
    case 'medium': { return 'medium';
    }
    case 'high': { return 'high';
    }
    case 'critical': { return 'critical';
    }
  }
}

// ─── Builders per source ──────────────────────────────────────────────

const DEFAULT_PANEL_FOR_DOMAIN: Record<string, string> = {
  earthquake: 'earthquake-super',
  seismic: 'earthquake-super',
  weather: 'weather-radar',
  hurricane: 'tropical-cyclones',
  cyber: 'cyber-threats',
  // 'maritime-intel' left the default layout; its surviving twin hosts the content.
  maritime: 'maritime-superpower',
  aviation: 'aviation-intel',
  conflict: 'ucdp-events',
  wildfire: 'wildfire-intel',
  power: 'grid-intelligence',
  health: 'disease-outbreaks',
  air_quality: 'openaq-monitor',
  geomagnetic: 'space-weather',
  solar_flare: 'space-weather',
  market: 'macro-signals',
};

function panelsForDomain(domain: string): string[] {
  const id = DEFAULT_PANEL_FOR_DOMAIN[domain];
  return id ? [id] : [];
}

export function alertToTimelineEvent(alert: UnifiedAlert): TimelineEvent {
  return {
    id: `alert:${alert.id}`,
    timestamp: alert.timestamp,
    type: 'alert',
    domain: alert.source,
    severity: fromAlertSeverity(alert.severity),
    title: alert.title,
    summary: alert.body,
    sourceIds: [alert.source],
    confidence: null,
    linkedPanelIds: ['unified-alert-inbox', ...panelsForDomain(alert.source)],
    raw: alert,
  };
}

export function situationToTimelineEvent(s: Situation): TimelineEvent {
  return {
    id: `situation:${s.id}`,
    timestamp: s.updatedAt,
    type: 'situation',
    domain: s.domain,
    severity: fromSituationSeverity(s.severity),
    title: s.name,
    summary: s.summary,
    sourceIds: s.observationIds.slice(0, 10),
    confidence: s.confidence,
    linkedPanelIds: ['situation-awareness', ...panelsForDomain(s.domain)],
    raw: s,
  };
}

export function notificationToTimelineEvent(n: NotificationHistoryEntry): TimelineEvent {
  return {
    id: `notification:${n.id}`,
    timestamp: n.recordedAt,
    type: 'notification',
    domain: n.domain,
    severity: fromHistorySeverity(n.severity),
    title: n.title,
    summary: n.body,
    sourceIds: [n.source, ...(n.ruleId ? [n.ruleId] : [])],
    confidence: null,
    linkedPanelIds: ['notification-history', ...panelsForDomain(n.domain)],
    raw: n,
  };
}

export function whatChangedToTimelineEvents(report: WhatChangedReport | null, now: number): TimelineEvent[] {
  const items = projectWhatChanged(report, now, 20);
  return items.map((i) => ({
    id: `what-changed:${i.id}`,
    timestamp: i.occurredAt,
    type: 'what-changed',
    domain: i.domain ?? 'unknown',
    severity: weightToSeverity(i.weight),
    title: i.label,
    summary: `Polarity: ${i.polarity}; weight ${i.weight}/100`,
    sourceIds: [i.id],
    confidence: null,
    linkedPanelIds: ['what-changed'],
    raw: i,
  }));
}

function weightToSeverity(weight: number): TimelineSeverity {
  if (weight >= 75) return 'critical';
  if (weight >= 50) return 'high';
  if (weight >= 25) return 'medium';
  if (weight > 0) return 'low';
  return 'info';
}

// Diagnostic state-changes are caller-supplied (we don't define a
// shape for them here because every diagnostics module has its own).
export interface DiagnosticTimelineInput {
  id: string;
  timestamp: number;
  domain: string;
  severity: TimelineSeverity;
  title: string;
  summary: string;
  sourceIds?: string[];
  linkedPanelIds?: string[];
  raw?: unknown;
}

export function diagnosticToTimelineEvent(d: DiagnosticTimelineInput): TimelineEvent {
  return {
    id: `diagnostic:${d.id}`,
    timestamp: d.timestamp,
    type: 'diagnostic',
    domain: d.domain,
    severity: d.severity,
    title: d.title,
    summary: d.summary,
    sourceIds: d.sourceIds ?? [],
    confidence: null,
    linkedPanelIds: d.linkedPanelIds ?? ['system-diagnostic'],
    raw: d.raw ?? d,
  };
}

// ─── Top-level merge ──────────────────────────────────────────────────

export interface BuildTimelineInput {
  alerts?: readonly UnifiedAlert[];
  situations?: readonly Situation[];
  notifications?: readonly NotificationHistoryEntry[];
  whatChanged?: WhatChangedReport | null;
  diagnostics?: readonly DiagnosticTimelineInput[];
  /** Free-form acknowledgment rows so the panel can layer in
   *  user actions like "Dismissed alert X". */
  acknowledgments?: readonly TimelineEvent[];
  now: number;
  /** Cap on returned events (default 200). */
  limit?: number;
  /** Lower bound on `timestamp` (inclusive). */
  since?: number;
}

export function buildTimeline(input: BuildTimelineInput): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const a of input.alerts ?? []) out.push(alertToTimelineEvent(a));
  for (const s of input.situations ?? []) out.push(situationToTimelineEvent(s));
  for (const n of input.notifications ?? []) out.push(notificationToTimelineEvent(n));
  for (const w of whatChangedToTimelineEvents(input.whatChanged ?? null, input.now)) out.push(w);
  for (const d of input.diagnostics ?? []) out.push(diagnosticToTimelineEvent(d));
  for (const ack of input.acknowledgments ?? []) out.push(ack);

  const since = input.since ?? null;
  const limit = Math.max(1, Math.min(1000, input.limit ?? 200));

  // Dedupe by id (keep the first occurrence's data — the inputs we
  // already merged are authoritative). Sort newest first as a final
  // pass so callers don't have to re-sort.
  const seen = new Set<string>();
  const deduped: TimelineEvent[] = [];
  for (const e of out) {
    if (seen.has(e.id)) continue;
    if (since !== null && e.timestamp < since) continue;
    seen.add(e.id);
    deduped.push(e);
  }
  deduped.sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    // Ties broken by severity desc, then type stability.
    const sd = SEV_ORDER[b.severity] - SEV_ORDER[a.severity];
    if (sd !== 0) return sd;
    return a.id.localeCompare(b.id);
  });
  return deduped.slice(0, limit);
}

// ─── Filter ────────────────────────────────────────────────────────────

export interface TimelineFilter {
  domain?: string;
  severity?: TimelineSeverity;
  /** Minimum severity rank — events with rank below this are dropped. */
  minSeverity?: TimelineSeverity;
  type?: TimelineEventType;
  /** Lower bound on `timestamp` (inclusive). */
  since?: number;
  /** Upper bound on `timestamp` (exclusive). */
  until?: number;
  /** Optional substring filter on title / summary. */
  query?: string;
}

export function filterTimeline(events: readonly TimelineEvent[], filter: TimelineFilter): TimelineEvent[] {
  const query = filter.query?.trim().toLowerCase() ?? '';
  const minRank = filter.minSeverity ? SEV_ORDER[filter.minSeverity] : null;
  return events.filter((e) => keepEvent(e, filter, query, minRank));
}

function keepEvent(
  e: TimelineEvent,
  filter: TimelineFilter,
  query: string,
  minRank: number | null,
): boolean {
  if (filter.domain && e.domain !== filter.domain) return false;
  if (filter.severity && e.severity !== filter.severity) return false;
  if (minRank !== null && SEV_ORDER[e.severity] < minRank) return false;
  if (filter.type && e.type !== filter.type) return false;
  if (filter.since !== undefined && e.timestamp < filter.since) return false;
  if (filter.until !== undefined && e.timestamp >= filter.until) return false;
  if (query && !`${e.title} ${e.summary}`.toLowerCase().includes(query)) return false;
  return true;
}

/** Discover the unique domain values present in a timeline slice. */
export function uniqueDomains(events: readonly TimelineEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) set.add(e.domain);
  return [...set].sort((a, b) => a.localeCompare(b));
}
