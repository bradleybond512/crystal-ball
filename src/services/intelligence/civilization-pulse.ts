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

// ── CivilizationPulseService ────────────────────────────────────────
//
// Sibling of CivilizationPulseEngine above. The Engine consumes
// `ObservationEvent[]` snapshots and outputs `PulseReading`. The
// Service consumes severity-level updates per domain and outputs a
// `CivilizationPulse` rolled across an internal 10-sample window per
// domain, with a weighted composite + status band + delta vs the last
// persisted pulse.
//
// Persisted at SERVICE_STORAGE_KEY (`wm-civilization-pulse-service`)
// so the two co-exist without trampling each other.

export type PulseStatus = 'nominal' | 'elevated' | 'stressed' | 'critical';
export type PulseDomainTrend = 'improving' | 'stable' | 'degrading';

export interface PulseDomain {
  domain: string;
  weight: number;
  currentScore: number;
  trend: PulseDomainTrend;
  lastUpdated: number;
}

export interface CivilizationPulse {
  compositeScore: number;
  status: PulseStatus;
  domains: PulseDomain[];
  deltaFromPrevious: number;
  timestamp: number;
}

export interface CivilizationPulseServiceOptions {
  storage?: StorageLike | null;
  now?: () => number;
  maxHistory?: number;
}

export const SERVICE_STORAGE_KEY = 'wm-civilization-pulse-service';
export const SERVICE_MAX_HISTORY = 200;
export const DOMAIN_SAMPLE_WINDOW = 10;
export const TREND_LOOKBACK = 5;
export const TREND_DELTA_THRESHOLD = 0.05;
const DEFAULT_NEW_DOMAIN_WEIGHT = 0.05;

export const SEVERITY_TO_SCORE: Record<number, number> = {
  0: 1, 1: 0.8, 2: 0.6, 3: 0.3, 4: 0,
};

export const PULSE_DOMAIN_WEIGHTS: Record<string, number> = {
  geopolitical: 0.2,
  economic: 0.18,
  health: 0.15,
  cyber: 0.15,
  climate: 0.12,
  social: 0.1,
  infrastructure: 0.05,
  space: 0.05,
};

export const PULSE_STATUS_THRESHOLDS: Record<Exclude<PulseStatus, 'critical'>, number> = {
  nominal: 0.7,
  elevated: 0.5,
  stressed: 0.3,
};

interface DomainState {
  domain: string;
  weight: number;
  samples: number[];
  scoreHistory: number[];
  currentScore: number;
  lastUpdated: number;
}

interface ServicePersistedState {
  domains: DomainState[];
  history: CivilizationPulse[];
}

export class CivilizationPulseService {
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly maxHistory: number;
  private readonly domains = new Map<string, DomainState>();
  private readonly history: CivilizationPulse[] = [];

  constructor(opts: CivilizationPulseServiceOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.maxHistory = opts.maxHistory ?? SERVICE_MAX_HISTORY;
    this.hydrate();
    this.seedMissing();
  }

  static getInstance(): CivilizationPulseService {
    serviceSingleton ??= new CivilizationPulseService();
    return serviceSingleton;
  }

  update(domain: string, severityLevel: number): void {
    const clamped = clampSeverity(severityLevel);
    const score = SEVERITY_TO_SCORE[clamped] ?? 0;
    const state = this.getOrCreateDomain(domain);
    state.samples.push(score);
    while (state.samples.length > DOMAIN_SAMPLE_WINDOW) state.samples.shift();
    state.currentScore = mean(state.samples);
    state.scoreHistory.push(state.currentScore);
    while (state.scoreHistory.length > DOMAIN_SAMPLE_WINDOW + TREND_LOOKBACK) state.scoreHistory.shift();
    state.lastUpdated = this.clock();
    this.persist();
  }

  getPulse(): CivilizationPulse {
    const timestamp = this.clock();
    const domains = this.buildDomainsView();
    const compositeScore = weightedComposite(domains);
    const status = statusFor(compositeScore);
    const previous = this.history[this.history.length - 1];
    const deltaFromPrevious = previous ? compositeScore - previous.compositeScore : 0;
    const pulse: CivilizationPulse = {
      compositeScore,
      status,
      domains,
      deltaFromPrevious,
      timestamp,
    };
    this.history.push(pulse);
    while (this.history.length > this.maxHistory) this.history.shift();
    this.persist();
    return clonePulse(pulse);
  }

  getDomains(): PulseDomain[] {
    return this.buildDomainsView().sort((a, b) => a.currentScore - b.currentScore);
  }

  getHistory(limit?: number): CivilizationPulse[] {
    const reversed: CivilizationPulse[] = [];
    for (let i = this.history.length - 1; i >= 0; i--) {
      reversed.push(clonePulse(this.history[i]!));
      if (limit && reversed.length >= limit) break;
    }
    return reversed;
  }

