/**
 * CausalAttributionService — traces which upstream signals and domains
 * were causally responsible for a given alert or situation.
 *
 * Weights on incoming candidates are normalized to sum to 1.0, then
 * classified by threshold: >0.4 → direct, 0.15–0.4 → contributing,
 * else → contextual.
 *
 * Pure deterministic; no DOM, no fetch.
 */

// ── Public types ─────────────────────────────────────────────────────

export type CausalType = 'direct' | 'contributing' | 'contextual';
export type TargetType = 'alert' | 'situation';

export interface AttributedCause {
  domain: string;
  observationId?: string;
  description: string;
  weight: number;
  causalType: CausalType;
}

export interface Attribution {
  id: string;
  targetId: string;
  targetType: TargetType;
  causes: AttributedCause[];
  totalWeight: number;
  computedAt: number;
}

export interface AttributionStats {
  total: number;
  avgCausesPerAttribution: number;
  topDomains: { domain: string; count: number }[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CausalAttributionServiceOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-causal-attribution';
const DEFAULT_CAPACITY = 500;

const DIRECT_THRESHOLD = 0.4;
const CONTRIBUTING_THRESHOLD = 0.15;

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedStore {
  attributions: Attribution[];
}

export class CausalAttributionService {
  private static instance: CausalAttributionService | undefined;

  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly attributions: Attribution[] = [];
  private idCounter = 0;

  constructor(opts: CausalAttributionServiceOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  static getInstance(): CausalAttributionService {
    CausalAttributionService.instance ??= new CausalAttributionService();
    return CausalAttributionService.instance;
  }

  static resetForTests(): void {
    CausalAttributionService.instance = undefined;
  }

  attribute(
    targetId: string,
    targetType: TargetType,
    candidates: Omit<AttributedCause, 'causalType'>[],
  ): Attribution {
    const now = this.clock();
    this.idCounter++;
    const id = `ca-${now}-${this.idCounter}`;

    const normalized = normalizeCandidates(candidates);

    const attribution: Attribution = {
      id,
      targetId,
      targetType,
      causes: normalized,
      totalWeight: normalized.reduce((s, c) => s + c.weight, 0),
      computedAt: now,
    };

    // Replace existing attribution for same targetId rather than duplicating
    const existingIdx = this.attributions.findIndex((a) => a.targetId === targetId);
    if (existingIdx !== -1) {
      this.attributions.splice(existingIdx, 1);
    }

    this.attributions.push(attribution);
    while (this.attributions.length > this.capacity) this.attributions.shift();
    this.persist();

    return attribution;
  }

  getAttribution(targetId: string): Attribution | undefined {
    // Return most recent for this targetId
    for (let i = this.attributions.length - 1; i >= 0; i--) {
      if (this.attributions[i]!.targetId === targetId) return this.attributions[i];
    }
    return undefined;
  }

  getByDomain(domain: string): Attribution[] {
    return this.attributions.filter((a) =>
      a.causes.some((c) => c.domain === domain),
    );
  }

  getAll(): Attribution[] {
    return [...this.attributions];
  }

  getStats(): AttributionStats {
    const total = this.attributions.length;
    const avgCausesPerAttribution =
      total === 0
        ? 0
        : Number(
            (
              this.attributions.reduce((s, a) => s + a.causes.length, 0) / total
            ).toFixed(4),
          );

    const domainCount = new Map<string, number>();
    for (const a of this.attributions) {
      for (const c of a.causes) {
        domainCount.set(c.domain, (domainCount.get(c.domain) ?? 0) + 1);
      }
    }

    const topDomains = [...domainCount.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

    return { total, avgCausesPerAttribution, topDomains };
  }

  // ── Internals ─────────────────────────────────────────────────────

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedStore;
      if (!parsed || !Array.isArray(parsed.attributions)) return;
      for (const a of parsed.attributions) this.attributions.push(a);
      while (this.attributions.length > this.capacity) this.attributions.shift();
    } catch {
      this.attributions.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const store: PersistedStore = { attributions: this.attributions };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeCandidates(
  candidates: Omit<AttributedCause, 'causalType'>[],
): AttributedCause[] {
  if (candidates.length === 0) return [];

  const rawSum = candidates.reduce((s, c) => s + Math.max(0, c.weight), 0);

  return candidates.map((c) => {
    const w = rawSum > 0 ? Math.max(0, c.weight) / rawSum : 0;
    return {
      domain: c.domain,
      observationId: c.observationId,
      description: c.description,
      weight: Number(w.toFixed(6)),
      causalType: classifyCausalType(w),
    };
  });
}

function classifyCausalType(normalizedWeight: number): CausalType {
  if (normalizedWeight > DIRECT_THRESHOLD) return 'direct';
  if (normalizedWeight >= CONTRIBUTING_THRESHOLD) return 'contributing';
  return 'contextual';
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
