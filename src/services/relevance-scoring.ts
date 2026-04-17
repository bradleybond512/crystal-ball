 
/**
 * Composite Alert Relevance Scoring (Phase 0.2)
 *
 * Computes a 0–100 relevance score for any UnifiedAlert based on:
 *   score = severity * proximity * freshness * novelty * source_trust
 *
 * Used to rank alerts in triage views so the most urgent, local, fresh,
 * novel, and trusted items float to the top. Service-only — panels wire
 * in a later phase.
 */

import type { UnifiedAlert, AlertSeverity } from './unified-alerts';
import { haversineKm } from './proximity-filter';
import { getSourceTrust } from './source-trust';

export interface UserLocation {
  lat: number;
  lon: number;
  radiusKm?: number; // default 1000
}

export interface RelevanceBreakdown {
  severity: number;
  proximity: number;
  freshness: number;
  novelty: number;
  trust: number;
  composite: number; // 0-100
}

const SEVERITY_WEIGHTS: Record<AlertSeverity, number> = {
  critical: 1,
  high: 0.8,
  medium: 0.5,
  low: 0.25,
  info: 0.1,
};

const DEFAULT_RADIUS_KM = 1000;
const NO_LOCATION_PROXIMITY = 0.2;
const DEFAULT_TRUST = 0.7;

function proximityScore(alert: UnifiedAlert, userLocation?: UserLocation): number {
  if (!alert.location || !userLocation) return NO_LOCATION_PROXIMITY;
  const radius = userLocation.radiusKm ?? DEFAULT_RADIUS_KM;
  const dist = haversineKm(userLocation.lat, userLocation.lon, alert.location.lat, alert.location.lon);
  if (dist <= 0) return 1;
  if (dist >= radius) return 0.3;
  // Linear decay from 1.0 at 0km to 0.3 at radiusKm
  return 1 - (dist / radius) * 0.7;
}

function freshnessScore(timestamp: number): number {
  const ageHours = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
  const raw = Math.exp(-ageHours / 6);
  return Math.min(1, Math.max(0.2, raw));
}

function noveltyScore(recentAlertsSameSource?: number): number {
  if (recentAlertsSameSource === undefined) return 1;
  if (recentAlertsSameSource <= 0) return 1;
  if (recentAlertsSameSource <= 2) return 0.5;
  return 0.3;
}

function trustScore(alert: UnifiedAlert): number {
  try {
    const t = getSourceTrust(alert.source);
    if (typeof t === 'number' && Number.isFinite(t)) return t;
  } catch { /* fall through */ }
  return DEFAULT_TRUST;
}

/** Compute the composite relevance breakdown for a single alert. */
export function computeRelevanceScore(
  alert: UnifiedAlert,
  userLocation?: UserLocation,
  recentAlertsSameSource?: number,
): RelevanceBreakdown {
  const severity = SEVERITY_WEIGHTS[alert.severity] ?? 0.5;
  const proximity = proximityScore(alert, userLocation);
  const freshness = freshnessScore(alert.timestamp);
  const novelty = noveltyScore(recentAlertsSameSource);
  const trust = trustScore(alert);
  const raw = severity * proximity * freshness * novelty * trust;
  const composite = Math.min(100, Math.max(0, Math.round(raw * 100)));
  return { severity, proximity, freshness, novelty, trust, composite };
}

/**
 * Compute relevance scores for a batch of alerts, attach composites to
 * `alert.relevanceScore`, and return the list sorted by descending score.
 */
export function sortAlertsByRelevance(
  alerts: UnifiedAlert[],
  userLocation?: UserLocation,
): UnifiedAlert[] {
  const sourceCounts = new Map<string, number>();
  for (const a of alerts) sourceCounts.set(a.source, (sourceCounts.get(a.source) ?? 0) + 1);
  for (const alert of alerts) {
    const recent = Math.max(0, (sourceCounts.get(alert.source) ?? 1) - 1);
    alert.relevanceScore = computeRelevanceScore(alert, userLocation, recent).composite;
  }
  return [...alerts].sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/** Legacy alias retained for existing panel consumers (pre-Phase 0.2 API). */
export const scoreAndSort = sortAlertsByRelevance;