  clear(): void {
    this.domains.clear();
    this.history.length = 0;
    this.seedMissing();
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private getOrCreateDomain(domain: string): DomainState {
    const existing = this.domains.get(domain);
    if (existing) return existing;
    const created: DomainState = {
      domain,
      weight: PULSE_DOMAIN_WEIGHTS[domain] ?? DEFAULT_NEW_DOMAIN_WEIGHT,
      samples: [],
      scoreHistory: [],
      currentScore: 1,
      lastUpdated: this.clock(),
    };
    this.domains.set(domain, created);
    return created;
  }

  private seedMissing(): void {
    const now = this.clock();
    for (const [domain, weight] of Object.entries(PULSE_DOMAIN_WEIGHTS)) {
      if (this.domains.has(domain)) continue;
      this.domains.set(domain, {
        domain,
        weight,
        samples: [],
        scoreHistory: [],
        currentScore: 1,
        lastUpdated: now,
      });
    }
  }

  private buildDomainsView(): PulseDomain[] {
    const out: PulseDomain[] = [];
    for (const state of this.domains.values()) {
      out.push({
        domain: state.domain,
        weight: state.weight,
        currentScore: state.currentScore,
        trend: domainTrendFor(state),
        lastUpdated: state.lastUpdated,
      });
    }
    return out;
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(SERVICE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ServicePersistedState;
      if (!parsed || !Array.isArray(parsed.domains) || !Array.isArray(parsed.history)) return;
      for (const d of parsed.domains) {
        const restored = restoreDomainState(d, this.clock());
        if (restored) this.domains.set(restored.domain, restored);
      }
      for (const h of parsed.history) this.history.push(h);
      while (this.history.length > this.maxHistory) this.history.shift();
    } catch {
      this.domains.clear();
      this.history.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: ServicePersistedState = {
        domains: [...this.domains.values()],
        history: this.history,
      };
      this.storage.setItem(SERVICE_STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // non-fatal
    }
  }
}

let serviceSingleton: CivilizationPulseService | undefined;

export function resetServiceForTests(): void {
  serviceSingleton = undefined;
}

// ── Service helpers ──────────────────────────────────────────────────

function clampSeverity(severity: number): number {
  if (!Number.isFinite(severity)) return 0;
  if (severity < 0) return 0;
  if (severity > 4) return 4;
  return Math.round(severity);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 1;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

function weightedComposite(domains: readonly PulseDomain[]): number {
  let weightTotal = 0;
  let scoreTotal = 0;
  for (const d of domains) {
    weightTotal += d.weight;
    scoreTotal += d.weight * d.currentScore;
  }
  if (weightTotal <= 0) return 0;
  const score = scoreTotal / weightTotal;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

function statusFor(score: number): PulseStatus {
  if (score >= PULSE_STATUS_THRESHOLDS.nominal) return 'nominal';
  if (score >= PULSE_STATUS_THRESHOLDS.elevated) return 'elevated';
  if (score >= PULSE_STATUS_THRESHOLDS.stressed) return 'stressed';
  return 'critical';
}

function domainTrendFor(state: DomainState): PulseDomainTrend {
  if (state.scoreHistory.length <= TREND_LOOKBACK) return 'stable';
  const lookback = state.scoreHistory.slice(-TREND_LOOKBACK - 1, -1);
  if (lookback.length === 0) return 'stable';
  const baseline = mean(lookback);
  const delta = state.currentScore - baseline;
  if (delta > TREND_DELTA_THRESHOLD) return 'improving';
  if (delta < -TREND_DELTA_THRESHOLD) return 'degrading';
  return 'stable';
}

function restoreDomainState(d: unknown, fallbackTimestamp: number): DomainState | null {
  if (typeof d !== 'object' || d === null) return null;
  const raw = d as Partial<DomainState>;
  if (typeof raw.domain !== 'string') return null;
  return {
    domain: raw.domain,
    weight: typeof raw.weight === 'number' ? raw.weight : DEFAULT_NEW_DOMAIN_WEIGHT,
    samples: Array.isArray(raw.samples) ? raw.samples : [],
    scoreHistory: Array.isArray(raw.scoreHistory) ? raw.scoreHistory : [],
    currentScore: typeof raw.currentScore === 'number' ? raw.currentScore : 1,
    lastUpdated: typeof raw.lastUpdated === 'number' ? raw.lastUpdated : fallbackTimestamp,
  };
}

function clonePulse(p: CivilizationPulse): CivilizationPulse {
  return {
    compositeScore: p.compositeScore,
    status: p.status,
    domains: p.domains.map((d) => ({ ...d })),
    deltaFromPrevious: p.deltaFromPrevious,
    timestamp: p.timestamp,
  };
}
