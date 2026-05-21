/**
 * Pure helpers for WorldStateComparatorPanel — extracted so tests can
 * import them without dragging the Panel base class's i18n /
 * import.meta.glob chain through tsx.
 *
 * All functions are deterministic: inputs in → outputs out, no DOM, no
 * fetch, no globals at import time.
 */

import type {
  DomainState,
  TimelineEntry,
  WorldSnapshot,
} from '../services/intelligence/historical-playback';

// ── Public types ──────────────────────────────────────────────────────

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface DomainDelta {
  domain: string;
  /** Severity of the domain in the "then" snapshot, or null if absent. */
  thenSeverity: number | null;
  /** Severity of the domain in the "now" snapshot, or null if absent. */
  nowSeverity: number | null;
  /** `now - then`, or null when either side is absent (no delta defined). */
  severityDelta: number | null;
  direction: DeltaDirection;
  thenEventCount: number;
  nowEventCount: number;
  eventCountDelta: number;
}

export interface ComparatorSummary {
  /** Total `activeAlerts` from each snapshot. Null when the snapshot is missing. */
  thenAlerts: number | null;
  nowAlerts: number | null;
  alertsDelta: number | null;
  thenSituations: number | null;
  nowSituations: number | null;
  situationsDelta: number | null;
  /** Domains whose severity strictly increased now > then. */
  escalatedDomains: string[];
  /** Domains whose severity strictly decreased now < then. */
  deEscalatedDomains: string[];
  /** Domain with the largest absolute severity change. Null when there is none. */
  mostChangedDomain: string | null;
  /** ms gap between the two captures (now - then). Null when missing data. */
  timeGapMs: number | null;
}

// ── Pure helpers ──────────────────────────────────────────────────────

function indexDomainStates(states: DomainState[]): Map<string, DomainState> {
  const map = new Map<string, DomainState>();
  for (const s of states) {
    if (s && typeof s.domain === 'string') map.set(s.domain, s);
  }
  return map;
}

