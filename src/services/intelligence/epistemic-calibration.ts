/**
 * Epistemic calibration loop (Phase 4B PR 3) — closes the feedback loop
 * between the epistemic services (meta-confidence, counterfactual
 * reasoning, bias detection) and the rest of the system.
 *
 * Three closures:
 *   A. Meta-confidence outcome grading — when a situation resolves, the
 *      meta-confidence estimate that was made for it is graded against
 *      the actual outcome and logged to the algorithm evaluation ledger,
 *      so the tuning loop can score the estimator over time.
 *   B. Counterfactual → assumption tracker — an analyst-validated
 *      (confirmed) counterfactual is registered as a short-lived (48h)
 *      critical lifecycle assumption so it surfaces in the
 *      assumption-lifecycle panel.
 *   C. (Lives in meta-confidence.ts) an unacknowledged high-severity bias
 *      detection damps the raw meta-confidence estimate.
 *
 * Pure with respect to the algorithm/intelligence modules — every
 * collaborator is injectable so tests stay hermetic. No DOM, no fetch.
 */

import {
  getMetaConfidenceService,
  type MetaConfidenceService,
} from './meta-confidence';
import {
  getAssumptionTrackerService,
  type Assumption,
  type AssumptionTrackerService,
} from './assumption-tracker-v2';
import {
  getSituationLifecycleTrackerService,
  type LifecyclePhase,
  type PhaseTransition,
  type SituationLifecycleTrackerService,
} from './situation-lifecycle-tracker';
import {
  recordAlgorithmEvaluation,
  recordAlgorithmOutcome,
} from '../algorithms/record-evaluation';
import type { EvaluationOutcome } from '../algorithms/algorithm-evaluation-ledger';
import {
  getAlgorithm,
  registerAlgorithm,
  type AlgorithmDefinition,
} from '../algorithms/algorithm-registry';

// ── Helpers ──────────────────────────────────────────────────────────

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// ── Algorithm-registry seam ──────────────────────────────────────────
//
// The tuning loop refuses to log evaluations for an unregistered id
// (record-evaluation throws UnknownAlgorithmError). The epistemic-bridge
// producer (PR 1) registers `meta-confidence`, but this PR must stand on
// its own — so we register it lazily and idempotently on first grade.
// Guarded by getAlgorithm so it never collides once PR 1 lands.

export const META_CONFIDENCE_ALGORITHM_ID = 'meta-confidence';

const META_CONFIDENCE_DEFINITION: AlgorithmDefinition = {
  id: META_CONFIDENCE_ALGORITHM_ID,
  label: 'Meta-confidence estimator',
  version: '1.0.0',
  domain: 'intelligence',
  healthDomain: 'reasoning_hypothesis',
  ownerFeature: 'intelligence',
  dependencies: { sources: [], providers: [], services: ['truth-score'] },
  outputs: ['risk_score'],
  criticality: 'medium',
};

interface RegistrySeam {
  getAlgorithm?: typeof getAlgorithm;
  registerAlgorithm?: typeof registerAlgorithm;
}

function ensureMetaConfidenceRegistered(deps: RegistrySeam): void {
  const get = deps.getAlgorithm ?? getAlgorithm;
  if (get(META_CONFIDENCE_ALGORITHM_ID)) return;
  (deps.registerAlgorithm ?? registerAlgorithm)(META_CONFIDENCE_DEFINITION);
}

// ── Sub-task A: meta-confidence outcome grading ──────────────────────

export interface MetaConfidenceGradeInput {
  situationId: string;
  /** Ground-truth reliability of the resolved situation in [0,1]:
   *  1 = the assessment proved correct/real, 0 = it proved wrong. */
  actualOutcome: number;
  /** ms timestamp of resolution. Defaults to Date.now() inside the
   *  recorder. */
  at?: number;
}

export interface MetaConfidenceGradeDeps extends RegistrySeam {
  metaService?: Pick<MetaConfidenceService, 'getEstimate'>;
  recordEvaluation?: typeof recordAlgorithmEvaluation;
  recordOutcome?: typeof recordAlgorithmOutcome;
}

