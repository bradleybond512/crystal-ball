/**
 * Shadow-Mode Runner (Phase 4).
 *
 * Runs experimental scoring variants in parallel with the production
 * `DriverScoringEngine`, without ever touching live alerts /
 * notifications. The runner only records `ShadowComparison`s between
 * the production score and each shadow variant's score for the same
 * observation, then surfaces an aggregate `ShadowReport` with a
 * promote / retire / continue-monitoring recommendation.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the most-recent 2 000 comparisons to `localStorage` under
 * `wm-shadow-runner` (oldest-evicted).
 */

import type { ObservationEvent } from './observation-adapters';
import type { EvidenceEdge } from './situation-store-v2';
import type { DerivedSeverity, EvidenceScore } from './driver-scores';

// ── Public types ──────────────────────────────────────────────────────

export type ShadowSeverity = DerivedSeverity;

export interface ShadowAlgorithm {
  id: string;
  name: string;
  description: string;
  version: string;
  isActive: boolean;
  promotedAt?: Date;
  retiredAt?: Date;
  /** Same interface as `DriverScoringEngine.scoreObservation`. */
  score: (obs: ObservationEvent, edges?: readonly EvidenceEdge[]) => EvidenceScore;
}

export interface ShadowComparison {
  id: string;
  shadowAlgorithmId: string;
  observationId: string;
  domain: string;
  productionSeverity: ShadowSeverity;
  shadowSeverity: ShadowSeverity;
  productionScore: number;
  shadowScore: number;
  agreement: boolean;
  delta: number;
  comparedAt: Date;
}

export interface DomainBreakdownEntry {
  agreementRate: number;
  avgDelta: number;
  count: number;
}

export type ShadowRecommendation = 'promote' | 'retire' | 'continue-monitoring';

export interface ShadowReport {
  shadowAlgorithmId: string;
  totalComparisons: number;
  agreementRate: number;
  avgDelta: number;
  domainBreakdown: Record<string, DomainBreakdownEntry>;
  recommendation: ShadowRecommendation;
  generatedAt: Date;
}

export interface ShadowEvent {
  type: 'comparison' | 'register' | 'unregister' | 'promote' | 'retire';
  algorithmId: string;
  comparison?: ShadowComparison;
}

export type ShadowListener = (event: ShadowEvent) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-shadow-runner';
const MAX_COMPARISONS = 2000;
const PROMOTE_AGREEMENT_THRESHOLD = 0.85;
const PROMOTE_DELTA_THRESHOLD = 0.05;
const RETIRE_AGREEMENT_THRESHOLD = 0.5;
const MIN_COMPARISONS_FOR_RECOMMENDATION = 10;

// ── Runner ────────────────────────────────────────────────────────────

export interface ShadowRunnerOptions {
  clock?: () => number;
}

export class ShadowRunner {
  private algorithms = new Map<string, ShadowAlgorithm>();
  /** Comparisons stored in insertion order; oldest evicted first. */
  private comparisons: ShadowComparison[] = [];
  private listeners = new Set<ShadowListener>();
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: ShadowRunnerOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Algorithm registry ──────────────────────────────────────────

  registerAlgorithm(algo: ShadowAlgorithm): void {
    this.ensureHydrated();
    this.algorithms.set(algo.id, cloneAlgorithm(algo));
    this.emit({ type: 'register', algorithmId: algo.id });
  }

  unregisterAlgorithm(id: string): void {
    if (!this.algorithms.has(id)) return;
    this.algorithms.delete(id);
    this.emit({ type: 'unregister', algorithmId: id });
  }

  getAlgorithm(id: string): ShadowAlgorithm | undefined {
    const a = this.algorithms.get(id);
    return a ? cloneAlgorithm(a) : undefined;
  }

  getAllAlgorithms(): ShadowAlgorithm[] {
    return [...this.algorithms.values()].map((a) => cloneAlgorithm(a));
  }

  getActiveAlgorithms(): ShadowAlgorithm[] {
    return [...this.algorithms.values()]
      .filter((a) => a.isActive && !a.promotedAt && !a.retiredAt)
      .map((a) => cloneAlgorithm(a));
  }

  // ── Lifecycle (promote / retire) ────────────────────────────────

  promoteAlgorithm(id: string): ShadowAlgorithm | undefined {
    this.ensureHydrated();
    const algo = this.algorithms.get(id);
    if (!algo) return undefined;
    algo.isActive = false;
    algo.promotedAt = new Date(this.clock());
    this.persist();
    this.emit({ type: 'promote', algorithmId: id });
    return cloneAlgorithm(algo);
  }

