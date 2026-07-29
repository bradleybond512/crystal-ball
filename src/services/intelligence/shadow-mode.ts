/**
 * Shadow-Mode A/B Comparison Service.
 *
 * Lets the team run any intelligence algorithm in "shadow" alongside
 * its live version: register a shadow run, push paired (live, shadow)
 * outputs at the call site, and the service hashes the input, scores
 * a structural divergence between outputs, persists the comparison,
 * and exposes per-run divergence rate.
 *
 * The service never invokes the algorithms itself — it's a passive
 * ledger. Production paths stay authoritative; the shadow output is
 * only inspected by operators reading the panel.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 * Persists runs + comparisons to localStorage under
 * `wm-shadow-mode-runs` + `wm-shadow-mode-comparisons`.
 */

// ── Public types ──────────────────────────────────────────────────────

/** Free-form algorithm id (kept as a documentation alias). The known
 *  intelligence-side ids live in `algo-eval-ledger.ts`; this service
 *  accepts any string so callers can shadow ad-hoc experimental
 *  variants. */
// eslint-disable-next-line sonarjs/redundant-type-aliases
export type ShadowAlgorithmId = string;

export interface ShadowRunConfig {
  id: string;
  algorithmId: ShadowAlgorithmId;
  description: string;
  enabled: boolean;
  createdAt: number;
}

/** ACC-401: stable join fields carried FIRST-CLASS on a comparison so
 *  verdicts join to resolved outcomes exactly — never by approximate
 *  hash or probability proximity. */
export interface ShadowJoinKey {
  targetKey: string;
  predictedAt: number;
  resolveBy: number;
  /** Model identity of the LIVE side (the production forecast). */
  liveModelId?: string;
  liveModelVersion?: string;
  /** Model identity of the SHADOW side (the challenger/baseline). */
  shadowModelId?: string;
  shadowModelVersion?: string;
  /** Feature-set version, when the emitting pipeline defines one. */
  featureSetVersion?: string;
}

export interface ShadowComparison {
  id: string;
  algorithmId: ShadowAlgorithmId;
  runId: string;
  /** SHA-256-free stable hash of the input — JSON.stringify based. */
  inputHash: string;
  /** Present when the producer supplied exact join fields (ACC-401). */
  joinKey?: ShadowJoinKey;
  liveOutput: unknown;
  shadowOutput: unknown;
  /** True when liveOutput and shadowOutput are not structurally equal. */
  diverged: boolean;
  /** 0 when identical, 1 when fully divergent. For object pairs,
   *  fraction of leaf fields that disagree. For primitives, 1 when
   *  unequal else 0. */
  divergenceScore: number;
  timestamp: number;
}

export interface ShadowComparisonFilter {
  runId?: string;
  algorithmId?: ShadowAlgorithmId;
  divergedOnly?: boolean;
}

export interface ShadowStats {
  totalRuns: number;
  enabledRuns: number;
  totalComparisons: number;
  divergedComparisons: number;
  /** 0–1; overall divergence rate across all comparisons. */
  divergenceRate: number;
}

export type ShadowComparisonListener = (comparison: ShadowComparison) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface ShadowModeServiceOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const RUNS_STORAGE_KEY = 'wm-shadow-mode-runs';
export const COMPARISONS_STORAGE_KEY = 'wm-shadow-mode-comparisons';
/** ACC-402: retention is PER RUN so one chatty run cannot evict another
 *  run's promotion evidence (the flip gate needs 200 joined pairs per run;
 *  the previous single global cap of 500 across 6 registered runs could
 *  starve every run below the gate). 300 per run leaves join-loss slack
 *  above the 200-pair gate. */
export const MAX_COMPARISONS_PER_RUN = 300;
/** Hard global ceiling bounding localStorage growth (~250 bytes per
 *  numeric comparison → worst case ≈ 450 KB, reached only when six runs
 *  are all saturated). Binds only if more runs register than
 *  MAX_COMPARISONS_TOTAL / MAX_COMPARISONS_PER_RUN. */
export const MAX_COMPARISONS_TOTAL = 1800;

// ── Helpers ──────────────────────────────────────────────────────────

function safeStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

const FNV_OFFSET = 0x81_1C_9D_C5;
const FNV_PRIME = 0x01_00_01_93;

function alphaSort(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Deterministic stringify so the resulting hash is stable across
 *  JS engines + property-insertion orders. Sorts object keys
 *  recursively. */
function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort(alphaSort);
  const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',');
  return `{${body}}`;
}

/** Lightweight FNV-1a 32-bit hash, hex-encoded. Plenty for ledger
 *  deduplication without pulling crypto.subtle. */
function fnv1aHex(input: string): string {
  let hash = FNV_OFFSET;
  for (const ch of input) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashInput(input: unknown): string {
  return fnv1aHex(stableStringify(input));
}

function deepEqualArrays(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => deepEqual(v, b[i]));
}

function deepEqualObjects(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a).sort(alphaSort);
  const bKeys = Object.keys(b).sort(alphaSort);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k, i) => k === bKeys[i] && deepEqual(a[k], b[k]));
}

