/**
 * Experiment Manager — per
 * docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md Layer 2.
 *
 * Pure in-memory store for controlled local experiments (algorithm
 * A/B, threshold comparisons, source weighting tests, etc.). Each
 * experiment carries:
 *   - hypothesis text
 *   - control + candidate versions
 *   - metric ids it tracks
 *   - minimum sample size
 *   - safety-stop conditions (predicate ids the harness checks)
 *   - rolling control/candidate/inconclusive tallies
 *   - lifecycle status
 *
 * Plan invariants:
 *   - No DOM, no fetch, no globals at import time.
 *   - JSON-serializable for the diagnostics export bundle and the
 *     agent handoff bundle.
 *   - Experiments NEVER apply settings on their own — they emit
 *     recommendations that the Policy Engine (Layer 1) evaluates.
 *   - Hard safety stop: when any safety-stop condition fires, the
 *     experiment flips to `stopped` and refuses further outcomes.
 *   - Sample contributions are append-only: re-recording an outcome
 *     for the same caseId throws so calibration data isn't retconned.
 */

// ── Public API ──────────────────────────────────────────────────────────

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'stopped';

export type ExperimentRecommendation =
  | 'promote'
  | 'keep_control'
  | 'continue'
  | 'manual_review';

export type ExperimentOutcomeKind = 'control_win' | 'candidate_win' | 'inconclusive';

export interface ExperimentDefinition {
  id: string;
  hypothesis: string;
  domain: string;
  controlVersion: string;
  candidateVersion: string;
  /** Metric ids this experiment tracks ("hit_rate", "time_to_warn",
   *  "false_positive_rate", "user_acknowledged"). */
  metrics: readonly string[];
  /** Minimum graded outcomes before a recommendation can be emitted. */
  minSamples: number;
  /** Safety-stop condition ids the host wants the harness to check
   *  ("safety_critical_miss", "user_acknowledged_drop", ...). */
  safetyStopConditions: readonly string[];
}

export interface ExperimentOutcomeRecord {
  /** Stable case id (e.g. mission id, alert id). Same case can not
   *  be recorded twice. */
  caseId: string;
  outcome: ExperimentOutcomeKind;
  /** ms timestamp the outcome was determined. */
  at: number;
  /** Optional metric values for this case. */
  metricValues?: Record<string, number>;
  /** Optional free-text notes. */
  notes?: string;
}

export interface ExperimentResult {
  experimentId: string;
  status: ExperimentStatus;
  sampleCount: number;
  controlWins: number;
  candidateWins: number;
  inconclusive: number;
  safetyStops: readonly string[];
  recommendation: ExperimentRecommendation;
  reason: string;
}

export interface ExperimentRecord extends ExperimentDefinition {
  status: ExperimentStatus;
  createdAt: number;
  /** Recorded outcomes in insertion order. */
  outcomes: readonly ExperimentOutcomeRecord[];
  /** Safety-stop condition ids that have actually fired. */
  triggeredSafetyStops: readonly string[];
}

export interface ExperimentManager {
  /** Open an experiment in 'draft' status. Throws on id collision. */
  define: (definition: ExperimentDefinition) => ExperimentRecord;
  /** Move an experiment from draft → running. Throws if not draft. */
  start: (id: string) => ExperimentRecord;
  /** Pause a running experiment. Idempotent. */
  pause: (id: string) => ExperimentRecord;
  /** Resume a paused experiment. */
  resume: (id: string) => ExperimentRecord;
  /** Hard stop on safety-stop firing. Idempotent — repeated calls
   *  with the same condition append once. */
  triggerSafetyStop: (id: string, conditionId: string) => ExperimentRecord;
  /** Append an outcome. Throws when the case is already recorded
   *  (append-only invariant) or when the experiment is stopped. */
  recordOutcome: (id: string, outcome: ExperimentOutcomeRecord) => ExperimentRecord;
  /** Mark an experiment completed (manual close-out). */
  complete: (id: string, reason: string) => ExperimentRecord;
  get: (id: string) => ExperimentRecord | undefined;
  all: () => ExperimentRecord[];
  /** Compute the recommendation snapshot for one experiment. */
  evaluate: (id: string) => ExperimentResult;
  /** Snapshot for the diagnostics export bundle. */
  toJson: () => ExperimentRecord[];
}

// ── Implementation ──────────────────────────────────────────────────────

export interface ExperimentManagerOptions {
  now?: () => number;
}

