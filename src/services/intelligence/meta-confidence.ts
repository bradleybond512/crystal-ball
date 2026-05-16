/**
 * Meta-Confidence Service (Phase 4).
 *
 * Second-order confidence: when an upstream model reports a 0.8
 * confidence for some score / situation / hypothesis, this layer
 * answers "how reliable is that 0.8 estimate?".
 *
 * The estimate combines:
 *   - evidenceBreadth        — how many independent domains contributed
 *   - evidenceConsistency    — how uniform the observation severities are
 *   - temporalStability      — how stable the reported confidence has been
 *   - assumption penalty     — −0.10 per critical assumption with
 *                              violationRisk='high'
 *
 * Pure module: no DOM / fetch / globals. Persists the most-recent
 * estimates to localStorage under `wm-meta-confidence` (cap 500).
 */

import type { ObservationEvent, ObservationSeverity } from './observation-adapters';
import type { Assumption } from './assumption-tracker';

// ── Public types ──────────────────────────────────────────────────────

export type ConfidenceReliability =
  | 'anchored'
  | 'moderate'
  | 'provisional'
  | 'speculative';

export type MetaConfidenceTargetType = 'score' | 'situation' | 'hypothesis';

export interface MetaConfidenceEstimate {
  targetId: string;
  targetType: MetaConfidenceTargetType;
  reportedConfidence: number;
  metaConfidence: number;
  reliability: ConfidenceReliability;
  evidenceBreadth: number;
  evidenceConsistency: number;
  temporalStability: number;
  sampleSize: number;
  confidenceInterval: [number, number];
  explanation: string;
  computedAt: Date;
}

export interface EstimateInput {
  targetId: string;
  targetType: MetaConfidenceTargetType;
  reportedConfidence: number;
  observations: readonly ObservationEvent[];
  assumptions?: readonly Assumption[];
  /** Historical reportedConfidence values, in chronological order
   *  (oldest first). The current `reportedConfidence` is appended
   *  internally for stability scoring. */
  priorEstimates?: readonly number[];
}

export interface MetaConfidenceStats {
  totalEstimates: number;
  byReliability: Record<ConfidenceReliability, number>;
  avgMetaConfidence: number;
  avgReportedConfidence: number;
}

export type MetaConfidenceListener = (estimate: MetaConfidenceEstimate) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-meta-confidence';
const MAX_ESTIMATES = 500;
/** Canonical Crystal Ball domain set used as the breadth denominator. */
const CANONICAL_DOMAINS: readonly string[] = [
  'weather', 'earthquake', 'cyber', 'maritime', 'aviation',
  'biosurveillance', 'space', 'conflict', 'infra', 'finance',
];
/** Breadth denominator. Fixed at 10 across target types per spec —
 *  the canonical domain set has 10 entries; the score isn't normalized
 *  by target type because a hypothesis backed by 10 domains is just as
 *  well-supported as a score backed by 10. */
const BREADTH_DENOMINATOR = 10;

const WEIGHT_BREADTH = 0.35;
const WEIGHT_CONSISTENCY = 0.35;
const WEIGHT_STABILITY = 0.3;

const ASSUMPTION_PENALTY = 0.1;
const CI_WIDTH_SCALE = 0.4;

const RELIABILITY_THRESHOLDS = {
  anchored: 0.75,
  moderate: 0.5,
  provisional: 0.25,
} as const;

/** Severity → numeric weight for the consistency stddev. Spec
 *  values: low=0.25, med=0.5, high=0.75, crit=1.0. INFO is treated
 *  as a tier below LOW so it still occupies the [0,1] range. */
const SEVERITY_WEIGHT: Record<ObservationSeverity, number> = {
  CRITICAL: 1,
  HIGH: 0.75,
  MEDIUM: 0.5,
  LOW: 0.25,
  INFO: 0.1,
};

// ── Scoring helpers ──────────────────────────────────────────────────

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function stddev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function uniqueDomainCount(observations: readonly ObservationEvent[]): number {
  const set = new Set<string>();
  for (const o of observations) set.add(o.domain);
  return set.size;
}

function computeBreadth(observations: readonly ObservationEvent[]): number {
  return clamp01(uniqueDomainCount(observations) / BREADTH_DENOMINATOR);
}

/** Minimum observation count before consistency is taken at full
 *  weight. Fewer than this and consistency is multiplied by
 *  `count / MIN_OBS_FOR_FULL_CONSISTENCY` — a 1-observation set can't
 *  meaningfully claim "uniform severity" because there's nothing to
 *  be uniform with. */
const MIN_OBS_FOR_FULL_CONSISTENCY = 3;

function computeConsistency(observations: readonly ObservationEvent[]): number {
  if (observations.length === 0) return 0;
  const weights = observations.map((o) => SEVERITY_WEIGHT[o.severity] ?? 0.5);
  // Raw stddev clamp per spec: max(0, 1 - stddev). Severity weights
  // are bounded in [0.1, 1.0], so the worst-case raw stddev is ≈ 0.45.
  const base = observations.length < 2 ? 1 : clamp01(1 - stddev(weights));
  const sampleDiscount = Math.min(1, observations.length / MIN_OBS_FOR_FULL_CONSISTENCY);
  return clamp01(base * sampleDiscount);
}

