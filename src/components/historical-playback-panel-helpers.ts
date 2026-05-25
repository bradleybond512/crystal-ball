/**
 * Pure helpers for HistoricalPlaybackPanel — extracted so tests can
 * import them without dragging the Panel base class's i18n /
 * import.meta.glob chain through tsx.
 *
 * No DOM, no fetch, no globals at import time. All inputs are caller-
 * supplied snapshots / timeline entries.
 */

import type {
  DomainState,
  TimelineEntry,
  WorldSnapshot,
} from '../services/intelligence/historical-playback';

// ── Public types ──────────────────────────────────────────────────────

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface SnapshotStats {
  /** `activeAlerts` from the snapshot, or `null` when no snapshot. */
  activeAlerts: number | null;
  /** `situationCount` from the snapshot, or `null`. */
  situationCount: number | null;
  /** Count of domains whose severity is ≥ 3 (HIGH / CRITICAL band). */
  highSeverityDomainCount: number;
  /** Weighted aggregate risk score in [0, 100]. Derived from severities. */
  riskScore: number;
  /** Snapshot capture time, or null. */
  capturedAt: number | null;
}

export interface DomainComparisonRow {
  domain: string;
  selectedSeverity: number | null;
  nowSeverity: number | null;
  delta: number | null;
  direction: DeltaDirection;
  selectedEventCount: number;
  nowEventCount: number;
}

export interface ScrubberMark {
  id: string;
  timestamp: number;
  severity: number;
  /** [0, 1] fraction along the timeline span. */
  fraction: number;
  /** True when this mark is the panel's currently selected snapshot. */
  isSelected: boolean;
  /** True when this mark is the most recent snapshot (the "Live" pin). */
  isLive: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────

function indexDomains(states: readonly DomainState[]): Map<string, DomainState> {
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
 * Weighted risk score in [0, 100]. Heavier weight on critical (sev ≥ 4),
 * lighter on high (sev 3), trace for medium (sev 2). Bounded so noisy
 * INFO/LOW counts can't pin the bar at 100.
 */
export function computeRiskScore(snapshot: WorldSnapshot | null): number {
  if (!snapshot) return 0;
  let weighted = 0;
  for (const s of snapshot.domainStates) {
    const sev = typeof s?.severity === 'number' ? s.severity : 0;
    if (sev >= 4) weighted += 25;
    else if (sev >= 3) weighted += 12;
    else if (sev >= 2) weighted += 4;
  }
  const alertBoost = snapshot.activeAlerts > 0 ? Math.min(15, snapshot.activeAlerts) : 0;
  const situationBoost = snapshot.situationCount > 0 ? Math.min(10, snapshot.situationCount * 2) : 0;
  return Math.min(100, weighted + alertBoost + situationBoost);
}

/**
 * Aggregate stats card for a single snapshot.
 */
export function computeSnapshotStats(snapshot: WorldSnapshot | null): SnapshotStats {
  if (!snapshot) {
    return {
      activeAlerts: null,
      situationCount: null,
      highSeverityDomainCount: 0,
      riskScore: 0,
      capturedAt: null,
    };
  }
  let highCount = 0;
  for (const s of snapshot.domainStates) {
    if (typeof s?.severity === 'number' && s.severity >= 3) highCount += 1;
  }
  return {
    activeAlerts: snapshot.activeAlerts,
    situationCount: snapshot.situationCount,
    highSeverityDomainCount: highCount,
    riskScore: computeRiskScore(snapshot),
    capturedAt: snapshot.capturedAt,
  };
}

/**
 * Per-domain comparison of the selected snapshot vs the current "now"
 * snapshot. Union of both domain sets is included so a domain that
 * exists only on one side still appears (other side null). Rows are
 * sorted by `|Δ|` desc, ties by domain ascending.
 */
export function computeDomainComparison(
  selected: WorldSnapshot | null,
  now: WorldSnapshot | null,
): DomainComparisonRow[] {
  const selectedMap = indexDomains(selected?.domainStates ?? []);
  const nowMap = indexDomains(now?.domainStates ?? []);
  const domains = new Set<string>([...selectedMap.keys(), ...nowMap.keys()]);

  const rows: DomainComparisonRow[] = [];
  for (const domain of domains) {
    const s = selectedMap.get(domain);
    const n = nowMap.get(domain);
    const selectedSeverity = s ? s.severity : null;
    const nowSeverity = n ? n.severity : null;
    const delta = selectedSeverity !== null && nowSeverity !== null
      ? nowSeverity - selectedSeverity
      : null;
    rows.push({
      domain,
      selectedSeverity,
      nowSeverity,
      delta,
      direction: directionFor(delta),
      selectedEventCount: s?.eventCount ?? 0,
      nowEventCount: n?.eventCount ?? 0,
    });
  }

  rows.sort((a, b) => {
    const aMag = a.delta === null ? -1 : Math.abs(a.delta);
    const bMag = b.delta === null ? -1 : Math.abs(b.delta);
    if (aMag !== bMag) return bMag - aMag;
    return a.domain.localeCompare(b.domain);
  });
  return rows;
}

/**
 * Resolve the panel's "active" snapshot id given (a) the user-clicked id
 * and (b) the available timeline. If the user hasn't clicked anything
 * (id === null), default to the newest snapshot — the "Live" position.
 * If the user-clicked id is no longer in the timeline (snapshot evicted
 * by the ring buffer), fall back to the newest.
 */
export function pickActiveSnapshotId(
  timeline: readonly TimelineEntry[],
  selectedId: string | null,
): string | null {
  if (timeline.length === 0) return null;
  const newest = timeline[timeline.length - 1]!.id;
  if (selectedId === null) return newest;
  const found = timeline.some((t) => t.id === selectedId);
  return found ? selectedId : newest;
}

/**
 * For the scrubber bar: map every timeline entry to a [0, 1] fractional
 * position relative to min..max range. `isSelected` and `isLive` flags
 * let the renderer style the active pin distinctly. Empty timeline →
 * empty marks. Single-snapshot timeline pins at fraction 0.5.
 */
export function buildScrubberMarks(
  timeline: readonly TimelineEntry[],
  selectedId: string | null,
): ScrubberMark[] {
  if (timeline.length === 0) return [];
  const liveId = timeline[timeline.length - 1]!.id;
  const min = timeline[0]!.timestamp;
  const max = timeline[timeline.length - 1]!.timestamp;
  const span = max - min;
  return timeline.map((entry) => {
    const fraction = span > 0 ? (entry.timestamp - min) / span : 0.5;
    return {
      id: entry.id,
      timestamp: entry.timestamp,
      severity: entry.severity,
      fraction,
      isSelected: entry.id === selectedId,
      isLive: entry.id === liveId,
    };
  });
}

/** ISO timestamp formatter — "YYYY-MM-DD HH:MM:SS UTC". */
export function formatTimestamp(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

/** Compact duration formatter: scales to s/m/h/d. */
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

/** Format a numeric delta with a sign — "+3", "-1", "0", "—" for null. */
export function formatDelta(value: number | null): string {
  if (value === null) return '—';
  if (value > 0) return `+${value}`;
  return String(value);
}

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
 * Map a risk score in [0, 100] to a severity band token used by the
 * stats card. Kept here so tests can pin the thresholds.
 */
export function riskBandFor(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/**
 * Safe-call wrapper. Used to gate service lookups so the panel renders
 * gracefully when the service throws or returns undefined.
 */
export function safe<T>(fn: () => T): T | null {
  try {
    return fn() ?? null;
  } catch {
    return null;
  }
}
