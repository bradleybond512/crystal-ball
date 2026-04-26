
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

import { unifiedAlertStore, type UnifiedAlert, type AlertSeverity, type AlertSource } from './unified-alerts';
import { haversineKm } from './proximity-filter';
import { getSourceTrust } from './source-trust';
import { getSourceFeedbackMult } from './source-feedback';
import { isGhostMode } from './mode-manager';

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

// ── Learned Trust Weights ────────────────────────────────────────────────────
//
// Per-source dismiss tracking. Each acknowledge is an "interaction"; if it
// happens within FAST_DISMISS_MS of the alert first appearing in a scoring
// pass, it counts as a dismiss. The dismiss rate dampens the static trust
// score so consistently-dismissed sources float lower over time.
//
// Floor of 0.4 ensures no source is fully silenced by behavior alone.

const TRUST_STORAGE_KEY = 'crystalball-learned-trust-v1';
const FAST_DISMISS_MS = 15_000;
const MIN_INTERACTIONS = 3;
const TRUST_FLOOR = 0.4;

interface SourceInteractions {
  total: number;
  dismissed: number;
}

let learnedTrust: Record<string, SourceInteractions> = {};
let trustLoaded = false;

function loadLearnedTrust(): void {
  if (trustLoaded) return;
  trustLoaded = true;
  try {
    const raw = localStorage.getItem(TRUST_STORAGE_KEY);
    if (raw) learnedTrust = JSON.parse(raw) as Record<string, SourceInteractions>;
  } catch { /* ignore corrupt data */ }
}

function saveLearnedTrust(): void {
  try { localStorage.setItem(TRUST_STORAGE_KEY, JSON.stringify(learnedTrust)); } catch { /* quota */ }
}

function ensureSource(source: string): SourceInteractions {
  learnedTrust[source] ??= { total: 0, dismissed: 0 };
  return learnedTrust[source];
}

export function recordInteraction(source: AlertSource, wasDismissed: boolean): void {
  if (isGhostMode()) return;
  loadLearnedTrust();
  const s = ensureSource(source);
  s.total += 1;
  if (wasDismissed) s.dismissed += 1;
  saveLearnedTrust();
}

export function getLearnedTrustMultiplier(source: AlertSource): number {
  loadLearnedTrust();
  const s = learnedTrust[source as string];
  if (!s || s.total < MIN_INTERACTIONS) return 1;
  const dismissRate = s.dismissed / s.total;
  return Math.max(TRUST_FLOOR, 1 - dismissRate * 0.6);
}

export function getLearnedTrustStats(): Readonly<Record<string, SourceInteractions>> {
  loadLearnedTrust();
  return { ...learnedTrust };
}

export function resetLearnedTrust(): void {
  learnedTrust = {};
  trustLoaded = true;
  try { localStorage.removeItem(TRUST_STORAGE_KEY); } catch { /* ignore */ }
}

// ── Source Reliability Tracking ─────────────────────────────────────────────
//
// Tracks per-source API health: last successful fetch, consecutive failures,
// and average latency. Stale or failing sources get a multiplier < 1 so their
// alerts rank lower until the source recovers.

const RELIABILITY_STORAGE_KEY = 'crystalball-source-reliability-v1';

export interface SourceReliability {
  source: string;
  lastSuccessfulFetch: number;
  consecutiveFailures: number;
  avgLatencyMs: number;
  sampleCount: number;
}

let reliabilityMap: Record<string, SourceReliability> = {};
let reliabilityLoaded = false;

function loadReliability(): void {
  if (reliabilityLoaded) return;
  reliabilityLoaded = true;
  try {
    const raw = localStorage.getItem(RELIABILITY_STORAGE_KEY);
    if (raw) reliabilityMap = JSON.parse(raw) as Record<string, SourceReliability>;
  } catch { /* ignore corrupt data */ }
}

function saveReliability(): void {
  try {
    localStorage.setItem(RELIABILITY_STORAGE_KEY, JSON.stringify(reliabilityMap));
  } catch { /* quota */ }
}

function ensureReliability(source: string): SourceReliability {
  reliabilityMap[source] ??= {
    source,
    lastSuccessfulFetch: 0,
    consecutiveFailures: 0,
    avgLatencyMs: 0,
    sampleCount: 0,
  };
  return reliabilityMap[source];
}

export function recordSourceSuccess(source: string, latencyMs: number): void {
  loadReliability();
  const r = ensureReliability(source);
  r.lastSuccessfulFetch = Date.now();
  r.consecutiveFailures = 0;
  r.sampleCount += 1;
  r.avgLatencyMs = r.avgLatencyMs + (latencyMs - r.avgLatencyMs) / r.sampleCount;
  saveReliability();
}

export function recordSourceFailure(source: string): void {
  loadReliability();
  const r = ensureReliability(source);
  r.consecutiveFailures += 1;
  saveReliability();
}

export function getSourceReliabilityMultiplier(source: string): number {
  loadReliability();
  const r = reliabilityMap[source];
  if (!r || r.lastSuccessfulFetch === 0) return 1;

  let mult = 1;

  const ageMinutes = (Date.now() - r.lastSuccessfulFetch) / 60_000;
  if (ageMinutes > 30) {
    mult *= Math.max(0.3, 1 - (ageMinutes - 30) / 120);
  }

  if (r.consecutiveFailures > 2) {
    mult *= Math.max(0.3, 1 - (r.consecutiveFailures - 2) * 0.15);
  }

  return mult;
}

export function getSourceReliabilityStats(): Readonly<Record<string, SourceReliability>> {
  loadReliability();
  return { ...reliabilityMap };
}

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
  let base = DEFAULT_TRUST;
  try {
    const t = getSourceTrust(alert.source);
    if (typeof t === 'number' && Number.isFinite(t)) base = t;
  } catch { /* fall through */ }
  const feedbackMult = getSourceFeedbackMult(alert.source);
  const learnedMult = getLearnedTrustMultiplier(alert.source);
  const reliabilityMult = getSourceReliabilityMultiplier(alert.source);
  return Math.max(0.1, base * feedbackMult * learnedMult * reliabilityMult);
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

// ── Trust learner observer ───────────────────────────────────────────────────
//
// Watches acknowledge transitions on unifiedAlertStore and calls
// recordInteraction(source, wasDismissed). A dismiss is an ack that happens
// within FAST_DISMISS_MS of the alert first being scored; otherwise it's a
// normal interaction (not a dismiss).

let trustLearnerStarted = false;

export function startTrustLearner(): void {
  if (trustLearnerStarted) return;
  trustLearnerStarted = true;
  loadLearnedTrust();

  const firstSeen = new Map<string, number>();
  const prevAcked = new Set<string>();

  for (const a of unifiedAlertStore.getAll()) {
    firstSeen.set(a.id, Date.now());
    if (a.acknowledged) prevAcked.add(a.id);
  }

  unifiedAlertStore.subscribe(() => {
    const now = Date.now();
    for (const a of unifiedAlertStore.getAll()) {
      if (!firstSeen.has(a.id)) firstSeen.set(a.id, now);
      if (a.acknowledged && !prevAcked.has(a.id)) {
        const seen = firstSeen.get(a.id) ?? now;
        const wasDismissed = now - seen < FAST_DISMISS_MS;
        recordInteraction(a.source, wasDismissed);
        prevAcked.add(a.id);
      }
    }
  });
}