function computeStability(
  reported: number,
  priorEstimates?: readonly number[],
): number {
  if (!priorEstimates || priorEstimates.length === 0) return 0.5;
  const series = [...priorEstimates, reported];
  // Raw stddev clamp per spec: max(0, 1 - stddev).
  return clamp01(1 - stddev(series));
}

function assumptionPenalty(assumptions?: readonly Assumption[]): number {
  if (!assumptions || assumptions.length === 0) return 0;
  let penalty = 0;
  for (const a of assumptions) {
    if (a.isCritical && a.violationRisk === 'high') penalty += ASSUMPTION_PENALTY;
  }
  // Cap the penalty so the metric never goes below 0.
  return Math.min(penalty, 1);
}

function deriveReliability(meta: number): ConfidenceReliability {
  if (meta >= RELIABILITY_THRESHOLDS.anchored) return 'anchored';
  if (meta >= RELIABILITY_THRESHOLDS.moderate) return 'moderate';
  if (meta >= RELIABILITY_THRESHOLDS.provisional) return 'provisional';
  return 'speculative';
}

function describeAgreement(consistency: number): string {
  if (consistency >= 0.8) return 'strong agreement';
  if (consistency >= 0.55) return 'moderate agreement';
  if (consistency >= 0.3) return 'weak agreement';
  return 'low agreement';
}

function buildExplanation(
  observations: readonly ObservationEvent[],
  consistency: number,
  assumptionPenaltyValue: number,
): string {
  const sources = new Set(observations.map((o) => o.sourceId)).size;
  const agreement = describeAgreement(consistency);
  const sourceWord = sources === 1 ? 'source' : 'sources';
  const obsWord = observations.length === 1 ? 'observation' : 'observations';
  const assumptionSuffix = assumptionPenaltyValue > 0
    ? ` Reduced by ${Math.round(assumptionPenaltyValue * 100)}% for critical assumption risk.`
    : '';
  if (observations.length === 0) {
    return `No observations available to ground this confidence estimate.${assumptionSuffix}`;
  }
  return `Based on ${observations.length} ${obsWord} from ${sources} ${sourceWord} with ${agreement}.${assumptionSuffix}`;
}

function confidenceIntervalFor(reported: number, meta: number): [number, number] {
  const width = (1 - meta) * CI_WIDTH_SCALE;
  const half = width / 2;
  return [clamp01(reported - half), clamp01(reported + half)];
}

// ── Service ──────────────────────────────────────────────────────────

export interface MetaConfidenceOptions {
  clock?: () => number;
}

export class MetaConfidenceService {
  private estimates = new Map<string, MetaConfidenceEstimate>();
  private listeners = new Set<MetaConfidenceListener>();
  private clock: () => number;
  private hydrated = false;
  private insertionOrder: string[] = [];

