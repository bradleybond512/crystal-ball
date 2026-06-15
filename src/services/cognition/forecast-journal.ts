/**
 * Operator Forecast Journal — PR 10 of the Cognitive Enhancement Plan.
 * docs/COGNITIVE_ENHANCEMENT_PLAN.md, Part C, "PR 10 — Operator Forecast Journal"
 *
 * Lightweight prediction journal: the operator logs their own probability on
 * any hypothesis; it resolves against the same outcome ledger; the journal
 * renders the operator's Brier score and reliability curve **next to the
 * system's** (reusing PR 2's buildCurve verbatim on journal records).
 *
 * Over time the Operator Model (PR 4) learns per-domain humanEdge: domains
 * where the operator demonstrably beats the system get their alerts ranked
 * up — the human and the machine each get weighted by demonstrated skill.
 *
 * Design:
 *   - JournalEntry mirrors PredictionRecord fields so toPredictionRecord()
 *     is a trivial adapter and buildCurve works unchanged.
 *   - Ghost Mode: logForecast() is a complete no-op.
 *   - Persistence: reasoning-memory key crystalball-cognition-journal-v1
 *     plus localStorage mirror with loaded/writtenSinceLoad guards.
 *   - Cap 1000 entries FIFO, resolved-oldest first.
 *   - humanEdge per domain = systemBrier − operatorBrier when n ≥ 30 for
 *     BOTH sides. Positive = human better. Stored on the OperatorModel via
 *     updateHumanEdge(). The ±20% total bound (0.8–1.2) is maintained in
 *     operator-model.interestMultiplier; humanEdge feeds into the same
 *     interestMultiplier path — it is NOT a separate multiplier.
 *
 * Privacy: local-only. All state lives in localStorage (fast read) with IDB
 * reasoning-memory backup. Nothing is ever transmitted or logged externally.
 * State is never attached to any network payload.
 *
 * UI deferred to PR 6 (probability slider on hypothesis detail).
 */

import type { PredictionRecord } from '@/services/intelligence/forecast-calibration';
import type { FactDomain } from '@/services/intelligence/types';
import { buildCurve, MIN_DOMAIN_N } from '@/services/cognition/recalibration';
import type { ReliabilityCurve } from '@/services/cognition/recalibration';
import { getMemory, putMemory } from '@/services/reasoning-memory';
import { isGhostMode } from '@/services/mode-manager';

// ── Types ─────────────────────────────────────────────────────────────────────

export type JournalStatus = 'pending' | 'resolved_true' | 'resolved_false' | 'expired';

/**
 * A single operator forecast entry.
 *
 * Field alignment with PredictionRecord is intentional: toPredictionRecord()
 * is a zero-loss adapter so buildCurve() works unchanged on journal records.
 */
export interface JournalEntry {
  /** Unique id (uuid-style, generated at log time). */
  id: string;
  /** Hypothesis signature (from hypothesis-feedback.signatureFor). */
  signature: string;
  /** Domain (mirrors PredictionRecord.domain). */
  domain: FactDomain;
  /** Human-readable claim text (hypothesis statement). */
  claim: string;
  /** Operator's probability in [0, 1]. */
  p: number;
  /** Unix-ms when the operator logged this forecast. */
  loggedAt: number;
  /** Resolution status. */
  status: JournalStatus;
  /** Unix-ms when this entry was resolved or expired. */
  resolvedAt?: number;
}

/** Comparison of operator vs system calibration for one domain (or global). */
export interface CalibrationComparison {
  domain: FactDomain | 'global';
  operator: {
    brier: number;
    n: number;
    curve: ReliabilityCurve;
  };
  system: {
    brier: number;
    n: number;
    curve: ReliabilityCurve;
  };
  /**
   * Human edge = systemBrier − operatorBrier.
   * Positive means operator beats the system.
   * null when n < MIN_BOTH_SIDES_N for either side.
   */
  humanEdge: number | null;
  explanation: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-cognition-journal-v1';

/** Maximum journal entries; FIFO eviction, resolved-oldest first. */
const MAX_ENTRIES = 1000;

/**
 * Both sides must have at least this many resolved entries before humanEdge
 * is computed. Matches MIN_DOMAIN_N from recalibration so curves are also valid.
 */
const MIN_BOTH_SIDES_N = MIN_DOMAIN_N; // 30

// ── State ─────────────────────────────────────────────────────────────────────

let _entries: JournalEntry[] = [];
let _loaded = false;
let _writtenSinceLoad = false;

// ── Persistence ───────────────────────────────────────────────────────────────

function applyLoaded(arr: JournalEntry[] | null): void {
  if (!Array.isArray(arr)) return;
  _entries = arr;
}

function ensureLoaded(): void {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyLoaded(JSON.parse(raw) as JournalEntry[]);
  } catch { /* ignore */ }
  void getMemory<JournalEntry[]>(STORAGE_KEY).then(arr => {
    if (_writtenSinceLoad) return;
    applyLoaded(arr);
  });
}

