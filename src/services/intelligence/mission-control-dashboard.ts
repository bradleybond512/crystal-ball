/**
 * MissionControlDashboardService — unified command-view aggregator that
 * bundles civilization pulse, situation roll-ups, world narrative, feed
 * health, anomaly counts, upcoming calendar events, and recent crisis
 * signature matches into a single `MissionControlSnapshot`.
 *
 * Pure deterministic; no DOM, no fetch. Upstream services are read via
 * an injectable `MissionControlSources` adapter — production wires the
 * live engines, tests pass deterministic stubs.
 */

// ── Public types ─────────────────────────────────────────────────────

export type MissionControlSeverity = 'low' | 'medium' | 'high' | 'critical';
export type MissionControlStatus = 'active' | 'watching' | 'resolved';

export interface MissionControlPulseSnapshot {
  overallScore: number;
  label: string;
  dominantStressor: string | null;
}

export interface MissionControlSituationSnapshot {
  id: string;
  name: string;
  domain: string;
  severity: MissionControlSeverity;
  status: MissionControlStatus;
  summary: string;
  confidence: number;
}

export interface MissionControlNarrativeSnapshot {
  headline: string;
  executiveSummary: string;
}

export interface MissionControlFeedSnapshot {
  total: number;
  healthy: number;
  degraded: number;
  stale: number;
  offline: number;
  unacknowledgedAlerts: number;
}

export interface MissionControlAnomalySnapshot {
  total: number;
  unacknowledged: number;
  topDomain: string | null;
}

export interface MissionControlCalendarEntry {
  id: string;
  title: string;
  type: string;
  scheduledAt: number;
  riskLevel: MissionControlSeverity;
  country: string;
  region: string;
}

export interface MissionControlCalendarEntryRendered extends MissionControlCalendarEntry {
  daysUntil: number;
}

export interface MissionControlSignatureMatch {
  signatureId: string;
  signatureName: string;
  confidence: 'low' | 'medium' | 'high';
  matchScore: number;
}

export interface MissionControlSnapshot {
  id: string;
  generatedAt: number;
  civilizationScore: number | null;
  civilizationLabel: string | null;
  dominantStressor: string | null;
  activeSituationCount: number;
  criticalSituationCount: number;
  topSituations: MissionControlSituationSnapshot[];
  narrativeHeadline: string | null;
  narrativeSummary: string | null;
  feedHealth: MissionControlFeedSnapshot | null;
  anomalyCount: number;
  anomalyTopDomain: string | null;
  upcomingEventsCount: number;
  upcomingEvents: MissionControlCalendarEntryRendered[];
  signatureMatches: MissionControlSignatureMatch[];
  systemHealthScore: number;
}

export interface MissionControlSources {
  getPulse(): MissionControlPulseSnapshot | null;
  getSituations(): readonly MissionControlSituationSnapshot[];
  getNarrative(): MissionControlNarrativeSnapshot | null;
  getFeedHealth(): MissionControlFeedSnapshot | null;
  getAnomalySummary(): MissionControlAnomalySnapshot | null;
  getUpcomingEvents(): readonly MissionControlCalendarEntry[];
  getRecentSignatureMatches(): readonly MissionControlSignatureMatch[];
}

export type MissionControlListener = (snapshot: MissionControlSnapshot) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface MissionControlDashboardServiceOptions {
  sources: MissionControlSources;
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_CAPACITY = 100;
export const STORAGE_KEY = 'wm-mission-control';
const TOP_SITUATIONS_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const SEVERITY_RANK: Record<MissionControlSeverity, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};
const STATUS_RANK: Record<MissionControlStatus, number> = {
  active: 3, watching: 2, resolved: 1,
};

// System-health scoring weights
const HEALTH_FEED_OFFLINE_PENALTY = 6;
const HEALTH_FEED_STALE_PENALTY = 3;
const HEALTH_FEED_DEGRADED_PENALTY = 1;
const HEALTH_CRITICAL_SIT_PENALTY = 8;
const HEALTH_HIGH_SIT_PENALTY = 4;
const HEALTH_ANOMALY_PENALTY = 2;
const HEALTH_PULSE_WEIGHT = 0.3;

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedState {
  history: MissionControlSnapshot[];
}

export class MissionControlDashboardService {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly sources: MissionControlSources;
  private readonly history: MissionControlSnapshot[] = [];
  private readonly subscribers = new Set<MissionControlListener>();
  private idCounter = 0;