export function createExperimentManager(options: ExperimentManagerOptions = {}): ExperimentManager {
  const now = options.now ?? (() => Date.now());
  const records = new Map<string, ExperimentRecord>();

  function getOrThrow(id: string): ExperimentRecord {
    const r = records.get(id);
    if (!r) throw new Error(`Experiment "${id}" not registered`);
    return r;
  }

  function setStatus(id: string, status: ExperimentStatus): ExperimentRecord {
    const r = getOrThrow(id);
    if (r.status === 'stopped' && status !== 'stopped') {
      throw new Error(`Experiment "${id}" is stopped and cannot transition to ${status}`);
    }
    const next: ExperimentRecord = { ...r, status };
    records.set(id, next);
    return next;
  }

  return {
    define(definition) {
      if (records.has(definition.id)) {
        throw new Error(`Experiment "${definition.id}" already defined`);
      }
      const record: ExperimentRecord = {
        ...definition,
        status: 'draft',
        createdAt: now(),
        outcomes: [],
        triggeredSafetyStops: [],
      };
      records.set(definition.id, record);
      return record;
    },

    start(id) {
      const r = getOrThrow(id);
      if (r.status !== 'draft' && r.status !== 'paused') {
        throw new Error(`Experiment "${id}" cannot start from ${r.status}`);
      }
      return setStatus(id, 'running');
    },

    pause(id) {
      const r = getOrThrow(id);
      if (r.status === 'paused' || r.status === 'stopped' || r.status === 'completed') return r;
      return setStatus(id, 'paused');
    },

    resume(id) {
      const r = getOrThrow(id);
      if (r.status !== 'paused') throw new Error(`Cannot resume experiment in ${r.status} status`);
      return setStatus(id, 'running');
    },

    triggerSafetyStop(id, conditionId) {
      const r = getOrThrow(id);
      const triggered = r.triggeredSafetyStops.includes(conditionId)
        ? r.triggeredSafetyStops
        : [...r.triggeredSafetyStops, conditionId];
      const next: ExperimentRecord = { ...r, triggeredSafetyStops: triggered, status: 'stopped' };
      records.set(id, next);
      return next;
    },

    recordOutcome(id, outcome) {
      const r = getOrThrow(id);
      if (r.status === 'stopped') throw new Error(`Experiment "${id}" is stopped — refusing new outcomes`);
      if (r.outcomes.some((o) => o.caseId === outcome.caseId)) {
        throw new Error(`Outcome for case "${outcome.caseId}" already recorded — append-only`);
      }
      const next: ExperimentRecord = { ...r, outcomes: [...r.outcomes, outcome] };
      records.set(id, next);
      return next;
    },

    // The reason argument is for the audit-trail caller; the record
    // shape stays JSON-clean and the verdict surfaces in evaluate().
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    complete(id, _reason) {
      const r = getOrThrow(id);
      if (r.status === 'stopped') throw new Error(`Experiment "${id}" is stopped — cannot complete`);
      const next: ExperimentRecord = { ...r, status: 'completed' };
      records.set(id, next);
      return next;
    },

    get(id) {
      return records.get(id);
    },

    all() {
      return [...records.values()].sort((a, b) => a.createdAt - b.createdAt);
    },

    evaluate(id) {
      const r = getOrThrow(id);
      return computeResult(r);
    },

    toJson() {
      return this.all();
    },
  };
}

// ── Recommendation engine ───────────────────────────────────────────────

function computeResult(r: ExperimentRecord): ExperimentResult {
  const controlWins = r.outcomes.filter((o) => o.outcome === 'control_win').length;
  const candidateWins = r.outcomes.filter((o) => o.outcome === 'candidate_win').length;
  const inconclusive = r.outcomes.filter((o) => o.outcome === 'inconclusive').length;
  const sampleCount = r.outcomes.length;

  if (r.triggeredSafetyStops.length > 0) {
    return {
      experimentId: r.id,
      status: 'stopped',
      sampleCount,
      controlWins,
      candidateWins,
      inconclusive,
      safetyStops: r.triggeredSafetyStops,
      recommendation: 'keep_control',
      reason: `Safety-stop fired (${r.triggeredSafetyStops.join(', ')}) — keep the control version, do not promote.`,
    };
  }

  if (sampleCount < r.minSamples) {
    return {
      experimentId: r.id,
      status: r.status,
      sampleCount,
      controlWins,
      candidateWins,
      inconclusive,
      safetyStops: r.triggeredSafetyStops,
      recommendation: 'continue',
      reason: `Need ${r.minSamples - sampleCount} more graded samples (have ${sampleCount}, need ${r.minSamples}).`,
    };
  }

  // Need a clear winner — candidate must beat control by ≥10 % of
  // the sample size. Tie / razor-thin → manual review.
  const margin = candidateWins - controlWins;
  const required = Math.max(2, Math.ceil(sampleCount * 0.1));

  if (margin >= required) {
    return {
      experimentId: r.id,
      status: r.status,
      sampleCount,
      controlWins,
      candidateWins,
      inconclusive,
      safetyStops: r.triggeredSafetyStops,
      recommendation: 'promote',
      reason: `Candidate wins by ${margin} (${candidateWins} vs ${controlWins}, threshold ${required}).`,
    };
  }
  if (-margin >= required) {
    return {
      experimentId: r.id,
      status: r.status,
      sampleCount,
      controlWins,
      candidateWins,
      inconclusive,
      safetyStops: r.triggeredSafetyStops,
      recommendation: 'keep_control',
      reason: `Control wins by ${-margin} (${controlWins} vs ${candidateWins}, threshold ${required}).`,
    };
  }
  return {
    experimentId: r.id,
    status: r.status,
    sampleCount,
    controlWins,
    candidateWins,
    inconclusive,
    safetyStops: r.triggeredSafetyStops,
    recommendation: 'manual_review',
    reason: `Margin ${margin} below required ${required} — request human review.`,
  };
}
