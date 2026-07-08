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

/** Microtask-coalescing persist scheduler: many calls within one synchronous
 *  task collapse into a single `persist` on the next microtask. Stored as a
 *  per-instance field so the two services in this module share the logic
 *  without duplicating the method body. */
function makeCoalescedPersist(persist: () => void): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; persist(); });
  };
}

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

/** Structural subset of bias-detector.ts's `BiasSignal` — only the two
 *  fields the damping rule reads. Declared locally so this module stays
 *  pure (no runtime import of the bias detector); callers pass the real
 *  `BiasSignal[]` (e.g. `getActive()` filtered to this target) directly. */
export interface BiasDetectionSignal {
  severity: 'advisory' | 'warning' | 'alert';
  acknowledged: boolean;
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
  /** Bias detections relevant to this target — typically the
   *  unacknowledged signals from bias-detector.ts whose
   *  `affectedTargetIds` include `targetId`. When any is unacknowledged
   *  AND high-severity ('alert'), the raw meta-confidence is damped by
   *  `BIAS_DAMPING_FACTOR` before the assumption penalty is applied. */
  biasDetections?: readonly BiasDetectionSignal[];
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

/** Multiplicative damping applied to raw meta-confidence when an
 *  unacknowledged high-severity ('alert') bias detection targets the
 *  same subject. Hard-coded by design — deliberately NOT a tunable knob
 *  until a set-wise non-regression safety-fixtures suite exists for it. */
const BIAS_DAMPING_FACTOR = 0.85;

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

/** True when any supplied bias detection is both unacknowledged and
 *  high-severity ('alert'). 'advisory'/'warning' bands do not damp. */
function hasUnacknowledgedHighSeverityBias(
  detections?: readonly BiasDetectionSignal[],
): boolean {
  if (!detections || detections.length === 0) return false;
  return detections.some((d) => !d.acknowledged && d.severity === 'alert');
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
  biasDamped = false,
): string {
  const sources = new Set(observations.map((o) => o.sourceId)).size;
  const agreement = describeAgreement(consistency);
  const sourceWord = sources === 1 ? 'source' : 'sources';
  const obsWord = observations.length === 1 ? 'observation' : 'observations';
  const assumptionSuffix = assumptionPenaltyValue > 0
    ? ` Reduced by ${Math.round(assumptionPenaltyValue * 100)}% for critical assumption risk.`
    : '';
  const biasSuffix = biasDamped
    ? ` Damped ${Math.round((1 - BIAS_DAMPING_FACTOR) * 100)}% for an unacknowledged high-severity bias detection.`
    : '';
  if (observations.length === 0) {
    return `No observations available to ground this confidence estimate.${assumptionSuffix}${biasSuffix}`;
  }
  return `Based on ${observations.length} ${obsWord} from ${sources} ${sourceWord} with ${agreement}.${assumptionSuffix}${biasSuffix}`;
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
    const biasDamped = hasUnacknowledgedHighSeverityBias(input.biasDetections);
    const biasFactor = biasDamped ? BIAS_DAMPING_FACTOR : 1;
    const meta = clamp01(rawMeta * (1 - penalty) * biasFactor);
    const reliability = deriveReliability(meta);
    const interval = confidenceIntervalFor(reported, meta);
    const explanation = buildExplanation(input.observations, consistency, penalty, biasDamped);
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
    this.schedulePersist();
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

  // Coalesces a burst of mutations into one JSON.stringify write on the next
  // microtask (in-memory state stays synchronous); fixes the renderer-hang
  // stringify storm.
  private schedulePersist = makeCoalescedPersist(this.persist.bind(this));

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
  hasUnacknowledgedHighSeverityBias,
  deriveReliability,
  confidenceIntervalFor,
  buildExplanation,
  CANONICAL_DOMAINS,
  BREADTH_DENOMINATOR,
  WEIGHT_BREADTH,
  WEIGHT_CONSISTENCY,
  WEIGHT_STABILITY,
  ASSUMPTION_PENALTY,
  BIAS_DAMPING_FACTOR,
  CI_WIDTH_SCALE,
  RELIABILITY_THRESHOLDS,
  MAX_ESTIMATES,
};

// ════════════════════════════════════════════════════════════════════════
// MetaConfidenceCalibrationService — calibration-history surface that
// answers "when we say X% confident, how often are we actually right?".
// Separate from MetaConfidenceService above (which estimates from
// observations + assumptions); this service builds binned reliability
// summaries from observed prediction outcomes.
// ════════════════════════════════════════════════════════════════════════

export interface CalibrationBin {
  binMin: number;
  binMax: number;
  predictedCount: number;
  correctCount: number;
  calibrationError: number;
}

export interface MetaConfidenceRecord {
  id: string;
  domain: string;
  algorithmId: string;
  predictedConfidence: number;
  wasCorrect: boolean;
  recordedAt: number;
}

export type CalibrationReliability = 'high' | 'medium' | 'low' | 'insufficient-data';

export interface MetaConfidenceSummary {
  domain: string;
  algorithmId: string;
  sampleCount: number;
  meanCalibrationError: number;
  reliability: CalibrationReliability;
  bins: CalibrationBin[];
}

export type CalibrationListener = (record: MetaConfidenceRecord) => void;

export interface CalibrationStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface MetaConfidenceCalibrationOptions {
  capacity?: number;
  storage?: CalibrationStorageLike | null;
  now?: () => number;
}

const CALIBRATION_STORAGE_KEY = 'wm-meta-confidence';
const CALIBRATION_MAX_RECORDS = 2000;
const CALIBRATION_INSUFFICIENT_DATA_THRESHOLD = 10;
const CALIBRATION_HIGH_THRESHOLD = 0.1;
const CALIBRATION_LOW_THRESHOLD = 0.2;
const CALIBRATION_BIN_COUNT = 5;

interface PersistedCalibrationState {
  records: MetaConfidenceRecord[];
}

export class MetaConfidenceCalibrationService {
  private readonly capacity: number;
  private readonly storage: CalibrationStorageLike | null;
  private readonly clock: () => number;
  private readonly records: MetaConfidenceRecord[] = [];
  private readonly subscribers = new Set<CalibrationListener>();
  private idCounter = 0;

