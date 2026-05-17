/**
 * CivilizationPulseEngine — composite real-time health score for the
 * global system. Aggregates ObservationEvent signals across all
 * domains into a single normalized 0–100 pulse reading.
 *
 * Pure deterministic; no DOM, no fetch.
 */

import type { ObservationEvent } from './observation-adapters';

// ── Public types ─────────────────────────────────────────────────────

export type PulseTrend = 'improving' | 'stable' | 'degrading';
export type PulseLabel = 'nominal' | 'elevated' | 'stressed' | 'critical';

export interface DomainPulse {
  domain: string;
  score: number;
  trend: PulseTrend;
  weight: number;
  lastUpdated: number;
  activeAlerts: number;
}

export interface PulseReading {
  overallScore: number;
  label: PulseLabel;
  domainPulses: DomainPulse[];
  dominantStressor: string | null;
  readingAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CivilizationPulseEngineOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

const DEFAULT_CAPACITY = 500;
const DEFAULT_HISTORY_LIMIT = 48;
export const STORAGE_KEY = 'wm-civilization-pulse';

// ── Scoring constants ───────────────────────────────────────────────

const SEVERITY_PENALTY: Record<string, number> = {
  CRITICAL: 15,
  HIGH: 8,
  MEDIUM: 3,
  LOW: 1,
  INFO: 0,
};

const DOMAIN_WEIGHTS: Record<string, number> = {
  geopolitical: 1.5,
  biosurveillance: 1.4,
  earthquake: 1.2,
  weather: 1.1,
};
const DEFAULT_DOMAIN_WEIGHT = 1;

const NOMINAL_THRESHOLD = 75;
const ELEVATED_THRESHOLD = 50;
const STRESSED_THRESHOLD = 25;
const TREND_THRESHOLD = 5;

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedState {
  history: PulseReading[];
}

export class CivilizationPulseEngine {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly history: PulseReading[] = [];
  private readonly subscribers = new Set<(reading: PulseReading) => void>();

  constructor(opts: CivilizationPulseEngineOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  computePulse(observations: readonly ObservationEvent[]): PulseReading {
    const readingAt = this.clock();
    const priorByDomain = lastDomainScores(this.history);
    const domainPulses = computeDomainPulses(observations, readingAt, priorByDomain);
    const overallScore = weightedAverage(domainPulses);
    const reading: PulseReading = {
      overallScore,
      label: labelFor(overallScore),
      domainPulses,
      dominantStressor: pickDominantStressor(domainPulses),
      readingAt,
    };
    this.history.push(reading);
    while (this.history.length > this.capacity) this.history.shift();
    this.persist();
    for (const cb of this.subscribers) cb(reading);
    return reading;
  }

  getLatestReading(): PulseReading | undefined {
    return this.history.length === 0 ? undefined : this.history[this.history.length - 1];
  }

  getHistory(limit: number = DEFAULT_HISTORY_LIMIT): PulseReading[] {
    if (limit >= this.history.length) return [...this.history];
    return this.history.slice(this.history.length - limit);
  }

  subscribe(cb: (reading: PulseReading) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: (reading: PulseReading) => void): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.history.length = 0;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed || !Array.isArray(parsed.history)) return;
      for (const reading of parsed.history) this.history.push(reading);
      while (this.history.length > this.capacity) this.history.shift();
    } catch {
      this.history.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedState = { history: this.history };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: CivilizationPulseEngine | undefined;

export function getCivilizationPulseEngine(): CivilizationPulseEngine {
  singleton ??= new CivilizationPulseEngine();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Scoring helpers ─────────────────────────────────────────────────

function lastDomainScores(history: readonly PulseReading[]): Map<string, number> {
  const map = new Map<string, number>();
  if (history.length === 0) return map;
  const last = history[history.length - 1]!;
  for (const dp of last.domainPulses) map.set(dp.domain, dp.score);
  return map;
}

function computeDomainPulses(
  observations: readonly ObservationEvent[],
  readingAt: number,
  priorByDomain: ReadonlyMap<string, number>,
): DomainPulse[] {
  const byDomain = new Map<string, { penalty: number; count: number }>();
  for (const obs of observations) {
    const cell = byDomain.get(obs.domain) ?? { penalty: 0, count: 0 };
    cell.penalty += SEVERITY_PENALTY[obs.severity] ?? 0;
    cell.count++;
    byDomain.set(obs.domain, cell);
  }
  const out: DomainPulse[] = [];
  for (const [domain, { penalty, count }] of byDomain) {
    const score = Math.max(0, 100 - penalty);
    const prior = priorByDomain.get(domain);
    out.push({
      domain,
      score,
      trend: trendFor(prior, score),
      weight: DOMAIN_WEIGHTS[domain] ?? DEFAULT_DOMAIN_WEIGHT,
      lastUpdated: readingAt,
      activeAlerts: count,
    });
  }
  return out.sort((a, b) => a.domain.localeCompare(b.domain));
}

function weightedAverage(domainPulses: readonly DomainPulse[]): number {
  if (domainPulses.length === 0) return 100;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const dp of domainPulses) {
    weightedSum += dp.score * dp.weight;
    totalWeight += dp.weight;
  }
  if (totalWeight === 0) return 100;
  return Math.round(weightedSum / totalWeight);
}

function labelFor(score: number): PulseLabel {
  if (score >= NOMINAL_THRESHOLD) return 'nominal';
  if (score >= ELEVATED_THRESHOLD) return 'elevated';
  if (score >= STRESSED_THRESHOLD) return 'stressed';
  return 'critical';
}

function trendFor(prior: number | undefined, current: number): PulseTrend {
  if (prior === undefined) return 'stable';
  const delta = current - prior;
  if (delta > TREND_THRESHOLD) return 'improving';
  if (delta < -TREND_THRESHOLD) return 'degrading';
  return 'stable';
}

function pickDominantStressor(domainPulses: readonly DomainPulse[]): string | null {
  let pick: DomainPulse | null = null;
  for (const dp of domainPulses) {
    if (dp.score >= 100) continue;
    if (!pick || dp.score < pick.score) pick = dp;
  }
  return pick?.domain ?? null;
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
