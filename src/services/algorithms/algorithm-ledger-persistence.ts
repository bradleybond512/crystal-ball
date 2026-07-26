/**
 * Algorithm Evaluation Ledger persistence — per
 * docs/CLAUDE_ALGORITHM_ACCURACY_ENHANCEMENT_PLAN_2026-05-05.md PR 1.
 *
 * Survives the in-memory `AlgorithmEvaluationLedger` across app restarts
 * by serializing it through `persistent-cache.ts`. Without this layer
 * every restart wipes the calibration evidence the closed-loop self-
 * improvement layer depends on, so health scoring and tunable proposals
 * would always be based on the current process lifetime only.
 *
 * Pure deterministic at the function-call level; side effects live in
 * the injected adapters (`read` / `write` / `emitDiagnostic` / `now`).
 *
 * Plan invariants:
 *   - Corrupt persisted payloads must NOT crash startup. Fail closed:
 *     ignore the payload, leave the in-memory ledger empty, emit a
 *     diagnostic event so the failure is observable.
 *   - Trim policy is deterministic: drop graded records over the age
 *     ceiling first, then drop oldest graded records to fit the count
 *     cap, only fall back to dropping pending records if pending alone
 *     exceeds the cap.
 *   - Persistence status is observable for the diagnostics surface.
 */

import { getDefaultDiagnosticBus } from '../diagnostics/diagnostic-events';
import { registerRecurringLoop } from '../diagnostics/recurring-loops';
// NOTE: Do NOT import getAlgorithmEvaluationLedger at module scope here —
// algorithms-state also imports from this file (resetAlgorithmLedgerPersistence),
// creating a real runtime circular dependency. The lazy getter below breaks the
// cycle while preserving the default-dep convenience. (arch-audit 2026-07-17)
import type {
  AlgorithmDomain,
  AlgorithmEvaluationLedger,
  EvaluationOutcome,
  EvaluationRecord,
} from './algorithm-evaluation-ledger';

// Lazy getter to break the algorithms-state ↔ algorithm-ledger-persistence cycle.
// algorithms-state calls resetAlgorithmLedgerPersistence (this file); this file
// needs getAlgorithmEvaluationLedger (algorithms-state) only as a default
// fallback when callers don't inject deps.ledger. Rather than import
// algorithms-state back (a cycle) or `require()` it (which is undefined in the
// Vite/browser ESM runtime), algorithms-state registers its getter here at load
// via setDefaultLedgerProvider — breaking the static edge while keeping this
// synchronous and browser-safe.
let _defaultLedgerProvider: (() => AlgorithmEvaluationLedger) | null = null;

/** Registered by algorithms-state at module load so getDefaultLedger stays
 *  synchronous without importing algorithms-state back. */
export function setDefaultLedgerProvider(provider: () => AlgorithmEvaluationLedger): void {
  _defaultLedgerProvider = provider;
}

function getDefaultLedger(): AlgorithmEvaluationLedger {
  if (!_defaultLedgerProvider) {
    throw new Error('[algorithm-ledger-persistence] default ledger provider not registered — import algorithms-state or pass deps.ledger');
  }
  return _defaultLedgerProvider();
}

// `persistent-cache.ts` pulls Vite's `import.meta.glob` transitively
// through the runtime/tauri-bridge/i18n chain, which makes a top-level
// import unsafe under plain `tsx --test`. Dynamic-import inside the
// default adapters keeps the unit tests free of that chain — they
// inject their own read/write anyway.
type PersistentCacheModule = typeof import('../persistent-cache');
let cacheModule: Promise<PersistentCacheModule> | undefined;
function loadPersistentCache(): Promise<PersistentCacheModule> {
  cacheModule ??= import('../persistent-cache');
  return cacheModule;
}

// ── Public constants ────────────────────────────────────────────────────

export const ALGORITHM_LEDGER_CACHE_KEY = 'algorithm-evaluation-ledger:v1';
export const DEFAULT_MAX_RECORDS = 2000;
export const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// ── Public types ────────────────────────────────────────────────────────

export type LedgerPersistenceLifecycle = 'idle' | 'ok' | 'error';

