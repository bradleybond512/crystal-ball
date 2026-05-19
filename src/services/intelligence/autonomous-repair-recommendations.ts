/**
 * AutonomousRepairRecommendationService — turns operational telemetry
 * (per-domain health signals + system-wide quality debts) into specific,
 * actionable repair recommendations.
 *
 * Each call to `generateRecommendations()` walks the inputs and emits new
 * recommendations only — pending recommendations for the same target are
 * not re-emitted, so an unresolved condition that persists across multiple
 * calls keeps a single open ticket instead of growing a duplicate pile.
 *
 * Pure deterministic — no DOM, no fetch. Persists to localStorage under
 * `wm-repair-recommendations`, ring-buffered at 300 entries. Injectable
 * storage and clock for tests.
 */

// ── Public types ──────────────────────────────────────────────────────

export type RepairTargetType = 'feed' | 'algorithm' | 'threshold' | 'config';
export type RepairPriority = 'low' | 'medium' | 'high' | 'critical';
export type RepairStatus = 'pending' | 'applied' | 'dismissed';

export interface RepairRecommendation {
  id: string;
  title: string;
  description: string;
  targetType: RepairTargetType;
  targetId: string;
  action: string;
  expectedImpact: string;
  priority: RepairPriority;
  status: RepairStatus;
  generatedAt: number;
  appliedAt?: number;
}

export interface HealthSignal {
  domain: string;
  score: number;
}

export interface QualityDebt {
  category: string;
  severity: string;
}

export interface RepairRecommendationStats {
  total: number;
  applied: number;
  dismissed: number;
  pending: number;
  avgTimeToApplyHours: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface AutonomousRepairRecommendationOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-repair-recommendations';
export const MAX_RECOMMENDATIONS = 300;

/** Below this health score, a feed is so degraded that it needs a critical-priority hard repair. */
export const CRITICAL_HEALTH_THRESHOLD = 0.3;
/** Between CRITICAL_HEALTH_THRESHOLD and this, a feed only needs threshold tuning. */
export const DEGRADED_HEALTH_THRESHOLD = 0.5;

const PRIORITY_ORDER: Record<RepairPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const HOUR_MS = 3_600_000;

// ── Storage helper ────────────────────────────────────────────────────

function safeStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Service ───────────────────────────────────────────────────────────

export class AutonomousRepairRecommendationService {
  private static _singleton: AutonomousRepairRecommendationService | null = null;
  private recommendations: RepairRecommendation[] = [];
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private idCounter = 0;

  constructor(options: AutonomousRepairRecommendationOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? Date.now;
    this.hydrate();
  }

  static getInstance(): AutonomousRepairRecommendationService {
    AutonomousRepairRecommendationService._singleton ??= new AutonomousRepairRecommendationService();
    return AutonomousRepairRecommendationService._singleton;
  }

  static _resetForTests(): void {
    AutonomousRepairRecommendationService._singleton = null;
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Walk the input signals and emit new pending recommendations.
   * A target that already has an open (pending) recommendation of the
   * same shape is skipped — callers can poll repeatedly without
   * generating duplicates.
   *
   * Returns only the recommendations created in this call, sorted by
   * priority descending.
   */
  generateRecommendations(
    healthSignals: HealthSignal[],
    qualityDebts: QualityDebt[],
  ): RepairRecommendation[] {
    const created: RepairRecommendation[] = [];
    const now = this.clock();

    for (const signal of healthSignals) {
      const rec = this.recommendationForSignal(signal, now);
      if (rec) created.push(rec);
    }

    for (const debt of qualityDebts) {
      const rec = this.recommendationForDebt(debt, now);
      if (rec) created.push(rec);
    }

    if (created.length > 0) {
      for (const rec of created) this.recommendations.push(rec);
      while (this.recommendations.length > MAX_RECOMMENDATIONS) this.recommendations.shift();
      this.persist();
    }

    return [...created]
      .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority])
      .map((r) => ({ ...r }));
  }

  private recommendationForSignal(signal: HealthSignal, now: number): RepairRecommendation | null {
    if (typeof signal?.score !== 'number' || Number.isNaN(signal.score)) return null;
    if (typeof signal.domain !== 'string' || signal.domain.length === 0) return null;

    if (signal.score < CRITICAL_HEALTH_THRESHOLD) {
      if (this.hasOpenRecommendation('feed', signal.domain)) return null;
      return this.buildRecommendation({
        title: `Repair ${signal.domain} feed`,
        description: `${signal.domain} health score is ${signal.score.toFixed(2)} — feed is severely degraded.`,
        targetType: 'feed',
        targetId: signal.domain,
        action: `Restart ${signal.domain} feed connector and re-validate upstream credentials`,
        expectedImpact: `Restore ${signal.domain} domain visibility; lift health back above ${DEGRADED_HEALTH_THRESHOLD.toFixed(1)}`,
        priority: 'critical',
        generatedAt: now,
      });
    }

    if (signal.score < DEGRADED_HEALTH_THRESHOLD) {
      if (this.hasOpenRecommendation('threshold', signal.domain)) return null;
      return this.buildRecommendation({
        title: `Adjust ${signal.domain} thresholds`,
        description: `${signal.domain} health score is ${signal.score.toFixed(2)} — borderline degraded, thresholds may be too strict.`,
        targetType: 'threshold',
        targetId: signal.domain,
        action: `Widen ${signal.domain} acceptance thresholds and inspect noise floor`,
        expectedImpact: `Reduce false-negative rate on ${signal.domain}; recover marginal observations`,
        priority: 'medium',
        generatedAt: now,
      });
    }

    return null;
  }

