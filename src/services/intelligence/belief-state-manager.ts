/**
 * BeliefStateManager — probabilistic world model with Bayesian updates.
 *
 * Instead of point estimates, tracks belief distributions over possible
 * world states. Each BeliefState holds a prior probability and is updated
 * via Bayes' theorem as new evidence arrives.
 *
 * Bayesian update: posterior = (prior × likelihood) /
 *   (prior × likelihood + (1−prior) × (1−likelihood))
 *
 * Pure deterministic; no DOM, no fetch.
 */

// ── Public types ─────────────────────────────────────────────────────

export interface BeliefEvidence {
  observationId: string;
  likelihood: number;
  weight: number;
  timestamp: number;
}

export interface BeliefState {
  id: string;
  proposition: string;
  domain: string;
  region?: string;
  priorProbability: number;
  posteriorProbability: number;
  evidence: BeliefEvidence[];
  lastUpdated: number;
  confidence: number;
}

export interface BeliefStateManagerOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// ── Constants ────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-belief-states';
const DEFAULT_CAPACITY = 1000;
const CONFIDENCE_EVIDENCE_SCALE = 10;

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedStore {
  beliefs: BeliefState[];
}

export class BeliefStateManager {
  private static instance: BeliefStateManager | undefined;

  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly beliefs: BeliefState[] = [];
  private idCounter = 0;

  constructor(opts: BeliefStateManagerOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  static getInstance(): BeliefStateManager {
    BeliefStateManager.instance ??= new BeliefStateManager();
    return BeliefStateManager.instance;
  }

  static resetForTests(): void {
    BeliefStateManager.instance = undefined;
  }

  assert(proposition: string, domain: string, priorProbability: number, region?: string): BeliefState {
    const now = this.clock();
    this.idCounter++;
    const id = `bs-${now}-${this.idCounter}`;
    const prior = clamp(priorProbability);

    const belief: BeliefState = {
      id,
      proposition,
      domain,
      region,
      priorProbability: prior,
      posteriorProbability: prior,
      evidence: [],
      lastUpdated: now,
      confidence: 0,
    };

    this.beliefs.push(belief);
    while (this.beliefs.length > this.capacity) this.beliefs.shift();
    this.persist();

    return belief;
  }

  update(id: string, evidence: BeliefEvidence): BeliefState | undefined {
    const belief = this.beliefs.find((b) => b.id === id);
    if (!belief) return undefined;

    const now = this.clock();
    const likelihood = clamp(evidence.likelihood);
    const prior = belief.posteriorProbability;

    const numerator = prior * likelihood;
    const normalizer = numerator + (1 - prior) * (1 - likelihood);

    belief.evidence.push({ ...evidence, likelihood });
    belief.posteriorProbability = normalizer === 0 ? prior : numerator / normalizer;
    belief.confidence = Math.min(belief.evidence.length / CONFIDENCE_EVIDENCE_SCALE, 1);
    belief.lastUpdated = now;

    this.persist();
    return belief;
  }

  query(domain?: string, minProbability?: number): BeliefState[] {
    let results = [...this.beliefs];
    if (domain !== undefined) {
      results = results.filter((b) => b.domain === domain);
    }
    if (minProbability !== undefined) {
      results = results.filter((b) => b.posteriorProbability >= minProbability);
    }
    return results.sort((a, b) => b.posteriorProbability - a.posteriorProbability);
  }

  getMostLikely(domain: string): BeliefState | undefined {
    let best: BeliefState | undefined;
    for (const b of this.beliefs) {
      if (b.domain !== domain) continue;
      if (!best || b.posteriorProbability > best.posteriorProbability) {
        best = b;
      }
    }
    return best;
  }

  getUncertain(threshold = 0.3): BeliefState[] {
    return this.beliefs.filter(
      (b) => Math.abs(b.posteriorProbability - 0.5) < threshold,
    );
  }

  getAll(): BeliefState[] {
    return [...this.beliefs];
  }

  // ── Internals ─────────────────────────────────────────────────────

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedStore;
      if (!parsed || !Array.isArray(parsed.beliefs)) return;
      for (const b of parsed.beliefs) this.beliefs.push(b);
      while (this.beliefs.length > this.capacity) this.beliefs.shift();
    } catch {
      this.beliefs.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const store: PersistedStore = { beliefs: this.beliefs };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