function save(): void {
  _writtenSinceLoad = true;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_entries)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, _entries);
}

// ── FIFO eviction ─────────────────────────────────────────────────────────────

/**
 * Enforce the MAX_ENTRIES cap using FIFO with a resolved-oldest-first bias:
 * sort all resolved entries by resolvedAt ascending and evict from that pool
 * before touching pending entries.
 */
function enforceCapIfNeeded(): void {
  if (_entries.length <= MAX_ENTRIES) return;

  const overflow = _entries.length - MAX_ENTRIES;

  // Separate resolved from pending.
  const resolved = _entries
    .filter(e => e.status !== 'pending')
    .sort((a, b) => (a.resolvedAt ?? a.loggedAt) - (b.resolvedAt ?? b.loggedAt));
  const pending = _entries.filter(e => e.status === 'pending');

  // Evict from resolved first.
  const resolvedToKeep = resolved.slice(Math.min(overflow, resolved.length));
  const pendingToEvict = Math.max(0, overflow - resolved.length);
  const pendingToKeep = pending.slice(pendingToEvict); // oldest pending evicted last resort

  _entries = [...resolvedToKeep, ...pendingToKeep];
}

// ── Hypothesis shape the journal needs (minimal interface) ────────────────────

export interface HypothesisLike {
  /** Hypothesis id (passed through to the entry). */
  id: string;
  /** Signature (from hypothesis-feedback.signatureFor). */
  signature: string;
  /** Primary domain. */
  domain: FactDomain;
  /** Statement text used as the claim. */
  statement: string;
}

// ── Simple ID generator (no crypto dependency) ────────────────────────────────

let _idCounter = 0;

function generateId(nowMs: number): string {
  // Deterministic monotonic suffix — no Math.random, so IDs stay reproducible
  // and collision-free even within the same millisecond.
  const r = (_idCounter++).toString(36).padStart(6, '0');
  return `jrnl-${nowMs.toString(36)}-${r}`;
}

// ── PredictionRecord adapter ──────────────────────────────────────────────────

/**
 * Convert a JournalEntry to a PredictionRecord so that PR 2's buildCurve
 * and brierScore functions can operate on journal data without modification.
 *
 * Adapter fidelity guarantee (tested):
 *   - id, domain, claim, probability, status all pass through unchanged.
 *   - loggedAt → predictedAt; resolvedAt passes through.
 *   - sourceId is fixed to 'operator-journal' for curve labelling.
 *   - resolveBy is set to loggedAt + 90 days (generous; expiry managed here).
 */
export function toPredictionRecord(entry: JournalEntry): PredictionRecord {
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  return {
    id: entry.id,
    sourceId: 'operator-journal',
    domain: entry.domain,
    claim: entry.claim,
    probability: entry.p,
    predictedAt: entry.loggedAt,
    resolveBy: entry.loggedAt + NINETY_DAYS_MS,
    status: entry.status,
    resolvedAt: entry.resolvedAt,
  };
}

// ── Public write API ──────────────────────────────────────────────────────────

/**
 * Log an operator forecast for a hypothesis.
 *
 * Ghost Mode: complete no-op (privacy guarantee; Ghost Mode means no learning).
 *
 * @param h   Hypothesis to forecast (id, signature, domain, statement).
 * @param p   Operator probability in [0, 1].
 * @param nowMs  Injectable clock (defaults to Date.now()).
 * @returns The created JournalEntry, or null in Ghost Mode.
 */
export function logForecast(
  h: HypothesisLike,
  p: number,
  nowMs?: number,
): JournalEntry | null {
  if (isGhostMode()) return null;
  ensureLoaded();

  const ts = nowMs ?? Date.now();
  const entry: JournalEntry = {
    id: generateId(ts),
    signature: h.signature,
    domain: h.domain,
    claim: h.statement,
    p: Math.max(0, Math.min(1, p)),
    loggedAt: ts,
    status: 'pending',
  };

  _entries.push(entry);
  enforceCapIfNeeded();
  save();

  return entry;
}

