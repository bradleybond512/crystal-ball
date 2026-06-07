/**
 * Tuning Decision Log — B3 (observability) of the self-improvement gameplan.
 *
 * The tuning-apply runner makes a decision per proposed parameter change:
 * it either auto-applies (gate said `allow_auto`) or holds the change for
 * user approval / denial. Those decisions previously survived only as a
 * transient `console.warn` on apply — held proposals left no trace at all.
 *
 * This module is the durable audit trail: a small persisted ring of the
 * loop's decisions so the user (and the AlgorithmDiagnosticPanel) can SEE
 * what the tuner proposed, what it changed, and — crucially — what it held
 * back and why. It is pure data: no scoring, no policy logic. The runner
 * appends; readers render.
 *
 * Persisted to localStorage (`crystalball-tuning-decisions-v1`), newest
 * first, capped at MAX_DECISIONS. Storage failures degrade silently to an
 * in-process no-op — an audit log must never break the tuning pass.
 */

export type TuningDecisionKind = 'applied' | 'held_for_approval';

export interface TuningDecision {
  /** ms timestamp the decision was recorded. */
  at: number;
  algorithmId: string;
  parameterId: string;
  /** Value before the proposed change. */
  priorValue: number;
  /** Value the proposal wanted to move to. */
  nextValue: number;
  /** Whether the change was applied or held for approval. */
  kind: TuningDecisionKind;
  /** Policy-gate rule id that drove the verdict (stable, auditable). */
  ruleId: string;
  /** Plain-English rationale from the policy gate. */
  reason: string;
}

const STORAGE_KEY = 'crystalball-tuning-decisions-v1';
const MAX_DECISIONS = 100;

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isDecision(value: unknown): value is TuningDecision {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.at === 'number'
    && typeof d.algorithmId === 'string'
    && typeof d.parameterId === 'string'
    && typeof d.priorValue === 'number'
    && typeof d.nextValue === 'number'
    && (d.kind === 'applied' || d.kind === 'held_for_approval')
    && typeof d.ruleId === 'string'
    && typeof d.reason === 'string'
  );
}

function load(): TuningDecision[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => isDecision(e)) : [];
  } catch {
    return [];
  }
}

function save(decisions: readonly TuningDecision[]): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(decisions.slice(0, MAX_DECISIONS)));
  } catch {
    /* storage unavailable — the audit log degrades to no-op, never throws */
  }
}

/** Append a decision to the front of the log (newest first), capped. */
export function recordTuningDecision(decision: TuningDecision): void {
  const next = [decision, ...load()].slice(0, MAX_DECISIONS);
  save(next);
}

/** All recorded decisions, newest first. */
export function getTuningDecisions(): TuningDecision[] {
  return load();
}

/** Test/diagnostic helper: clear the log. */
export function _resetTuningDecisionsForTests(): void {
  save([]);
}
