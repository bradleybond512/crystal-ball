/**
 * Closed-Loop Mission Ledger — wires situation lifecycle outcomes back
 * into per-algorithm calibration in the OutcomeLedger.
 *
 * When a situation transitions to `resolved`, the singleton automatically
 * builds a MissionOutcome from the lifecycle (lead time, accuracy /
 * timeliness defaults) and persists one OutcomeRecord per contributing
 * algorithmId so each algorithm's calibration moves with the actual
 * verdict. Manual `recordOutcome(...)` lets analysts override the
 * accuracy / timeliness flags when reviewing a resolution.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the most-recent 500 outcomes to `localStorage` under
 * `wm-closed-loop-ledger`.
 */

import {
  getSituationLifecycleTrackerService,
  type PhaseTransition,
  type SituationLifecycle,
  type SituationLifecycleTrackerService,
} from './situation-lifecycle-tracker';
import {
  getOutcomeLedger,
  type OutcomeLedger,
  type PredictedSeverity,
} from './outcome-ledger';

// ── Public types ─────────────────────────────────────────────────────

export interface MissionOutcome {
  situationId: string;
  domain: string;
  detectedAt: number;
  resolvedAt: number;
  /** ms between detection and resolution — convenience field, always
   *  equal to `resolvedAt - detectedAt` after normalisation. */
  leadTimeMs: number;
  wasAccurate: boolean;
  wasTimely: boolean;
  /** Algorithm contributors. Each id maps to one OutcomeLedger record so
   *  per-algorithm calibration tracks the resolution outcome. */
  algorithmIds: string[];
}

export interface DomainCalibrationReport {
  domain: string;
  accuracy: number;
  timeliness: number;
  sampleCount: number;
}

export interface FeedbackLoopStats {
  totalOutcomes: number;
  accuracyRate: number;
  timelinessRate: number;
  avgLeadTimeMinutes: number;
  topDomainsByAccuracy: string[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface ClosedLoopMissionLedgerOptions {
  storage?: StorageLike | null;
  clock?: () => number;
  lifecycleTracker?: SituationLifecycleTrackerService;
  outcomeLedger?: OutcomeLedger;
  /** Wire the lifecycle subscription on construction. Defaults to true.
   *  Tests that drive transitions manually can pass `false` to keep the
   *  ledger free of subscriber side effects. */
  autoSubscribe?: boolean;
  /** Lead-time ceiling (ms) for the auto-derived `wasTimely` flag.
   *  Defaults to 24 hours. */
  timelyThresholdMs?: number;
  /** Severity predicted by the algorithm contributors at detection time.
   *  Used as the `predictedSeverity` on every OutcomeRecord this ledger
   *  forwards into the OutcomeLedger. Defaults to 'high' — situations
   *  that reach `resolved` were almost always escalated past 'low'. */
  defaultPredictedSeverity?: PredictedSeverity;
}

// ── Constants ────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-closed-loop-ledger';
export const MAX_OUTCOMES = 500;
export const DEFAULT_TIMELY_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const MIN_ACCURACY_SAMPLES = 3;

// ── Serialization ────────────────────────────────────────────────────

interface PersistedLedger {
  version: 1;
  outcomes: MissionOutcome[];
}

function deserialize(raw: unknown): MissionOutcome[] {
  if (!raw || typeof raw !== 'object') return [];
  const payload = raw as PersistedLedger;
  if (payload.version !== 1) return [];
  if (!Array.isArray(payload.outcomes)) return [];
  const out: MissionOutcome[] = [];
  for (const entry of payload.outcomes) {
    const o = deserializeEntry(entry);
    if (o) out.push(o);
  }
  return out;
}

function deserializeEntry(entry: unknown): MissionOutcome | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as Record<string, unknown>;
  if (typeof e.situationId !== 'string') return undefined;
  if (typeof e.domain !== 'string') return undefined;
  if (typeof e.detectedAt !== 'number') return undefined;
  if (typeof e.resolvedAt !== 'number') return undefined;
  if (typeof e.leadTimeMs !== 'number') return undefined;
  if (typeof e.wasAccurate !== 'boolean') return undefined;
  if (typeof e.wasTimely !== 'boolean') return undefined;
  if (!Array.isArray(e.algorithmIds)) return undefined;
  const algorithmIds = e.algorithmIds.filter((a): a is string => typeof a === 'string');
  return {
    situationId: e.situationId,
    domain: e.domain,
    detectedAt: e.detectedAt,
    resolvedAt: e.resolvedAt,
    leadTimeMs: e.leadTimeMs,
    wasAccurate: e.wasAccurate,
    wasTimely: e.wasTimely,
    algorithmIds,
  };
}

// ── Ledger ───────────────────────────────────────────────────────────

export class ClosedLoopMissionLedger {
  private outcomes: MissionOutcome[] = [];
  private hydrated = false;
  private readonly storage: StorageLike | null;
  private readonly lifecycleTracker: SituationLifecycleTrackerService;
  private readonly outcomeLedger: OutcomeLedger;
  private readonly timelyThresholdMs: number;
  private readonly defaultPredictedSeverity: PredictedSeverity;
  private unsubscribe: (() => void) | null = null;

