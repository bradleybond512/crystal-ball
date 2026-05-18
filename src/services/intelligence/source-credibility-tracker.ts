/**
 * Source Credibility Tracker — tracks the historical accuracy of each
 * intelligence source. When a source's report is later confirmed or
 * refuted the service updates the source's credibility score; the
 * score then drives downstream weighting so high-credibility sources
 * count more in any aggregate.
 *
 *   credibilityScore = confirmCount / max(confirmCount + refuteCount, 1)
 *
 * Tier classification (only assigned once a source has >= 10 reports):
 *   tier-1   score >= 0.8
 *   tier-2   score >= 0.6
 *   tier-3   score >= 0.4  (also the floor for any rated source)
 *   unrated  totalReports < 10
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the source table to `wm-source-credibility` (one entry per source)
 * and feedback events to `wm-credibility-feedback` (LIFO ring buffer,
 * max 2000).
 */

// ── Public types ──────────────────────────────────────────────────────

export type CredibilityTier = 'tier-1' | 'tier-2' | 'tier-3' | 'unrated';

export type CredibilityOutcome = 'confirmed' | 'refuted' | 'neutral';

export interface SourceRecord {
  sourceId: string;
  domain: string;
  confirmCount: number;
  refuteCount: number;
  neutralCount: number;
  totalReports: number;
  credibilityScore: number;
  tier: CredibilityTier;
  lastSeenAt: number;
  firstSeenAt: number;
}

export interface CredibilityFeedback {
  id: string;
  sourceId: string;
  domain: string;
  reportId: string;
  outcome: CredibilityOutcome;
  recordedAt: number;
}

export type FeedbackInput = Omit<CredibilityFeedback, 'id' | 'recordedAt'>;

export interface SourceFilter {
  domain?: string;
  tier?: CredibilityTier;
}

export interface CredibilitySummary {
  totalSources: number;
  byTier: Record<CredibilityTier, number>;
  avgScore: number;
  topSources: SourceRecord[];
  worstSources: SourceRecord[];
}

export type CredibilityListener = (feedback: CredibilityFeedback, source: SourceRecord) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface SourceCredibilityTrackerOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const SOURCES_STORAGE_KEY = 'wm-source-credibility';
export const FEEDBACK_STORAGE_KEY = 'wm-credibility-feedback';
export const MAX_FEEDBACK = 2000;

export const TIER_1_FLOOR = 0.8;
export const TIER_2_FLOOR = 0.6;
export const TIER_3_FLOOR = 0.4;
export const RATED_MIN_REPORTS = 10;
export const SUMMARY_BUCKET_MIN_REPORTS = 5;
export const SUMMARY_BUCKET_SIZE = 5;
export const UNRATED_WEIGHT = 0.5;

// ── Seed catalog ──────────────────────────────────────────────────────

interface SeedSource {
  sourceId: string;
  domain: string;
}

const SEED_SOURCES: readonly SeedSource[] = [
  { sourceId: 'usgs-earthquake', domain: 'earthquake' },
  { sourceId: 'who-biosurv', domain: 'biosurv' },
  { sourceId: 'nws-weather', domain: 'weather' },
  { sourceId: 'ais-maritime', domain: 'maritime' },
  { sourceId: 'opensky-aviation', domain: 'aviation' },
  { sourceId: 'acled-conflict', domain: 'geopolitical' },
  { sourceId: 'nvd-cve', domain: 'cyber' },
  { sourceId: 'ofac-sanctions', domain: 'compliance' },
  { sourceId: 'gdacs-alerts', domain: 'gdacs' },
  { sourceId: 'osint-twitter', domain: 'osint' },
];

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

function cloneSource(s: SourceRecord): SourceRecord {
  return { ...s };
}

function cloneFeedback(f: CredibilityFeedback): CredibilityFeedback {
  return { ...f };
}

export function classifyTier(score: number, totalReports: number): CredibilityTier {
  if (totalReports < RATED_MIN_REPORTS) return 'unrated';
  if (score >= TIER_1_FLOOR) return 'tier-1';
  if (score >= TIER_2_FLOOR) return 'tier-2';
  return 'tier-3';
}