  constructor(options: MetaConfidenceOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Public API ──────────────────────────────────────────────────

  estimate(input: EstimateInput): MetaConfidenceEstimate {
    this.ensureHydrated();
    const reported = clamp01(input.reportedConfidence);
    const breadth = computeBreadth(input.observations);
    const consistency = computeConsistency(input.observations);
    const stability = computeStability(reported, input.priorEstimates);
    const rawMeta = (breadth * WEIGHT_BREADTH)
      + (consistency * WEIGHT_CONSISTENCY)
      + (stability * WEIGHT_STABILITY);
    const penalty = assumptionPenalty(input.assumptions);
    const meta = clamp01(rawMeta * (1 - penalty));
    const reliability = deriveReliability(meta);
    const interval = confidenceIntervalFor(reported, meta);
    const explanation = buildExplanation(input.observations, consistency, penalty);
    const estimate: MetaConfidenceEstimate = {
      targetId: input.targetId,
      targetType: input.targetType,
      reportedConfidence: round4(reported),
      metaConfidence: round4(meta),
      reliability,
      evidenceBreadth: round4(breadth),
      evidenceConsistency: round4(consistency),
      temporalStability: round4(stability),
      sampleSize: input.observations.length,
      confidenceInterval: [round4(interval[0]), round4(interval[1])],
      explanation,
      computedAt: new Date(this.clock()),
    };
    this.store(estimate);
    this.persist();
    this.notify(estimate);
    return cloneEstimate(estimate);
  }

  getEstimate(targetId: string): MetaConfidenceEstimate | undefined {
    this.ensureHydrated();
    const e = this.estimates.get(targetId);
    return e ? cloneEstimate(e) : undefined;
  }

  getAllEstimates(): MetaConfidenceEstimate[] {
    this.ensureHydrated();
    return [...this.estimates.values()].map((e) => cloneEstimate(e));
  }

  getByReliability(reliability: ConfidenceReliability): MetaConfidenceEstimate[] {
    this.ensureHydrated();
    return [...this.estimates.values()]
      .filter((e) => e.reliability === reliability)
      .map((e) => cloneEstimate(e));
  }

  getByTargetType(targetType: MetaConfidenceTargetType): MetaConfidenceEstimate[] {
    this.ensureHydrated();
    return [...this.estimates.values()]
      .filter((e) => e.targetType === targetType)
      .map((e) => cloneEstimate(e));
  }

  stats(): MetaConfidenceStats {
    this.ensureHydrated();
    const byReliability: Record<ConfidenceReliability, number> = {
      anchored: 0,
      moderate: 0,
      provisional: 0,
      speculative: 0,
    };
    let metaSum = 0;
    let reportedSum = 0;
    for (const e of this.estimates.values()) {
      byReliability[e.reliability] += 1;
      metaSum += e.metaConfidence;
      reportedSum += e.reportedConfidence;
    }
    const total = this.estimates.size;
    return {
      totalEstimates: total,
      byReliability,
      avgMetaConfidence: total === 0 ? 0 : round4(metaSum / total),
      avgReportedConfidence: total === 0 ? 0 : round4(reportedSum / total),
    };
  }

  subscribe(listener: MetaConfidenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties in-memory + persisted state. */
  resetForTesting(): void {
    this.estimates.clear();
    this.insertionOrder = [];
    this.listeners.clear();
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

  private store(estimate: MetaConfidenceEstimate): void {
    const existing = this.estimates.get(estimate.targetId);
    this.estimates.set(estimate.targetId, estimate);
    if (!existing) {
      this.insertionOrder.push(estimate.targetId);
      this.enforceCapacity();
    }
  }

  private enforceCapacity(): void {
    while (this.insertionOrder.length > MAX_ESTIMATES) {
      const oldest = this.insertionOrder.shift();
      if (oldest !== undefined) this.estimates.delete(oldest);
    }
  }

  private notify(estimate: MetaConfidenceEstimate): void {
    const snapshot = cloneEstimate(estimate);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* isolate listener crash */ }
    }
  }

  // ── Persistence ──────────────────────────────────────────────────

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PersistedEstimate[] | null;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        const e = deserialize(entry);
        if (e) {
          this.estimates.set(e.targetId, e);
          this.insertionOrder.push(e.targetId);
        }
      }
    } catch {
      // corrupt — leave empty
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    const payload = this.insertionOrder
      .map((id) => this.estimates.get(id))
      .filter((e): e is MetaConfidenceEstimate => e !== undefined)
      .map((e) => serialize(e));
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // quota / disabled — best effort
    }
  }
}

// ── Persistence helpers ─────────────────────────────────────────────

interface PersistedEstimate extends Omit<MetaConfidenceEstimate, 'computedAt'> {
  computedAt: number;
}

function serialize(e: MetaConfidenceEstimate): PersistedEstimate {
  return {
    ...e,
    confidenceInterval: [e.confidenceInterval[0], e.confidenceInterval[1]],
    computedAt: e.computedAt.getTime(),
  };
}

function deserialize(raw: unknown): MetaConfidenceEstimate | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as PersistedEstimate;
  if (typeof r.targetId !== 'string' || typeof r.reportedConfidence !== 'number') return undefined;
  const ci = Array.isArray(r.confidenceInterval) && r.confidenceInterval.length === 2
    ? [Number(r.confidenceInterval[0]), Number(r.confidenceInterval[1])] as [number, number]
    : [0, 1] as [number, number];
  return {
    targetId: r.targetId,
    targetType: r.targetType,
    reportedConfidence: Number(r.reportedConfidence),
    metaConfidence: typeof r.metaConfidence === 'number' ? r.metaConfidence : 0,
    reliability: r.reliability,
    evidenceBreadth: typeof r.evidenceBreadth === 'number' ? r.evidenceBreadth : 0,
    evidenceConsistency: typeof r.evidenceConsistency === 'number' ? r.evidenceConsistency : 0,
    temporalStability: typeof r.temporalStability === 'number' ? r.temporalStability : 0,
    sampleSize: typeof r.sampleSize === 'number' ? r.sampleSize : 0,
    confidenceInterval: ci,
    explanation: r.explanation ?? '',
    computedAt: new Date(typeof r.computedAt === 'number' ? r.computedAt : Date.now()),
  };
}

function cloneEstimate(e: MetaConfidenceEstimate): MetaConfidenceEstimate {
  return {
    ...e,
    confidenceInterval: [e.confidenceInterval[0], e.confidenceInterval[1]],
    computedAt: new Date(e.computedAt),
  };
}

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: MetaConfidenceService | null = null;

export function getMetaConfidenceService(): MetaConfidenceService {
  _singleton ??= new MetaConfidenceService();
  return _singleton;
}

export function __resetMetaConfidenceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  computeBreadth,
  computeConsistency,
  computeStability,
  assumptionPenalty,
  deriveReliability,
  confidenceIntervalFor,
  buildExplanation,
  CANONICAL_DOMAINS,
  BREADTH_DENOMINATOR,
  WEIGHT_BREADTH,
  WEIGHT_CONSISTENCY,
  WEIGHT_STABILITY,
  ASSUMPTION_PENALTY,
  CI_WIDTH_SCALE,
  RELIABILITY_THRESHOLDS,
  MAX_ESTIMATES,
};
