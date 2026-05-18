/**
 * Situation Priority Queue Service — maintains a live ranked list of
 * all active Situations sorted by urgency. Urgency combines severity,
 * recency, confidence, and operator-configured weights so operators
 * get a single "what should I look at next?" view.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * up to 500 entries under `wm-situation-priority-queue`. Defensive
 * deserialise + corrupt-blob recovery + listener crash isolation.
 */

// ── Public types ──────────────────────────────────────────────────────

export interface PriorityWeights {
  severity: number;
  recency: number;
  confidence: number;
  domainWeight: number;
}

export interface PriorityEntry {
  situationId: string;
  domain: string;
  severity: string;
  /** 0..1 — confidence in the underlying assessment. */
  confidence: number;
  /** Epoch ms when the underlying signal was detected. Recency decays
   *  to zero over 24 hours from this point. */
  detectedAt: number;
  /** Weighted urgency 0..1 — higher is more urgent. */
  urgencyScore: number;
  /** 1-based rank within the queue at time of computation. */
  rank: number;
}

export interface PrioritySnapshot {
  entries: PriorityEntry[];
  weights: PriorityWeights;
  computedAt: number;
}

export interface PriorityQueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PriorityQueueListener = (entries: PriorityEntry[]) => void;

export type PriorityUpsert = Omit<PriorityEntry, 'urgencyScore' | 'rank'>;

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-situation-priority-queue';
export const MAX_ENTRIES = 500;
export const RECENCY_WINDOW_MS = 86_400_000; // 24h

export const DEFAULT_WEIGHTS: PriorityWeights = {
  severity: 0.4,
  recency: 0.3,
  confidence: 0.2,
  domainWeight: 0.1,
};

const SEVERITY_SCORE: Record<string, number> = {
  critical: 1,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
  unknown: 0.1,
};

const DOMAIN_SCORE: Record<string, number> = {
  geopolitical: 1,
  biosurv: 0.95,
  earthquake: 0.9,
  cyber: 0.85,
  maritime: 0.8,
  aviation: 0.8,
  weather: 0.7,
  wildfire: 0.7,
};
const DEFAULT_DOMAIN_SCORE = 0.6;

// ── Helpers ───────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

const SEVERITY_UNKNOWN = 0.1;

function severityScore(s: string): number {
  return SEVERITY_SCORE[s] ?? SEVERITY_UNKNOWN;
}

function domainScore(d: string): number {
  return DOMAIN_SCORE[d] ?? DEFAULT_DOMAIN_SCORE;
}

function recencyScore(detectedAt: number, now: number): number {
  const age = now - detectedAt;
  if (!Number.isFinite(age) || age <= 0) return 1;
  return clamp01(1 - age / RECENCY_WINDOW_MS);
}

/** Normalize weights so they sum to 1. If all zero, fall back to defaults. */
function normalizeWeights(w: PriorityWeights): PriorityWeights {
  const total = w.severity + w.recency + w.confidence + w.domainWeight;
  if (total <= 0 || !Number.isFinite(total)) {
    return { ...DEFAULT_WEIGHTS };
  }
  return {
    severity: w.severity / total,
    recency: w.recency / total,
    confidence: w.confidence / total,
    domainWeight: w.domainWeight / total,
  };
}

function computeUrgency(
  entry: PriorityUpsert,
  weights: PriorityWeights,
  now: number,
): number {
  const sev = severityScore(entry.severity);
  const rec = recencyScore(entry.detectedAt, now);
  const conf = clamp01(entry.confidence);
  const dom = domainScore(entry.domain);
  const score =
    sev * weights.severity +
    rec * weights.recency +
    conf * weights.confidence +
    dom * weights.domainWeight;
  return clamp01(score);
}

function isValidEntry(v: unknown): v is PriorityEntry {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.situationId === 'string' &&
    typeof r.domain === 'string' &&
    typeof r.severity === 'string' &&
    typeof r.confidence === 'number' &&
    typeof r.detectedAt === 'number' &&
    typeof r.urgencyScore === 'number' &&
    typeof r.rank === 'number'
  );
}

function isValidWeights(v: unknown): v is PriorityWeights {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.severity === 'number' &&
    typeof r.recency === 'number' &&
    typeof r.confidence === 'number' &&
    typeof r.domainWeight === 'number'
  );
}

// ── Service ───────────────────────────────────────────────────────────

export class SituationPriorityQueueService {
  private entries = new Map<string, PriorityEntry>();
  private weights: PriorityWeights = { ...DEFAULT_WEIGHTS };
  private readonly listeners = new Set<PriorityQueueListener>();
  private readonly storage: PriorityQueueStorage;
  private readonly clock: () => number;

  constructor(storage: PriorityQueueStorage, clock: () => number = () => Date.now()) {
    this.storage = storage;
    this.clock = clock;
    this.hydrate();
  }