export interface AlgorithmLedgerPersistenceStatus {
  lastLoadStatus: LedgerPersistenceLifecycle;
  lastLoadedAt: number | null;
  lastSaveStatus: LedgerPersistenceLifecycle;
  lastSavedAt: number | null;
  /** Records currently held in the in-memory ledger after the last
   *  hydrate / persist / trim pass. */
  recordCount: number;
  /** Total records dropped by the most recent
   *  `trimAndPersistAlgorithmLedger` call. Resets each trim. */
  trimmedCount: number;
  /** Cumulative records dropped due to corrupt-payload rejection across
   *  the lifetime of this process. */
  rejectedCount: number;
  lastError: string | null;
}

export type DiagnosticEmitter = (
  severity: 'info' | 'warning' | 'error' | 'critical',
  message: string,
  detail?: Record<string, unknown>,
) => void;

export interface AlgorithmLedgerPersistenceDeps {
  ledger?: AlgorithmEvaluationLedger;
  /** Read previously persisted records. Returns `null` when nothing is
   *  cached. May throw — `hydrateAlgorithmLedger` will treat any throw
   *  as a corrupt-payload event. */
  read?: (key: string) => Promise<EvaluationRecord[] | null>;
  write?: (key: string, records: EvaluationRecord[]) => Promise<void>;
  emitDiagnostic?: DiagnosticEmitter;
  now?: () => number;
}

export interface TrimAndPersistOptions {
  maxRecords?: number;
  maxAgeMs?: number;
}

export interface AlgorithmLedgerLifecycleDeps extends AlgorithmLedgerPersistenceDeps {
  intervalMs?: number;
  registerLoop?: typeof registerRecurringLoop;
}

// ── Module-level status singleton ───────────────────────────────────────

let status: AlgorithmLedgerPersistenceStatus = freshStatus();

function freshStatus(): AlgorithmLedgerPersistenceStatus {
  return {
    lastLoadStatus: 'idle',
    lastLoadedAt: null,
    lastSaveStatus: 'idle',
    lastSavedAt: null,
    recordCount: 0,
    trimmedCount: 0,
    rejectedCount: 0,
    lastError: null,
  };
}

export function getAlgorithmLedgerPersistenceStatus(): AlgorithmLedgerPersistenceStatus {
  return { ...status };
}

/** Reset module state. Tests use this; app code does not. */
export function resetAlgorithmLedgerPersistence(): void {
  status = freshStatus();
}

export async function startAlgorithmLedgerPersistence(
  deps: AlgorithmLedgerLifecycleDeps = {},
): Promise<AlgorithmLedgerPersistenceStatus> {
  const {
    intervalMs = 60_000,
    registerLoop = registerRecurringLoop,
    ...persistenceDeps
  } = deps;
  const ledger = persistenceDeps.ledger ?? getDefaultLedger();
  const scopedDeps = { ...persistenceDeps, ledger };
  const hydrated = await hydrateAlgorithmLedger(scopedDeps);
  const initial = hydrated.lastLoadStatus === 'ok'
    ? await trimAndPersistAlgorithmLedger({}, scopedDeps)
    : hydrated;

  registerLoop(
    'algorithm-ledger-persistence',
    () => { void trimAndPersistAlgorithmLedger({}, scopedDeps); },
    intervalMs,
    { priority: 'normal' },
  );

  return initial;
}

// ── Hydrate ─────────────────────────────────────────────────────────────

