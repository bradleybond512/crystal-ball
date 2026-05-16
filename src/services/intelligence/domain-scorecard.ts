/**
 * Domain scorecard engine — per-domain A–F grade consolidating five
 * inputs into a single grade and an actionable recommendation:
 *
 *   1. Outcome quality          (OutcomeLedger.getCalibration)
 *   2. Prediction accuracy      (AlgoEvalLedger.getStats('driver-scorer', domain))
 *   3. Feed health              (caller-provided 'healthy' / 'degraded' / 'down')
 *   4. Attention efficiency     (AttentionAllocator.getMultiplier × outcome quality)
 *   5. Budget health            (TrustBudget.getBudget)
 *
 * Sources are wired via a `DomainScorecardSources` adapter so production
 * code wires the live singletons in one place and tests pass an
 * in-memory fixture. Engine is pure deterministic.
 */

import type { AlgorithmStats } from './algo-eval-ledger';
import type { DomainCalibration } from './outcome-ledger';
import type { DomainBudget } from '../notifications/trust-budget';

// ── Public types ──────────────────────────────────────────────────────

export type ScorecardGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type ScorecardTrend = 'improving' | 'stable' | 'degrading';
export type FeedHealth = 'healthy' | 'degraded' | 'down';

export interface DomainScorecardComponents {
  outcomeQuality: number;
  predictionAccuracy: number;
  feedHealth: number;
  attentionEfficiency: number;
  budgetHealth: number;
}

export interface DomainScorecard {
  domain: string;
  grade: ScorecardGrade;
  overallScore: number;
  components: DomainScorecardComponents;
  trend: ScorecardTrend;
  topIssue: string | null;
  recommendation: string;
  outcomeCount: number;
  lastUpdated: Date;
}

export interface ScorecardSummary {
  generatedAt: Date;
  scorecards: DomainScorecard[];
  topPerformer: string | null;
  worstPerformer: string | null;
  systemGrade: ScorecardGrade;
  domainsNeedingAttention: string[];
}

/** Adapter interface for the four input services. Production code
 *  wires this to the live singletons; tests pass an in-memory fixture. */
export interface DomainScorecardSources {
  getCalibration(domain: string): DomainCalibration | null;
  getAlgorithmStats(algorithmId: string, domain: string | undefined): AlgorithmStats | null;
  getAttentionMultiplier(domain: string): number;
  getBudget(domain: string): DomainBudget | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DomainScorecardServiceOptions {
  sources: DomainScorecardSources;
  storage?: StorageLike | null;
  now?: () => number;
  /** Bump the algorithm id when scoring a different prediction
   *  algorithm; defaults to the driver-scorer that backs PR #480. */
  algorithmId?: string;
}

// ── Constants ────────────────────────────────────────────────────────

const WEIGHTS = {
  outcomeQuality: 0.3,
  predictionAccuracy: 0.3,
  feedHealth: 0.2,
  attentionEfficiency: 0.1,
  budgetHealth: 0.1,
} as const;

const GRADE_THRESHOLDS: { min: number; grade: ScorecardGrade }[] = [
  { min: 0.85, grade: 'A' },
  { min: 0.7, grade: 'B' },
  { min: 0.55, grade: 'C' },
  { min: 0.4, grade: 'D' },
  { min: 0,    grade: 'F' },
];

const TREND_THRESHOLD = 0.05;
const COMPONENT_PERFECT_EPSILON = 1e-9;
const BUDGET_USED_HEAVY_RATIO = 0.7;
const DEFAULT_ALGORITHM_ID = 'driver-scorer';
export const STORAGE_KEY = 'wm-domain-scorecards';

const FEED_HEALTH_SCORE: Record<FeedHealth, number> = {
  healthy: 1,
  degraded: 0.5,
  down: 0,
};

// ── Engine ───────────────────────────────────────────────────────────

interface SerializedScorecard extends Omit<DomainScorecard, 'lastUpdated'> {
  lastUpdated: number;
}

export class DomainScorecardService {
  private sources: DomainScorecardSources;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly algorithmId: string;
  private readonly byDomain = new Map<string, DomainScorecard>();
  private readonly priorScore = new Map<string, number>();
  private readonly subscribers = new Set<(s: DomainScorecard) => void>();