  constructor(opts: MissionControlDashboardServiceOptions) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.sources = opts.sources;
    this.hydrate();
  }

  refresh(): MissionControlSnapshot {
    const generatedAt = this.clock();
    const pulse = safe(() => this.sources.getPulse()) ?? null;
    const situations = safe(() => this.sources.getSituations()) ?? [];
    const narrative = safe(() => this.sources.getNarrative()) ?? null;
    const feedHealth = safe(() => this.sources.getFeedHealth()) ?? null;
    const anomaly = safe(() => this.sources.getAnomalySummary()) ?? null;
    const upcomingRaw = safe(() => this.sources.getUpcomingEvents()) ?? [];
    const signatureMatches = [...(safe(() => this.sources.getRecentSignatureMatches()) ?? [])];

    const activeSituationCount = countActive(situations);
    const criticalSituationCount = countCriticalActive(situations);
    const topSituations = rankSituations(situations).slice(0, TOP_SITUATIONS_LIMIT);
    const upcomingEvents = renderUpcoming([...upcomingRaw], generatedAt);

    const systemHealthScore = computeSystemHealthScore({
      pulse, feedHealth, anomaly, situations,
    });

    this.idCounter++;
    const id = `mc-${generatedAt}-${this.idCounter}`;
    const snapshot: MissionControlSnapshot = {
      id,
      generatedAt,
      civilizationScore: pulse?.overallScore ?? null,
      civilizationLabel: pulse?.label ?? null,
      dominantStressor: pulse?.dominantStressor ?? null,
      activeSituationCount,
      criticalSituationCount,
      topSituations,
      narrativeHeadline: narrative?.headline ?? null,
      narrativeSummary: narrative?.executiveSummary ?? null,
      feedHealth,
      anomalyCount: anomaly?.total ?? 0,
      anomalyTopDomain: anomaly?.topDomain ?? null,
      upcomingEventsCount: upcomingEvents.length,
      upcomingEvents,
      signatureMatches,
      systemHealthScore,
    };

    this.history.push(snapshot);
    while (this.history.length > this.capacity) this.history.shift();
    this.persist();
    for (const cb of this.subscribers) cb(snapshot);
    return snapshot;
  }

  getLatest(): MissionControlSnapshot | null {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1] ?? null;
  }

  getHistory(limit?: number): MissionControlSnapshot[] {
    const reversed: MissionControlSnapshot[] = [];
    for (let i = this.history.length - 1; i >= 0; i--) {
      reversed.push(this.history[i]!);
      if (limit && reversed.length >= limit) break;
    }
    return reversed;
  }

  subscribe(cb: MissionControlListener): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: MissionControlListener): void {
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
      for (const s of parsed.history) this.history.push(s);
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

let singleton: MissionControlDashboardService | undefined;

export function getMissionControlDashboardService(sources: MissionControlSources): MissionControlDashboardService {
  singleton ??= new MissionControlDashboardService({ sources });
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function countActive(situations: readonly MissionControlSituationSnapshot[]): number {
  let n = 0;
  for (const s of situations) if (s.status === 'active') n++;
  return n;
}

function countCriticalActive(situations: readonly MissionControlSituationSnapshot[]): number {
  let n = 0;
  for (const s of situations) if (s.status === 'active' && s.severity === 'critical') n++;
  return n;
}

function rankSituations(
  situations: readonly MissionControlSituationSnapshot[],
): MissionControlSituationSnapshot[] {
  return [...situations].sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return STATUS_RANK[b.status] - STATUS_RANK[a.status];
  });
}

function renderUpcoming(
  events: MissionControlCalendarEntry[],
  generatedAt: number,
): MissionControlCalendarEntryRendered[] {
  return events
    .map((e) => ({ ...e, daysUntil: Math.max(0, Math.round((e.scheduledAt - generatedAt) / DAY_MS)) }))
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

interface HealthInputs {
  pulse: MissionControlPulseSnapshot | null;
  feedHealth: MissionControlFeedSnapshot | null;
  anomaly: MissionControlAnomalySnapshot | null;
  situations: readonly MissionControlSituationSnapshot[];
}

function computeSystemHealthScore(inputs: HealthInputs): number {
  let score = 100;

  if (inputs.feedHealth) {
    score -= inputs.feedHealth.offline * HEALTH_FEED_OFFLINE_PENALTY;
    score -= inputs.feedHealth.stale * HEALTH_FEED_STALE_PENALTY;
    score -= inputs.feedHealth.degraded * HEALTH_FEED_DEGRADED_PENALTY;
  }

  for (const s of inputs.situations) {
    if (s.status !== 'active') continue;
    if (s.severity === 'critical') score -= HEALTH_CRITICAL_SIT_PENALTY;
    else if (s.severity === 'high') score -= HEALTH_HIGH_SIT_PENALTY;
  }

  if (inputs.anomaly) {
    score -= Math.min(inputs.anomaly.unacknowledged, 20) * HEALTH_ANOMALY_PENALTY;
  }

  if (inputs.pulse) {
    // Pulse 100 = full credit; pulse 0 = penalty up to 30
    const pulsePenalty = (100 - inputs.pulse.overallScore) * HEALTH_PULSE_WEIGHT;
    score -= pulsePenalty;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