/**
 * Resolve a journal entry when the outcome is known.
 *
 * Follows the same resolution flow as hypothesis-accuracy (truth = materialized,
 * false = fizzled). Finds entries by signature so callers don't need the entry id.
 *
 * @param signature  Hypothesis signature.
 * @param outcome    true = resolved_true, false = resolved_false.
 * @param nowMs      Injectable clock.
 * @returns Number of entries resolved (0 if none found pending).
 */
export function resolveJournalEntry(
  signature: string,
  outcome: boolean,
  nowMs?: number,
): number {
  ensureLoaded();
  const ts = nowMs ?? Date.now();
  let count = 0;
  for (const entry of _entries) {
    if (entry.signature === signature && entry.status === 'pending') {
      entry.status = outcome ? 'resolved_true' : 'resolved_false';
      entry.resolvedAt = ts;
      count += 1;
    }
  }
  if (count > 0) save();
  return count;
}

/**
 * Expire all pending journal entries whose loggedAt is older than maxAgeDays.
 *
 * Called periodically (same pattern as forecast-calibration expirePending).
 *
 * @param maxAgeDays  Default 90 days.
 * @param nowMs       Injectable clock.
 */
export function expireOldJournalEntries(
  maxAgeDays = 90,
  nowMs?: number,
): number {
  ensureLoaded();
  const ts = nowMs ?? Date.now();
  const threshold = ts - maxAgeDays * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const entry of _entries) {
    if (entry.status === 'pending' && entry.loggedAt < threshold) {
      entry.status = 'expired';
      entry.resolvedAt = ts;
      count += 1;
    }
  }
  if (count > 0) save();
  return count;
}

// ── Public read API ───────────────────────────────────────────────────────────

/** Return all journal entries (defensive copy). */
export function getAllJournalEntries(): JournalEntry[] {
  ensureLoaded();
  return [..._entries];
}

/**
 * Build the operator's reliability curve via PR 2's buildCurve.
 *
 * Converts journal entries to PredictionRecords (toPredictionRecord adapter)
 * and passes them verbatim to buildCurve — no reimplementation.
 *
 * @param domain  If provided, builds a per-domain curve; otherwise global.
 */
export function getOperatorCurve(domain?: FactDomain): ReliabilityCurve {
  ensureLoaded();
  const records = _entries.map(e => toPredictionRecord(e));
  return buildCurve(records, domain);
}

/**
 * Compute the operator's overall Brier score.
 *
 * Returns 0 with n=0 when no resolved entries exist.
 */
export function getOperatorBrier(domain?: FactDomain): { brier: number; n: number } {
  ensureLoaded();
  const resolved = _entries.filter(e =>
    (e.status === 'resolved_true' || e.status === 'resolved_false') &&
    (!domain || e.domain === domain),
  );
  if (resolved.length === 0) return { brier: 0, n: 0 };
  let sum = 0;
  for (const e of resolved) {
    const outcome = e.status === 'resolved_true' ? 1 : 0;
    sum += (e.p - outcome) ** 2;
  }
  return { brier: Math.round((sum / resolved.length) * 1000) / 1000, n: resolved.length };
}

// ── System side helper (reads from calibration store) ────────────────────────

/**
 * Get system-side Brier score and curve from the calibration store.
 *
 * Imports are deferred to this function to avoid circular imports:
 * forecast-journal → operator-model → (never) → forecast-journal.
 * The bridge pattern follows episodic-memory-bridge.ts (PR 1).
 */
async function getSystemSide(domain?: FactDomain): Promise<{ brier: number; n: number; curve: ReliabilityCurve }> {
  // Dynamic import breaks the circular dependency at the module graph level.
  const { getCalibrationStore } = await import('@/services/intelligence/forecast-calibration-adapter');
  const { buildCurve: bc } = await import('@/services/cognition/recalibration');
  const store = getCalibrationStore();
  const all = store.all();
  const records = domain ? all.filter(r => r.domain === domain) : all;
  const resolved = records.filter(r => r.status === 'resolved_true' || r.status === 'resolved_false');
  const curve = bc(records, domain);
  if (resolved.length === 0) return { brier: 0, n: 0, curve };
  let sum = 0;
  for (const r of resolved) {
    const outcome = r.status === 'resolved_true' ? 1 : 0;
    sum += (r.probability - outcome) ** 2;
  }
  return {
    brier: Math.round((sum / resolved.length) * 1000) / 1000,
    n: resolved.length,
    curve,
  };
}