  constructor(opts: MetaConfidenceCalibrationOptions = {}) {
    this.capacity = opts.capacity ?? CALIBRATION_MAX_RECORDS;
    this.storage = opts.storage === undefined ? defaultCalibrationStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  record(input: Omit<MetaConfidenceRecord, 'id' | 'recordedAt'>): MetaConfidenceRecord {
    const recordedAt = this.clock();
    this.idCounter++;
    const persisted: MetaConfidenceRecord = {
      ...input,
      id: `mcc-${recordedAt}-${this.idCounter}`,
      recordedAt,
    };
    this.records.push(persisted);
    while (this.records.length > this.capacity) this.records.shift();
    this.schedulePersist();
    for (const cb of this.subscribers) cb(persisted);
    return persisted;
  }

  getSummary(domain: string, algorithmId: string): MetaConfidenceSummary {
    const matching = this.records.filter((r) => r.domain === domain && r.algorithmId === algorithmId);
    const bins = buildBins(matching);
    const populatedBins = bins.filter((b) => b.predictedCount > 0);
    const meanCalibrationError = populatedBins.length === 0
      ? 0
      : Number(
          (populatedBins.reduce((sum, b) => sum + b.calibrationError, 0) / populatedBins.length).toFixed(4),
        );
    return {
      domain,
      algorithmId,
      sampleCount: matching.length,
      meanCalibrationError,
      reliability: reliabilityFor(matching.length, meanCalibrationError),
      bins,
    };
  }

  getMetaConfidenceScore(domain: string, algorithmId: string): number {
    const summary = this.getSummary(domain, algorithmId);
    if (summary.reliability === 'insufficient-data') return 0.5;
    return Number((1 - summary.meanCalibrationError).toFixed(4));
  }

  getAllSummaries(): MetaConfidenceSummary[] {
    const pairs = new Map<string, { domain: string; algorithmId: string }>();
    for (const r of this.records) {
      pairs.set(`${r.domain}|${r.algorithmId}`, { domain: r.domain, algorithmId: r.algorithmId });
    }
    return [...pairs.values()].map((p) => this.getSummary(p.domain, p.algorithmId));
  }

  getRecords(domain?: string, algorithmId?: string, limit?: number): MetaConfidenceRecord[] {
    const filtered: MetaConfidenceRecord[] = [];
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i]!;
      if (domain && r.domain !== domain) continue;
      if (algorithmId && r.algorithmId !== algorithmId) continue;
      filtered.push(r);
      if (limit && filtered.length >= limit) break;
    }
    return filtered;
  }

