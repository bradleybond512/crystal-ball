// ── Public types ─────────────────────────────────────────────────────────

export interface ProxySignal {
  signalType: string;
  domain: string;
  value: number;    // 0–1 normalized
  weight: number;   // relative weight for inference
  observedAt: number; // ms epoch
}

export type HiddenSystemInferredState = 'stable' | 'stressed' | 'degraded' | 'failed' | 'unknown';

export interface HiddenSystemState {
  id: string;
  systemName: string;
  domain: string;
  inferredState: HiddenSystemInferredState;
  confidence: number;  // 0–1
  proxySignals: ProxySignal[];
  lastInferredAt: number; // ms epoch
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// ── Constants ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-hidden-systems';
const MAX_STATES = 200;

// ── Helpers ───────────────────────────────────────────────────────────────

function nullStorage(): StorageLike {
  return {
    getItem: () => null,
    setItem: () => undefined,
  };
}

function defaultStorage(): StorageLike {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // localStorage may throw in some environments
  }
  return nullStorage();
}

function weightedMean(proxies: ProxySignal[]): number {
  let weightSum = 0;
  let valueSum = 0;
  for (const p of proxies) {
    weightSum += p.weight;
    valueSum += p.value * p.weight;
  }
  return weightSum === 0 ? 0 : valueSum / weightSum;
}

