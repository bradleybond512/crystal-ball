/**
 * Counterfactual Reasoning Service — for each Situation or intelligence
 * assessment, generates "what would have to be true for this to be
 * wrong?" counter-hypotheses. Different from the CompetitiveHypothesis
 * surface (which proposes competing explanations of what IS happening);
 * this asks what conditions would falsify the current leading
 * assessment. Forces analysts to consider disconfirmatory evidence
 * before locking in a conclusion.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * up to 1000 counterfactuals under `wm-counterfactuals` (ring buffer,
 * oldest evicted first). Defensive deserialise + corrupt-blob recovery
 * + listener crash isolation.
 */

// ── Public types ──────────────────────────────────────────────────────

export type CounterfactualType =
  | 'data-quality'
  | 'missing-signal'
  | 'model-bias'
  | 'scope-error'
  | 'timing-error';

export type CounterfactualStatus =
  | 'open'
  | 'investigated'
  | 'refuted'
  | 'confirmed-valid';

export interface Counterfactual {
  id: string;
  situationId: string;
  assessmentId: string;
  /** Domain the counterfactual was generated against. Cached on the
   *  record so the filter UI doesn't need to resolve the Situation. */
  domain: string;
  type: CounterfactualType;
  falsificationCondition: string;
  rationale: string;
  /** 0..1 — analyst confidence that the falsification condition is
   *  plausible enough to investigate. */
  plausibility: number;
  status: CounterfactualStatus;
  createdAt: number;
  resolvedAt?: number;
  resolutionNote?: string;
}

export interface CounterfactualSet {
  situationId: string;
  assessmentId: string;
  counterfactuals: Counterfactual[];
  openCount: number;
  /** Counterfactuals with plausibility >= 0.5. The panel surfaces
   *  these first because they're worth time. */
  highPlausibilityCount: number;
}

export interface CounterfactualFilter {
  status?: CounterfactualStatus;
  domain?: string;
}

export interface CounterfactualSummary {
  total: number;
  open: number;
  highPlausibility: number;
  /** refuted / max(total, 1). */
  refutedRate: number;
}

export interface CounterfactualStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type CounterfactualListener = (counterfactuals: Counterfactual[]) => void;

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-counterfactuals';
export const MAX_COUNTERFACTUALS = 1000;
export const HIGH_PLAUSIBILITY_THRESHOLD = 0.5;

const TERMINAL_STATUSES: ReadonlySet<CounterfactualStatus> = new Set(['refuted', 'confirmed-valid']);

/** Initial plausibility per type — set at generation time. */
const INITIAL_PLAUSIBILITY: Record<CounterfactualType, number> = {
  'data-quality': 0.3,
  'missing-signal': 0.4,
  'model-bias': 0.2,
  // The two manual-only types use neutral defaults; the spec doesn't
  // emit them automatically but reserves them for ad-hoc registration
  // in a future PR.
  'scope-error': 0.3,
  'timing-error': 0.3,
};

/** Domain-specific model-bias templates. The generic fallback handles
 *  every unrecognised domain. */
const MODEL_BIAS_TEMPLATES: Record<string, string> = {
  earthquake: 'over-weights magnitude vs depth + population proximity',
  weather: 'over-weights wind speed vs precipitation accumulation',
  maritime: 'over-weights vessel count vs chokepoint proximity',
  cyber: 'over-weights CVSS vs exploitability + reach',
  biosurveillance: 'over-weights case-count growth vs reporting-delay artefacts',
  geopolitical: 'over-weights public rhetoric vs material posture',
  aviation: 'over-weights affected-flights count vs airport category',
  'space-weather': 'over-weights Kp index vs solar-event class + impact path',
};

const GENERIC_MODEL_BIAS = 'over-weights the dominant input feature relative to its real-world coupling';

// Data-quality + missing-signal templates are domain-agnostic for now;
// the rationale carries the assessment's claim verbatim so the analyst
// sees the specific framing the counterfactual is challenging.

// ── Storage helper ────────────────────────────────────────────────────

