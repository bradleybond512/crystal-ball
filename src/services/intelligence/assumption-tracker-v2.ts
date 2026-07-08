/**
 * Assumption Tracker (v2) — annotates intelligence model outputs with
 * the assumptions they rely on, records violations when downstream
 * evidence contradicts those assumptions, and rolls the active set
 * into a summary the safety surfaces can act on.
 *
 * Coexists with the v1 service at `assumption-tracker.ts` (which uses
 * a different `Assumption` shape + `wm-assumption-annotations` storage
 * key and is consumed by AssumptionPanel / SafetyCaseDashboard /
 * QualityDebtPanel / model-governance / safety-case). v2 here uses
 * fresh `wm-assumptions` + `wm-assumption-violations` keys so the two
 * services never see each other's data.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Two ring
 * buffers: 2000 assumptions, 500 violations. Defensive deserialise +
 * corrupt-blob recovery + listener crash isolation.
 */

// ── Public types ──────────────────────────────────────────────────────

export type AssumptionStatus = 'active' | 'violated' | 'expired' | 'confirmed';

export type AssumptionConfidence = 'high' | 'medium' | 'low';

export type ViolationSeverity = 'critical' | 'significant' | 'minor';

export interface Assumption {
  id: string;
  label: string;
  rationale: string;
  algorithmId: string;
  outputId: string;
  domain: string;
  confidence: AssumptionConfidence;
  status: AssumptionStatus;
  createdAt: number;
  validatedAt?: number;
  violatedAt?: number;
  expiresAt?: number;
}

export interface AssumptionViolation {
  id: string;
  assumptionId: string;
  evidence: string;
  severity: ViolationSeverity;
  detectedAt: number;
}

export interface AssumptionSummary {
  total: number;
  byStatus: Record<AssumptionStatus, number>;
  byConfidence: Record<AssumptionConfidence, number>;
  recentViolations: AssumptionViolation[];
  /** violations.length / max(total, 1). */
  violationRate: number;
}

export interface AssumptionFilter {
  algorithmId?: string;
  outputId?: string;
  status?: AssumptionStatus;
  domain?: string;
}

export interface AssumptionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type AssumptionListener = (state: {
  assumptions: Assumption[];
  violations: AssumptionViolation[];
}) => void;

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY_ASSUMPTIONS = 'wm-assumptions';
export const STORAGE_KEY_VIOLATIONS = 'wm-assumption-violations';
export const MAX_ASSUMPTIONS = 2000;
export const MAX_VIOLATIONS = 500;
const RECENT_VIOLATIONS_IN_SUMMARY = 10;

/** Assumption statuses that can never transition further — confirm /
 *  violate / expire are no-ops on these. */
const TERMINAL_STATUSES: ReadonlySet<AssumptionStatus> = new Set([
  'violated', 'expired', 'confirmed',
]);

// ── Helpers ──────────────────────────────────────────────────────────