  private recommendationForDebt(debt: QualityDebt, now: number): RepairRecommendation | null {
    if (typeof debt?.category !== 'string' || debt.category.length === 0) return null;
    const severity = (debt.severity ?? '').toLowerCase();
    if (severity !== 'high' && severity !== 'critical') return null;
    if (this.hasOpenRecommendation('algorithm', debt.category)) return null;

    const priority: RepairPriority = severity === 'critical' ? 'critical' : 'high';
    return this.buildRecommendation({
      title: `Reconfigure ${debt.category} algorithm`,
      description: `${debt.category} carries a ${severity}-severity quality debt that needs immediate algorithm review.`,
      targetType: 'algorithm',
      targetId: debt.category,
      action: `Review ${debt.category} algorithm weights and retire stale heuristics`,
      expectedImpact: `Reduce ${debt.category} false-positive rate and improve calibration`,
      priority,
      generatedAt: now,
    });
  }

  /**
   * Mark a pending recommendation as applied. No-op if the id is unknown
   * or the recommendation is already in a terminal status.
   * Returns true when the status transitioned, false otherwise.
   */
  applyRecommendation(id: string): boolean {
    const rec = this.recommendations.find((r) => r.id === id);
    if (rec?.status !== 'pending') return false;
    rec.status = 'applied';
    rec.appliedAt = this.clock();
    this.persist();
    return true;
  }

  /**
   * Mark a pending recommendation as dismissed. Mirrors applyRecommendation
   * for the dismiss path; terminal-status recommendations stay frozen.
   */
  dismissRecommendation(id: string): boolean {
    const rec = this.recommendations.find((r) => r.id === id);
    if (rec?.status !== 'pending') return false;
    rec.status = 'dismissed';
    this.persist();
    return true;
  }

  /** All pending recommendations, sorted by priority descending. */
  getOpen(): RepairRecommendation[] {
    return this.recommendations
      .filter((r) => r.status === 'pending')
      .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority])
      .map((r) => ({ ...r }));
  }

  getStats(): RepairRecommendationStats {
    const total = this.recommendations.length;
    let applied = 0;
    let dismissed = 0;
    let pending = 0;
    let appliedDurationSum = 0;

    for (const r of this.recommendations) {
      switch (r.status) {
        case 'applied': {
          applied += 1;
          if (typeof r.appliedAt === 'number') {
            appliedDurationSum += r.appliedAt - r.generatedAt;
          }
          break;
        }
        case 'dismissed': {
          dismissed += 1;
          break;
        }
        default: {
          pending += 1;
          break;
        }
      }
    }

    const avgTimeToApplyHours = applied === 0
      ? 0
      : Number(((appliedDurationSum / applied) / HOUR_MS).toFixed(4));

    return { total, applied, dismissed, pending, avgTimeToApplyHours };
  }

  /** Clear all recommendations and storage (test seam). */
  resetForTesting(): void {
    this.recommendations = [];
    this.idCounter = 0;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ──────────────────────────────────────────────────────

  private buildRecommendation(seed: Omit<RepairRecommendation, 'id' | 'status'>): RepairRecommendation {
    this.idCounter += 1;
    return {
      id: `arr-${seed.generatedAt.toString(36)}-${this.idCounter}`,
      status: 'pending',
      ...seed,
    };
  }

  private hasOpenRecommendation(targetType: RepairTargetType, targetId: string): boolean {
    return this.recommendations.some(
      (r) => r.status === 'pending' && r.targetType === targetType && r.targetId === targetId,
    );
  }

  private hydrate(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: RepairRecommendation[] | null;
    try { parsed = JSON.parse(raw) as RepairRecommendation[] | null; } catch { return; }
    if (!Array.isArray(parsed)) return;

    for (const entry of parsed) {
      if (!entry || typeof entry.id !== 'string') continue;
      if (typeof entry.targetType !== 'string' || typeof entry.targetId !== 'string') continue;
      if (typeof entry.generatedAt !== 'number') continue;
      this.recommendations.push({ ...entry });
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.recommendations));
    } catch { /* best effort */ }
  }
}

// ── Convenience accessor ──────────────────────────────────────────────

export function getAutonomousRepairRecommendationService(): AutonomousRepairRecommendationService {
  return AutonomousRepairRecommendationService.getInstance();
}

export const __internals = {
  STORAGE_KEY,
  MAX_RECOMMENDATIONS,
  CRITICAL_HEALTH_THRESHOLD,
  DEGRADED_HEALTH_THRESHOLD,
  PRIORITY_ORDER,
};
