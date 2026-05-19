/**
 * Multi-agent review loop — second-opinion gate for high-stakes intelligence
 * outputs (situations, alerts, briefs) before downstream action.
 *
 * Routing rules at submit time:
 *   - severity < 3 → auto-approved (no human review needed)
 *   - severity ≥ 3 → pending (queued for review)
 *   - severity ≥ 4 AND reason mentions a sensitive domain ('geopolitical',
 *     'health', or 'nuclear') → escalated (still needs review, but flagged
 *     so the queue UI can render it with extra prominence)
 *
 * Pure deterministic; no DOM, no fetch. Persisted to localStorage under
 * `wm-review-loop` so the queue survives reloads.
 */

export type ReviewTargetType = 'situation' | 'alert' | 'brief';
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'escalated';

export interface ReviewRequest {
  id: string;
  targetId: string;
  targetType: ReviewTargetType;
  /** 0…5 numeric severity. Routing thresholds are at 3 (queue) and 4 (escalate). */
  severity: number;
  reason: string;
  status: ReviewStatus;
  reviewedAt?: number;
  reviewNote?: string;
  createdAt: number;
}

export interface ReviewStats {
  total: number;
  autoApproved: number;
  pendingCount: number;
  /** Fraction in [0, 1] of resolved requests that ended approved. 0 when total=0. */
  approvalRate: number;
  /** Average ms between createdAt and reviewedAt for resolved requests. 0 when none. */
  avgReviewTimeMs: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface MultiAgentReviewLoopOptions {
  /** Max requests retained. Older entries are evicted FIFO. Default 500. */
  capacity?: number;
  /** Storage backend. `null` disables persistence. Default: globalThis.localStorage. */
  storage?: StorageLike | null;
  /** Clock injection for deterministic tests. Default: Date.now. */
  now?: () => number;
  /** Id generator for deterministic tests. Default: monotonic counter + random suffix. */
  idGen?: () => string;
}

export const STORAGE_KEY = 'wm-review-loop';
const DEFAULT_CAPACITY = 500;

const SENSITIVE_DOMAINS = ['geopolitical', 'health', 'nuclear'] as const;

function detectSensitiveDomain(reason: string): boolean {
  const lc = reason.toLowerCase();
  return SENSITIVE_DOMAINS.some(d => lc.includes(d));
}

export class MultiAgentReviewLoop {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly idGen: () => string;
  /** Insertion-order list of request ids for ring-buffer eviction. */
  private readonly order: string[] = [];
  private readonly byId = new Map<string, ReviewRequest>();
  /** Counter for the default id generator. */
  private idCounter = 0;

  constructor(opts: MultiAgentReviewLoopOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.idGen = opts.idGen ?? (() => {
      this.idCounter += 1;
      const uuid = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? this.idCounter.toString(36).padStart(6, '0');
      return `rvw-${this.clock().toString(36)}-${this.idCounter}-${uuid}`;
    });
    this.hydrate();
  }

  /**
   * Submit a new review request. The returned record reflects the final
   * routing decision: `approved` (auto), `pending`, or `escalated`.
   */
  submitForReview(
    targetId: string,
    targetType: ReviewTargetType,
    severity: number,
    reason: string,
  ): ReviewRequest {
    const createdAt = this.clock();
    const sev = Number.isFinite(severity) ? severity : 0;
    let status: ReviewStatus;
    let reviewedAt: number | undefined;
    if (sev < 3) {
      status = 'approved';
      reviewedAt = createdAt;
    } else if (sev >= 4 && detectSensitiveDomain(reason)) {
      status = 'escalated';
    } else {
      status = 'pending';
    }
    const req: ReviewRequest = {
      id: this.idGen(),
      targetId,
      targetType,
      severity: sev,
      reason,
      status,
      reviewedAt,
      createdAt,
    };
    this.commit(req);
    return req;
  }

  /**
   * Resolve a pending or escalated request. Returns the updated record.
   * Idempotent against already-resolved requests (returns them unchanged).
   * Throws if the id is unknown — callers should never review a target
   * that wasn't submitted.
   */
  review(id: string, approved: boolean, note?: string): ReviewRequest {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new Error(`MultiAgentReviewLoop.review: unknown id "${id}"`);
    }
    if (existing.status === 'approved' || existing.status === 'rejected') {
      return existing;
    }
    const updated: ReviewRequest = {
      ...existing,
      status: approved ? 'approved' : 'rejected',
      reviewedAt: this.clock(),
      reviewNote: note,
    };
    this.byId.set(id, updated);
    this.persist();
    return updated;
  }