/** Structural deep equality. Returns true when the two values are
 *  observationally identical (same shape + same primitives). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return deepEqualArrays(a, b);
  return deepEqualObjects(a as Record<string, unknown>, b as Record<string, unknown>);
}

/** Walk both values together and tally (matchingLeaves,
 *  divergingLeaves). Primitives + nulls count as 1 leaf each. Arrays
 *  index-aligned; extra positions on either side count as diverging.
 *  Returns the divergence fraction in [0, 1]. */
function divergenceScore(live: unknown, shadow: unknown): number {
  const tally = { matched: 0, diverged: 0 };
  walk(live, shadow, tally);
  const total = tally.matched + tally.diverged;
  if (total === 0) return 0;
  return Number((tally.diverged / total).toFixed(4));
}

interface DivergenceTally { matched: number; diverged: number }

function walkArrays(a: unknown[], b: unknown[], tally: DivergenceTally): void {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (i >= a.length || i >= b.length) tally.diverged += 1;
    else walk(a[i], b[i], tally);
  }
}

function walkObjects(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  tally: DivergenceTally,
): void {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const aHas = Object.prototype.hasOwnProperty.call(a, key);
    const bHas = Object.prototype.hasOwnProperty.call(b, key);
    if (!aHas || !bHas) tally.diverged += 1;
    else walk(a[key], b[key], tally);
  }
}