  constructor(opts: DomainScorecardServiceOptions) {
    this.sources = opts.sources;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.algorithmId = opts.algorithmId ?? DEFAULT_ALGORITHM_ID;
    this.hydrate();
  }

  generateScorecard(domain: string, feedHealth: FeedHealth): DomainScorecard {
    const calibration = this.sources.getCalibration(domain);
    const algoStats = this.sources.getAlgorithmStats(this.algorithmId, domain);
    const multiplier = this.sources.getAttentionMultiplier(domain);
    const budget = this.sources.getBudget(domain);

    const components: DomainScorecardComponents = {
      outcomeQuality: computeOutcomeQuality(calibration),
      predictionAccuracy: computePredictionAccuracy(algoStats),
      feedHealth: FEED_HEALTH_SCORE[feedHealth],
      attentionEfficiency: 0,
      budgetHealth: computeBudgetHealth(budget),
    };
    components.attentionEfficiency = computeAttentionEfficiency(multiplier, components.outcomeQuality);

    const overallScore = weightedScore(components);
    const grade = gradeFor(overallScore);
    const topIssue = pickTopIssue(components);
    const recommendation = recommendationFor(topIssue);

    const trend = decideTrend(this.priorScore.get(domain), overallScore);
    this.priorScore.set(domain, overallScore);

    const scorecard: DomainScorecard = {
      domain,
      grade,
      overallScore,
      components,
      trend,
      topIssue: topIssue ? `${topIssue.label} is at ${topIssue.value.toFixed(2)}` : null,
      recommendation,
      outcomeCount: calibration?.totalOutcomes ?? 0,
      lastUpdated: new Date(this.clock()),
    };
    this.commit(scorecard);
    return scorecard;
  }

  generateAll(feedHealthMap: Record<string, FeedHealth>): ScorecardSummary {
    const scorecards: DomainScorecard[] = [];
    for (const [domain, health] of Object.entries(feedHealthMap)) {
      scorecards.push(this.generateScorecard(domain, health));
    }
    const sortedByScore = [...scorecards].sort((a, b) => b.overallScore - a.overallScore);
    const topPerformer = sortedByScore[0]?.domain ?? null;
    const worstPerformer = sortedByScore.length > 0
      ? sortedByScore[sortedByScore.length - 1]?.domain ?? null
      : null;
    const systemGrade = medianGrade(scorecards);
    const domainsNeedingAttention = scorecards
      .filter((s) => s.grade === 'D' || s.grade === 'F')
      .map((s) => s.domain);
    return {
      generatedAt: new Date(this.clock()),
      scorecards,
      topPerformer,
      worstPerformer,
      systemGrade,
      domainsNeedingAttention,
    };
  }

  getScorecard(domain: string): DomainScorecard | undefined {
    return this.byDomain.get(domain);
  }

