/**
 * Cognitive Bias Detector — scans intelligence outputs (Situations,
 * Observations) for signatures of common cognitive biases and flags
 * them for operator review.
 *
 * The detector itself never blocks or rewrites the underlying claim.
 * It produces an advisory ledger that operators can acknowledge or
 * ignore, so the system stays auditable when its own outputs are
 * skewed by anchoring, recency effects, overconfidence, etc.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 * Persists detections to localStorage under
 * `wm-cognitive-bias-detections` (LIFO ring buffer, capped at 1000).
 */

import type { ObservationEvent, Situation } from '@/types/intelligence';

// ── Public types ──────────────────────────────────────────────────────

export type BiasType =
  | 'anchoring'
  | 'availability'
  | 'confirmation'
  | 'recency'
  | 'overconfidence'
  | 'groupthink';

export type BiasSeverity = 'low' | 'medium' | 'high';

export type BiasTargetType = 'situation' | 'observation' | 'correlation';

export interface BiasDetection {
  id: string;
  biasType: BiasType;
  severity: BiasSeverity;
  targetId: string;
  targetType: BiasTargetType;
  evidence: string;
  detectedAt: number;
  acknowledged: boolean;
}

export interface BiasReport {
  totalDetections: number;
  byType: Record<BiasType, number>;
  bySeverity: Record<BiasSeverity, number>;
  unacknowledgedCount: number;
  topBiasType: BiasType | null;
}

export interface BiasDetectionFilter {
  biasType?: BiasType;
  acknowledged?: boolean;
  targetId?: string;
}

/** Extra signals callers may pass when scanning a Situation. Lets the
 *  detector avoid pulling in external services directly. */
export interface SituationScanContext {
  /** Number of distinct corroborating domains beyond the situation's
   *  primary domain. When omitted, the anchoring check is skipped. */
  corroboratingDomainCount?: number;
  /** True when the caller has at least one open contradiction tied to
   *  this situation. Defaults to false (→ confirmation bias may fire). */
  hasContradictions?: boolean;
}

export type BiasDetectionListener = (detection: BiasDetection) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface CognitiveBiasDetectorOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const DETECTIONS_STORAGE_KEY = 'wm-cognitive-bias-detections';
export const MAX_DETECTIONS = 1000;

export const ANCHORING_CONFIDENCE_FLOOR = 0.9;
export const ANCHORING_MIN_CORROBORATING_DOMAINS = 2;
export const OVERCONFIDENCE_FLOOR = 0.95;
export const AVAILABILITY_LOOKBACK_MS = 24 * 60 * 60_000;
export const AVAILABILITY_MIN_HIGH_OR_CRITICAL = 3;
export const RECENCY_WINDOW_MS = 60 * 60_000;
/** Recent-situation memory cap per domain — bounded to keep the
 *  availability heuristic O(1) per scan. */
const RECENT_SITUATION_MEMORY_MAX = 200;

const ALL_BIAS_TYPES: readonly BiasType[] = [
  'anchoring', 'availability', 'confirmation', 'recency', 'overconfidence', 'groupthink',
];

const ALL_SEVERITIES: readonly BiasSeverity[] = ['low', 'medium', 'high'];

// ── Helpers ───────────────────────────────────────────────────────────

function safeStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function cloneDetection(d: BiasDetection): BiasDetection {
  return { ...d };
}

function emptyByType(): Record<BiasType, number> {
  return { anchoring: 0, availability: 0, confirmation: 0, recency: 0, overconfidence: 0, groupthink: 0 };
}

function emptyBySeverity(): Record<BiasSeverity, number> {
  return { low: 0, medium: 0, high: 0 };
}

// ── Service ───────────────────────────────────────────────────────────

interface RecentSituationRecord {
  domain: string;
  severity: Situation['severity'];
  timestamp: number;
}

export class CognitiveBiasDetectorService {
  private detections: BiasDetection[] = [];
  private listeners = new Set<BiasDetectionListener>();
  private recentSituations: RecentSituationRecord[] = [];
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: CognitiveBiasDetectorOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Scan API ───────────────────────────────────────────────────────

