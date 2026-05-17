/**
 * Recovery Modeling — tracks post-event recovery curves per
 * region/domain so Crystal Ball can distinguish a Situation that is
 * genuinely improving (severity trending down across multiple data
 * points) from one that is merely temporarily quiet.
 *
 * Pure service with injectable Storage. Each RecoveryProfile holds a
 * time series of (timestamp, severityNum, observationCount) data
 * points; the engine runs linear regression on the most recent 5
 * points to compute a recoveryRate, and projects an estimated
 * resolution time from the current trend. Profiles transition through
 * acute → stabilizing → recovering → resolved as severity drops
 * relative to the recorded peak.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import type { Situation } from './situation-store-v2';

// ── Public types ─────────────────────────────────────────────────────────

export type RecoveryPhase = 'acute' | 'stabilizing' | 'recovering' | 'resolved';

export interface RecoveryDataPoint {
  timestamp: number;
  severityNum: number;
  observationCount: number;
}

export interface RecoveryProfile {
  id: string;
  domain: string;
  region: string;
  situationId: string;
  startedAt: number;
  expectedDurationHours: number;
  phase: RecoveryPhase;
  peakSeverity: string;
  currentSeverityNum: number;
  recoveryRate: number;
  estimatedResolutionAt: number | null;
  dataPoints: RecoveryDataPoint[];
  /** Captured at init time for spatial matching of subsequent observations. */
  centerLat: number | null;
  centerLon: number | null;
}