function computeScore(confirmCount: number, refuteCount: number): number {
  const denominator = Math.max(confirmCount + refuteCount, 1);
  return Number((confirmCount / denominator).toFixed(4));
}

function emptyByTier(): Record<CredibilityTier, number> {
  return { 'tier-1': 0, 'tier-2': 0, 'tier-3': 0, unrated: 0 };
}

// ── Service ───────────────────────────────────────────────────────────

export class SourceCredibilityTrackerService {
  private sources = new Map<string, SourceRecord>();
  private feedback: CredibilityFeedback[] = [];
  private listeners = new Set<CredibilityListener>();
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: SourceCredibilityTrackerOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Feedback API ───────────────────────────────────────────────────

  recordFeedback(input: FeedbackInput): CredibilityFeedback {
    this.ensureHydrated();
    const now = this.clock();
    this.idSeq += 1;
    const event: CredibilityFeedback = {
      id: `cred-${now.toString(36)}-${this.idSeq}`,
      sourceId: input.sourceId,
      domain: input.domain,
      reportId: input.reportId,
      outcome: input.outcome,
      recordedAt: now,
    };
    const source = this.getOrCreateSource(input.sourceId, input.domain, now);
    this.applyOutcome(source, input.outcome);
    source.totalReports += 1;
    source.lastSeenAt = now;
    source.credibilityScore = computeScore(source.confirmCount, source.refuteCount);
    source.tier = classifyTier(source.credibilityScore, source.totalReports);
    this.feedback.push(event);
    if (this.feedback.length > MAX_FEEDBACK) {
      this.feedback.splice(0, this.feedback.length - MAX_FEEDBACK);
    }
    this.persistSources();
    this.persistFeedback();
    const snapshot = cloneSource(source);
    const eventSnapshot = cloneFeedback(event);
    for (const l of this.listeners) {
      try { l(eventSnapshot, snapshot); } catch { /* isolate */ }
    }
    return cloneFeedback(event);
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getSource(sourceId: string): SourceRecord | null {
    this.ensureHydrated();
    const s = this.sources.get(sourceId);
    return s ? cloneSource(s) : null;
  }

  getAllSources(filter: SourceFilter = {}): SourceRecord[] {
    this.ensureHydrated();
    return [...this.sources.values()]
      .filter((s) => {
        if (filter.domain && s.domain !== filter.domain) return false;
        if (filter.tier && s.tier !== filter.tier) return false;
        return true;
      })
      .sort((a, b) => b.credibilityScore - a.credibilityScore)
      .map((s) => cloneSource(s));
  }

  getWeight(sourceId: string): number {
    this.ensureHydrated();
    const s = this.sources.get(sourceId);
    if (!s) return UNRATED_WEIGHT;
    if (s.tier === 'unrated') return UNRATED_WEIGHT;
    return s.credibilityScore;
  }

  getSummary(): CredibilitySummary {
    this.ensureHydrated();
    const byTier = emptyByTier();
    let scoreSum = 0;
    let scoreCount = 0;
    for (const s of this.sources.values()) {
      byTier[s.tier] += 1;
      if (s.totalReports > 0) {
        scoreSum += s.credibilityScore;
        scoreCount += 1;
      }
    }
    const eligibleForBuckets = [...this.sources.values()]
      .filter((s) => s.totalReports >= SUMMARY_BUCKET_MIN_REPORTS)
      .sort((a, b) => b.credibilityScore - a.credibilityScore);
    const topSources = eligibleForBuckets.slice(0, SUMMARY_BUCKET_SIZE).map((s) => cloneSource(s));
    const tail = eligibleForBuckets.slice(-SUMMARY_BUCKET_SIZE);
    const worstSources: SourceRecord[] = [];
    for (let i = tail.length - 1; i >= 0; i -= 1) worstSources.push(cloneSource(tail[i]!));
    return {
      totalSources: this.sources.size,
      byTier,
      avgScore: scoreCount === 0 ? 0 : Number((scoreSum / scoreCount).toFixed(4)),
      topSources,
      worstSources,
    };
  }

  getFeedback(sourceId?: string, limit?: number): CredibilityFeedback[] {
    this.ensureHydrated();
    const matched = sourceId === undefined
      ? this.feedback
      : this.feedback.filter((f) => f.sourceId === sourceId);
    const ordered: CredibilityFeedback[] = [];
    for (let i = matched.length - 1; i >= 0; i -= 1) ordered.push(matched[i]!);
    const capped = typeof limit === 'number' ? ordered.slice(0, Math.max(0, limit)) : ordered;
    return capped.map((f) => cloneFeedback(f));
  }

  subscribe(listener: CredibilityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unsubscribe(listener: CredibilityListener): void {
    this.listeners.delete(listener);
  }

  /** Test seam — clears state, persisted blobs, and re-seeds the catalog. */
  resetForTesting(): void {
    this.sources.clear();
    this.feedback = [];
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(SOURCES_STORAGE_KEY); } catch { /* ignore */ }
      try { this.storage.removeItem(FEEDBACK_STORAGE_KEY); } catch { /* ignore */ }
    }
    this.seedDefaultSources();
  }