  scanSituation(situation: Situation, context: SituationScanContext = {}): BiasDetection[] {
    this.ensureHydrated();
    this.recordSituationForAvailability(situation);
    const fired: BiasDetection[] = [];

    const anchoring = this.checkAnchoring(situation, context);
    if (anchoring) fired.push(anchoring);

    const availability = this.checkAvailability(situation);
    if (availability) fired.push(availability);

    const confirmation = this.checkConfirmation(situation, context);
    if (confirmation) fired.push(confirmation);

    const overconfidence = this.checkOverconfidence(situation);
    if (overconfidence) fired.push(overconfidence);

    // Placeholder: no groupthink detector yet — needs an inter-source
    // agreement model that isn't wired up. Intentionally returns null.
    const groupthink = this.checkGroupthink();
    if (groupthink) fired.push(groupthink);

    for (const d of fired) this.record(d);
    return fired.map((d) => cloneDetection(d));
  }

  scanObservation(observation: ObservationEvent): BiasDetection[] {
    this.ensureHydrated();
    const fired: BiasDetection[] = [];
    const recency = this.checkRecency(observation);
    if (recency) fired.push(recency);
    for (const d of fired) this.record(d);
    return fired.map((d) => cloneDetection(d));
  }

  // ── Heuristics ─────────────────────────────────────────────────────

  private checkAnchoring(s: Situation, ctx: SituationScanContext): BiasDetection | null {
    if (ctx.corroboratingDomainCount === undefined) return null;
    if (s.confidence <= ANCHORING_CONFIDENCE_FLOOR) return null;
    if (ctx.corroboratingDomainCount >= ANCHORING_MIN_CORROBORATING_DOMAINS) return null;
    return this.build(
      'anchoring',
      'medium',
      s.id,
      'situation',
      `confidence ${s.confidence.toFixed(2)} > ${ANCHORING_CONFIDENCE_FLOOR.toFixed(2)} with only `
      + `${ctx.corroboratingDomainCount} corroborating domain(s) (need >= ${ANCHORING_MIN_CORROBORATING_DOMAINS})`,
    );
  }

  private checkAvailability(s: Situation): BiasDetection | null {
    const cutoff = this.clock() - AVAILABILITY_LOOKBACK_MS;
    const recentHighOrCritical = this.recentSituations.filter((r) =>
      r.domain === s.domain && r.timestamp >= cutoff
      && (r.severity === 'high' || r.severity === 'critical'),
    ).length;
    if (recentHighOrCritical < AVAILABILITY_MIN_HIGH_OR_CRITICAL) return null;
    return this.build(
      'availability',
      'low',
      s.id,
      'situation',
      `recency-driven elevation: domain "${s.domain}" has ${recentHighOrCritical} HIGH/CRITICAL `
      + `situations in last 24h (>= ${AVAILABILITY_MIN_HIGH_OR_CRITICAL})`,
    );
  }

  private checkConfirmation(s: Situation, ctx: SituationScanContext): BiasDetection | null {
    if (ctx.hasContradictions === true) return null;
    return this.build(
      'confirmation',
      'low',
      s.id,
      'situation',
      'no contradicting signals tied to this situation — supporting-evidence-only synthesis',
    );
  }

  private checkOverconfidence(s: Situation): BiasDetection | null {
    if (s.confidence <= OVERCONFIDENCE_FLOOR) return null;
    return this.build(
      'overconfidence',
      'high',
      s.id,
      'situation',
      `confidence ${s.confidence.toFixed(2)} exceeds overconfidence floor ${OVERCONFIDENCE_FLOOR.toFixed(2)}`,
    );
  }

  private checkGroupthink(): BiasDetection | null {
    // Placeholder: requires an inter-source agreement model that
    // doesn't exist yet. Returns null until a detector ships.
    return null;
  }

  private checkRecency(o: ObservationEvent): BiasDetection | null {
    if (o.severity !== 'CRITICAL') return null;
    const ageMs = this.clock() - o.timestamp;
    if (ageMs < 0 || ageMs >= RECENCY_WINDOW_MS) return null;
    return this.build(
      'recency',
      'medium',
      o.id,
      'observation',
      `too-fresh assessment: CRITICAL observation only ${Math.round(ageMs / 60_000)}m old `
      + `(< ${Math.round(RECENCY_WINDOW_MS / 60_000)}m)`,
    );
  }

  // ── Reads + writes ────────────────────────────────────────────────

  acknowledge(detectionId: string): BiasDetection | undefined {
    this.ensureHydrated();
    const idx = this.detections.findIndex((d) => d.id === detectionId);
    if (idx === -1) return undefined;
    const current = this.detections[idx]!;
    if (current.acknowledged) return cloneDetection(current);
    const next: BiasDetection = { ...current, acknowledged: true };
    this.detections[idx] = next;
    this.schedulePersist();
    return cloneDetection(next);
  }