  upsert(input: PriorityUpsert): PriorityEntry {
    const now = this.clock();
    const urgencyScore = computeUrgency(input, this.weights, now);
    const entry: PriorityEntry = {
      situationId: input.situationId,
      domain: input.domain,
      severity: input.severity,
      confidence: clamp01(input.confidence),
      detectedAt: input.detectedAt,
      urgencyScore,
      rank: 0,
    };
    this.entries.set(entry.situationId, entry);
    this.enforceRingBuffer();
    this.recomputeRanks();
    this.persist();
    this.notify();
    const final = this.entries.get(entry.situationId);
    return final ? { ...final } : { ...entry };
  }

  remove(situationId: string): boolean {
    if (!this.entries.has(situationId)) return false;
    this.entries.delete(situationId);
    this.recomputeRanks();
    this.persist();
    this.notify();
    return true;
  }

  getQueue(limit?: number): PriorityEntry[] {
    const sorted = this.sortedEntries();
    const sliced = typeof limit === 'number' && limit >= 0 ? sorted.slice(0, limit) : sorted;
    return sliced.map((e) => ({ ...e }));
  }

  getTop(n: number): PriorityEntry[] {
    if (!Number.isFinite(n) || n <= 0) return [];
    return this.getQueue(Math.floor(n));
  }

  setWeights(w: Partial<PriorityWeights>): PriorityWeights {
    const merged: PriorityWeights = {
      severity: w.severity ?? this.weights.severity,
      recency: w.recency ?? this.weights.recency,
      confidence: w.confidence ?? this.weights.confidence,
      domainWeight: w.domainWeight ?? this.weights.domainWeight,
    };
    this.weights = normalizeWeights(merged);
    this.recomputeAllScores();
    this.persist();
    this.notify();
    return { ...this.weights };
  }

  getWeights(): PriorityWeights {
    return { ...this.weights };
  }

  getSnapshot(): PrioritySnapshot {
    return {
      entries: this.getQueue(),
      weights: { ...this.weights },
      computedAt: this.clock(),
    };
  }

  subscribe(cb: PriorityQueueListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ── Internals ───────────────────────────────────────────────────────

  private sortedEntries(): PriorityEntry[] {
    return [...this.entries.values()].sort((a, b) => {
      if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
      // Tie-break on detection recency, then on stable situationId for determinism.
      if (b.detectedAt !== a.detectedAt) return b.detectedAt - a.detectedAt;
      return a.situationId.localeCompare(b.situationId);
    });
  }

  private recomputeRanks(): void {
    const sorted = this.sortedEntries();
    sorted.forEach((entry, idx) => {
      const stored = this.entries.get(entry.situationId);
      if (stored) stored.rank = idx + 1;
    });
  }

  private recomputeAllScores(): void {
    const now = this.clock();
    for (const entry of this.entries.values()) {
      entry.urgencyScore = computeUrgency(entry, this.weights, now);
    }
    this.recomputeRanks();
  }

  private enforceRingBuffer(): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    // Evict the lowest-urgency entries first (those an operator would
    // never look at). Stable tie-break on oldest detectedAt.
    const sorted = [...this.entries.values()].sort((a, b) => {
      if (a.urgencyScore !== b.urgencyScore) return a.urgencyScore - b.urgencyScore;
      return a.detectedAt - b.detectedAt;
    });
    const overflow = this.entries.size - MAX_ENTRIES;
    for (let i = 0; i < overflow; i++) {
      const victim = sorted[i];
      if (victim) this.entries.delete(victim.situationId);
    }
  }

  private hydrate(): void {
    let raw: string | null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      const obj = parsed as Record<string, unknown>;
      if (isValidWeights(obj.weights)) {
        this.weights = normalizeWeights(obj.weights);
      }
      const list = Array.isArray(obj.entries) ? obj.entries : [];
      for (const row of list) {
        if (isValidEntry(row)) this.entries.set(row.situationId, { ...row });
      }
      this.enforceRingBuffer();
      this.recomputeRanks();
    } catch {
      // Corrupt blob — drop it.
      try {
        this.storage.removeItem(STORAGE_KEY);
      } catch {
        /* noop */
      }
    }
  }

  private persist(): void {
    try {
      const payload = JSON.stringify({
        entries: [...this.entries.values()],
        weights: this.weights,
      });
      this.storage.setItem(STORAGE_KEY, payload);
    } catch {
      /* persistence is best-effort */
    }
  }

  private notify(): void {
    const snapshot = this.getQueue();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Crash isolation — one bad listener cannot poison the others.
      }
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let singleton: SituationPriorityQueueService | null = null;

function defaultStorage(): PriorityQueueStorage {
  if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: PriorityQueueStorage }).localStorage) {
    return (globalThis as unknown as { localStorage: PriorityQueueStorage }).localStorage;
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) ?? null : null),
    setItem: (k, v) => {
      mem.set(k, v);
    },
    removeItem: (k) => {
      mem.delete(k);
    },
  };
}

export function getSituationPriorityQueueService(): SituationPriorityQueueService {
  singleton ??= new SituationPriorityQueueService(defaultStorage());
  return singleton;
}

export function __resetSituationPriorityQueueSingleton(): void {
  singleton = null;
}

export const __internals = {
  severityScore,
  domainScore,
  recencyScore,
  computeUrgency,
  normalizeWeights,
  clamp01,
};