  constructor(options: ClosedLoopMissionLedgerOptions = {}) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.lifecycleTracker = options.lifecycleTracker ?? getSituationLifecycleTrackerService();
    this.outcomeLedger = options.outcomeLedger ?? getOutcomeLedger();
    this.timelyThresholdMs = options.timelyThresholdMs ?? DEFAULT_TIMELY_THRESHOLD_MS;
    this.defaultPredictedSeverity = options.defaultPredictedSeverity ?? 'high';
    if (options.autoSubscribe !== false) {
      this.unsubscribe = this.lifecycleTracker.subscribe((t) => this.onTransition(t));
    }
  }

  // ── Auto-subscription path ──────────────────────────────────────────

  /** Builds + records a MissionOutcome whenever a transition lands on
   *  `resolved`. No-op for every other phase. The auto-derived
   *  `wasAccurate` is `true` (resolved is an analyst-confirmed terminal
   *  phase) and `wasTimely` checks the lead time against
   *  `timelyThresholdMs`. */
  private onTransition(transition: PhaseTransition): void {
    if (transition.toPhase !== 'resolved') return;
    const lifecycle = this.lifecycleTracker.getLifecycle(transition.situationId);
    if (!lifecycle) return;
    const outcome = this.buildAutoOutcome(lifecycle, transition);
    if (!outcome) return;
    this.recordOutcome(outcome, { algorithmIdsRequired: false });
  }