  getDetections(filter: BiasDetectionFilter = {}, limit?: number): BiasDetection[] {
    this.ensureHydrated();
    const matched = this.detections.filter((d) => {
      if (filter.biasType && d.biasType !== filter.biasType) return false;
      if (filter.acknowledged !== undefined && d.acknowledged !== filter.acknowledged) return false;
      if (filter.targetId && d.targetId !== filter.targetId) return false;
      return true;
    });
    // Newest-first.
    const ordered: BiasDetection[] = [];
    for (let i = matched.length - 1; i >= 0; i -= 1) ordered.push(matched[i]!);
    const capped = typeof limit === 'number' ? ordered.slice(0, Math.max(0, limit)) : ordered;
    return capped.map((d) => cloneDetection(d));
  }

  getReport(): BiasReport {
    this.ensureHydrated();
    const byType = emptyByType();
    const bySeverity = emptyBySeverity();
    let unacknowledgedCount = 0;
    for (const d of this.detections) {
      byType[d.biasType] += 1;
      bySeverity[d.severity] += 1;
      if (!d.acknowledged) unacknowledgedCount += 1;
    }
    let topBiasType: BiasType | null = null;
    let topCount = 0;
    for (const t of ALL_BIAS_TYPES) {
      if (byType[t] > topCount) { topCount = byType[t]; topBiasType = t; }
    }
    return {
      totalDetections: this.detections.length,
      byType,
      bySeverity,
      unacknowledgedCount,
      topBiasType,
    };
  }

  subscribe(listener: BiasDetectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unsubscribe(listener: BiasDetectionListener): void {
    this.listeners.delete(listener);
  }

  /** Test seam — clears state and persisted blob. */
  resetForTesting(): void {
    this.detections = [];
    this.listeners.clear();
    this.recentSituations = [];
    this.idSeq = 0;
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(DETECTIONS_STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private build(
    biasType: BiasType,
    severity: BiasSeverity,
    targetId: string,
    targetType: BiasTargetType,
    evidence: string,
  ): BiasDetection {
    const now = this.clock();
    this.idSeq += 1;
    return {
      id: `bias-${now.toString(36)}-${this.idSeq}`,
      biasType, severity, targetId, targetType, evidence,
      detectedAt: now, acknowledged: false,
    };
  }

  private record(detection: BiasDetection): void {
    this.detections.push(detection);
    if (this.detections.length > MAX_DETECTIONS) {
      this.detections.splice(0, this.detections.length - MAX_DETECTIONS);
    }
    this.schedulePersist();
    const snapshot = cloneDetection(detection);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* isolate */ }
    }
  }

  private recordSituationForAvailability(s: Situation): void {
    this.recentSituations.push({
      domain: s.domain, severity: s.severity, timestamp: this.clock(),
    });
    const cutoff = this.clock() - AVAILABILITY_LOOKBACK_MS;
    this.recentSituations = this.recentSituations.filter((r) => r.timestamp >= cutoff);
    if (this.recentSituations.length > RECENT_SITUATION_MEMORY_MAX) {
      this.recentSituations.splice(0, this.recentSituations.length - RECENT_SITUATION_MEMORY_MAX);
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(DETECTIONS_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as BiasDetection[] | null;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (entry && typeof entry.id === 'string') this.detections.push({ ...entry });
      }
    } catch {
      // corrupt — leave empty
    }
  }

  // Coalesces a burst of mutations into one JSON.stringify write on the next
  // microtask (in-memory state stays synchronous); fixes the renderer-hang
  // stringify storm.
  private persistScheduled = false;
  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => { this.persistScheduled = false; this.persist(); });
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(DETECTIONS_STORAGE_KEY, JSON.stringify(this.detections));
    } catch { /* best effort */ }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: CognitiveBiasDetectorService | null = null;

export function getCognitiveBiasDetectorService(): CognitiveBiasDetectorService {
  _singleton ??= new CognitiveBiasDetectorService();
  return _singleton;
}

export function __resetCognitiveBiasDetectorServiceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  ALL_BIAS_TYPES,
  ALL_SEVERITIES,
  ANCHORING_CONFIDENCE_FLOOR,
  ANCHORING_MIN_CORROBORATING_DOMAINS,
  OVERCONFIDENCE_FLOOR,
  AVAILABILITY_LOOKBACK_MS,
  AVAILABILITY_MIN_HIGH_OR_CRITICAL,
  RECENCY_WINDOW_MS,
  MAX_DETECTIONS,
};