  retireAlgorithm(id: string): ShadowAlgorithm | undefined {
    this.ensureHydrated();
    const algo = this.algorithms.get(id);
    if (!algo) return undefined;
    algo.isActive = false;
    algo.retiredAt = new Date(this.clock());
    this.persist();
    this.emit({ type: 'retire', algorithmId: id });
    return cloneAlgorithm(algo);
  }

  // ── Shadow execution ────────────────────────────────────────────

  /** Run every active shadow algorithm against an observation +
   *  production score. Silent — never touches downstream notifications
   *  or alert sinks. Listener crashes are isolated. */
  runShadow(
    obs: ObservationEvent,
    productionScore: EvidenceScore,
    edges?: readonly EvidenceEdge[],
  ): void {
    this.ensureHydrated();
    const active = [...this.algorithms.values()].filter((a) => a.isActive && !a.promotedAt && !a.retiredAt);
    if (active.length === 0) return;
    for (const algo of active) {
      this.runOne(algo, obs, productionScore, edges);
    }
    this.enforceCapacity();
    this.persist();
  }

  private runOne(
    algo: ShadowAlgorithm,
    obs: ObservationEvent,
    productionScore: EvidenceScore,
    edges?: readonly EvidenceEdge[],
  ): void {
    let shadowScore: EvidenceScore;
    try {
      shadowScore = algo.score(obs, edges);
    } catch {
      // Shadow crashes never bring down the runner — skip this comparison.
      return;
    }
    const comparison: ShadowComparison = {
      id: this.nextId(),
      shadowAlgorithmId: algo.id,
      observationId: obs.id,
      domain: obs.domain,
      productionSeverity: productionScore.derivedSeverity,
      shadowSeverity: shadowScore.derivedSeverity,
      productionScore: clamp01(productionScore.finalScore),
      shadowScore: clamp01(shadowScore.finalScore),
      agreement: productionScore.derivedSeverity === shadowScore.derivedSeverity,
      delta: round4(clamp(-1, 1, shadowScore.finalScore - productionScore.finalScore)),
      comparedAt: new Date(this.clock()),
    };
    this.comparisons.push(comparison);
    this.emit({ type: 'comparison', algorithmId: algo.id, comparison: cloneComparison(comparison) });
  }

  // ── Reads ────────────────────────────────────────────────────────

  getComparisons(shadowAlgorithmId: string): ShadowComparison[] {
    this.ensureHydrated();
    return this.comparisons
      .filter((c) => c.shadowAlgorithmId === shadowAlgorithmId)
      .map((c) => cloneComparison(c));
  }

  getAllComparisons(): ShadowComparison[] {
    this.ensureHydrated();
    return this.comparisons.map((c) => cloneComparison(c));
  }

  getReport(shadowAlgorithmId: string): ShadowReport {
    this.ensureHydrated();
    const rows = this.comparisons.filter((c) => c.shadowAlgorithmId === shadowAlgorithmId);
    const total = rows.length;
    if (total === 0) {
      return {
        shadowAlgorithmId,
        totalComparisons: 0,
        agreementRate: 0,
        avgDelta: 0,
        domainBreakdown: {},
        recommendation: 'continue-monitoring',
        generatedAt: new Date(this.clock()),
      };
    }
    let agreements = 0;
    let deltaSum = 0;
    const byDomain = new Map<string, { agreements: number; deltaSum: number; count: number }>();
    for (const c of rows) {
      if (c.agreement) agreements += 1;
      deltaSum += c.delta;
      const bucket = byDomain.get(c.domain) ?? { agreements: 0, deltaSum: 0, count: 0 };
      bucket.count += 1;
      bucket.deltaSum += c.delta;
      if (c.agreement) bucket.agreements += 1;
      byDomain.set(c.domain, bucket);
    }
    const agreementRate = agreements / total;
    const avgDelta = deltaSum / total;
    const domainBreakdown: Record<string, DomainBreakdownEntry> = {};
    for (const [domain, bucket] of byDomain) {
      domainBreakdown[domain] = {
        agreementRate: round4(bucket.agreements / bucket.count),
        avgDelta: round4(bucket.deltaSum / bucket.count),
        count: bucket.count,
      };
    }
    return {
      shadowAlgorithmId,
      totalComparisons: total,
      agreementRate: round4(agreementRate),
      avgDelta: round4(avgDelta),
      domainBreakdown,
      recommendation: deriveRecommendation(total, agreementRate, avgDelta),
      generatedAt: new Date(this.clock()),
    };
  }

