/**
 * SituationLifecycleTrackerService — records every state transition a
 * Situation moves through (detected → escalated → investigated →
 * mitigated → resolved → closed). Computes time-to-escalate,
 * time-to-resolve, and domain-level performance statistics.
 *
 * Pure deterministic; no DOM, no fetch. Injectable `Storage` and
 * `clock` keep tests hermetic.
 */

// ── Public types ─────────────────────────────────────────────────────

export type LifecyclePhase =
  | 'detected'
  | 'escalated'
  | 'investigated'
  | 'mitigated'
  | 'resolved'
  | 'closed';

export interface PhaseTransition {
  id: string;
  situationId: string;
  domain: string;
  fromPhase: LifecyclePhase | null;
  toPhase: LifecyclePhase;
  transitionedAt: number;
  durationInPriorPhase: number | null;
}

export interface SituationLifecycle {
  situationId: string;
  domain: string;
  currentPhase: LifecyclePhase;
  detectedAt: number;
  resolvedAt?: number;
  closedAt?: number;
  transitions: PhaseTransition[];
  totalDurationMs: number | null;
  timeToEscalateMs: number | null;
  timeToResolveMs: number | null;
}

export interface LifecycleStats {
  domain: string;
  avgTimeToEscalateMs: number | null;
  avgTimeToResolveMs: number | null;
  sampleCount: number;
  phaseDistribution: Record<LifecyclePhase, number>;
}

export interface LifecycleFilter {
  domain?: string;
  currentPhase?: LifecyclePhase;
}

export type TransitionListener = (transition: PhaseTransition) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SituationLifecycleTrackerServiceOptions {
  storage?: StorageLike | null;
  now?: () => number;
  maxLifecycles?: number;
  maxTransitions?: number;
}

// ── Constants ────────────────────────────────────────────────────────

export const LIFECYCLES_STORAGE_KEY = 'wm-situation-lifecycles';
export const TRANSITIONS_STORAGE_KEY = 'wm-lifecycle-transitions';
export const MAX_LIFECYCLES = 1000;
export const MAX_TRANSITIONS = 5000;

const ALL_PHASES: LifecyclePhase[] = [
  'detected', 'escalated', 'investigated', 'mitigated', 'resolved', 'closed',
];

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedLifecycles {
  lifecycles: SituationLifecycle[];
}
interface PersistedTransitions {
  transitions: PhaseTransition[];
}

export class SituationLifecycleTrackerService {
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly maxLifecycles: number;
  private readonly maxTransitions: number;
  private readonly lifecycles = new Map<string, SituationLifecycle>();
  private readonly transitions: PhaseTransition[] = [];
  private readonly subscribers = new Set<TransitionListener>();
  private idCounter = 0;

  constructor(opts: SituationLifecycleTrackerServiceOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.maxLifecycles = opts.maxLifecycles ?? MAX_LIFECYCLES;
    this.maxTransitions = opts.maxTransitions ?? MAX_TRANSITIONS;
    this.hydrate();
  }

  recordTransition(situationId: string, domain: string, toPhase: LifecyclePhase): PhaseTransition {
    const transitionedAt = this.clock();
    const lifecycle = this.getOrCreateLifecycle(situationId, domain, toPhase, transitionedAt);

    if (lifecycle.transitions.length > 0 && lifecycle.currentPhase === toPhase) {
      return cloneTransition(lifecycle.transitions[lifecycle.transitions.length - 1]!);
    }

    const transition = this.makeTransition(lifecycle, situationId, domain, toPhase, transitionedAt);
    lifecycle.transitions.push(transition);
    lifecycle.currentPhase = toPhase;
    applyPhaseSideEffects(lifecycle, toPhase, transitionedAt);

    this.transitions.push(transition);
    while (this.transitions.length > this.maxTransitions) this.transitions.shift();
    this.evictLifecyclesIfNeeded();

    this.persist();
    for (const cb of this.subscribers) cb(transition);
    return cloneTransition(transition);
  }

  private getOrCreateLifecycle(
    situationId: string,
    domain: string,
    toPhase: LifecyclePhase,
    transitionedAt: number,
  ): SituationLifecycle {
    const existing = this.lifecycles.get(situationId);
    if (existing) return existing;
    const created: SituationLifecycle = {
      situationId,
      domain,
      currentPhase: toPhase,
      detectedAt: transitionedAt,
      transitions: [],
      totalDurationMs: null,
      timeToEscalateMs: null,
      timeToResolveMs: null,
    };
    this.lifecycles.set(situationId, created);
    return created;
  }

  private makeTransition(
    lifecycle: SituationLifecycle,
    situationId: string,
    domain: string,
    toPhase: LifecyclePhase,
    transitionedAt: number,
  ): PhaseTransition {
    const lastTrans = lifecycle.transitions[lifecycle.transitions.length - 1];
    const fromPhase = lastTrans ? lastTrans.toPhase : null;
    const durationInPriorPhase = lastTrans ? transitionedAt - lastTrans.transitionedAt : null;
    this.idCounter++;
    return {
      id: `pt-${transitionedAt}-${this.idCounter}`,
      situationId,
      domain,
      fromPhase,
      toPhase,
      transitionedAt,
      durationInPriorPhase,
    };
  }

  getLifecycle(situationId: string): SituationLifecycle | null {
    const lc = this.lifecycles.get(situationId);
    return lc ? cloneLifecycle(lc) : null;
  }

