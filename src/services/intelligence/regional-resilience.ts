/**
 * Regional Resilience Index — scores each of 15 baseline world
 * regions on how well it withstands and recovers from repeated
 * crises, based on observed recovery patterns.
 *
 * Pure service with injectable Storage. Scores start at 50 (moderate)
 * and shift based on:
 *   + fast recovery (avg < 3 days):           +10
 *   + moderate recovery (3 ≤ avg < 7 days):   +5
 *   − slow recovery (14 < avg ≤ 30 days):     −8
 *   − very slow recovery (avg > 30 days):     −15
 *   − high frequency (>5 events in 90 days):  −10
 *   + improving trend (last 3 < prior 3):     +10
 *
 * Clamped to [0, 100]. Label bands map every 20 points
 * (fragile / vulnerable / moderate / resilient / robust). Region is
 * derived from `region:X` tags on the observation when present, then
 * from observation coordinates via nearest-region match against the
 * 15-region center table.
 */

import type { ObservationEvent } from '@/types/intelligence';

// ── Public types ─────────────────────────────────────────────────────────

export type ResilienceLabel = 'fragile' | 'vulnerable' | 'moderate' | 'resilient' | 'robust';
export type ResilienceTrend = 'improving' | 'stable' | 'degrading';

export interface RegionalScore {
  region: string;
  score: number;
  label: ResilienceLabel;
  trend: ResilienceTrend;
  eventCount: number;
  avgRecoveryDays: number;
  worstDomain: string | null;
  lastUpdated: number;
}

export interface ResilienceEvent {
  region: string;
  domain: string;
  peakSeverity: string;
  startAt: number;
  recoveredAt: number | null;
  recoveryDays: number | null;
}

export interface BaselineRegion {
  name: string;
  centerLat: number;
  centerLon: number;
}

export const BASELINE_REGIONS: readonly BaselineRegion[] = [
  { name: 'Northeast Asia', centerLat: 35, centerLon: 140 },
  { name: 'Southeast Asia', centerLat: 1, centerLon: 104 },
  { name: 'South Asia', centerLat: 28, centerLon: 77 },
  { name: 'Middle East', centerLat: 24, centerLon: 46 },
  { name: 'Eastern Europe', centerLat: 55, centerLon: 37 },
  { name: 'Western Europe', centerLat: 48, centerLon: 2 },
  { name: 'North America East', centerLat: 40, centerLon: -74 },
  { name: 'North America West', centerLat: 34, centerLon: -118 },
  { name: 'Central America', centerLat: 19, centerLon: -99 },
  { name: 'South America North', centerLat: 4, centerLon: -74 },
  { name: 'South America South', centerLat: -34, centerLon: -58 },
  { name: 'North Africa', centerLat: 30, centerLon: 31 },
  { name: 'Sub-Saharan Africa', centerLat: 6, centerLon: 3 },
  { name: 'Oceania', centerLat: -33, centerLon: 151 },
  { name: 'Pacific', centerLat: 0, centerLon: 180 },
];

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RegionalResilienceIndexOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