/** Map calibration deviation to a graded outcome so the record counts in
 *  `summarizeCalibration` (which ignores records with no outcome). A
 *  well-calibrated estimate sits close to the actual outcome. */
function deviationToOutcome(deviation: number): EvaluationOutcome {
  if (deviation <= 0.15) return 'hit';
  if (deviation <= 0.35) return 'partial';
  return 'miss';
}

export interface MetaConfidenceGradeResult {
  situationId: string;
  metaConfidence: number;
  actualOutcome: number;
  /** |actualOutcome − metaConfidence| — lower is better-calibrated. */
  deviation: number;
  recordId: string;
}

/**
 * Grade the meta-confidence estimate that was made for a now-resolved
 * situation against its actual outcome, logging the deviation to the
 * evaluation ledger under the `meta-confidence` algorithm id. Returns
 * null when no estimate was ever recorded for the situation (nothing to
 * grade).
 */
export function gradeMetaConfidenceOnResolution(
  input: MetaConfidenceGradeInput,
  deps: MetaConfidenceGradeDeps = {},
): MetaConfidenceGradeResult | null {
  const metaService = deps.metaService ?? getMetaConfidenceService();
  const estimate = metaService.getEstimate(input.situationId);
  if (!estimate) return null;
  // The estimate service is keyed by target id alone, so a score or
  // hypothesis estimate could shadow a situation sharing that id. We only
  // grade situation resolutions — reject anything else.
  if (estimate.targetType !== 'situation') return null;

  const actual = clamp01(input.actualOutcome);
  const deviation = Math.abs(actual - estimate.metaConfidence);

  ensureMetaConfidenceRegistered(deps);
  const record = (deps.recordEvaluation ?? recordAlgorithmEvaluation)(
    META_CONFIDENCE_ALGORITHM_ID,
    {
      durationMs: 0,
      score: deviation,
      at: input.at,
      detail: {
        situationId: input.situationId,
        metaConfidence: estimate.metaConfidence,
        reportedConfidence: estimate.reportedConfidence,
        actualOutcome: actual,
      },
      notes: `Meta-confidence ${estimate.metaConfidence} vs actual ${actual} on resolution (deviation ${deviation.toFixed(4)}).`,
    },
  );

  // Grade the record immediately — without an outcome, summarizeCalibration
  // ignores it and the tuning loop never sees this signal.
  const outcome = deviationToOutcome(deviation);
  (deps.recordOutcome ?? recordAlgorithmOutcome)(
    record.id,
    outcome,
    `Calibration deviation ${deviation.toFixed(4)} → ${outcome}.`,
    input.at,
  );

  return {
    situationId: input.situationId,
    metaConfidence: estimate.metaConfidence,
    actualOutcome: actual,
    deviation,
    recordId: record.id,
  };
}

// ── Sub-task B: confirmed counterfactual → assumption tracker ────────

/** Confirmed counterfactuals live as critical lifecycle assumptions for
 *  48 hours before they expire out of the active set. */
export const COUNTERFACTUAL_ASSUMPTION_TTL_MS = 48 * 60 * 60 * 1000;

/** Algorithm id stamped on assumptions minted from counterfactuals. */
export const COUNTERFACTUAL_ALGORITHM_ID = 'counterfactual-reasoning';

export interface ConfirmedCounterfactualInput {
  id: string;
  situationId: string;
  domain: string;
  /** The falsification condition (threshold text) becomes the
   *  assumption label. */
  falsificationCondition: string;
  rationale?: string;
}

export interface RegisterCounterfactualDeps {
  tracker?: Pick<AssumptionTrackerService, 'register'>;
  now?: () => number;
  ttlMs?: number;
}

/**
 * Register an analyst-confirmed counterfactual as a critical lifecycle
 * assumption (confidence 'high', TTL 48h) so it shows up in the
 * assumption-lifecycle panel and ages out on its own.
 */
