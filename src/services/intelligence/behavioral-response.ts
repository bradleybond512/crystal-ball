/**
 * BehavioralResponseModel — track how populations and regional systems
 * respond to stress events over time. Models a 5-phase response curve
 * (shock → mobilization → adaptation → normalization → resilience)
 * with per-domain phase durations.
 *
 * Pure deterministic; no DOM, no fetch.
 */

import type { ObservationEvent } from './observation-adapters';

// ── Public types ─────────────────────────────────────────────────────

export type ResponsePhase =
  | 'shock'
  | 'mobilization'
  | 'adaptation'
  | 'normalization'
  | 'resilience';

export interface BehavioralDataPoint {
  timestamp: number;
  observedSeverityNum: number;
  responseIntensity: number;
  phase: ResponsePhase;
}

export interface BehavioralProfile {
  id: string;
  domain: string;
  region: string;
  eventId: string;
  phase: ResponsePhase;
  stressScore: number;
  mobilizationScore: number;
  adaptationRate: number;
  estimatedNormalizationAt: number | null;
  dataPoints: BehavioralDataPoint[];
  startedAt: number;
}

export interface BehavioralStats {
  avgAdaptationRateByDomain: Record<string, number>;
  mostResilientRegions: { region: string; adaptationRate: number }[];
  avgShockDurationHours: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BehavioralResponseModelOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

const DEFAULT_CAPACITY = 100;
export const STORAGE_KEY = 'wm-behavioral-response';

// ── Severity rank → 0..1 score (CRITICAL = 1.0, scaled by 4) ────────

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0,
};

function severityNorm(severity: string): number {
  return (SEVERITY_RANK[severity] ?? 0) / 4;
}

// ── Domain phase-duration templates ─────────────────────────────────

interface PhaseTemplate {
  /** Boundary in hours when the system leaves shock. */
  shockEndHours: number;
  /** Boundary in hours when the system leaves mobilization. */
  mobilizationEndHours: number;
  /** Boundary in hours when the system leaves adaptation
   *  (entering normalization). */
  adaptationEndHours: number;
}

const HOUR_MS = 60 * 60_000;
const DAY_HOURS = 24;
const WEEK_HOURS = 7 * DAY_HOURS;

const DOMAIN_TEMPLATES: Record<string, PhaseTemplate> = {
  earthquake:      { shockEndHours: 6,  mobilizationEndHours: 48,  adaptationEndHours: 2 * WEEK_HOURS },
  weather:         { shockEndHours: 12, mobilizationEndHours: 72,  adaptationEndHours: WEEK_HOURS },
  biosurveillance: { shockEndHours: 24, mobilizationEndHours: 168, adaptationEndHours: 4 * WEEK_HOURS },
  cyber:           { shockEndHours: 2,  mobilizationEndHours: 24,  adaptationEndHours: WEEK_HOURS },
  maritime:        { shockEndHours: 8,  mobilizationEndHours: 48,  adaptationEndHours: WEEK_HOURS },
  aviation:        { shockEndHours: 1,  mobilizationEndHours: 12,  adaptationEndHours: 72 },
  'space-weather': { shockEndHours: 6,  mobilizationEndHours: 48,  adaptationEndHours: WEEK_HOURS },
  geopolitical:    { shockEndHours: 48, mobilizationEndHours: 14 * DAY_HOURS, adaptationEndHours: 60 * DAY_HOURS },
};

const DEFAULT_TEMPLATE: PhaseTemplate = {
  shockEndHours: 6,
  mobilizationEndHours: 48,
  adaptationEndHours: 2 * WEEK_HOURS,
};

function templateFor(domain: string): PhaseTemplate {
  return DOMAIN_TEMPLATES[domain] ?? DEFAULT_TEMPLATE;
}

// ── Phase decision ──────────────────────────────────────────────────

function timeBasedPhase(elapsedHours: number, template: PhaseTemplate): ResponsePhase {
  if (elapsedHours < template.shockEndHours) return 'shock';
  if (elapsedHours < template.mobilizationEndHours) return 'mobilization';
  if (elapsedHours < template.adaptationEndHours) return 'adaptation';
  return 'normalization';
}