export interface RegionalResilienceIndex {
  ingestEvent(obs: ObservationEvent, resolvedAt?: number): void;
  computeScore(region: string): RegionalScore;
  getScore(region: string): RegionalScore | undefined;
  getAllScores(): RegionalScore[];
  getTopResilient(n?: number): RegionalScore[];
  getMostFragile(n?: number): RegionalScore[];
  subscribe(cb: (scores: RegionalScore[]) => void): void;
  unsubscribe(cb: (scores: RegionalScore[]) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-regional-resilience';
export const MAX_EVENTS = 1000;
export const MAX_REGIONS = 200;

const DAY_MS = 24 * 60 * 60_000;
const FREQUENCY_WINDOW_DAYS = 90;
const FREQUENCY_THRESHOLD = 5;
const TREND_WINDOW = 3;
const TREND_MIN_EVENTS = 6;

// ── Helpers ──────────────────────────────────────────────────────────────

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestRegion(lat: number, lon: number): string {
  let best = BASELINE_REGIONS[0]!;
  let bestDist = Infinity;
  for (const r of BASELINE_REGIONS) {
    const d = haversineKm(lat, lon, r.centerLat, r.centerLon);
    if (d < bestDist) { best = r; bestDist = d; }
  }
  return best.name;
}

const REGION_NAMES: ReadonlySet<string> = new Set(BASELINE_REGIONS.map((r) => r.name));

function resolveRegion(obs: ObservationEvent): string | null {
  for (const tag of obs.tags) {
    if (tag.startsWith('region:')) {
      const name = tag.slice('region:'.length);
      if (REGION_NAMES.has(name)) return name;
    }
  }
  if (obs.location) return nearestRegion(obs.location.lat, obs.location.lon);
  return null;
}

function labelForScore(score: number): ResilienceLabel {
  if (score < 20) return 'fragile';
  if (score < 40) return 'vulnerable';
  if (score < 60) return 'moderate';
  if (score < 80) return 'resilient';
  return 'robust';
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneScore(s: RegionalScore): RegionalScore {
  return { ...s };
}

// ── Score computation ───────────────────────────────────────────────────

function recoveryDaysOf(event: ResilienceEvent, now: number): number {
  if (event.recoveryDays !== null) return event.recoveryDays;
  return Math.max(0, (now - event.startAt) / DAY_MS);
}

function avgRecoveryDays(events: readonly ResilienceEvent[], now: number): number {
  if (events.length === 0) return 0;
  let sum = 0;
  for (const e of events) sum += recoveryDaysOf(e, now);
  return sum / events.length;
}

function frequencyBonus(events: readonly ResilienceEvent[], now: number): number {
  const cutoff = now - FREQUENCY_WINDOW_DAYS * DAY_MS;
  const recent = events.filter((e) => e.startAt >= cutoff);
  return recent.length > FREQUENCY_THRESHOLD ? -10 : 0;
}

function trendOf(events: readonly ResilienceEvent[]): ResilienceTrend {
  if (events.length < TREND_MIN_EVENTS) return 'stable';
  const sorted = [...events].sort((a, b) => a.startAt - b.startAt);
  const lastN = sorted.slice(-TREND_WINDOW);
  const priorN = sorted.slice(-(TREND_WINDOW * 2), -TREND_WINDOW);
  if (lastN.length < TREND_WINDOW || priorN.length < TREND_WINDOW) return 'stable';
  const avg = (arr: ResilienceEvent[]): number => {
    let s = 0; let n = 0;
    for (const e of arr) {
      if (e.recoveryDays !== null) { s += e.recoveryDays; n += 1; }
    }
    return n === 0 ? 0 : s / n;
  };
  const lastAvg = avg(lastN);
  const priorAvg = avg(priorN);
  if (lastAvg < priorAvg) return 'improving';
  if (lastAvg > priorAvg) return 'degrading';
  return 'stable';
}

function recoveryBonus(avgDays: number): number {
  if (avgDays < 3) return 10;
  if (avgDays < 7) return 5;
  if (avgDays > 30) return -15;
  if (avgDays > 14) return -8;
  return 0;
}

function worstDomainFor(events: readonly ResilienceEvent[], now: number): string | null {
  const byDomain = new Map<string, { sum: number; n: number }>();
  for (const e of events) {
    const d = byDomain.get(e.domain) ?? { sum: 0, n: 0 };
    d.sum += recoveryDaysOf(e, now);
    d.n += 1;
    byDomain.set(e.domain, d);
  }
  let worst: string | null = null;
  let worstAvg = -Infinity;
  for (const [domain, agg] of byDomain) {
    const avg = agg.sum / agg.n;
    if (avg > worstAvg) { worst = domain; worstAvg = avg; }
  }
  return worst;
}

// ── Persistence ─────────────────────────────────────────────────────────

interface PersistedState {
  events: ResilienceEvent[];
}

function rehydrate(storage: StorageLike | null): ResilienceEvent[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return []; }
  if (!parsed || typeof parsed !== 'object') return [];
  const state = parsed as PersistedState;
  if (!Array.isArray(state.events)) return [];
  return state.events;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createRegionalResilienceIndex(
  options: RegionalResilienceIndexOptions = {},
): RegionalResilienceIndex {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const events: ResilienceEvent[] = rehydrate(storage);
  const listeners = new Set<(scores: RegionalScore[]) => void>();

  function persist(): void {
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ events })); }
    catch { /* non-critical */ }
  }

  function notify(): void {
    const snapshot = buildAllScores();
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function eventsForRegion(region: string): ResilienceEvent[] {
    return events.filter((e) => e.region === region);
  }

  function computeScoreInternal(region: string): RegionalScore {
    const regionEvents = eventsForRegion(region);
    const now = clock();
    if (regionEvents.length === 0) {
      return {
        region,
        score: 50, label: 'moderate', trend: 'stable',
        eventCount: 0, avgRecoveryDays: 0, worstDomain: null,
        lastUpdated: now,
      };
    }
    const avgDays = avgRecoveryDays(regionEvents, now);
    const trend = trendOf(regionEvents);
    const recovery = recoveryBonus(avgDays);
    const freq = frequencyBonus(regionEvents, now);
    const improving = trend === 'improving' ? 10 : 0;
    const score = clampScore(50 + recovery + freq + improving);
    return {
      region,
      score,
      label: labelForScore(score),
      trend,
      eventCount: regionEvents.length,
      avgRecoveryDays: avgDays,
      worstDomain: worstDomainFor(regionEvents, now),
      lastUpdated: now,
    };
  }

  function buildAllScores(): RegionalScore[] {
    const out: RegionalScore[] = [];
    const seen = new Set<string>();
    for (const r of BASELINE_REGIONS) {
      out.push(computeScoreInternal(r.name));
      seen.add(r.name);
    }
    // Any custom regions accreted from explicit region:X tags
    for (const e of events) {
      if (seen.has(e.region)) continue;
      seen.add(e.region);
      out.push(computeScoreInternal(e.region));
      if (out.length >= MAX_REGIONS) break;
    }
    return out;
  }

  return {
    ingestEvent(obs, resolvedAt): void {
      const region = resolveRegion(obs);
      if (!region) return;
      const recoveredAt = typeof resolvedAt === 'number' ? resolvedAt : null;
      const recoveryDays = recoveredAt === null
        ? null
        : Math.max(0, (recoveredAt - obs.timestamp) / DAY_MS);
      events.push({
        region,
        domain: obs.domain,
        peakSeverity: obs.severity,
        startAt: obs.timestamp,
        recoveredAt,
        recoveryDays,
      });
      if (events.length > MAX_EVENTS) {
        events.splice(0, events.length - MAX_EVENTS);
      }
      persist();
      notify();
    },

    computeScore(region): RegionalScore {
      return cloneScore(computeScoreInternal(region));
    },

    getScore(region): RegionalScore | undefined {
      if (REGION_NAMES.has(region) || events.some((e) => e.region === region)) {
        return cloneScore(computeScoreInternal(region));
      }
      return undefined;
    },

    getAllScores(): RegionalScore[] {
      return buildAllScores().map((s) => cloneScore(s));
    },

    getTopResilient(n = 5): RegionalScore[] {
      return buildAllScores()
        .sort((a, b) => b.score - a.score)
        .slice(0, n)
        .map((s) => cloneScore(s));
    },

    getMostFragile(n = 5): RegionalScore[] {
      return buildAllScores()
        .sort((a, b) => a.score - b.score)
        .slice(0, n)
        .map((s) => cloneScore(s));
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

let _singleton: RegionalResilienceIndex | null = null;

export function getRegionalResilienceIndex(): RegionalResilienceIndex {
  _singleton ??= createRegionalResilienceIndex();
  return _singleton;
}

export function _resetRegionalResilienceSingletonForTests(): void {
  _singleton = null;
}