  getAll(filter?: LifecycleFilter, limit?: number): SituationLifecycle[] {
    const all = [...this.lifecycles.values()];
    all.sort((a, b) => b.detectedAt - a.detectedAt);
    const filtered = filter ? all.filter((lc) => matchesFilter(lc, filter)) : all;
    const capped = typeof limit === 'number' ? filtered.slice(0, Math.max(0, limit)) : filtered;
    return capped.map((lc) => cloneLifecycle(lc));
  }

  getAllTransitions(): PhaseTransition[] {
    return this.transitions.map((t) => cloneTransition(t));
  }

  getStats(domain?: string): LifecycleStats[] {
    const byDomain = new Map<string, SituationLifecycle[]>();
    for (const lc of this.lifecycles.values()) {
      if (domain && lc.domain !== domain) continue;
      const list = byDomain.get(lc.domain) ?? [];
      list.push(lc);
      byDomain.set(lc.domain, list);
    }
    const out: LifecycleStats[] = [];
    for (const [d, lcs] of byDomain) {
      out.push(buildStatsForDomain(d, lcs));
    }
    out.sort((a, b) => a.domain.localeCompare(b.domain));
    return out;
  }

  subscribe(cb: TransitionListener): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: TransitionListener): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.lifecycles.clear();
    this.transitions.length = 0;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private evictLifecyclesIfNeeded(): void {
    if (this.lifecycles.size <= this.maxLifecycles) return;
    const sorted = [...this.lifecycles.values()].sort((a, b) => a.detectedAt - b.detectedAt);
    while (this.lifecycles.size > this.maxLifecycles) {
      const oldest = sorted.shift();
      if (!oldest) break;
      this.lifecycles.delete(oldest.situationId);
    }
  }

  private hydrate(): void {
    if (!this.storage) return;
    this.hydrateLifecycles();
    this.hydrateTransitions();
  }

  private hydrateLifecycles(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(LIFECYCLES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedLifecycles;
      if (parsed && Array.isArray(parsed.lifecycles)) {
        for (const lc of parsed.lifecycles) this.lifecycles.set(lc.situationId, lc);
      }
    } catch {
      this.lifecycles.clear();
    }
  }

  private hydrateTransitions(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(TRANSITIONS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedTransitions;
        if (parsed && Array.isArray(parsed.transitions)) {
          for (const t of parsed.transitions) this.transitions.push(t);
          while (this.transitions.length > this.maxTransitions) this.transitions.shift();
        }
      }
    } catch {
      this.transitions.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const lcs: PersistedLifecycles = { lifecycles: [...this.lifecycles.values()] };
      this.storage.setItem(LIFECYCLES_STORAGE_KEY, JSON.stringify(lcs));
      const trans: PersistedTransitions = { transitions: this.transitions };
      this.storage.setItem(TRANSITIONS_STORAGE_KEY, JSON.stringify(trans));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: SituationLifecycleTrackerService | undefined;

export function getSituationLifecycleTrackerService(): SituationLifecycleTrackerService {
  singleton ??= new SituationLifecycleTrackerService();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function applyPhaseSideEffects(lifecycle: SituationLifecycle, toPhase: LifecyclePhase, transitionedAt: number): void {
  const elapsed = transitionedAt - lifecycle.detectedAt;
  if (toPhase === 'resolved' && lifecycle.resolvedAt === undefined) {
    lifecycle.resolvedAt = transitionedAt;
    lifecycle.timeToResolveMs = elapsed;
    lifecycle.totalDurationMs = elapsed;
  }
  if (toPhase === 'closed' && lifecycle.closedAt === undefined) {
    lifecycle.closedAt = transitionedAt;
    lifecycle.totalDurationMs ??= elapsed;
  }
  if (toPhase === 'escalated' && lifecycle.timeToEscalateMs === null) {
    lifecycle.timeToEscalateMs = elapsed;
  }
}

function matchesFilter(lc: SituationLifecycle, filter: LifecycleFilter): boolean {
  if (filter.domain && lc.domain !== filter.domain) return false;
  if (filter.currentPhase && lc.currentPhase !== filter.currentPhase) return false;
  return true;
}

function buildStatsForDomain(domain: string, lcs: readonly SituationLifecycle[]): LifecycleStats {
  const phaseDistribution: Record<LifecyclePhase, number> = {
    detected: 0, escalated: 0, investigated: 0, mitigated: 0, resolved: 0, closed: 0,
  };
  let escalateTotal = 0; let escalateCount = 0;
  let resolveTotal = 0; let resolveCount = 0;
  for (const lc of lcs) {
    phaseDistribution[lc.currentPhase] += 1;
    if (lc.timeToEscalateMs !== null) {
      escalateTotal += lc.timeToEscalateMs;
      escalateCount += 1;
    }
    if (lc.timeToResolveMs !== null) {
      resolveTotal += lc.timeToResolveMs;
      resolveCount += 1;
    }
  }
  return {
    domain,
    avgTimeToEscalateMs: escalateCount === 0 ? null : Math.round(escalateTotal / escalateCount),
    avgTimeToResolveMs: resolveCount === 0 ? null : Math.round(resolveTotal / resolveCount),
    sampleCount: lcs.length,
    phaseDistribution,
  };
}

function cloneLifecycle(lc: SituationLifecycle): SituationLifecycle {
  return {
    ...lc,
    transitions: lc.transitions.map((t) => cloneTransition(t)),
  };
}

function cloneTransition(t: PhaseTransition): PhaseTransition {
  return { ...t };
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

export const KNOWN_PHASES: readonly LifecyclePhase[] = ALL_PHASES;