export interface RecoveryStats {
  activeCount: number;
  avgRecoveryRateByDomain: Record<string, number>;
  avgDurationByDomain: Record<string, number>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RecoveryModelingEngineOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

export interface RecoveryModelingEngine {
  initProfile(situation: Situation, peakObs: ObservationEvent): RecoveryProfile;
  ingestObservation(obs: ObservationEvent): void;
  updateRecoveryRate(profileId: string): void;
  estimateResolution(profileId: string): number | null;
  getProfile(id: string): RecoveryProfile | undefined;
  getActiveProfiles(): RecoveryProfile[];
  getCompletedProfiles(limit?: number): RecoveryProfile[];
  stats(): RecoveryStats;
  subscribe(cb: (profiles: RecoveryProfile[]) => void): void;
  unsubscribe(cb: (profiles: RecoveryProfile[]) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-recovery-modeling';
export const MAX_PROFILES = 100;
const MATCH_RADIUS_KM = 500;
const REGRESSION_WINDOW = 5;
const RESOLVED_LOW_RUN = 4; // > 3 consecutive LOW data points

export const EXPECTED_DURATION_BY_DOMAIN: Readonly<Record<string, number>> = {
  earthquake: 72,
  biosurv: 720,
  weather: 48,
  wildfire: 168,
  maritime: 24,
};
const DEFAULT_EXPECTED_DURATION_HOURS = 96;

const SEVERITY_RANK: Record<ObservationSeverity, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};
const SEVERITY_LOW = SEVERITY_RANK.LOW;

// ── Geometry helpers ────────────────────────────────────────────────────

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function severityNum(s: ObservationSeverity): number {
  return SEVERITY_RANK[s];
}

function expectedDurationFor(domain: string): number {
  return EXPECTED_DURATION_BY_DOMAIN[domain] ?? DEFAULT_EXPECTED_DURATION_HOURS;
}

function regionLabel(situation: Situation): string {
  if (situation.location) {
    return `${situation.location.lat.toFixed(2)},${situation.location.lon.toFixed(2)}`;
  }
  if (situation.entityIds.length > 0) return situation.entityIds[0]!;
  return 'global';
}

// ── Phase + rate helpers ────────────────────────────────────────────────

function computePhase(profile: RecoveryProfile): RecoveryPhase {
  const points = profile.dataPoints;
  if (points.length === 0) return 'acute';
  const peakNum = severityNum(profile.peakSeverity as ObservationSeverity);
  const current = points[points.length - 1]!.severityNum;
  // Resolved: > RESOLVED_LOW_RUN-1 consecutive LOW (or below) data points at the tail
  if (points.length >= RESOLVED_LOW_RUN) {
    const tail = points.slice(-RESOLVED_LOW_RUN);
    if (tail.every((p) => p.severityNum <= SEVERITY_LOW)) return 'resolved';
  }
  // Trending down: derivative across last 2 points
  const trending = points.length >= 2 && current < points[points.length - 2]!.severityNum;
  // Recovering: severity < peak-2 AND trending down
  if (current < peakNum - 2 && trending) return 'recovering';
  // Stabilizing: severity < peak-1
  if (current < peakNum - 1) return 'stabilizing';
  return 'acute';
}

/** Linear-regression slope over (timestamp, severityNum). Negative slope
 *  means severity is decreasing over time → improving. The exposed
 *  recoveryRate is the negated slope per hour: positive = improving. */
function linearRegressionRate(points: readonly RecoveryDataPoint[]): number {
  if (points.length < 2) return 0;
  const window = points.slice(-REGRESSION_WINDOW);
  const n = window.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of window) {
    const xHours = p.timestamp / 3_600_000;
    sumX += xHours;
    sumY += p.severityNum;
    sumXY += xHours * p.severityNum;
    sumXX += xHours * xHours;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  const slopePerHour = (n * sumXY - sumX * sumY) / denom;
  return -slopePerHour;
}

// ── Storage helpers ─────────────────────────────────────────────────────

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneProfile(p: RecoveryProfile): RecoveryProfile {
  return { ...p, dataPoints: p.dataPoints.map((d) => ({ ...d })) };
}

function rehydrate(storage: StorageLike | null): RecoveryProfile[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: RecoveryProfile[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const p = item as RecoveryProfile;
    if (typeof p.id !== 'string') continue;
    out.push({ ...p, dataPoints: Array.isArray(p.dataPoints) ? p.dataPoints.map((d) => ({ ...d })) : [] });
  }
  return out;
}

// ── Factory ─────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextProfileId(nowMs: number): string {
  _idCounter += 1;
  return `rp-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

export function createRecoveryModelingEngine(
  options: RecoveryModelingEngineOptions = {},
): RecoveryModelingEngine {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const profiles: RecoveryProfile[] = rehydrate(storage);
  const listeners = new Set<(profiles: RecoveryProfile[]) => void>();

  function persist(): void {
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(profiles)); }
    catch { /* quota / private-mode — non-critical */ }
  }

  function notify(): void {
    const snapshot = profiles.map((p) => cloneProfile(p));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function findBySituation(situationId: string): RecoveryProfile | undefined {
    return profiles.find((p) => p.situationId === situationId);
  }

  function matchProfileForObs(obs: ObservationEvent): RecoveryProfile | undefined {
    const candidates = profiles.filter(
      (p) => p.phase !== 'resolved' && p.domain === obs.domain,
    );
    if (!obs.location) {
      // No-location observations match any profile with no center.
      const noCenter = candidates.find((p) => p.centerLat === null);
      if (noCenter) return noCenter;
      return undefined;
    }
    let best: RecoveryProfile | undefined;
    let bestDist = Infinity;
    for (const p of candidates) {
      if (p.centerLat === null || p.centerLon === null) continue;
      const dist = haversineKm(p.centerLat, p.centerLon, obs.location.lat, obs.location.lon);
      if (dist <= MATCH_RADIUS_KM && dist < bestDist) {
        best = p;
        bestDist = dist;
      }
    }
    return best;
  }

  function updatePhase(profile: RecoveryProfile): void {
    profile.phase = computePhase(profile);
  }

  function evictIfOverCapacity(): void {
    if (profiles.length <= MAX_PROFILES) return;
    // Drop the oldest resolved profile first; otherwise the oldest profile.
    const resolvedIdx = profiles.findIndex((p) => p.phase === 'resolved');
    if (resolvedIdx === -1) profiles.splice(0, 1);
    else profiles.splice(resolvedIdx, 1);
  }

  return {
    initProfile(situation, peakObs): RecoveryProfile {
      const existing = findBySituation(situation.id);
      if (existing) return cloneProfile(existing);
      const now = clock();
      const peakSeverity = peakObs.severity;
      const profile: RecoveryProfile = {
        id: nextProfileId(now),
        domain: situation.domain,
        region: regionLabel(situation),
        situationId: situation.id,
        startedAt: now,
        expectedDurationHours: expectedDurationFor(situation.domain),
        phase: 'acute',
        peakSeverity,
        currentSeverityNum: severityNum(peakSeverity),
        recoveryRate: 0,
        estimatedResolutionAt: null,
        dataPoints: [{
          timestamp: peakObs.timestamp,
          severityNum: severityNum(peakSeverity),
          observationCount: 1,
        }],
        centerLat: situation.location?.lat ?? peakObs.location?.lat ?? null,
        centerLon: situation.location?.lon ?? peakObs.location?.lon ?? null,
      };
      profiles.push(profile);
      evictIfOverCapacity();
      persist();
      notify();
      return cloneProfile(profile);
    },

    ingestObservation(obs): void {
      const profile = matchProfileForObs(obs);
      if (!profile) return;
      const point: RecoveryDataPoint = {
        timestamp: obs.timestamp,
        severityNum: severityNum(obs.severity),
        observationCount: 1,
      };
      profile.dataPoints.push(point);
      profile.currentSeverityNum = point.severityNum;
      updatePhase(profile);
      persist();
      notify();
    },

    updateRecoveryRate(profileId): void {
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return;
      profile.recoveryRate = linearRegressionRate(profile.dataPoints);
      persist();
      notify();
    },

    estimateResolution(profileId): number | null {
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return null;
      if (profile.recoveryRate <= 0) {
        profile.estimatedResolutionAt = null;
        persist();
        return null;
      }
      const last = profile.dataPoints[profile.dataPoints.length - 1];
      if (!last) return null;
      const remainingBands = last.severityNum - SEVERITY_LOW;
      if (remainingBands <= 0) {
        profile.estimatedResolutionAt = last.timestamp;
        persist();
        return last.timestamp;
      }
      const hoursToLow = remainingBands / profile.recoveryRate;
      const estimate = last.timestamp + hoursToLow * 3_600_000;
      profile.estimatedResolutionAt = estimate;
      persist();
      return estimate;
    },

    getProfile(id): RecoveryProfile | undefined {
      const p = profiles.find((x) => x.id === id);
      return p ? cloneProfile(p) : undefined;
    },

    getActiveProfiles(): RecoveryProfile[] {
      return profiles
        .filter((p) => p.phase !== 'resolved')
        .map((p) => cloneProfile(p));
    },

    getCompletedProfiles(limit = 20): RecoveryProfile[] {
      const resolved = profiles.filter((p) => p.phase === 'resolved').slice(-limit);
      const out: RecoveryProfile[] = [];
      for (let i = resolved.length - 1; i >= 0; i--) {
        out.push(cloneProfile(resolved[i]!));
      }
      return out;
    },

    stats(): RecoveryStats {
      const active = profiles.filter((p) => p.phase !== 'resolved');
      const avgRecoveryRateByDomain: Record<string, number> = {};
      const avgDurationByDomain: Record<string, number> = {};
      const rateAccum: Record<string, { sum: number; n: number }> = {};
      const durationAccum: Record<string, { sum: number; n: number }> = {};
      for (const p of active) {
        const r = rateAccum[p.domain] ?? { sum: 0, n: 0 };
        r.sum += p.recoveryRate;
        r.n += 1;
        rateAccum[p.domain] = r;
        const d = durationAccum[p.domain] ?? { sum: 0, n: 0 };
        d.sum += p.expectedDurationHours;
        d.n += 1;
        durationAccum[p.domain] = d;
      }
      for (const [k, v] of Object.entries(rateAccum)) {
        avgRecoveryRateByDomain[k] = v.n === 0 ? 0 : v.sum / v.n;
      }
      for (const [k, v] of Object.entries(durationAccum)) {
        avgDurationByDomain[k] = v.n === 0 ? 0 : v.sum / v.n;
      }
      return { activeCount: active.length, avgRecoveryRateByDomain, avgDurationByDomain };
    },

    subscribe(cb): void {
      listeners.add(cb);
    },
    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: RecoveryModelingEngine | null = null;

export function getRecoveryModelingEngine(): RecoveryModelingEngine {
  _singleton ??= createRecoveryModelingEngine();
  return _singleton;
}

export function _resetRecoveryModelingSingletonForTests(): void {
  _singleton = null;
}