  subscribeCalibration(cb: CalibrationListener): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribeCalibration(cb: CalibrationListener): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.records.length = 0;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(CALIBRATION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedCalibrationState;
      if (!parsed || !Array.isArray(parsed.records)) return;
      for (const r of parsed.records) this.records.push(r);
      while (this.records.length > this.capacity) this.records.shift();
    } catch {
      this.records.length = 0;
    }
  }

  // Coalesces a burst of mutations into one JSON.stringify write on the next
  // microtask (in-memory state stays synchronous); fixes the renderer-hang
  // stringify storm.
  private schedulePersist = makeCoalescedPersist(this.persist.bind(this));

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedCalibrationState = { records: this.records };
      this.storage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton for the calibration service ──────────────────────

let _calibrationSingleton: MetaConfidenceCalibrationService | undefined;

export function getMetaConfidenceCalibrationService(): MetaConfidenceCalibrationService {
  _calibrationSingleton ??= new MetaConfidenceCalibrationService();
  return _calibrationSingleton;
}

export function resetCalibrationServiceForTests(): void {
  _calibrationSingleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildBins(records: readonly MetaConfidenceRecord[]): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < CALIBRATION_BIN_COUNT; i++) {
    bins.push({
      binMin: i / CALIBRATION_BIN_COUNT,
      binMax: (i + 1) / CALIBRATION_BIN_COUNT,
      predictedCount: 0,
      correctCount: 0,
      calibrationError: 0,
    });
  }
  for (const r of records) {
    const idx = binIndex(r.predictedConfidence);
    const bin = bins[idx]!;
    bin.predictedCount++;
    if (r.wasCorrect) bin.correctCount++;
  }
  for (const bin of bins) {
    if (bin.predictedCount === 0) {
      bin.calibrationError = 0;
      continue;
    }
    const midpoint = (bin.binMin + bin.binMax) / 2;
    const actual = bin.correctCount / bin.predictedCount;
    bin.calibrationError = Number(Math.abs(midpoint - actual).toFixed(4));
  }
  return bins;
}

function binIndex(predictedConfidence: number): number {
  // Bins are half-open [0-0.2), [0.2-0.4), [0.4-0.6), [0.6-0.8) and
  // the LAST bin [0.8-1.0] is closed on both ends so 1.0 lands inside.
  if (predictedConfidence >= 1) return CALIBRATION_BIN_COUNT - 1;
  if (predictedConfidence < 0) return 0;
  return Math.floor(predictedConfidence * CALIBRATION_BIN_COUNT);
}

function reliabilityFor(sampleCount: number, meanCalibrationError: number): CalibrationReliability {
  if (sampleCount < CALIBRATION_INSUFFICIENT_DATA_THRESHOLD) return 'insufficient-data';
  if (meanCalibrationError < CALIBRATION_HIGH_THRESHOLD) return 'high';
  if (meanCalibrationError < CALIBRATION_LOW_THRESHOLD) return 'medium';
  return 'low';
}

function defaultCalibrationStorage(): CalibrationStorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: CalibrationStorageLike }).localStorage;
  return ls ?? null;
}