  // ── Internal ───────────────────────────────────────────────────────

  private getOrCreateSource(sourceId: string, domain: string, now: number): SourceRecord {
    const existing = this.sources.get(sourceId);
    if (existing) return existing;
    const fresh: SourceRecord = {
      sourceId, domain,
      confirmCount: 0, refuteCount: 0, neutralCount: 0,
      totalReports: 0,
      credibilityScore: 0,
      tier: 'unrated',
      lastSeenAt: now,
      firstSeenAt: now,
    };
    this.sources.set(sourceId, fresh);
    return fresh;
  }

  private applyOutcome(source: SourceRecord, outcome: CredibilityOutcome): void {
    switch (outcome) {
      case 'confirmed': { source.confirmCount += 1; break; }
      case 'refuted': { source.refuteCount += 1; break; }
      case 'neutral': { source.neutralCount += 1; break; }
    }
  }

  private seedDefaultSources(): void {
    const now = this.clock();
    for (const seed of SEED_SOURCES) {
      if (this.sources.has(seed.sourceId)) continue;
      const seeded: SourceRecord = {
        sourceId: seed.sourceId,
        domain: seed.domain,
        confirmCount: 7,
        refuteCount: 3,
        neutralCount: 0,
        totalReports: 10,
        credibilityScore: 0.7,
        tier: 'tier-2',
        lastSeenAt: now,
        firstSeenAt: now,
      };
      this.sources.set(seeded.sourceId, seeded);
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    this.seedDefaultSources();
    if (!this.storage) return;
    this.hydrateSources();
    this.hydrateFeedback();
  }

  private hydrateSources(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(SOURCES_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: SourceRecord[] | null;
    try { parsed = JSON.parse(raw) as SourceRecord[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!entry || typeof entry.sourceId !== 'string') continue;
      // Re-classify on hydrate so stale tiers don't survive a threshold change.
      const tier = classifyTier(entry.credibilityScore, entry.totalReports);
      this.sources.set(entry.sourceId, { ...entry, tier });
    }
  }

  private hydrateFeedback(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(FEEDBACK_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: CredibilityFeedback[] | null;
    try { parsed = JSON.parse(raw) as CredibilityFeedback[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (entry && typeof entry.id === 'string') this.feedback.push({ ...entry });
    }
  }

  private persistSources(): void {
    if (!this.storage) return;
    const payload = [...this.sources.values()];
    try {
      this.storage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* best effort */ }
  }

  private persistFeedback(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(this.feedback));
    } catch { /* best effort */ }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: SourceCredibilityTrackerService | null = null;

export function getSourceCredibilityTrackerService(): SourceCredibilityTrackerService {
  _singleton ??= new SourceCredibilityTrackerService();
  return _singleton;
}

export function __resetSourceCredibilityTrackerServiceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  SEED_SOURCES,
  TIER_1_FLOOR,
  TIER_2_FLOOR,
  TIER_3_FLOOR,
  RATED_MIN_REPORTS,
  SUMMARY_BUCKET_MIN_REPORTS,
  SUMMARY_BUCKET_SIZE,
  UNRATED_WEIGHT,
  MAX_FEEDBACK,
  computeScore,
};