function directionFor(delta: number | null): DeltaDirection {
  if (delta === null) return 'flat';
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

/**
 * Compute the per-domain comparison row set. The union of `then` and
 * `now` domains is included so a domain that only appears in one side
 * still shows up (with the other side as null). Rows are sorted by
 * absolute severity change descending, then domain name ascending —
 * stable + deterministic.
 */
export function computeDomainDeltas(
  thenSnapshot: WorldSnapshot | null,
  nowSnapshot: WorldSnapshot | null,
): DomainDelta[] {
  const thenMap = indexDomainStates(thenSnapshot?.domainStates ?? []);
  const nowMap = indexDomainStates(nowSnapshot?.domainStates ?? []);
  const domains = new Set<string>([...thenMap.keys(), ...nowMap.keys()]);

  const rows: DomainDelta[] = [];
  for (const domain of domains) {
    const t = thenMap.get(domain);
    const n = nowMap.get(domain);
    const thenSeverity = t ? t.severity : null;
    const nowSeverity = n ? n.severity : null;
    const severityDelta = thenSeverity !== null && nowSeverity !== null
      ? nowSeverity - thenSeverity
      : null;
    rows.push({
      domain,
      thenSeverity,
      nowSeverity,
      severityDelta,
      direction: directionFor(severityDelta),
      thenEventCount: t?.eventCount ?? 0,
      nowEventCount: n?.eventCount ?? 0,
      eventCountDelta: (n?.eventCount ?? 0) - (t?.eventCount ?? 0),
    });
  }

  rows.sort((a, b) => {
    const aMag = a.severityDelta === null ? -1 : Math.abs(a.severityDelta);
    const bMag = b.severityDelta === null ? -1 : Math.abs(b.severityDelta);
    if (aMag !== bMag) return bMag - aMag;
    return a.domain.localeCompare(b.domain);
  });
  return rows;
}

interface DeltaRollup {
  escalated: string[];
  deEscalated: string[];
  mostChangedDomain: string | null;
}

/** Reduce delta rows to {escalated, deEscalated, mostChangedDomain}.
 *  Extracted from `computeSummary` to keep its cognitive complexity
 *  within the lint budget. */
function rollupDeltas(deltas: readonly DomainDelta[]): DeltaRollup {
  const escalated: string[] = [];
  const deEscalated: string[] = [];
  let mostChanged: { domain: string; mag: number } | null = null;
  for (const row of deltas) {
    if (row.severityDelta === null) continue;
    if (row.severityDelta > 0) escalated.push(row.domain);
    else if (row.severityDelta < 0) deEscalated.push(row.domain);
    const mag = Math.abs(row.severityDelta);
    if (mag > 0 && (mostChanged === null || mag > mostChanged.mag)) {
      mostChanged = { domain: row.domain, mag };
    }
  }
  escalated.sort((a, b) => a.localeCompare(b));
  deEscalated.sort((a, b) => a.localeCompare(b));
  return { escalated, deEscalated, mostChangedDomain: mostChanged ? mostChanged.domain : null };
}

function diffNullable(then_: number | null, now_: number | null): number | null {
  return then_ !== null && now_ !== null ? now_ - then_ : null;
}

/**
 * Roll the delta rows up into a single-glance summary card.
 */
export function computeSummary(
  thenSnapshot: WorldSnapshot | null,
  nowSnapshot: WorldSnapshot | null,
): ComparatorSummary {
  const deltas = computeDomainDeltas(thenSnapshot, nowSnapshot);
  const { escalated, deEscalated, mostChangedDomain } = rollupDeltas(deltas);

  const thenAlerts = thenSnapshot ? thenSnapshot.activeAlerts : null;
  const nowAlerts = nowSnapshot ? nowSnapshot.activeAlerts : null;
  const thenSituations = thenSnapshot ? thenSnapshot.situationCount : null;
  const nowSituations = nowSnapshot ? nowSnapshot.situationCount : null;
  const timeGapMs = thenSnapshot && nowSnapshot
    ? nowSnapshot.capturedAt - thenSnapshot.capturedAt
    : null;

  return {
    thenAlerts,
    nowAlerts,
    alertsDelta: diffNullable(thenAlerts, nowAlerts),
    thenSituations,
    nowSituations,
    situationsDelta: diffNullable(thenSituations, nowSituations),
    escalatedDomains: escalated,
    deEscalatedDomains: deEscalated,
    mostChangedDomain,
    timeGapMs,
  };
}

/**
 * Map a delta direction → an arrow glyph and a CSS color token. Pure so
 * tests can pin the colour palette.
 */
export function arrowFor(direction: DeltaDirection): string {
  if (direction === 'up') return '▲';
  if (direction === 'down') return '▼';
  return '◆';
}

export function colorFor(direction: DeltaDirection): string {
  if (direction === 'up') return 'var(--severity-high)';
  if (direction === 'down') return 'var(--severity-ok)';
  return 'var(--severity-info)';
}

/**
 * Format a delta value with a sign — "+3", "-1", "0". For numeric
 * `severityDelta` rows where presence is guaranteed; returns "—" for null.
 */
export function formatDelta(value: number | null): string {
  if (value === null) return '—';
  if (value > 0) return `+${value}`;
  return String(value);
}

/** ISO timestamp formatter — uses the injected clock for tests. */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

/** Pretty-print a ms duration as the largest unit ≥ 1 (s / m / h / d). */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const abs = Math.abs(ms);
  const sign = ms < 0 ? '-' : '';
  if (abs < 1000) return `${sign}${abs}ms`;
  if (abs < 60_000) return `${sign}${Math.round(abs / 1000)}s`;
  if (abs < 3_600_000) return `${sign}${Math.round(abs / 60_000)}m`;
  if (abs < 86_400_000) return `${sign}${Math.round(abs / 3_600_000)}h`;
  return `${sign}${Math.round(abs / 86_400_000)}d`;
}

/** Find a timeline entry by id. */
export function timelineEntryById(
  timeline: readonly TimelineEntry[],
  id: string,
): TimelineEntry | undefined {
  return timeline.find((e) => e.id === id);
}

/**
 * For the scrubber bar: map every snapshot timestamp onto a [0, 1]
 * fractional position relative to the timeline's min..max range. Returns
 * `0.5` for every entry when min === max (single-snapshot timeline) so the
 * pin still renders.
 */
export interface ScrubberMark {
  id: string;
  timestamp: number;
  severity: number;
  /** [0, 1] horizontal position. */
  fraction: number;
}

export function buildScrubberMarks(timeline: readonly TimelineEntry[]): ScrubberMark[] {
  if (timeline.length === 0) return [];
  const min = timeline[0]!.timestamp;
  const max = timeline[timeline.length - 1]!.timestamp;
  const span = max - min;
  if (span <= 0) {
    return timeline.map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      severity: entry.severity,
      fraction: 0.5,
    }));
  }
  return timeline.map((entry) => ({
    id: entry.id,
    timestamp: entry.timestamp,
    severity: entry.severity,
    fraction: (entry.timestamp - min) / span,
  }));
}

/**
 * Safe-call wrapper for service lookups — turns thrown errors into null
 * so the panel renders gracefully when the service is mid-load /
 * misconfigured. Same `safe(() => …) ?? null` shape the spec called out.
 */
export function safe<T>(fn: () => T): T | null {
  try {
    return fn() ?? null;
  } catch {
    return null;
  }
}