  subscribe(cb: (s: DomainScorecard) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  clear(): void {
    this.byDomain.clear();
    this.priorScore.clear();
    this.persist();
  }

  // ── Internals ──────────────────────────────────────────────────────

  private commit(scorecard: DomainScorecard): void {
    this.byDomain.set(scorecard.domain, scorecard);
    this.persist();
    for (const cb of this.subscribers) cb(scorecard);
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SerializedScorecard[];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        this.byDomain.set(item.domain, {
          ...item,
          lastUpdated: new Date(item.lastUpdated),
        });
        this.priorScore.set(item.domain, item.overallScore);
      }
    } catch {
      this.byDomain.clear();
      this.priorScore.clear();
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: SerializedScorecard[] = [];
      for (const sc of this.byDomain.values()) {
        serial.push({ ...sc, lastUpdated: sc.lastUpdated.getTime() });
      }
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: DomainScorecardService | undefined;

export function getDomainScorecardService(sources: DomainScorecardSources): DomainScorecardService {
  singleton ??= new DomainScorecardService({ sources });
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Component math ──────────────────────────────────────────────────

function computeOutcomeQuality(calibration: DomainCalibration | null): number {
  if (!calibration) return 0.5;
  return clamp01(1 - calibration.falsePositiveRate);
}

function computePredictionAccuracy(stats: AlgorithmStats | null): number {
  if (stats?.accuracy === undefined) return 0.5;
  return clamp01(stats.accuracy);
}

function computeAttentionEfficiency(multiplier: number, outcomeQuality: number): number {
  if (multiplier > 1) {
    if (outcomeQuality > 0.7) return 1;
    if (outcomeQuality < 0.4) return 0.3;
  }
  return 0.6;
}

function computeBudgetHealth(budget: DomainBudget | null): number {
  if (!budget) return 1;
  if (budget.exhausted) return 0.3;
  const quota = budget.currentQuota || budget.baseQuota;
  if (quota <= 0) return 1;
  const usedRatio = budget.used / quota;
  return usedRatio < BUDGET_USED_HEAVY_RATIO ? 1 : 0.6;
}

function weightedScore(c: DomainScorecardComponents): number {
  const raw =
    c.outcomeQuality * WEIGHTS.outcomeQuality +
    c.predictionAccuracy * WEIGHTS.predictionAccuracy +
    c.feedHealth * WEIGHTS.feedHealth +
    c.attentionEfficiency * WEIGHTS.attentionEfficiency +
    c.budgetHealth * WEIGHTS.budgetHealth;
  return Number(raw.toFixed(4));
}

function gradeFor(score: number): ScorecardGrade {
  for (const t of GRADE_THRESHOLDS) {
    if (score >= t.min) return t.grade;
  }
  return 'F';
}

interface ComponentIssue {
  key: keyof DomainScorecardComponents;
  label: string;
  value: number;
}

const COMPONENT_LABELS: Record<keyof DomainScorecardComponents, string> = {
  outcomeQuality: 'Outcome quality',
  predictionAccuracy: 'Prediction accuracy',
  feedHealth: 'Feed health',
  attentionEfficiency: 'Attention efficiency',
  budgetHealth: 'Budget health',
};

function pickTopIssue(c: DomainScorecardComponents): ComponentIssue | null {
  let worst: ComponentIssue | null = null;
  for (const key of Object.keys(c) as (keyof DomainScorecardComponents)[]) {
    const v = c[key];
    if (v >= 1 - COMPONENT_PERFECT_EPSILON) continue;
    if (!worst || v < worst.value) {
      worst = { key, label: COMPONENT_LABELS[key], value: v };
    }
  }
  return worst;
}

function recommendationFor(issue: ComponentIssue | null): string {
  if (!issue) return 'All components healthy — no action needed.';
  switch (issue.key) {
    case 'outcomeQuality': {
      return 'Review recent dismissals — domain has a high false-positive rate.';
    }
    case 'predictionAccuracy': {
      return 'Re-tune driver weights — algorithm accuracy is below target.';
    }
    case 'feedHealth': {
      return 'Check feed-source status; rerun health probes.';
    }
    case 'attentionEfficiency': {
      return 'Recalibrate attention multiplier against recent outcomes.';
    }
    case 'budgetHealth': {
      return 'Reduce notification volume or expand trust budget for this domain.';
    }
  }
}

function decideTrend(prior: number | undefined, current: number): ScorecardTrend {
  if (prior === undefined) return 'stable';
  const delta = current - prior;
  if (delta > TREND_THRESHOLD) return 'improving';
  if (delta < -TREND_THRESHOLD) return 'degrading';
  return 'stable';
}

const GRADE_ORDER: ScorecardGrade[] = ['A', 'B', 'C', 'D', 'F'];

function medianGrade(scorecards: readonly DomainScorecard[]): ScorecardGrade {
  if (scorecards.length === 0) return 'F';
  const sorted = [...scorecards].sort(
    (a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade),
  );
  return sorted[Math.floor((sorted.length - 1) / 2)]?.grade ?? 'F';
}

// ── Utility ─────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