function safeStorage(): CounterfactualStorage | null {
  try {
    const ls = (globalThis as { localStorage?: CounterfactualStorage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Generation templates ──────────────────────────────────────────────

interface DraftTemplate {
  type: CounterfactualType;
  falsificationCondition: (domain: string) => string;
  rationale: (claim: string, domain: string) => string;
}

const GENERATION_TEMPLATES: readonly DraftTemplate[] = [
  {
    type: 'data-quality',
    falsificationCondition: (domain) =>
      `The ${domain} sensor / feed data backing this assessment is corrupted, delayed, or partially missing.`,
    rationale: (claim) =>
      `If the underlying observations are bad, the claim "${claim}" rests on signal that didn't actually happen — refuting this counterfactual requires showing the feeds are healthy at the assessment time.`,
  },
  {
    type: 'missing-signal',
    falsificationCondition: (domain) =>
      `A key ${domain} indicator that would invalidate the leading interpretation hasn't been observed yet.`,
    rationale: (claim) =>
      `If a confirming or disconfirming signal is in flight but not yet ingested, the claim "${claim}" may be premature — refuting this counterfactual requires showing the expected indicator chain is complete.`,
  },
  {
    type: 'model-bias',
    falsificationCondition: (domain) =>
      `The scoring model ${MODEL_BIAS_TEMPLATES[domain] ?? GENERIC_MODEL_BIAS}, biasing it toward the current conclusion.`,
    rationale: (claim) =>
      `Even with clean data, a structural bias in the scorer can drive the claim "${claim}" — refuting this counterfactual requires showing the bias is bounded or the conclusion survives without the suspect weighting.`,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function matchesFilter(c: Counterfactual, filter?: CounterfactualFilter): boolean {
  if (!filter) return true;
  if (filter.status !== undefined && c.status !== filter.status) return false;
  if (filter.domain !== undefined && c.domain !== filter.domain) return false;
  return true;
}

function buildSet(assessmentId: string, counterfactuals: readonly Counterfactual[]): CounterfactualSet {
  // Defensive — caller always passes counterfactuals for a single
  // assessmentId, but we guard against drift.
  const filtered = counterfactuals.filter((c) => c.assessmentId === assessmentId);
  const situationId = filtered[0]?.situationId ?? '';
  let openCount = 0;
  let highPlausibilityCount = 0;
  for (const c of filtered) {
    if (c.status === 'open') openCount += 1;
    if (c.plausibility >= HIGH_PLAUSIBILITY_THRESHOLD) highPlausibilityCount += 1;
  }
  return {
    situationId,
    assessmentId,
    counterfactuals: filtered.map((c) => ({ ...c })),
    openCount,
    highPlausibilityCount,
  };
}

// ── Service ───────────────────────────────────────────────────────────

export interface CounterfactualReasoningServiceOptions {
  clock?: () => number;
  storage?: CounterfactualStorage | null;
}

export class CounterfactualReasoningService {
  private counterfactuals: Counterfactual[] = [];
  private listeners = new Set<CounterfactualListener>();
  private hydrated = false;
  private clock: () => number;
  private storage: CounterfactualStorage | null;
  private idCounter = 0;

  constructor(options: CounterfactualReasoningServiceOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.storage = options.storage === null
      ? null
      : options.storage ?? safeStorage();
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const out: Counterfactual[] = [];
      for (const entry of parsed) {
        const valid = asValidCounterfactual(entry);
        if (valid) out.push(valid);
      }
      this.counterfactuals = out;
    } catch {
      // Corrupt blob — start clean.
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
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.counterfactuals));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private nextId(now: number): string {
    this.idCounter += 1;
    return `cf-${now.toString(36)}-${this.idCounter}`;
  }

  private notify(): void {
    const snapshot = this.counterfactuals.map((c) => ({ ...c }));
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Generate counterfactuals against a leading assessment. Emits one
   *  draft per built-in template (data-quality, missing-signal,
   *  model-bias) = 3 per call. Idempotent by assessmentId — calling
   *  twice on the same id returns the existing set unchanged. */
  generate(
    situationId: string,
    assessmentId: string,
    domain: string,
    claim: string,
  ): CounterfactualSet {
    this.ensureHydrated();
    const existing = this.counterfactuals.filter((c) => c.assessmentId === assessmentId);
    if (existing.length > 0) return buildSet(assessmentId, existing);

    const now = this.clock();
    const fresh: Counterfactual[] = GENERATION_TEMPLATES.map((tmpl) => ({
      id: this.nextId(now),
      situationId,
      assessmentId,
      domain,
      type: tmpl.type,
      falsificationCondition: tmpl.falsificationCondition(domain),
      rationale: tmpl.rationale(claim, domain),
      plausibility: INITIAL_PLAUSIBILITY[tmpl.type],
      status: 'open',
      createdAt: now,
    }));
    this.counterfactuals.push(...fresh);
    this.enforceCapacity();
    this.schedulePersist();
    this.notify();
    return buildSet(assessmentId, fresh);
  }

  /** Move an open counterfactual to investigated. No-op on terminal
   *  statuses. */
  investigate(id: string): void {
    this.ensureHydrated();
    const target = this.counterfactuals.find((c) => c.id === id);
    if (target?.status !== 'open') return;
    target.status = 'investigated';
    this.schedulePersist();
    this.notify();
  }

  /** Mark a non-terminal counterfactual as refuted with a note. */
  refute(id: string, note: string): void {
    this.transitionTerminal(id, 'refuted', note);
  }

  /** Mark a non-terminal counterfactual as confirmed-valid (the
   *  falsification condition IS a real concern) with a note. */
  confirm(id: string, note: string): void {
    this.transitionTerminal(id, 'confirmed-valid', note);
  }

  private transitionTerminal(
    id: string,
    status: 'refuted' | 'confirmed-valid',
    note: string,
  ): void {
    this.ensureHydrated();
    const target = this.counterfactuals.find((c) => c.id === id);
    if (!target || TERMINAL_STATUSES.has(target.status)) return;
    target.status = status;
    target.resolvedAt = this.clock();
    target.resolutionNote = note;
    this.schedulePersist();
    this.notify();
  }

  /** Adjust plausibility by a signed delta. Clamps the result to [0, 1]. */
  updatePlausibility(id: string, delta: number): void {
    this.ensureHydrated();
    const target = this.counterfactuals.find((c) => c.id === id);
    if (!target) return;
    target.plausibility = clamp01(target.plausibility + delta);
    this.schedulePersist();
    this.notify();
  }

  /** Set for one assessment, or null if no counterfactuals exist. */
  getSet(assessmentId: string): CounterfactualSet | null {
    this.ensureHydrated();
    const matching = this.counterfactuals.filter((c) => c.assessmentId === assessmentId);
    if (matching.length === 0) return null;
    return buildSet(assessmentId, matching);
  }

  /** All counterfactuals in LIFO order, optionally narrowed by filter
   *  and limited. */
  getAll(filter?: CounterfactualFilter, limit?: number): Counterfactual[] {
    this.ensureHydrated();
    const out: Counterfactual[] = [];
    for (let i = this.counterfactuals.length - 1; i >= 0; i--) {
      const c = this.counterfactuals[i]!;
      if (!matchesFilter(c, filter)) continue;
      out.push({ ...c });
      if (limit !== undefined && out.length >= limit) break;
    }
    return out;
  }

  /** Aggregate stats for the panel header. */
  getSummary(): CounterfactualSummary {
    this.ensureHydrated();
    let open = 0;
    let highPlausibility = 0;
    let refuted = 0;
    for (const c of this.counterfactuals) {
      if (c.status === 'open') open += 1;
      if (c.plausibility >= HIGH_PLAUSIBILITY_THRESHOLD) highPlausibility += 1;
      if (c.status === 'refuted') refuted += 1;
    }
    const total = this.counterfactuals.length;
    return {
      total,
      open,
      highPlausibility,
      refutedRate: refuted / Math.max(total, 1),
    };
  }

  subscribe(listener: CounterfactualListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private enforceCapacity(): void {
    if (this.counterfactuals.length <= MAX_COUNTERFACTUALS) return;
    this.counterfactuals.splice(0, this.counterfactuals.length - MAX_COUNTERFACTUALS);
  }

  /** Test seam — empties counterfactuals + listeners + persisted blob. */
  resetForTesting(): void {
    this.counterfactuals = [];
    this.listeners.clear();
    this.idCounter = 0;
    this.hydrated = true;
    if (this.storage) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

// ── Persistence validators ──────────────────────────────────────────

const VALID_TYPES: ReadonlySet<string> = new Set([
  'data-quality', 'missing-signal', 'model-bias', 'scope-error', 'timing-error',
]);
const VALID_STATUSES: ReadonlySet<string> = new Set([
  'open', 'investigated', 'refuted', 'confirmed-valid',
]);

function asValidCounterfactual(entry: unknown): Counterfactual | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as Counterfactual;
  if (typeof e.id !== 'string' || typeof e.situationId !== 'string') return undefined;
  if (typeof e.assessmentId !== 'string' || typeof e.domain !== 'string') return undefined;
  if (!VALID_TYPES.has(e.type) || !VALID_STATUSES.has(e.status)) return undefined;
  if (typeof e.falsificationCondition !== 'string' || typeof e.rationale !== 'string') return undefined;
  if (typeof e.plausibility !== 'number' || typeof e.createdAt !== 'number') return undefined;
  return { ...e };
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: CounterfactualReasoningService | null = null;

export function getCounterfactualReasoningService(): CounterfactualReasoningService {
  _singleton ??= new CounterfactualReasoningService();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetCounterfactualReasoningSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY,
  MAX_COUNTERFACTUALS,
  HIGH_PLAUSIBILITY_THRESHOLD,
  TERMINAL_STATUSES,
  INITIAL_PLAUSIBILITY,
  MODEL_BIAS_TEMPLATES,
  GENERIC_MODEL_BIAS,
  GENERATION_TEMPLATES,
  clamp01,
  matchesFilter,
};