/** Sustained low severity past normalization-onset signals true
 *  resilience: the system isn't just back to baseline, it's better
 *  than before. Requires at least 3 LOW/INFO observations after
 *  entering normalization. */
function shouldPromoteToResilience(profile: BehavioralProfile, currentPhase: ResponsePhase): boolean {
  if (currentPhase !== 'normalization') return false;
  let lowCount = 0;
  for (let i = profile.dataPoints.length - 1; i >= 0; i--) {
    const dp = profile.dataPoints[i]!;
    if (dp.phase !== 'normalization') break;
    if (dp.observedSeverityNum <= 0.25) lowCount++;
  }
  return lowCount >= 3;
}

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedState {
  profiles: BehavioralProfile[];
}

export class BehavioralResponseModel {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly byId = new Map<string, BehavioralProfile>();
  private readonly order: string[] = [];
  private readonly subscribers = new Set<(profile: BehavioralProfile) => void>();

  constructor(opts: BehavioralResponseModelOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  initProfile(obs: ObservationEvent): BehavioralProfile {
    const now = this.clock();
    const region = regionOf(obs);
    const template = templateFor(obs.domain);
    const seed: BehavioralDataPoint = {
      timestamp: now,
      observedSeverityNum: severityNorm(obs.severity),
      responseIntensity: 0,
      phase: 'shock',
    };
    const profile: BehavioralProfile = {
      id: `brp-${now}-${this.byId.size + 1}`,
      domain: obs.domain,
      region,
      eventId: obs.id,
      phase: 'shock',
      stressScore: severityNorm(obs.severity),
      mobilizationScore: 0,
      adaptationRate: 0,
      estimatedNormalizationAt: now + template.adaptationEndHours * HOUR_MS,
      dataPoints: [seed],
      startedAt: now,
    };
    this.commit(profile);
    return profile;
  }

  ingestObservation(obs: ObservationEvent): void {
    const region = regionOf(obs);
    const existing = this.findProfile(obs.domain, region);
    if (!existing) {
      this.initProfile(obs);
      return;
    }
    const now = this.clock();
    const elapsedHours = (now - existing.startedAt) / HOUR_MS;
    const template = templateFor(existing.domain);
    // Resilience is a terminal phase: once a profile has demonstrated
    // sustained recovery, a fresh observation doesn't kick it back to
    // a time-based earlier phase. Otherwise compute from elapsed time.
    const basePhase: ResponsePhase = existing.phase === 'resilience'
      ? 'resilience'
      : timeBasedPhase(elapsedHours, template);
    const stressScore = Math.max(existing.stressScore, severityNorm(obs.severity));
    const dataPoint: BehavioralDataPoint = {
      timestamp: now,
      observedSeverityNum: severityNorm(obs.severity),
      responseIntensity: 0,
      phase: basePhase,
    };
    const dataPoints = [...existing.dataPoints, dataPoint];
    const mobilizationScore = computeMobilization(dataPoints, template);
    const adaptationRate = computeAdaptationRate(dataPoints);
    const updated: BehavioralProfile = {
      ...existing,
      dataPoints,
      stressScore,
      mobilizationScore,
      adaptationRate,
      phase: basePhase,
    };
    if (shouldPromoteToResilience(updated, basePhase)) {
      updated.phase = 'resilience';
      // Tag the just-pushed data point so the trail and the profile
      // phase agree.
      const tail = dataPoints[dataPoints.length - 1];
      if (tail) tail.phase = 'resilience';
    }
    this.commit(updated);
  }

  getProfiles(domain?: string): BehavioralProfile[] {
    const all = [...this.byId.values()];
    if (!domain) return all;
    return all.filter((p) => p.domain === domain);
  }

  getActiveProfiles(): BehavioralProfile[] {
    return this.getProfiles().filter((p) => p.phase !== 'normalization' && p.phase !== 'resilience');
  }

  stats(): BehavioralStats {
    const all = this.getProfiles();
    const sums = new Map<string, { sum: number; count: number }>();
    let totalShockHours = 0;
    let shockProfiles = 0;
    for (const p of all) {
      const cell = sums.get(p.domain) ?? { sum: 0, count: 0 };
      cell.sum += p.adaptationRate;
      cell.count++;
      sums.set(p.domain, cell);
      const template = templateFor(p.domain);
      totalShockHours += template.shockEndHours;
      shockProfiles++;
    }
    const avgAdaptationRateByDomain: Record<string, number> = {};
    for (const [domain, cell] of sums) {
      avgAdaptationRateByDomain[domain] = cell.count > 0 ? cell.sum / cell.count : 0;
    }
    const mostResilientRegions = [...all]
      .filter((p) => p.adaptationRate > 0)
      .sort((a, b) => b.adaptationRate - a.adaptationRate)
      .slice(0, 5)
      .map((p) => ({ region: p.region, adaptationRate: Number(p.adaptationRate.toFixed(4)) }));
    return {
      avgAdaptationRateByDomain,
      mostResilientRegions,
      avgShockDurationHours: shockProfiles > 0 ? totalShockHours / shockProfiles : 0,
    };
  }

  subscribe(cb: (profile: BehavioralProfile) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: (profile: BehavioralProfile) => void): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.byId.clear();
    this.order.length = 0;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private findProfile(domain: string, region: string): BehavioralProfile | undefined {
    for (const profile of this.byId.values()) {
      if (profile.domain === domain && profile.region === region) return profile;
    }
    return undefined;
  }

  private commit(profile: BehavioralProfile): void {
    const existed = this.byId.has(profile.id);
    this.byId.set(profile.id, profile);
    if (!existed) this.order.push(profile.id);
    while (this.order.length > this.capacity) {
      const evict = this.order.shift();
      if (evict !== undefined) this.byId.delete(evict);
    }
    this.persist();
    for (const cb of this.subscribers) cb(profile);
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed || !Array.isArray(parsed.profiles)) return;
      for (const profile of parsed.profiles) {
        if (!this.byId.has(profile.id)) this.order.push(profile.id);
        this.byId.set(profile.id, profile);
      }
    } catch {
      this.byId.clear();
      this.order.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedState = { profiles: [...this.byId.values()] };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: BehavioralResponseModel | undefined;

export function getBehavioralResponseModel(): BehavioralResponseModel {
  singleton ??= new BehavioralResponseModel();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function regionOf(obs: ObservationEvent): string {
  if (obs.entityIds.length === 0) return 'global';
  const first = obs.entityIds[0]!;
  const prefix = first.split('-')[0] ?? first;
  if (prefix.length === 0) return 'global';
  return prefix;
}

function computeMobilization(
  dataPoints: readonly BehavioralDataPoint[],
  template: PhaseTemplate,
): number {
  const mobPoints = dataPoints.filter((dp) => dp.phase === 'mobilization');
  if (mobPoints.length === 0) return 0;
  // Observation rate during mobilization phase, normalized by
  // template duration. Higher rate → higher mobilization score.
  const span = template.mobilizationEndHours - template.shockEndHours;
  if (span <= 0) return 0;
  const rate = mobPoints.length / span;
  return Number(Math.min(1, rate).toFixed(4));
}

function computeAdaptationRate(dataPoints: readonly BehavioralDataPoint[]): number {
  const adaptPoints = dataPoints.filter((dp) => dp.phase === 'adaptation');
  if (adaptPoints.length < 2) return 0;
  const first = adaptPoints[0]!;
  const last = adaptPoints[adaptPoints.length - 1]!;
  const dt = (last.timestamp - first.timestamp) / HOUR_MS;
  if (dt <= 0) return 0;
  // Positive rate = severity dropping over time.
  const delta = first.observedSeverityNum - last.observedSeverityNum;
  return Number(Math.max(0, delta / dt).toFixed(4));
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