  getAllReports(): ShadowReport[] {
    return this.getAllAlgorithms().map((a) => this.getReport(a.id));
  }

  // ── Subscribe ────────────────────────────────────────────────────

  subscribe(listener: ShadowListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties everything, including persisted state. */
  resetForTesting(): void {
    this.algorithms.clear();
    this.comparisons = [];
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

  private emit(event: ShadowEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* listener crash isolation */ }
    }
  }

  private nextId(): string {
    this.idSeq += 1;
    return `sc-${this.clock().toString(36)}-${this.idSeq}`;
  }

  private enforceCapacity(): void {
    if (this.comparisons.length <= MAX_COMPARISONS) return;
    const overflow = this.comparisons.length - MAX_COMPARISONS;
    this.comparisons.splice(0, overflow);
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
      const parsed = JSON.parse(raw) as PersistedState | null;
      if (!parsed) return;
      for (const entry of parsed.comparisons ?? []) {
        const c = deserializeComparison(entry);
        if (c) this.comparisons.push(c);
      }
    } catch {
      // corrupt blob — leave empty
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    const payload: PersistedState = {
      comparisons: this.comparisons.map((c) => serializeComparison(c)),
    };
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // best effort
    }
  }
}

// ── Persistence helpers ─────────────────────────────────────────────

interface PersistedComparison extends Omit<ShadowComparison, 'comparedAt'> {
  comparedAt: number;
}

interface PersistedState {
  comparisons: PersistedComparison[];
}

function serializeComparison(c: ShadowComparison): PersistedComparison {
  return { ...c, comparedAt: c.comparedAt.getTime() };
}

function deserializeComparison(raw: unknown): ShadowComparison | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as PersistedComparison;
  if (typeof r.id !== 'string' || typeof r.shadowAlgorithmId !== 'string') return undefined;
  return {
    id: r.id,
    shadowAlgorithmId: r.shadowAlgorithmId,
    observationId: r.observationId,
    domain: r.domain,
    productionSeverity: r.productionSeverity,
    shadowSeverity: r.shadowSeverity,
    productionScore: typeof r.productionScore === 'number' ? r.productionScore : 0,
    shadowScore: typeof r.shadowScore === 'number' ? r.shadowScore : 0,
    agreement: r.agreement === true,
    delta: typeof r.delta === 'number' ? r.delta : 0,
    comparedAt: new Date(typeof r.comparedAt === 'number' ? r.comparedAt : Date.now()),
  };
}

function cloneAlgorithm(a: ShadowAlgorithm): ShadowAlgorithm {
  return {
    ...a,
    promotedAt: a.promotedAt ? new Date(a.promotedAt) : undefined,
    retiredAt: a.retiredAt ? new Date(a.retiredAt) : undefined,
  };
}

function cloneComparison(c: ShadowComparison): ShadowComparison {
  return { ...c, comparedAt: new Date(c.comparedAt) };
}

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function clamp01(value: number): number {
  return clamp(0, 1, value);
}

function clamp(lo: number, hi: number, value: number): number {
  if (!Number.isFinite(value)) return lo;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function deriveRecommendation(
  totalComparisons: number,
  agreementRate: number,
  avgDelta: number,
): ShadowRecommendation {
  if (totalComparisons < MIN_COMPARISONS_FOR_RECOMMENDATION) return 'continue-monitoring';
  if (agreementRate < RETIRE_AGREEMENT_THRESHOLD) return 'retire';
  if (agreementRate > PROMOTE_AGREEMENT_THRESHOLD && avgDelta > PROMOTE_DELTA_THRESHOLD) return 'promote';
  return 'continue-monitoring';
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: ShadowRunner | null = null;

export function getShadowRunner(): ShadowRunner {
  _singleton ??= new ShadowRunner();
  return _singleton;
}

export function __resetShadowRunnerSingleton(): void {
  _singleton = null;
}

export const __internals = {
  deriveRecommendation,
  MAX_COMPARISONS,
  PROMOTE_AGREEMENT_THRESHOLD,
  PROMOTE_DELTA_THRESHOLD,
  RETIRE_AGREEMENT_THRESHOLD,
  MIN_COMPARISONS_FOR_RECOMMENDATION,
};