export async function hydrateAlgorithmLedger(
  deps: AlgorithmLedgerPersistenceDeps = {},
): Promise<AlgorithmLedgerPersistenceStatus> {
  const ledger = deps.ledger ?? getDefaultLedger();
  const read = deps.read ?? defaultRead;
  const emit = deps.emitDiagnostic ?? defaultEmit;
  const now = deps.now ?? Date.now;

  let raw: unknown;
  try {
    raw = await read(ALGORITHM_LEDGER_CACHE_KEY);
  } catch (error) {
    return failLoad(error, emit, now);
  }

  if (raw == null) {
    status = {
      ...status,
      lastLoadStatus: 'ok',
      lastLoadedAt: now(),
      recordCount: ledger.all().length,
      lastError: null,
    };
    return getAlgorithmLedgerPersistenceStatus();
  }

  const validated = validateRecords(raw);
  if (!validated.ok) {
    status = {
      ...status,
      lastLoadStatus: 'error',
      lastLoadedAt: now(),
      rejectedCount: status.rejectedCount + (Array.isArray(raw) ? raw.length : 0),
      lastError: validated.reason,
    };
    emit('warning', 'Algorithm ledger persisted payload rejected as corrupt', {
      reason: validated.reason,
      key: ALGORITHM_LEDGER_CACHE_KEY,
    });
    // Fail closed: leave the in-memory ledger as it was (typically empty
    // at boot). Do not let bad persisted state corrupt a clean start.
    return getAlgorithmLedgerPersistenceStatus();
  }

  ledger.loadJson(validated.records);
  status = {
    ...status,
    lastLoadStatus: 'ok',
    lastLoadedAt: now(),
    recordCount: ledger.all().length,
    lastError: null,
  };
  return getAlgorithmLedgerPersistenceStatus();
}

// ── Persist ─────────────────────────────────────────────────────────────

export async function persistAlgorithmLedger(
  deps: AlgorithmLedgerPersistenceDeps = {},
): Promise<AlgorithmLedgerPersistenceStatus> {
  const ledger = deps.ledger ?? getDefaultLedger();
  const write = deps.write ?? defaultWrite;
  const emit = deps.emitDiagnostic ?? defaultEmit;
  const now = deps.now ?? Date.now;

  const records = ledger.toJson();
  try {
    await write(ALGORITHM_LEDGER_CACHE_KEY, records);
  } catch (error) {
    return failSave(error, emit, now, records.length);
  }
  status = {
    ...status,
    lastSaveStatus: 'ok',
    lastSavedAt: now(),
    recordCount: records.length,
    lastError: null,
  };
  return getAlgorithmLedgerPersistenceStatus();
}

// ── Trim + persist ──────────────────────────────────────────────────────

export async function trimAndPersistAlgorithmLedger(
  options: TrimAndPersistOptions = {},
  deps: AlgorithmLedgerPersistenceDeps = {},
): Promise<AlgorithmLedgerPersistenceStatus> {
  const ledger = deps.ledger ?? getDefaultLedger();
  const now = deps.now ?? Date.now;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  const before = ledger.all();
  const kept = applyTrimPolicy(before, { maxRecords, maxAgeMs, nowMs: now() });
  const trimmedCount = before.length - kept.length;

  if (trimmedCount > 0) {
    ledger.loadJson(kept);
  }

  status = { ...status, trimmedCount };
  return persistAlgorithmLedger({ ...deps, ledger });
}

/** Deterministic trim used by `trimAndPersistAlgorithmLedger`. Exposed
 *  for unit tests. Pending (ungraded) records are preserved unless
 *  pending alone exceeds the count cap. */
export function applyTrimPolicy(
  records: readonly EvaluationRecord[],
  options: { maxRecords: number; maxAgeMs: number; nowMs: number },
): EvaluationRecord[] {
  const { maxRecords, maxAgeMs, nowMs } = options;
  const ageCutoff = nowMs - maxAgeMs;

  // Phase A: drop graded records older than the age cutoff. Preserve
  // pending regardless of age — they're awaiting outcome.
  const phaseA = records.filter((r) => {
    if (r.outcome === undefined) return true;
    return r.at >= ageCutoff;
  });

  if (phaseA.length <= maxRecords) {
    return [...phaseA].sort((a, b) => a.at - b.at);
  }

  // Phase B: still over the cap. Drop oldest graded first; only drop
  // pending records if pending alone exceeds the cap.
  const sorted = [...phaseA].sort((a, b) => a.at - b.at);
  const pending = sorted.filter((r) => r.outcome === undefined);
  const graded = sorted.filter((r) => r.outcome !== undefined);

  if (pending.length >= maxRecords) {
    // Pending records alone over the cap — keep newest pending only.
    return pending.slice(pending.length - maxRecords);
  }

  const gradedSlots = maxRecords - pending.length;
  const keptGraded = graded.slice(graded.length - gradedSlots);
  return [...pending, ...keptGraded].sort((a, b) => a.at - b.at);
}

// ── Validation ──────────────────────────────────────────────────────────