function walk(a: unknown, b: unknown, tally: DivergenceTally): void {
  if (a === b) { tally.matched += 1; return; }
  if (a === null || b === null || typeof a !== typeof b || typeof a !== 'object') {
    tally.diverged += 1;
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { tally.diverged += 1; return; }
  if (Array.isArray(a) && Array.isArray(b)) {
    walkArrays(a, b, tally);
    return;
  }
  walkObjects(a as Record<string, unknown>, b as Record<string, unknown>, tally);
}

// ── Service ──────────────────────────────────────────────────────────

export class ShadowModeAlgorithmService {
  private runs = new Map<string, ShadowRunConfig>();
  private runOrder: string[] = [];
  /** Newest-last; LIFO reads slice from the tail. */
  private comparisons: ShadowComparison[] = [];
  private listeners = new Set<ShadowComparisonListener>();
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: ShadowModeServiceOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Run registry ────────────────────────────────────────────────

  register(config: ShadowRunConfig): ShadowRunConfig {
    this.ensureHydrated();
    const stored: ShadowRunConfig = {
      ...config,
      createdAt: config.createdAt || this.clock(),
    };
    const existing = this.runs.has(stored.id);
    this.runs.set(stored.id, stored);
    if (!existing) this.runOrder.push(stored.id);
    this.persistRuns();
    return { ...stored };
  }

  enable(runId: string): ShadowRunConfig | undefined {
    return this.toggle(runId, true);
  }

  disable(runId: string): ShadowRunConfig | undefined {
    return this.toggle(runId, false);
  }

  private toggle(runId: string, enabled: boolean): ShadowRunConfig | undefined {
    this.ensureHydrated();
    const current = this.runs.get(runId);
    if (!current) return undefined;
    if (current.enabled === enabled) return { ...current };
    const next = { ...current, enabled };
    this.runs.set(runId, next);
    this.persistRuns();
    return { ...next };
  }

  getRun(runId: string): ShadowRunConfig | undefined {
    this.ensureHydrated();
    const r = this.runs.get(runId);
    return r ? { ...r } : undefined;
  }

  getAllRuns(): ShadowRunConfig[] {
    this.ensureHydrated();
    return this.runOrder
      .map((id) => this.runs.get(id))
      .filter((r): r is ShadowRunConfig => r !== undefined)
      .map((r) => ({ ...r }));
  }

  // ── Compare ──────────────────────────────────────────────────────

  compare<T>(
    runId: string,
    input: unknown,
    liveOutput: T,
    shadowOutput: T,
    joinKey?: ShadowJoinKey,
  ): ShadowComparison {
    this.ensureHydrated();
    const run = this.runs.get(runId);
    const now = this.clock();
    const algorithmId = run?.algorithmId ?? runId;
    const diverged = !deepEqual(liveOutput, shadowOutput);
    const score = diverged ? divergenceScore(liveOutput, shadowOutput) : 0;
    const comparison: ShadowComparison = {
      id: this.nextId(now),
      algorithmId,
      runId,
      inputHash: hashInput(input),
      ...(joinKey ? { joinKey: { ...joinKey } } : {}),
      liveOutput,
      shadowOutput,
      diverged,
      divergenceScore: score,
      timestamp: now,
    };
    // Only record when the run exists AND is enabled. If the caller
    // wired things up before registering, we still return the result
    // — but don't pollute the ledger.
    if (run?.enabled) {
      this.comparisons.push(comparison);
      this.enforceCapacity(runId);
      this.persistComparisons();
      this.notify(comparison);
    }
    return cloneComparison(comparison);
  }

  // ── Reads ────────────────────────────────────────────────────────

  /** Newest-first slice. When `runId` is omitted, returns every run's
   *  comparisons interleaved (still newest-first). `limit` caps the
   *  result. */
  getComparisons(filter: ShadowComparisonFilter | string = {}, limit?: number): ShadowComparison[] {
    this.ensureHydrated();
    const f: ShadowComparisonFilter = typeof filter === 'string' ? { runId: filter } : filter;
    const filtered = this.comparisons.filter((c) => {
      if (f.runId && c.runId !== f.runId) return false;
      if (f.algorithmId && c.algorithmId !== f.algorithmId) return false;
      if (f.divergedOnly && !c.diverged) return false;
      return true;
    });
    // Newest-first.
    const reversed: ShadowComparison[] = [];
    for (let i = filtered.length - 1; i >= 0; i -= 1) reversed.push(filtered[i]!);
    const capped = typeof limit === 'number' ? reversed.slice(0, Math.max(0, limit)) : reversed;
    return capped.map((c) => cloneComparison(c));
  }

  getDivergenceRate(runId: string): number {
    this.ensureHydrated();
    const rows = this.comparisons.filter((c) => c.runId === runId);
    if (rows.length === 0) return 0;
    const diverged = rows.filter((c) => c.diverged).length;
    return Number((diverged / rows.length).toFixed(4));
  }

  stats(): ShadowStats {
    this.ensureHydrated();
    const enabledRuns = [...this.runs.values()].filter((r) => r.enabled).length;
    const totalComparisons = this.comparisons.length;
    const divergedComparisons = this.comparisons.filter((c) => c.diverged).length;
    return {
      totalRuns: this.runs.size,
      enabledRuns,
      totalComparisons,
      divergedComparisons,
      divergenceRate: totalComparisons === 0
        ? 0
        : Number((divergedComparisons / totalComparisons).toFixed(4)),
    };
  }

  subscribe(listener: ShadowComparisonListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unsubscribe(listener: ShadowComparisonListener): void {
    this.listeners.delete(listener);
  }

  /** Test seam — clears state + persisted blobs. */
  resetForTesting(): void {
    this.runs.clear();
    this.runOrder = [];
    this.comparisons = [];
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(RUNS_STORAGE_KEY); } catch { /* ignore */ }
      try { this.storage.removeItem(COMPARISONS_STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

  /** Trim the run that just grew past its per-run cap (oldest first),
   *  then enforce the global ceiling across all runs. */
  private enforceCapacity(grownRunId: string): void {
    let runCount = 0;
    for (const c of this.comparisons) {
      if (c.runId === grownRunId) runCount += 1;
    }
    if (runCount > MAX_COMPARISONS_PER_RUN) {
      let toDrop = runCount - MAX_COMPARISONS_PER_RUN;
      this.comparisons = this.comparisons.filter((c) => {
        if (toDrop > 0 && c.runId === grownRunId) {
          toDrop -= 1;
          return false;
        }
        return true;
      });
    }
    if (this.comparisons.length > MAX_COMPARISONS_TOTAL) {
      this.comparisons.splice(0, this.comparisons.length - MAX_COMPARISONS_TOTAL);
    }
  }

  private notify(comparison: ShadowComparison): void {
    const snapshot = cloneComparison(comparison);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* isolate */ }
    }
  }

  private nextId(now: number): string {
    this.idSeq += 1;
    return `cmp-${now.toString(36)}-${this.idSeq}`;
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    this.hydrateRuns();
    this.hydrateComparisons();
  }

  private hydrateRuns(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(RUNS_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as ShadowRunConfig[] | null;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (entry && typeof entry.id === 'string') {
          this.runs.set(entry.id, { ...entry });
          this.runOrder.push(entry.id);
        }
      }
    } catch {
      // corrupt — leave empty
    }
  }

  private hydrateComparisons(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(COMPARISONS_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as ShadowComparison[] | null;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (entry && typeof entry.id === 'string') this.comparisons.push({ ...entry });
      }
      if (this.comparisons.length > MAX_COMPARISONS_TOTAL) {
        this.comparisons.splice(0, this.comparisons.length - MAX_COMPARISONS_TOTAL);
      }
    } catch {
      // corrupt — leave empty
    }
  }

  private persistRuns(): void {
    if (!this.storage) return;
    const payload = this.runOrder
      .map((id) => this.runs.get(id))
      .filter((r): r is ShadowRunConfig => r !== undefined);
    try { this.storage.setItem(RUNS_STORAGE_KEY, JSON.stringify(payload)); } catch { /* best effort */ }
  }

  private persistComparisons(): void {
    if (!this.storage) return;
    try { this.storage.setItem(COMPARISONS_STORAGE_KEY, JSON.stringify(this.comparisons)); } catch { /* best effort */ }
  }
}

function cloneComparison(c: ShadowComparison): ShadowComparison {
  return { ...c };
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: ShadowModeAlgorithmService | null = null;

export function getShadowModeAlgorithmService(): ShadowModeAlgorithmService {
  _singleton ??= new ShadowModeAlgorithmService();
  return _singleton;
}

export function __resetShadowModeAlgorithmServiceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  stableStringify,
  fnv1aHex,
  deepEqual,
  divergenceScore,
  hashInput,
  MAX_COMPARISONS_PER_RUN,
  MAX_COMPARISONS_TOTAL,
};