/**
 * Get a comparison of operator vs system calibration.
 *
 * humanEdge is computed only when BOTH sides have n ≥ MIN_BOTH_SIDES_N (30)
 * resolved entries in the requested domain (or globally). Positive humanEdge
 * means the operator outperforms the system (lower Brier is better).
 *
 * @param domain  If provided, compare within that domain; otherwise globally.
 */
export async function getComparison(domain?: FactDomain): Promise<CalibrationComparison> {
  ensureLoaded();
  const operatorResult = getOperatorBrier(domain);
  const operatorCurve = getOperatorCurve(domain);
  const system = await getSystemSide(domain);

  const domainLabel: FactDomain | 'global' = domain ?? 'global';
  const bothQualify = operatorResult.n >= MIN_BOTH_SIDES_N && system.n >= MIN_BOTH_SIDES_N;
  const humanEdge = bothQualify
    ? Math.round((system.brier - operatorResult.brier) * 1000) / 1000
    : null;

  let explanation: string;
  if (!bothQualify) {
    const need = MIN_BOTH_SIDES_N;
    explanation =
      `Insufficient data for ${domainLabel} comparison ` +
      `(operator n=${operatorResult.n}, system n=${system.n}; need ≥${need} resolved on both sides)`;
  } else if (humanEdge === null) {
    explanation = 'humanEdge computation deferred';
  } else if (humanEdge > 0) {
    explanation =
      `Operator outperforms system in ${domainLabel}: ` +
      `operator Brier ${operatorResult.brier.toFixed(3)} vs system ${system.brier.toFixed(3)} ` +
      `(humanEdge +${humanEdge.toFixed(3)})`;
  } else if (humanEdge < 0) {
    explanation =
      `System outperforms operator in ${domainLabel}: ` +
      `operator Brier ${operatorResult.brier.toFixed(3)} vs system ${system.brier.toFixed(3)} ` +
      `(humanEdge ${humanEdge.toFixed(3)})`;
  } else {
    explanation =
      `Operator and system are equally calibrated in ${domainLabel}: ` +
      `Brier ${operatorResult.brier.toFixed(3)} each`;
  }

  return {
    domain: domainLabel,
    operator: { brier: operatorResult.brier, n: operatorResult.n, curve: operatorCurve },
    system: { brier: system.brier, n: system.n, curve: system.curve },
    humanEdge,
    explanation,
  };
}

// ── humanEdge → operator-model bridge ────────────────────────────────────────

/**
 * Compute per-domain humanEdge for all domains where both sides qualify
 * (n ≥ MIN_BOTH_SIDES_N) and push the result into the OperatorModel.
 *
 * Called asynchronously after each batch of resolutions; never on the hot path.
 * Follows the episodic-memory-bridge pattern to avoid circular imports.
 *
 * The humanEdge values are stored on OperatorModel.humanEdge (optional field,
 * added additively without breaking the existing interface). The alert-ranking
 * influence of humanEdge is routed through the existing interestMultiplier in
 * operator-model.ts — it is NOT a separate multiplier. The combined bound
 * [0.8, 1.2] is maintained there.
 */
export async function refreshHumanEdge(): Promise<Record<string, number>> {
  if (isGhostMode()) return {};
  ensureLoaded();

  // Collect all domains present in the journal.
  const domains = new Set(_entries.map(e => e.domain));
  const edge: Record<string, number> = {};

  for (const domain of domains) {
    const comparison = await getComparison(domain);
    if (comparison.humanEdge !== null) {
      edge[domain] = comparison.humanEdge;
    }
  }

  // Update the operator model if there is any edge data.
  if (Object.keys(edge).length > 0) {
    const { updateHumanEdge } = await import('@/services/cognition/operator-model');
    updateHumanEdge(edge);
  }

  return edge;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Exposed for tests — directly set journal entries and mark loaded. */
export function _testOnlySetEntries(entries: JournalEntry[]): void {
  _entries = [...entries];
  _loaded = true;
  _writtenSinceLoad = false;
}

/** Exposed for tests — reset module state. */
export function _testOnlyReset(): void {
  _entries = [];
  _loaded = false;
  _writtenSinceLoad = false;
}