  private buildAutoOutcome(
    lifecycle: SituationLifecycle,
    transition: PhaseTransition,
  ): MissionOutcome | null {
    const resolvedAt = lifecycle.resolvedAt ?? transition.transitionedAt;
    const detectedAt = lifecycle.detectedAt;
    if (!Number.isFinite(detectedAt) || !Number.isFinite(resolvedAt)) return null;
    const leadTimeMs = Math.max(0, resolvedAt - detectedAt);
    return {
      situationId: lifecycle.situationId,
      domain: lifecycle.domain,
      detectedAt,
      resolvedAt,
      leadTimeMs,
      wasAccurate: true,
      wasTimely: leadTimeMs <= this.timelyThresholdMs,
      algorithmIds: [],
    };
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Persist a MissionOutcome and forward one OutcomeRecord per
   * `algorithmIds[]` entry into the OutcomeLedger so each algorithm's
   * per-domain calibration moves with the verdict.
   *
   * Caller-supplied `leadTimeMs` is recomputed from detectedAt /
   * resolvedAt to keep the field consistent.
   */
  recordOutcome(
    outcome: MissionOutcome,
    options: { algorithmIdsRequired?: boolean } = {},
  ): MissionOutcome {
    this.ensureHydrated();
    const algorithmIdsRequired = options.algorithmIdsRequired ?? true;
    if (algorithmIdsRequired && outcome.algorithmIds.length === 0) {
      throw new Error('MissionOutcome.algorithmIds must include at least one algorithm');
    }
    const normalised = normaliseOutcome(outcome);
    this.outcomes.push(normalised);
    this.enforceCapacity();
    this.persist();
    this.forwardToOutcomeLedger(normalised);
    return cloneOutcome(normalised);
  }

  getOutcomes(domain?: string): MissionOutcome[] {
    this.ensureHydrated();
    const filtered = domain
      ? this.outcomes.filter((o) => o.domain === domain)
      : this.outcomes;
    return filtered.map((o) => cloneOutcome(o));
  }

  getCalibrationReport(): DomainCalibrationReport[] {
    this.ensureHydrated();
    const byDomain = groupByDomain(this.outcomes);
    const reports: DomainCalibrationReport[] = [];
    for (const [domain, list] of byDomain) reports.push(summariseDomain(domain, list));
    reports.sort((a, b) => b.sampleCount - a.sampleCount || a.domain.localeCompare(b.domain));
    return reports;
  }

  getFeedbackLoopStats(): FeedbackLoopStats {
    this.ensureHydrated();
    const total = this.outcomes.length;
    if (total === 0) {
      return {
        totalOutcomes: 0,
        accuracyRate: 0,
        timelinessRate: 0,
        avgLeadTimeMinutes: 0,
        topDomainsByAccuracy: [],
      };
    }
    let accurate = 0;
    let timely = 0;
    let leadTotal = 0;
    for (const o of this.outcomes) {
      if (o.wasAccurate) accurate += 1;
      if (o.wasTimely) timely += 1;
      leadTotal += o.leadTimeMs;
    }
    const reports = this.getCalibrationReport();
    const eligible = [...reports.filter((r) => r.sampleCount >= MIN_ACCURACY_SAMPLES)];
    eligible.sort((a, b) =>
      b.accuracy - a.accuracy
      || b.sampleCount - a.sampleCount
      || a.domain.localeCompare(b.domain),
    );
    const topDomainsByAccuracy = eligible.slice(0, 3).map((r) => r.domain);
    return {
      totalOutcomes: total,
      accuracyRate: accurate / total,
      timelinessRate: timely / total,
      avgLeadTimeMinutes: Math.round(leadTotal / total / 60_000),
      topDomainsByAccuracy,
    };
  }

  /** Stop responding to lifecycle transitions. Idempotent. */
  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** Test seam — clears outcomes + the persisted blob, but preserves
   *  any active lifecycle subscription so the same instance can keep
   *  ingesting transitions. */
  resetForTesting(): void {
    this.outcomes = [];
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    } else if (this.storage) {
      try { this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, outcomes: [] })); } catch { /* best effort */ }
    }
  }

  // ── Internals ───────────────────────────────────────────────────────

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      this.outcomes = deserialize(JSON.parse(raw));
    } catch {
      // Corrupt blob — start clean rather than crash on hydrate.
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const payload: PersistedLedger = { version: 1, outcomes: this.outcomes };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota / unavailable — best-effort.
    }
  }

  private enforceCapacity(): void {
    if (this.outcomes.length <= MAX_OUTCOMES) return;
    this.outcomes.splice(0, this.outcomes.length - MAX_OUTCOMES);
  }

  private forwardToOutcomeLedger(outcome: MissionOutcome): void {
    const actual = outcome.wasAccurate ? 'confirmed-real' : 'marked-false-positive';
    const recordedAt = new Date(outcome.resolvedAt);
    for (const algorithmId of outcome.algorithmIds) {
      this.outcomeLedger.record({
        domain: outcome.domain,
        situationId: outcome.situationId,
        predictedSeverity: this.defaultPredictedSeverity,
        actualOutcome: actual,
        recordedAt,
        notes: `closed-loop:${algorithmId}`,
      });
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let singleton: ClosedLoopMissionLedger | null = null;

/** Singleton accessor. The first call wires the lifecycle subscription
 *  via {@link getSituationLifecycleTrackerService}. */
export function getClosedLoopMissionLedger(): ClosedLoopMissionLedger {
  singleton ??= new ClosedLoopMissionLedger();
  return singleton;
}

/** Test seam — drops the singleton + unsubscribes from the tracker. */
export function __resetClosedLoopMissionLedgerSingleton(): void {
  if (singleton) singleton.dispose();
  singleton = null;
}

/** Alias for callers used to `<Service>.getInstance()` patterns. */
export const ClosedLoopMissionLedgerService = {
  getInstance: getClosedLoopMissionLedger,
};

// ── Helpers ──────────────────────────────────────────────────────────

function groupByDomain(outcomes: readonly MissionOutcome[]): Map<string, MissionOutcome[]> {
  const byDomain = new Map<string, MissionOutcome[]>();
  for (const o of outcomes) {
    const list = byDomain.get(o.domain);
    if (list) list.push(o);
    else byDomain.set(o.domain, [o]);
  }
  return byDomain;
}

function summariseDomain(domain: string, list: readonly MissionOutcome[]): DomainCalibrationReport {
  const sampleCount = list.length;
  let accurate = 0;
  let timely = 0;
  for (const o of list) {
    if (o.wasAccurate) accurate += 1;
    if (o.wasTimely) timely += 1;
  }
  return {
    domain,
    accuracy: sampleCount === 0 ? 0 : accurate / sampleCount,
    timeliness: sampleCount === 0 ? 0 : timely / sampleCount,
    sampleCount,
  };
}

function normaliseOutcome(outcome: MissionOutcome): MissionOutcome {
  const leadTimeMs = Math.max(0, outcome.resolvedAt - outcome.detectedAt);
  return {
    ...outcome,
    leadTimeMs,
    algorithmIds: [...outcome.algorithmIds],
  };
}

function cloneOutcome(outcome: MissionOutcome): MissionOutcome {
  return { ...outcome, algorithmIds: [...outcome.algorithmIds] };
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

// Exposed for tests that need to peek at internals.
export const __internals = {
  STORAGE_KEY,
  MAX_OUTCOMES,
  DEFAULT_TIMELY_THRESHOLD_MS,
  MIN_ACCURACY_SAMPLES,
  normaliseOutcome,
};