  /** All pending (not escalated) requests, oldest first. */
  getPending(): ReviewRequest[] {
    const out: ReviewRequest[] = [];
    for (const id of this.order) {
      const r = this.byId.get(id);
      if (r?.status === 'pending') out.push(r);
    }
    return out;
  }

  /** All requests in insertion order. Useful for queue rendering. */
  getAll(): ReviewRequest[] {
    const out: ReviewRequest[] = [];
    for (const id of this.order) {
      const r = this.byId.get(id);
      if (r) out.push(r);
    }
    return out;
  }

  /**
   * Did the most recent submission for `targetId` end approved? Returns false
   * for unknown targets, pending, escalated, or rejected outcomes.
   */
  isApproved(targetId: string): boolean {
    let latest: ReviewRequest | undefined;
    for (const id of this.order) {
      const r = this.byId.get(id);
      if (r?.targetId !== targetId) continue;
      if (!latest || r.createdAt > latest.createdAt) latest = r;
    }
    return latest?.status === 'approved';
  }

  getStats(): ReviewStats {
    const acc: StatsAccumulator = {
      total: 0, autoApproved: 0, pendingCount: 0,
      resolved: 0, approved: 0,
      reviewTimeSum: 0, reviewTimeSamples: 0,
    };
    for (const id of this.order) {
      const r = this.byId.get(id);
      if (r) accumulateStats(acc, r);
    }
    return {
      total: acc.total,
      autoApproved: acc.autoApproved,
      pendingCount: acc.pendingCount,
      approvalRate: acc.resolved > 0 ? acc.approved / acc.resolved : 0,
      avgReviewTimeMs: acc.reviewTimeSamples > 0 ? acc.reviewTimeSum / acc.reviewTimeSamples : 0,
    };
  }

  /** Clear all state (in memory + persisted). Intended for tests. */
  clear(): void {
    this.byId.clear();
    this.order.length = 0;
    this.persist();
  }

  // ── Internals ──────────────────────────────────────────────────────

  private commit(req: ReviewRequest): void {
    this.byId.set(req.id, req);
    this.order.push(req.id);
    while (this.order.length > this.capacity) {
      const evictId = this.order.shift();
      if (evictId !== undefined) this.byId.delete(evictId);
    }
    this.persist();
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ReviewRequest[];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!isValidRequest(item)) continue;
        this.byId.set(item.id, item);
        this.order.push(item.id);
        while (this.order.length > this.capacity) {
          const evictId = this.order.shift();
          if (evictId !== undefined) this.byId.delete(evictId);
        }
      }
    } catch {
      this.byId.clear();
      this.order.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: ReviewRequest[] = [];
      for (const id of this.order) {
        const r = this.byId.get(id);
        if (r) serial.push(r);
      }
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }

  // ── Singleton ──────────────────────────────────────────────────────

  private static instance: MultiAgentReviewLoop | undefined;

  static getInstance(): MultiAgentReviewLoop {
    MultiAgentReviewLoop.instance ??= new MultiAgentReviewLoop();
    return MultiAgentReviewLoop.instance;
  }

  /** Drop the process-wide singleton. Tests only. */
  static resetForTests(): void {
    MultiAgentReviewLoop.instance = undefined;
  }
}

interface StatsAccumulator {
  total: number;
  autoApproved: number;
  pendingCount: number;
  resolved: number;
  approved: number;
  reviewTimeSum: number;
  reviewTimeSamples: number;
}

function accumulateStats(acc: StatsAccumulator, r: ReviewRequest): void {
  acc.total += 1;
  if (r.status === 'pending') acc.pendingCount += 1;
  if (r.severity < 3 && r.status === 'approved') acc.autoApproved += 1;
  if (r.status !== 'approved' && r.status !== 'rejected') return;
  acc.resolved += 1;
  if (r.status === 'approved') acc.approved += 1;
  if (r.reviewedAt !== undefined) {
    acc.reviewTimeSum += Math.max(0, r.reviewedAt - r.createdAt);
    acc.reviewTimeSamples += 1;
  }
}

function isValidRequest(x: unknown): x is ReviewRequest {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.targetId === 'string' &&
    (r.targetType === 'situation' || r.targetType === 'alert' || r.targetType === 'brief') &&
    typeof r.severity === 'number' &&
    typeof r.reason === 'string' &&
    (r.status === 'pending' || r.status === 'approved' || r.status === 'rejected' || r.status === 'escalated') &&
    typeof r.createdAt === 'number'
  );
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
