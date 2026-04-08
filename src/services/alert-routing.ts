/**
 * Alert routing — maps every UnifiedAlert source to its primary panel,
 * and computes a "hotness score" used by the Triage Bar, sidebar auto-promote,
 * and Today view to decide what's most important right now.
 *
 * Tunable weights live at the top of this file.
 */

import type { UnifiedAlert, AlertSeverity } from './unified-alerts';

// ─── Tunable weights (start values; we'll iterate) ────────────────────────
const SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  critical: 100,
  high: 60,
  medium: 30,
  low: 10,
  info: 3,
};

/** Half-life for recency decay, in minutes. After this many minutes, score halves. */
const RECENCY_HALFLIFE_MIN = 20;

/** Multiplier when alert is within PROXIMITY_KM of the user. */
const PROXIMITY_MULT = 1.5;
const PROXIMITY_KM = 250;

/** Multiplier when alert touches a watchlist entity. */
const WATCHLIST_MULT = 2.0;

// ─── Source → panel routing ──────────────────────────────────────────────
const SOURCE_TO_PANEL: Record<UnifiedAlert['source'], string> = {
  'breaking-news': 'live-news',
  'nws': 'unified-alert-inbox',
  'gdacs': 'gdacs',
  'tsunami': 'tsunami',
  'volcano': 'volcanoes',
  'oref': 'unified-alert-inbox',
  'hazard': 'situation-awareness',
  'correlation': 'situation-awareness',
  'cyber': 'cyber-threats',
  'resource': 'resource-inventory',
  'local-ids': 'local-ids',
};

export function panelForAlert(a: UnifiedAlert): string {
  return SOURCE_TO_PANEL[a.source] ?? 'unified-alert-inbox';
}

/** Compute current hotness score for a single alert. */
export function scoreAlert(a: UnifiedAlert, nowMs: number = Date.now()): number {
  if (a.acknowledged) return 0;
  const base = SEVERITY_WEIGHT[a.severity] ?? 0;
  const ageMin = Math.max(0, (nowMs - a.timestamp) / 60_000);
  const decay = Math.pow(0.5, ageMin / RECENCY_HALFLIFE_MIN);
  let score = base * decay;
  if (typeof a.distanceKm === 'number' && a.distanceKm <= PROXIMITY_KM) score *= PROXIMITY_MULT;
  if (a.pinned) score *= 1.25;
  // Watchlist boost: encoded by ingestor via relevanceScore >= 100
  if (a.relevanceScore >= 100) score *= WATCHLIST_MULT;
  return score;
}

/** Sort alerts by descending hotness score. */
export function rankAlerts(alerts: UnifiedAlert[]): UnifiedAlert[] {
  const now = Date.now();
  return [...alerts]
    .map(a => ({ a, s: scoreAlert(a, now) }))
    .filter(x => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .map(x => x.a);
}

/** Aggregate the max active score per panel, for sidebar auto-promote. */
export function panelHeatMap(alerts: UnifiedAlert[]): Map<string, number> {
  const now = Date.now();
  const heat = new Map<string, number>();
  for (const a of alerts) {
    const s = scoreAlert(a, now);
    if (s <= 0) continue;
    const pid = panelForAlert(a);
    const prev = heat.get(pid) ?? 0;
    if (s > prev) heat.set(pid, s);
  }
  return heat;
}