function safeStorage(): AssumptionStorage | null {
  try {
    const ls = (globalThis as { localStorage?: AssumptionStorage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function emptyByStatus(): Record<AssumptionStatus, number> {
  return { active: 0, violated: 0, expired: 0, confirmed: 0 };
}

function emptyByConfidence(): Record<AssumptionConfidence, number> {
  return { high: 0, medium: 0, low: 0 };
}

// ── Service ───────────────────────────────────────────────────────────

export interface AssumptionTrackerServiceOptions {
  clock?: () => number;
  storage?: AssumptionStorage | null;
}

export class AssumptionTrackerService {
  private assumptions: Assumption[] = [];
  private violations: AssumptionViolation[] = [];
  private listeners = new Set<AssumptionListener>();
  private hydrated = false;
  private clock: () => number;
  private storage: AssumptionStorage | null;
  private idCounter = 0;

  constructor(options: AssumptionTrackerServiceOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    // `storage: null` opts out of persistence; default uses
    // localStorage when available, else acts in-memory only.
    this.storage = options.storage === null
      ? null
      : options.storage ?? safeStorage();
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    this.assumptions = this.hydrateKey<Assumption>(STORAGE_KEY_ASSUMPTIONS, asValidAssumption);
    this.violations = this.hydrateKey<AssumptionViolation>(STORAGE_KEY_VIOLATIONS, asValidViolation);
  }

  private hydrateKey<T>(key: string, validator: (entry: unknown) => T | undefined): T[] {
    if (!this.storage) return [];
    let raw: string | null = null;
    try { raw = this.storage.getItem(key); } catch { return []; }
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out: T[] = [];
      for (const entry of parsed) {
        const valid = validator(entry);
        if (valid) out.push(valid);
      }
      return out;
    } catch {
      // Corrupt blob — start clean.
      return [];
    }
  }

  // Coalesces a burst of mutations into one JSON.stringify write on the next
  // microtask (in-memory state stays synchronous); fixes the renderer-hang
  // stringify storm.
  private persistScheduled = false;
  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => { this.persistScheduled = false; this.persist(); });
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY_ASSUMPTIONS, JSON.stringify(this.assumptions));
      this.storage.setItem(STORAGE_KEY_VIOLATIONS, JSON.stringify(this.violations));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.clock().toString(36)}-${this.idCounter}`;
  }

  private notify(): void {
    const snapshot = {
      assumptions: this.assumptions.map((a) => ({ ...a })),
      violations: this.violations.map((v) => ({ ...v })),
    };
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Register a new assumption in `active` status. */
  register(a: Omit<Assumption, 'id' | 'status' | 'createdAt'>): Assumption {
    this.ensureHydrated();
    const stamped: Assumption = {
      ...a,
      id: this.nextId('asm'),
      status: 'active',
      createdAt: this.clock(),
    };
    this.assumptions.push(stamped);
    this.enforceAssumptionCapacity();
    this.schedulePersist();
    this.notify();
    return { ...stamped };
  }

  /** Mark an assumption as `confirmed` — it held up. Stamps
   *  `validatedAt` from the clock. Terminal statuses are not
   *  re-transitioned. */
  confirm(id: string): void {
    this.ensureHydrated();
    const target = this.assumptions.find((a) => a.id === id);
    if (!target || TERMINAL_STATUSES.has(target.status)) return;
    target.status = 'confirmed';
    target.validatedAt = this.clock();
    this.schedulePersist();
    this.notify();
  }

  /** Record a violation against an active assumption: appends an
   *  AssumptionViolation row to the violations ring, transitions the
   *  assumption to `violated`, and stamps `violatedAt`. */
  violate(id: string, evidence: string, severity: ViolationSeverity): void {
    this.ensureHydrated();
    const target = this.assumptions.find((a) => a.id === id);
    if (!target || TERMINAL_STATUSES.has(target.status)) return;
    const now = this.clock();
    target.status = 'violated';
    target.violatedAt = now;
    const violation: AssumptionViolation = {
      id: this.nextId('vio'),
      assumptionId: id,
      evidence,
      severity,
      detectedAt: now,
    };
    this.violations.push(violation);
    this.enforceViolationCapacity();
    this.schedulePersist();
    this.notify();
  }

  /** Sweep `active` assumptions with `expiresAt < before` into the
   *  `expired` status. Persists once after the sweep regardless of
   *  whether anything actually expired. */
  expire(before: number): void {
    this.ensureHydrated();
    let changed = false;
    for (const a of this.assumptions) {
      if (a.status !== 'active') continue;
      if (typeof a.expiresAt !== 'number') continue;
      if (a.expiresAt < before) {
        a.status = 'expired';
        changed = true;
      }
    }
    if (changed) {
      this.schedulePersist();
      this.notify();
    }
  }

  /** Assumptions in LIFO order, optionally narrowed by filter +
   *  limited to the first `limit` matches. */
  getAssumptions(filter?: AssumptionFilter, limit?: number): Assumption[] {
    this.ensureHydrated();
    const matched: Assumption[] = [];
    // Iterate newest-first by walking the stored array in reverse.
    for (let i = this.assumptions.length - 1; i >= 0; i--) {
      const a = this.assumptions[i]!;
      if (filter && !matchesFilter(a, filter)) continue;
      matched.push({ ...a });
      if (limit !== undefined && matched.length >= limit) break;
    }
    return matched;
  }

  /** Violations in LIFO order, optionally narrowed to a single
   *  assumption id + limited. */
  getViolations(assumptionId?: string, limit?: number): AssumptionViolation[] {
    this.ensureHydrated();
    const matched: AssumptionViolation[] = [];
    for (let i = this.violations.length - 1; i >= 0; i--) {
      const v = this.violations[i]!;
      if (assumptionId !== undefined && v.assumptionId !== assumptionId) continue;
      matched.push({ ...v });
      if (limit !== undefined && matched.length >= limit) break;
    }
    return matched;
  }

  /** Aggregate counts + recent-violations slice for the safety panel. */
  getSummary(): AssumptionSummary {
    this.ensureHydrated();
    const byStatus = emptyByStatus();
    const byConfidence = emptyByConfidence();
    for (const a of this.assumptions) {
      byStatus[a.status] += 1;
      byConfidence[a.confidence] += 1;
    }
    const total = this.assumptions.length;
    const recent = this.getViolations(undefined, RECENT_VIOLATIONS_IN_SUMMARY);
    const violationRate = this.violations.length / Math.max(total, 1);
    return { total, byStatus, byConfidence, recentViolations: recent, violationRate };
  }

  subscribe(listener: AssumptionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private enforceAssumptionCapacity(): void {
    if (this.assumptions.length <= MAX_ASSUMPTIONS) return;
    this.assumptions.splice(0, this.assumptions.length - MAX_ASSUMPTIONS);
  }

  private enforceViolationCapacity(): void {
    if (this.violations.length <= MAX_VIOLATIONS) return;
    this.violations.splice(0, this.violations.length - MAX_VIOLATIONS);
  }

  /** Test seam — empties assumptions + violations + listeners + the
   *  persisted blobs. */
  resetForTesting(): void {
    this.assumptions = [];
    this.violations = [];
    this.listeners.clear();
    this.idCounter = 0;
    this.hydrated = true;
    if (this.storage) {
      try { this.storage.removeItem(STORAGE_KEY_ASSUMPTIONS); } catch { /* best effort */ }
      try { this.storage.removeItem(STORAGE_KEY_VIOLATIONS); } catch { /* best effort */ }
    }
  }
}

// ── Filter helper ────────────────────────────────────────────────────

function matchesFilter(a: Assumption, filter: AssumptionFilter): boolean {
  if (filter.algorithmId !== undefined && a.algorithmId !== filter.algorithmId) return false;
  if (filter.outputId !== undefined && a.outputId !== filter.outputId) return false;
  if (filter.status !== undefined && a.status !== filter.status) return false;
  if (filter.domain !== undefined && a.domain !== filter.domain) return false;
  return true;
}

// ── Persistence validators ──────────────────────────────────────────

const VALID_STATUSES: ReadonlySet<string> = new Set(['active', 'violated', 'expired', 'confirmed']);
const VALID_CONFIDENCES: ReadonlySet<string> = new Set(['high', 'medium', 'low']);
const VALID_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'significant', 'minor']);

function asValidAssumption(entry: unknown): Assumption | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as Assumption;
  if (typeof e.id !== 'string' || typeof e.label !== 'string') return undefined;
  if (typeof e.rationale !== 'string' || typeof e.algorithmId !== 'string') return undefined;
  if (typeof e.outputId !== 'string' || typeof e.domain !== 'string') return undefined;
  if (!VALID_CONFIDENCES.has(e.confidence)) return undefined;
  if (!VALID_STATUSES.has(e.status)) return undefined;
  if (typeof e.createdAt !== 'number') return undefined;
  return { ...e };
}

function asValidViolation(entry: unknown): AssumptionViolation | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as AssumptionViolation;
  if (typeof e.id !== 'string' || typeof e.assumptionId !== 'string') return undefined;
  if (typeof e.evidence !== 'string') return undefined;
  if (!VALID_SEVERITIES.has(e.severity)) return undefined;
  if (typeof e.detectedAt !== 'number') return undefined;
  return { ...e };
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: AssumptionTrackerService | null = null;

export function getAssumptionTrackerService(): AssumptionTrackerService {
  _singleton ??= new AssumptionTrackerService();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetAssumptionTrackerServiceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY_ASSUMPTIONS,
  STORAGE_KEY_VIOLATIONS,
  MAX_ASSUMPTIONS,
  MAX_VIOLATIONS,
  RECENT_VIOLATIONS_IN_SUMMARY,
  TERMINAL_STATUSES,
  matchesFilter,
};
