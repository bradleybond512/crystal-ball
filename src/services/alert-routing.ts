/**
 * Alert routing — maps every UnifiedAlert source to its primary panel,
 * and computes a "hotness score" used by the Triage Bar, sidebar auto-promote,
 * and Today view to decide what's most important right now.
 *
 * Tunable weights live at the top of this file.
 */

import type { UnifiedAlert, AlertSeverity } from './unified-alerts';
import { getSourceTrust } from './source-trust';
import { getSourceFeedbackMult } from './source-feedback';

// ─── Tunable weights (start values; we'll iterate) ────────────────────────
const SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  critical: 100,
  high: 60,
  medium: 30,
  low: 10,
  info: 3,
};

/**
 * Per-source severity multiplier. Lets us calibrate noisy sources without
 * changing their raw classification (e.g. dial down IDS chatter, boost OREF).
 * 1.0 = neutral.
 */
const SOURCE_MULT: Record<UnifiedAlert['source'], number> = {
  'breaking-news': 1,
  'nws': 1,
  'gdacs': 1.1,
  'tsunami': 1.3,
  'volcano': 1,
  'oref': 1.4,
  'hazard': 1.2,
  'correlation': 1.2,
  'cyber': 0.7,
  'resource': 0.8,
  'local-ids': 0.5,
  'earthquake': 1,
  'fire': 0.8,
  'cyclone': 1.1,
};

/** Half-life for recency decay, in minutes. After this many minutes, score halves. */
const RECENCY_HALFLIFE_MIN = 20;

/** Multiplier when alert is within PROXIMITY_KM of the user. */
const PROXIMITY_MULT = 1.5;
const PROXIMITY_KM = 250;

/** Multiplier when alert touches a watchlist entity. */
const WATCHLIST_MULT = 2;

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
  'earthquake': 'earthquakes',
  'fire': 'satellite-fires',
  'cyclone': 'tropical-cyclones',
};

export function panelForAlert(a: UnifiedAlert): string {
  return SOURCE_TO_PANEL[a.source] ?? 'unified-alert-inbox';
}

/** Detailed score breakdown — used by tooltips and debug logging. */
export interface ScoreBreakdown {
  base: number;
  decay: number;
  sourceMult: number;
  trustMult: number;
  proximityMult: number;
  watchlistMult: number;
  pinMult: number;
  total: number;
}

export function scoreBreakdown(a: UnifiedAlert, nowMs: number = Date.now()): ScoreBreakdown {
  if (a.acknowledged || (typeof a.snoozedUntil === 'number' && a.snoozedUntil > nowMs)) {
    return { base: 0, decay: 0, sourceMult: 0, trustMult: 1, proximityMult: 1, watchlistMult: 1, pinMult: 1, total: 0 };
  }
  const base = SEVERITY_WEIGHT[a.severity] ?? 0;
  const ageMin = Math.max(0, (nowMs - a.timestamp) / 60_000);
  const decay = Math.pow(0.5, ageMin / RECENCY_HALFLIFE_MIN);
  const sourceMult = SOURCE_MULT[a.source] ?? 1;
  const trustMult = getSourceTrust(a.source) * getSourceFeedbackMult(a.source);
  const proximityMult = (typeof a.distanceKm === 'number' && a.distanceKm <= PROXIMITY_KM) ? PROXIMITY_MULT : 1;
  const watchlistMult = a.relevanceScore >= 100 ? WATCHLIST_MULT : 1;
  const pinMult = a.pinned ? 1.25 : 1;
  const total = base * decay * sourceMult * trustMult * proximityMult * watchlistMult * pinMult;
  return { base, decay, sourceMult, trustMult, proximityMult, watchlistMult, pinMult, total };
}

/** Compute current hotness score for a single alert. */
export function scoreAlert(a: UnifiedAlert, nowMs: number = Date.now()): number {
  return scoreBreakdown(a, nowMs).total;
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
