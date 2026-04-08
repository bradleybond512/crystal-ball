/**
 * Composite Relevance Scoring Engine
 *
 * Computes a single 0–1 relevance score for any UnifiedAlert by combining:
 * severity × proximity × freshness × novelty × source trust
 *
 * This score powers the default sort in the Unified Alert Inbox — surfacing
 * the one alert that matters out of dozens.
 */

import type { AlertSeverity, UnifiedAlert } from './unified-alerts';
import type { ProximityConfig } from './proximity-filter';
import { haversineKm, loadProximityConfig } from './proximity-filter';

// ── Severity weights ───────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.25,
  info: 0.1,
};

// ── Freshness decay ────────────────────────────────────────────────────────

const FRESHNESS_HALF_LIFE_MS = 3 * 60 * 60 * 1000; // 3 hours

function freshnessWeight(timestampMs: number, now: number): number {
  const ageMs = Math.max(0, now - timestampMs);
  // Exponential decay: 1.0 at t=0, 0.5 at 3h, 0.25 at 6h, floor 0.05
  return Math.max(0.05, Math.pow(0.5, ageMs / FRESHNESS_HALF_LIFE_MS));
}

// ── Proximity weight ───────────────────────────────────────────────────────

function proximityWeight(
  alert: UnifiedAlert,
  config: ProximityConfig | null,
): number {
  // No user location configured → neutral weight
  if (!config?.location || !alert.location) return 0.5;

  const distKm = haversineKm(
 config.location.lat,
 config.location.lon,
 alert.location.lat,
 alert.location.lon,
  );
  // Store distance on alert for display
  alert.distanceKm = distKm;

  const radiusKm = config.radiusKm || 500;
  if (distKm <= 50) return 1.0; // very close
  if (distKm <= radiusKm) {
 // Linear decay from 1.0 at 50km to 0.4 at radius
 return 1.0 - 0.6 * ((distKm - 50) / (radiusKm - 50));
  }
  // Beyond radius — still relevant but low weight
  return Math.max(0.15, 0.4 * Math.exp(-(distKm - radiusKm) / (radiusKm * 2)));
}

// ── Novelty weight ─────────────────────────────────────────────────────────

const recentTitleHashes = new Map<number, number>(); // hash -> count
const NOVELTY_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
 h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

function noveltyWeight(title: string): number {
  const hash = simpleHash(title.toLowerCase().trim());
  const count = recentTitleHashes.get(hash) ?? 0;
  recentTitleHashes.set(hash, count + 1);
  if (count === 0) return 1.0;
  if (count <= 2) return 0.5;
  if (count <= 5) return 0.3;
  return 0.15;
}

/** Periodic cleanup of stale novelty entries */
let lastNoveltyCleanup = Date.now();
function cleanupNovelty(): void {
  const now = Date.now();
  if (now - lastNoveltyCleanup < NOVELTY_WINDOW_MS) return;
  recentTitleHashes.clear();
  lastNoveltyCleanup = now;
}

// ── Source trust weight ────────────────────────────────────────────────────

const SOURCE_TRUST: Record<string, number> = {
  'breaking-news': 0.7,  // varies by tier, but default mid-range
  nws: 1.0, // government authoritative
  gdacs: 0.95, // UN-backed
  tsunami: 1.0, // NOAA authoritative
  volcano: 0.9, // Smithsonian/USGS
  oref: 1.0, // Israeli government real-time
  hazard: 0.85, // aggregated from multiple agencies
  correlation: 0.5, // computed signals, less certain
  cyber: 0.6, // open-source threat intel, variable quality
};

function sourceTrustWeight(source: string): number {
  return SOURCE_TRUST[source] ?? 0.5;
}

// ── Composite score ────────────────────────────────────────────────────────

export interface RelevanceComponents {
  severity: number;
  freshness: number;
  proximity: number;
  novelty: number;
  sourceTrust: number;
  total: number;
}

/**
 * Compute a composite relevance score for a unified alert.
 *
 * Formula:  severity^0.35 × freshness^0.25 × proximity^0.20 × novelty^0.10 × sourceTrust^0.10
 *
 * Using geometric mean with exponent weights ensures each dimension contributes
 * proportionally without any single factor dominating.
 */
export function computeRelevanceScore(
  alert: UnifiedAlert,
  config?: ProximityConfig | null,
): number {
  cleanupNovelty();

  const proxConfig = config ?? loadProximityConfig();

  const sev = SEVERITY_WEIGHT[alert.severity] ?? 0.1;
  const fresh = freshnessWeight(alert.timestamp, Date.now());
  const prox = proximityWeight(alert, proxConfig);
  const novel = noveltyWeight(alert.title);
  const trust = sourceTrustWeight(alert.source);

  // Weighted geometric mean
  const score =
 Math.pow(sev, 0.35) *
 Math.pow(fresh, 0.25) *
 Math.pow(prox, 0.20) *
 Math.pow(novel, 0.10) *
 Math.pow(trust, 0.10);

  return Math.round(score * 1000) / 1000; // 3 decimal places
}

/**
 * Full breakdown for debugging / UI display.
 */
export function computeRelevanceComponents(
  alert: UnifiedAlert,
  config?: ProximityConfig | null,
): RelevanceComponents {
  const proxConfig = config ?? loadProximityConfig();

  const severity = SEVERITY_WEIGHT[alert.severity] ?? 0.1;
  const freshness = freshnessWeight(alert.timestamp, Date.now());
  const proximity = proximityWeight(alert, proxConfig);
  const novelty = noveltyWeight(alert.title);
  const sourceTrust = sourceTrustWeight(alert.source);

  const total =
 Math.pow(severity, 0.35) *
 Math.pow(freshness, 0.25) *
 Math.pow(proximity, 0.20) *
 Math.pow(novelty, 0.10) *
 Math.pow(sourceTrust, 0.10);

  return {
 severity,
 freshness,
 proximity,
 novelty,
 sourceTrust,
 total: Math.round(total * 1000) / 1000,
  };
}

/**
 * Score and sort an array of alerts by relevance (descending).
 * Pinned alerts always come first.
 */
export function scoreAndSort(alerts: UnifiedAlert[], config?: ProximityConfig | null): UnifiedAlert[] {
  const proxConfig = config ?? loadProximityConfig();

  for (const alert of alerts) {
 alert.relevanceScore = computeRelevanceScore(alert, proxConfig);
  }

  return alerts.sort((a, b) => {
 // Pinned first
 if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
 // Unacknowledged before acknowledged
 if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
 // Then by relevance score descending
 return b.relevanceScore - a.relevanceScore;
  });
}