export function registerConfirmedCounterfactual(
  counterfactual: ConfirmedCounterfactualInput,
  deps: RegisterCounterfactualDeps = {},
): Assumption {
  const tracker = deps.tracker ?? getAssumptionTrackerService();
  const now = (deps.now ?? Date.now)();
  const ttlMs = deps.ttlMs ?? COUNTERFACTUAL_ASSUMPTION_TTL_MS;
  return tracker.register({
    label: counterfactual.falsificationCondition,
    rationale: counterfactual.rationale
      ?? `Analyst-confirmed counterfactual for situation ${counterfactual.situationId}.`,
    algorithmId: COUNTERFACTUAL_ALGORITHM_ID,
    outputId: counterfactual.id,
    domain: counterfactual.domain,
    // Highest confidence band the tracker models — an analyst validated
    // the falsification path, so treat it as a critical assumption.
    confidence: 'high',
    expiresAt: now + ttlMs,
  });
}

// ── Wiring: situation resolution → grading ───────────────────────────

const RESOLUTION_PHASES: ReadonlySet<LifecyclePhase> = new Set(['resolved', 'closed']);

/** A transition counts as the situation's resolution exactly once: on
 *  the first move into 'resolved', or into 'closed' when it didn't pass
 *  through 'resolved' first. Avoids double-grading the resolved→closed
 *  tail. */
function isResolutionTransition(t: PhaseTransition): boolean {
  if (!RESOLUTION_PHASES.has(t.toPhase)) return false;
  if (t.toPhase === 'closed' && t.fromPhase === 'resolved') return false;
  return true;
}

export interface WireEpistemicCalibrationDeps extends RegistrySeam {
  lifecycleTracker?: Pick<SituationLifecycleTrackerService, 'subscribe'>;
  metaService?: Pick<MetaConfidenceService, 'getEstimate'>;
  recordEvaluation?: typeof recordAlgorithmEvaluation;
  recordOutcome?: typeof recordAlgorithmOutcome;
  /** Map a resolution transition to a ground-truth outcome in [0,1].
   *  Default: a situation that ran to resolution proved real → 1. */
  resolutionOutcome?: (transition: PhaseTransition) => number;
}

/**
 * Subscribe to the situation lifecycle tracker and grade meta-confidence
 * each time a situation resolves. Returns an unsubscribe handle.
 */
export function wireEpistemicCalibration(
  deps: WireEpistemicCalibrationDeps = {},
): () => void {
  const tracker = deps.lifecycleTracker ?? getSituationLifecycleTrackerService();
  const outcomeFor = deps.resolutionOutcome ?? (() => 1);
  return tracker.subscribe((transition) => {
    if (!isResolutionTransition(transition)) return;
    gradeMetaConfidenceOnResolution(
      {
        situationId: transition.situationId,
        actualOutcome: outcomeFor(transition),
        at: transition.transitionedAt,
      },
      {
        metaService: deps.metaService,
        recordEvaluation: deps.recordEvaluation,
        recordOutcome: deps.recordOutcome,
        getAlgorithm: deps.getAlgorithm,
        registerAlgorithm: deps.registerAlgorithm,
      },
    );
  });
}

let epistemicCalibrationUnsubscribe: (() => void) | null = null;

/**
 * Production entry point — wires the situation-resolution → meta-confidence
 * grading subscription into the live lifecycle tracker once. Idempotent:
 * a second call tears down the prior subscription first. Mirrors the other
 * boot starters (startOutcomeGradingCadence / startTuningApplyCadence).
 */
export function startEpistemicCalibration(
  deps: WireEpistemicCalibrationDeps = {},
): () => void {
  epistemicCalibrationUnsubscribe?.();
  epistemicCalibrationUnsubscribe = wireEpistemicCalibration(deps);
  return () => {
    epistemicCalibrationUnsubscribe?.();
    epistemicCalibrationUnsubscribe = null;
  };
}

export const __internals = {
  META_CONFIDENCE_DEFINITION,
  ensureMetaConfidenceRegistered,
  isResolutionTransition,
  clamp01,
};
