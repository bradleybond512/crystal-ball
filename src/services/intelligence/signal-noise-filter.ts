/**
 * SignalNoiseFilter — scores incoming observations on a 0-1 signal/noise
 * spectrum using three weighted factors: source count, corroboration count,
 * and recency. Persists scores to storage under `wm-signal-noise` in a
 * 2000-entry ring map.
 *
 * Singleton pattern mirrors self-improvement-scheduler.ts. Injectable
 * Storage + clock for deterministic unit testing.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface ObservationInput {
  id: string;
  domain: string;
  severity?: string;
  sourceCount?: number;
  corroborationCount?: number;
  ageMs?: number;
}

export interface ScoreFactor {
  name: string;
  weight: number;
  value: number;
}

export interface SignalScore {
  observationId: string;
  signalScore: number;
  noiseScore: number;
  isSignal: boolean;
  confidence: number;
  factors: ScoreFactor[];
}

export interface FilterStats {
  totalScored: number;
  signalCount: number;
  noiseCount: number;
  avgSignalScore: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SignalNoiseFilterOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-signal-noise';
export const MAX_SCORES = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function sourceCountValue(n: number | undefined): number {
  if (n === undefined || n <= 1) return 0.3;
  if (n === 2) return 0.6;
  return 1;
}

function corroborationValue(n: number | undefined): number {
  if (n === undefined || n === 0) return 0.1;
  if (n === 1) return 0.4;
  if (n === 2) return 0.7;
  return 1;
}

function recencyValue(ageMs: number | undefined): number {
  if (ageMs === undefined) return 1;
  if (ageMs < 5 * 60_000) return 1;
  if (ageMs < 30 * 60_000) return 0.7;
  if (ageMs < 2 * 60 * 60_000) return 0.4;
  return 0.1;
}

function isValidScore(item: unknown): item is SignalScore {
  if (!item || typeof item !== 'object') return false;
  const s = item as Record<string, unknown>;
  return typeof s.observationId === 'string'
    && typeof s.signalScore === 'number'
    && typeof s.isSignal === 'boolean';
}

function hydrate(storage: StorageLike | null): Map<string, SignalScore> {
  const map = new Map<string, SignalScore>();
  if (!storage) return map;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return map;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return map;
    for (const item of arr) {
      if (isValidScore(item)) {
        map.set(item.observationId, item as SignalScore);
      }
    }
  } catch { /* ignore */ }
  return map;
}

function persist(storage: StorageLike | null, scores: Map<string, SignalScore>): void {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify([...scores.values()]));
}

// ── Class ─────────────────────────────────────────────────────────────────

export class SignalNoiseFilter {
  private static _instance: SignalNoiseFilter | null = null;

  static getInstance(): SignalNoiseFilter {
    SignalNoiseFilter._instance ??= new SignalNoiseFilter();
    return SignalNoiseFilter._instance;
  }

  static _resetSingletonForTests(): void {
    SignalNoiseFilter._instance = null;
  }

  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly scores: Map<string, SignalScore>;

  constructor(options: SignalNoiseFilterOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.clock = options.now ?? (() => Date.now());
    this.scores = hydrate(this.storage);
    this.enforceCap();
  }

  score(observation: ObservationInput): SignalScore {
    const factors: ScoreFactor[] = [
      { name: 'sourceCount',   weight: 0.3, value: sourceCountValue(observation.sourceCount) },
      { name: 'corroboration', weight: 0.4, value: corroborationValue(observation.corroborationCount) },
      { name: 'recency',       weight: 0.3, value: recencyValue(observation.ageMs) },
    ];

    const raw = factors.reduce((sum, f) => sum + f.weight * f.value, 0);
    const signalScore = Number.parseFloat(raw.toFixed(4));
    const noiseScore = Number.parseFloat((1 - signalScore).toFixed(4));
    const isSignal = signalScore > 0.5;

    const result: SignalScore = {
      observationId: observation.id,
      signalScore,
      noiseScore,
      isSignal,
      confidence: signalScore,
      factors,
    };

    this.scores.set(observation.id, result);
    this.enforceCap();
    persist(this.storage, this.scores);
    return result;
  }

  batchScore(observations: ObservationInput[]): SignalScore[] {
    return observations.map(obs => this.score(obs));
  }

  getStats(): FilterStats {
    const totalScored = this.scores.size;
    let signalCount = 0;
    let sum = 0;
    for (const s of this.scores.values()) {
      if (s.isSignal) signalCount++;
      sum += s.signalScore;
    }
    const noiseCount = totalScored - signalCount;
    const avgSignalScore = totalScored === 0
      ? 0
      : Number.parseFloat((sum / totalScored).toFixed(4));
    return { totalScored, signalCount, noiseCount, avgSignalScore };
  }

  getScore(observationId: string): SignalScore | undefined {
    return this.scores.get(observationId);
  }

  clear(): void {
    this.scores.clear();
    persist(this.storage, this.scores);
  }

  private enforceCap(): void {
    if (this.scores.size <= MAX_SCORES) return;
    const excess = this.scores.size - MAX_SCORES;
    const keys = this.scores.keys();
    for (let i = 0; i < excess; i++) {
      const { value: key } = keys.next();
      if (key !== undefined) this.scores.delete(key);
    }
  }

  /** Exposed for testing only — returns current clock value. */
  _now(): number {
    return this.clock();
  }
}