function populationStdDev(proxies: ProxySignal[]): number {
  if (proxies.length === 0) return 0;
  const values = proxies.map((p) => p.value);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function toState(mean: number): HiddenSystemInferredState {
  if (mean < 0.25) return 'stable';
  if (mean < 0.5) return 'stressed';
  if (mean < 0.75) return 'degraded';
  return 'failed';
}

function toId(systemName: string): string {
  return systemName.toLowerCase().replace(/\s+/g, '-');
}

// ── Seed data ─────────────────────────────────────────────────────────────

interface SeedSystem {
  systemName: string;
  domain: string;
  proxies: (Omit<ProxySignal, 'observedAt'> & { offsetMs: number })[];
}

const SEED_SYSTEMS: readonly SeedSystem[] = [
  {
    systemName: 'Global Financial Clearing',
    domain: 'finance',
    proxies: [
      { signalType: 'interbank-spread',       domain: 'finance', value: 0.18, weight: 2.5, offsetMs: 0 },
      { signalType: 'cls-settlement-rate',    domain: 'finance', value: 0.25, weight: 3,   offsetMs: 900_000 },
      { signalType: 'target2-queue-depth',    domain: 'finance', value: 0.35, weight: 2,   offsetMs: 1_800_000 },
      { signalType: 'chips-throughput',       domain: 'finance', value: 0.22, weight: 2.5, offsetMs: 2_700_000 },
    ],
  },
  {
    systemName: 'Undersea Cable Network',
    domain: 'telecommunications',
    proxies: [
      { signalType: 'latency-anomaly-index',    domain: 'telecommunications', value: 0.12, weight: 2,   offsetMs: 0 },
      { signalType: 'rerouting-frequency',      domain: 'telecommunications', value: 0.2,  weight: 1.5, offsetMs: 600_000 },
      { signalType: 'capacity-utilization',     domain: 'telecommunications', value: 0.28, weight: 2.5, offsetMs: 1_200_000 },
      { signalType: 'packet-loss-rate',         domain: 'telecommunications', value: 0.15, weight: 3,   offsetMs: 1_800_000 },
    ],
  },
  {
    systemName: 'Sovereign Debt Rollover',
    domain: 'finance',
    proxies: [
      { signalType: 'auction-cover-ratio',   domain: 'finance', value: 0.4,  weight: 3,   offsetMs: 0 },
      { signalType: 'bid-ask-spread',        domain: 'finance', value: 0.5,  weight: 2,   offsetMs: 900_000 },
      { signalType: 'cds-spread-index',      domain: 'finance', value: 0.42, weight: 2.5, offsetMs: 1_800_000 },
      { signalType: 'maturity-cliff-ratio',  domain: 'finance', value: 0.48, weight: 2,   offsetMs: 2_700_000 },
    ],
  },
  {
    systemName: 'Supply Chain Credit Availability',
    domain: 'trade',
    proxies: [
      { signalType: 'trade-finance-rejection-rate', domain: 'trade', value: 0.38, weight: 2.5, offsetMs: 0 },
      { signalType: 'loc-utilization',              domain: 'trade', value: 0.42, weight: 2,   offsetMs: 900_000 },
      { signalType: 'credit-insurance-claims',      domain: 'trade', value: 0.35, weight: 1.5, offsetMs: 1_800_000 },
      { signalType: 'invoice-discounting-spread',   domain: 'trade', value: 0.45, weight: 2,   offsetMs: 2_700_000 },
    ],
  },
  {
    systemName: 'Dark Fiber Capacity',
    domain: 'telecommunications',
    proxies: [
      { signalType: 'lit-to-dark-ratio',            domain: 'telecommunications', value: 0.1,  weight: 2,   offsetMs: 0 },
      { signalType: 'new-route-provisioning-lag',   domain: 'telecommunications', value: 0.18, weight: 1.5, offsetMs: 600_000 },
      { signalType: 'iru-demand-index',             domain: 'telecommunications', value: 0.15, weight: 2.5, offsetMs: 1_200_000 },
      { signalType: 'wavelength-utilization',       domain: 'telecommunications', value: 0.14, weight: 2,   offsetMs: 1_800_000 },
    ],
  },
  {
    systemName: 'Global Shipping Insurance Pool',
    domain: 'maritime',
    proxies: [
      { signalType: 'claims-frequency-index',     domain: 'maritime', value: 0.52, weight: 3,   offsetMs: 0 },
      { signalType: 'premium-deviation',          domain: 'maritime', value: 0.58, weight: 2.5, offsetMs: 900_000 },
      { signalType: 'war-risk-uplift',            domain: 'maritime', value: 0.6,  weight: 2,   offsetMs: 1_800_000 },
      { signalType: 'reinsurance-capacity-ratio', domain: 'maritime', value: 0.5,  weight: 2,   offsetMs: 2_700_000 },
    ],
  },
];

// ── Service ───────────────────────────────────────────────────────────────

interface PersistedStore {
  states: HiddenSystemState[];
}

export class HiddenSystemModelingService {
  private static instance: HiddenSystemModelingService | undefined;

  private readonly storage: StorageLike;
  private readonly stateMap = new Map<string, HiddenSystemState>();

  private constructor(storage: StorageLike = defaultStorage()) {
    this.storage = storage;
    this.hydrate();
    this.seedIfEmpty();
  }

  static getInstance(): HiddenSystemModelingService {
    HiddenSystemModelingService.instance ??= new HiddenSystemModelingService();
    return HiddenSystemModelingService.instance;
  }

  static createForTesting(storage: StorageLike): HiddenSystemModelingService {
    return new HiddenSystemModelingService(storage);
  }

  infer(systemName: string, domain: string, proxies: ProxySignal[]): HiddenSystemState {
    const id = toId(systemName);
    const now = Date.now();

    if (proxies.length === 0) {
      const state: HiddenSystemState = {
        id,
        systemName,
        domain,
        inferredState: 'unknown',
        confidence: 0,
        proxySignals: [],
        lastInferredAt: now,
      };
      this.store(state);
      return state;
    }

    const mean = weightedMean(proxies);
    const stdDev = populationStdDev(proxies);
    const confidence = Math.max(0, Math.min(1, 1 - stdDev));

    const state: HiddenSystemState = {
      id,
      systemName,
      domain,
      inferredState: toState(mean),
      confidence,
      proxySignals: proxies,
      lastInferredAt: now,
    };

    this.store(state);
    return state;
  }

  getState(systemName: string): HiddenSystemState | undefined {
    return this.stateMap.get(toId(systemName));
  }

  getAllStates(): HiddenSystemState[] {
    return [...this.stateMap.values()].sort((a, b) => a.confidence - b.confidence);
  }

  getStats(): { total: number; byState: Record<string, number>; avgConfidence: number } {
    const all = [...this.stateMap.values()];
    const byState: Record<string, number> = {};
    let confidenceSum = 0;
    for (const s of all) {
      byState[s.inferredState] = (byState[s.inferredState] ?? 0) + 1;
      confidenceSum += s.confidence;
    }
    return {
      total: all.length,
      byState,
      avgConfidence: all.length === 0 ? 0 : confidenceSum / all.length,
    };
  }

  private store(state: HiddenSystemState): void {
    this.stateMap.set(state.id, state);
    this.enforceLimit();
    this.persist();
  }

  private enforceLimit(): void {
    if (this.stateMap.size <= MAX_STATES) return;
    const sorted = [...this.stateMap.values()].sort((a, b) => a.lastInferredAt - b.lastInferredAt);
    const toRemove = sorted.slice(0, this.stateMap.size - MAX_STATES);
    for (const s of toRemove) {
      this.stateMap.delete(s.id);
    }
  }

  private persist(): void {
    const payload: PersistedStore = { states: [...this.stateMap.values()] };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // storage errors are non-fatal
    }
  }

  private hydrate(): void {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedStore;
      if (!Array.isArray(parsed?.states)) return;
      for (const s of parsed.states) {
        if (s && typeof s.id === 'string') {
          this.stateMap.set(s.id, s as HiddenSystemState);
        }
      }
    } catch {
      // corrupt storage — start fresh
    }
  }

  private seedIfEmpty(): void {
    if (this.stateMap.size > 0) return;
    const baseTs = Date.now() - 3_600_000;
    for (const seed of SEED_SYSTEMS) {
      const proxies: ProxySignal[] = seed.proxies.map((p) => ({
        signalType: p.signalType,
        domain: p.domain,
        value: p.value,
        weight: p.weight,
        observedAt: baseTs - p.offsetMs,
      }));
      this.infer(seed.systemName, seed.domain, proxies);
    }
  }
}