interface ValidationOk {
  ok: true;
  records: EvaluationRecord[];
}
interface ValidationFail {
  ok: false;
  reason: string;
}

export function validateRecords(raw: unknown): ValidationOk | ValidationFail {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'payload is not an array' };
  }
  const out: EvaluationRecord[] = [];
  let index = 0;
  for (const item of raw as readonly unknown[]) {
    if (!isEvaluationRecord(item)) {
      return { ok: false, reason: `record at index ${index} failed shape check` };
    }
    out.push(item);
    index += 1;
  }
  return { ok: true, records: out };
}

function isEvaluationRecord(value: unknown): value is EvaluationRecord {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return false;
  if (typeof r.algorithmId !== 'string' || r.algorithmId.length === 0) return false;
  if (!isAlgorithmDomain(r.domain)) return false;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return false;
  if (typeof r.durationMs !== 'number' || !Number.isFinite(r.durationMs)) return false;
  if (r.outcome !== undefined && !isOutcome(r.outcome)) return false;
  if (r.outcomeAt !== undefined && (typeof r.outcomeAt !== 'number' || !Number.isFinite(r.outcomeAt))) return false;
  return true;
}

const DOMAINS: ReadonlySet<AlgorithmDomain> = new Set([
  'truth_score',
  'evidence_graph',
  'situation_clustering',
  'baseline_deviation',
  'compound_risk',
  'forecast_calibration',
  'watchlist_relevance',
  'negative_evidence',
  'shortage_score',
  'weather_polygon',
  'weather_urgency',
  'reasoning_hypothesis',
  'other',
]);

function isAlgorithmDomain(value: unknown): value is AlgorithmDomain {
  return typeof value === 'string' && DOMAINS.has(value as AlgorithmDomain);
}

const OUTCOMES: ReadonlySet<EvaluationOutcome> = new Set(['hit', 'miss', 'partial', 'inconclusive']);
function isOutcome(value: unknown): value is EvaluationOutcome {
  return typeof value === 'string' && OUTCOMES.has(value as EvaluationOutcome);
}

// ── Defaults ────────────────────────────────────────────────────────────

async function defaultRead(key: string): Promise<EvaluationRecord[] | null> {
  const { getPersistentCache } = await loadPersistentCache();
  const envelope = await getPersistentCache<EvaluationRecord[]>(key);
  return envelope ? envelope.data : null;
}

async function defaultWrite(key: string, records: EvaluationRecord[]): Promise<void> {
  const { setPersistentCache } = await loadPersistentCache();
  await setPersistentCache<EvaluationRecord[]>(key, records, 365 * 24 * 60 * 60 * 1000);
}

const defaultEmit: DiagnosticEmitter = (severity, message, detail) => {
  try {
    getDefaultDiagnosticBus().emit({
      severity,
      kind: severity === 'info' ? 'service_success' : 'service_failure',
      serviceId: 'algorithm-ledger-persistence',
      message,
      detail,
    });
  } catch {
    // The diagnostic bus must never crash a persistence call.
  }
};

// ── Failure helpers ─────────────────────────────────────────────────────

function failLoad(
  error: unknown,
  emit: DiagnosticEmitter,
  now: () => number,
): AlgorithmLedgerPersistenceStatus {
  const reason = error instanceof Error ? error.message : String(error);
  status = {
    ...status,
    lastLoadStatus: 'error',
    lastLoadedAt: now(),
    lastError: reason,
  };
  emit('error', 'Algorithm ledger hydrate failed', {
    reason,
    key: ALGORITHM_LEDGER_CACHE_KEY,
  });
  return getAlgorithmLedgerPersistenceStatus();
}

function failSave(
  error: unknown,
  emit: DiagnosticEmitter,
  now: () => number,
  attemptedCount: number,
): AlgorithmLedgerPersistenceStatus {
  const reason = error instanceof Error ? error.message : String(error);
  status = {
    ...status,
    lastSaveStatus: 'error',
    lastSavedAt: now(),
    lastError: reason,
  };
  emit('error', 'Algorithm ledger persist failed', {
    reason,
    attemptedCount,
    key: ALGORITHM_LEDGER_CACHE_KEY,
  });
  return getAlgorithmLedgerPersistenceStatus();
}
