/* eslint-disable sonarjs/no-nested-conditional, @typescript-eslint/prefer-nullish-coalescing, unicorn/no-array-callback-reference, sonarjs/no-misleading-array-reverse */
/**
 * Situation Clustering — Alerts Enhancement Roadmap Phase 1.2
 *
 * Lightweight alert-centric grouping that complements the heavier
 * `situation-engine.ts` (which clusters CorrelationSignals into
 * OODA-loop Situations).
 *
 * This module clusters raw UnifiedAlerts into a flat "Situation" shape
 * keyed by geographic (<100km) + temporal (<6h) + category proximity.
 * Used for alert-feed UI grouping, not full OODA orchestration.
 */
import {
  computeDistanceKm,
  type AlertSeverity,
  type UnifiedAlert,
} from './unified-alerts';

export interface Situation {
  id: string;
  /** Auto-generated, e.g. "Hurricane X — Gulf Coast" */
  label: string;
  alerts: UnifiedAlert[];
  /** Highest severity among children */
  severity: AlertSeverity;
  trend: 'escalating' | 'stable' | 'de-escalating';
  firstSeen: number;
  lastUpdate: number;
}

// ── Tunables ──────────────────────────────────────────────────────────────
const PROXIMITY_KM = 100;
const TEMPORAL_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_SITUATIONS = 50;
const TREND_RECENT_MS = 60 * 60 * 1000;        // last 1h
const TREND_PRIOR_MS = 3 * 60 * 60 * 1000;     // previous 3h

const SEV_RANK: Record<AlertSeverity, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};

const SEV_BY_RANK: AlertSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

// ── Category grouping ─────────────────────────────────────────────────────
/**
 * Collapse alert sources into coarse categories. Two alerts with overlapping
 * categories are eligible to cluster together (provided geo+time also match).
 */
function categoryOf(source: UnifiedAlert['source']): string {
  if (source === 'earthquake' || source === 'tsunami' || source === 'volcano') return 'geophysical';
  if (source === 'nws' || source === 'spc' || source === 'cyclone' || source === 'space-weather') return 'weather';
  if (source === 'gdacs' || source === 'fire' || source === 'air-quality' || source === 'radiation') return 'hazard';
  if (source === 'cyber' || source === 'power-grid' || source === 'comms-health') return 'infrastructure';
  if (source === 'oref' || source === 'local-ids') return 'security';
  if (source === 'disease') return 'health';
  if (source === 'maritime' || source === 'travel-advisory' || source === 'aviation-hazard') return 'transit';
  if (source === 'breaking-news' || source === 'correlation' || source === 'resource' || source === 'hazard') return 'news';
  return 'other';
}

function maxSeverity(alerts: UnifiedAlert[]): AlertSeverity {
  let rank = 0;
  for (const a of alerts) rank = Math.max(rank, SEV_RANK[a.severity]);
  return SEV_BY_RANK[rank] ?? 'info';
}

function mostSpecificAlert(alerts: UnifiedAlert[]): UnifiedAlert {
  // Highest severity, then newest, wins as label anchor.
  return [...alerts].sort((a, b) => {
    const s = SEV_RANK[b.severity] - SEV_RANK[a.severity];
    return s === 0 ? b.timestamp - a.timestamp : s;
  })[0]!;
}

function generateLabel(alerts: UnifiedAlert[]): string {
  const anchor = mostSpecificAlert(alerts);
  const title = anchor.title.length > 60 ? `${anchor.title.slice(0, 57)}...` : anchor.title;
  const region = anchor.location?.label;
  return region ? `${title} — ${region}` : title;
}

// ── Clustering primitives ────────────────────────────────────────────────
function alertsMatch(a: UnifiedAlert, b: UnifiedAlert): boolean {
  if (Math.abs(a.timestamp - b.timestamp) > TEMPORAL_WINDOW_MS) return false;
  if (categoryOf(a.source) !== categoryOf(b.source)) return false;
  if (!a.location || !b.location) return true; // no geo = match on category+time
  const km = computeDistanceKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
  return km < PROXIMITY_KM;
}

function belongsToGroup(alert: UnifiedAlert, group: UnifiedAlert[]): boolean {
  // Alert joins group if it matches ANY existing member.
  for (const member of group) {
    if (alertsMatch(alert, member)) return true;
  }
  return false;
}

export function classifyTrend(situation: Situation): 'escalating' | 'stable' | 'de-escalating' {
  const now = Date.now();
  let recent = 0;
  let prior = 0;
  for (const a of situation.alerts) {
    const age = now - a.timestamp;
    if (age <= TREND_RECENT_MS) recent++;
    else if (age <= TREND_RECENT_MS + TREND_PRIOR_MS) prior++;
  }
  // Normalize to per-hour arrival rate (prior window is 3x longer).
  const recentRate = recent;
  const priorRate = prior / 3;
  if (recentRate > priorRate * 1.5 && recentRate >= 2) return 'escalating';
  if (recentRate < priorRate * 0.5 && priorRate >= 1) return 'de-escalating';
  return 'stable';
}

function buildSituation(alerts: UnifiedAlert[]): Situation {
  const timestamps = alerts.map(a => a.timestamp);
  const firstSeen = Math.min(...timestamps);
  const lastUpdate = Math.max(...timestamps);
  const id = `sit-${firstSeen}-${alerts[0]!.id.slice(0, 12)}`;
  const draft: Situation = {
    id,
    label: generateLabel(alerts),
    alerts: [...alerts].sort((a, b) => b.timestamp - a.timestamp),
    severity: maxSeverity(alerts),
    trend: 'stable',
    firstSeen,
    lastUpdate,
  };
  draft.trend = classifyTrend(draft);
  return draft;
}

/** Cluster a flat list of alerts into at most 50 Situations. */
export function clusterAlertsToSituations(alerts: UnifiedAlert[]): Situation[] {
  if (alerts.length === 0) return [];
  const sorted = [...alerts].sort((a, b) => a.timestamp - b.timestamp);
  const groups: UnifiedAlert[][] = [];
  for (const alert of sorted) {
    let placed = false;
    for (const g of groups) {
      if (belongsToGroup(alert, g)) { g.push(alert); placed = true; break; }
    }
    if (!placed) groups.push([alert]);
  }
  const situations = groups.map(buildSituation);
  // Sort by severity desc, then most recent lastUpdate desc.
  situations.sort((a, b) => {
    const s = SEV_RANK[b.severity] - SEV_RANK[a.severity];
    return s === 0 ? b.lastUpdate - a.lastUpdate : s;
  });
  return situations.slice(0, MAX_SITUATIONS);
}

/** Append new alerts to an existing Situation, recomputing derived fields. */
export function updateSituation(existing: Situation, newAlerts: UnifiedAlert[]): Situation {
  const seen = new Set(existing.alerts.map(a => a.id));
  const merged = [...existing.alerts];
  for (const a of newAlerts) {
    if (!seen.has(a.id)) { merged.push(a); seen.add(a.id); }
  }
  const timestamps = merged.map(a => a.timestamp);
  const updated: Situation = {
    ...existing,
    alerts: merged.sort((a, b) => b.timestamp - a.timestamp),
    severity: maxSeverity(merged),
    firstSeen: Math.min(...timestamps),
    lastUpdate: Math.max(...timestamps),
    label: generateLabel(merged),
    trend: 'stable',
  };
  updated.trend = classifyTrend(updated);
  return updated;
}
