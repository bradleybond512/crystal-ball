/**
 * Cognition Algorithm Registration + Evaluation Hooks (PR 12).
 *
 * Registers the five cognition-layer algorithms in the algorithm registry so
 * they receive:
 *   - evaluation-ledger grading (hit/miss/partial per outcome)
 *   - hit-rate + weighted-hit-rate tracking in AlgorithmDiagnosticPanel
 *   - drift detection via drift-detector.ts (Page-Hinkley on rolling F1)
 *   - safe-adjustment proposals via safe-adjustment.ts (operator-approved only)
 *
 * The cognition algorithms now expose their tunable knobs through
 * tunable-params-store.ts (PR 12 step 1), so safe-adjustment can propose
 * bounded changes that are validated by backtest-engine.ts before the operator
 * accepts them. Nothing is auto-applied — the contract is proposals only.
 *
 * Drift coverage: drift-detector.ts consumes the evaluation ledger; once
 * cognition algorithms push graded outcomes here, sustained degradation
 * (e.g. embeddings going stale as the world changes) fires retune/shadow
 * actions automatically — no modification to drift-detector needed.
 *
 * Evaluation hook design: minimal and honest. The hooks fire fire-and-forget
 * at the natural grading points:
 *   - episodic-analog: grading flows through hypothesis-accuracy (which already
 *     resolves episodes); this module exposes a thin wrapper.
 *   - superforecast: grading flows through calibration store resolutions;
 *     this module exposes a pushSuperforecastEvaluation() helper.
 *
 * Pure: no DOM, no fetch, no globals at import time.
 * No new runtime dependencies.
 */

import {
  registerAlgorithm,
  type AlgorithmDefinition,
} from '@/services/algorithms/algorithm-registry';
import {
  recordAlgorithmEvaluation,
  recordAlgorithmOutcome,
} from '@/services/algorithms/record-evaluation';
import type { EvaluationOutcome } from '@/services/algorithms/algorithm-evaluation-ledger';

// ── Algorithm definitions ─────────────────────────────────────────────────────

/**
 * The five cognition-layer algorithms. Defined here as the canonical source
 * of truth so registerCognitionAlgorithms() and tests use the same objects.
 */
export const COGNITION_ALGORITHM_DEFINITIONS: readonly AlgorithmDefinition[] = [
  {
    id: 'episodic-analog',
    label: 'Episodic analog retrieval',
    version: '1.0.0',
    domain: 'cognition',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'cognition',
    dependencies: {
      sources: [],
      providers: [],
      services: ['episodic-memory', 'vector-index'],
    },
    outputs: ['risk_score'],
    criticality: 'medium',
  },
  {
    id: 'cognition-recalibration',
    label: 'Cognition recalibration',
    version: '1.0.0',
    domain: 'cognition',
    healthDomain: 'forecast_calibration',
    ownerFeature: 'cognition',
    dependencies: {
      sources: [],
      providers: [],
      services: ['recalibration'],
    },
    outputs: ['forecast'],
    criticality: 'medium',
  },
  {
    id: 'superforecast',
    label: 'Superforecaster pipeline',
    version: '1.0.0',
    domain: 'cognition',
    healthDomain: 'forecast_calibration',
    ownerFeature: 'cognition',
    dependencies: {
      sources: [],
      providers: ['anthropic', 'groq', 'openrouter'],
      services: ['base-rates', 'probability-aggregation', 'cognition-recalibration'],
    },
    outputs: ['forecast'],
    criticality: 'medium',
  },
  {
    id: 'operator-ranking',
    label: 'Operator model ranking',
    version: '1.0.0',
    domain: 'cognition',
    healthDomain: 'watchlist_relevance',
    ownerFeature: 'cognition',
    dependencies: {
      sources: [],
      providers: [],
      services: ['operator-model'],
    },
    outputs: ['ranking'],
    criticality: 'low',
  },
  {
    id: 'entity-trajectory',
    label: 'Entity trajectory / dossier heat',
    version: '1.0.0',
    domain: 'cognition',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'cognition',
    dependencies: {
      sources: [],
      providers: [],
      services: ['entity-dossier', 'entity-graph'],
    },
    outputs: ['risk_score'],
    criticality: 'medium',
  },
];

// ── Registration ──────────────────────────────────────────────────────────────

let _registered = false;

/**
 * Register all cognition algorithms into the global algorithm registry.
 *
 * Idempotent: safe to call multiple times (second+ calls are no-ops unless
 * `force` is true). Called at module import time by app bootstrap code and
 * explicitly in tests via the exported function.
 */
export function registerCognitionAlgorithms(options: { force?: boolean } = {}): void {
  if (_registered && !options.force) return;
  for (const def of COGNITION_ALGORITHM_DEFINITIONS) {
    registerAlgorithm(def, { replace: options.force ?? false });
  }
  _registered = true;
}

/** Reset registration state (tests only). */
export function _resetCognitionRegistrationForTests(): void {
  _registered = false;
}

// Auto-register at module load time. The algorithm registry is a singleton Map;
// this is safe to call unconditionally — registerAlgorithm throws only on
// duplicate id when replace:false, and _registered guards re-entry.
registerCognitionAlgorithms();

// ── Evaluation hooks ──────────────────────────────────────────────────────────
//
// Fire-and-forget helpers that push graded outcomes into the evaluation ledger.
// They sit at the natural grading boundaries: hypothesis-accuracy for episodic
// analogs and calibration store resolutions for superforecasts. The actual
// grading logic lives in those modules; these hooks only push the record into
// the shared ledger so drift-detector and safe-adjustment see it.

/**
 * Record an episodic analog evaluation (score + outcome in one step, since
 * analog quality is graded synchronously against the resolved episode).
 *
 * Called by the wiring layer (episodic-memory-bridge / analyst-loop) after
 * hypothesis-accuracy grades a hypothesis as hit/miss/partial.
 *
 * @param analogScore   The analogScoreFor() value (0–1, or null when < 3 recalls).
 * @param outcome       The graded outcome ('hit' | 'miss' | 'partial' | 'inconclusive').
 * @param reason        Free-text reason for audit trail.
 */
export function recordEpisodicAnalogEvaluation(
  analogScore: number | null,
  outcome: EvaluationOutcome,
  reason: string,
): void {
  try {
    const at = Date.now();
    const rec = recordAlgorithmEvaluation('episodic-analog', {
      durationMs: 0, // sync retrieval; latency not meaningful at this boundary
      score: analogScore ?? undefined,
      label: analogScore !== null ? 'analog-scored' : 'no-analog',
      notes: `analogScore=${analogScore !== null ? analogScore.toFixed(3) : 'null'}`,
      at,
    });
    recordAlgorithmOutcome(rec.id, outcome, reason, at);
  } catch {
    // Fire-and-forget: evaluation hooks must never throw into the caller.
  }
}

/**
 * Record a superforecast evaluation.
 *
 * Called by superforecast.ts (or the wiring layer) when a superforecast is
 * emitted. The calibration store already records the prediction for Brier
 * grading; this pushes a parallel record into the evaluation ledger so
 * drift-detector watches it.
 *
 * @param probability   The emitted probability (0–1).
 * @param hypothesisId  Optional hypothesis id for cross-referencing.
 * @returns             The evaluation record id — callers can later push an
 *                      outcome via recordSuperforecastOutcome().
 */
export function recordSuperforecastEvaluation(
  probability: number,
  hypothesisId?: string,
): string {
  try {
    const rec = recordAlgorithmEvaluation('superforecast', {
      durationMs: 0,
      score: probability,
      notes: hypothesisId ? `hypothesisId=${hypothesisId}` : undefined,
    });
    return rec.id;
  } catch {
    return ''; // fire-and-forget; empty id signals caller to skip outcome wiring
  }
}

/**
 * Append an outcome to a previously recorded superforecast evaluation.
 *
 * Called when the hypothesis resolves (hypothesis-accuracy grades it).
 * Maps hypothesis outcome labels to the ledger's EvaluationOutcome taxonomy.
 *
 * @param recordId   The id returned by recordSuperforecastEvaluation().
 * @param outcome    'hit' | 'miss' | 'partial' | 'inconclusive'.
 * @param reason     Free-text reason.
 */
export function recordSuperforecastOutcome(
  recordId: string,
  outcome: EvaluationOutcome,
  reason: string,
): void {
  if (!recordId) return; // silently no-op when emit failed
  try {
    recordAlgorithmOutcome(recordId, outcome, reason);
  } catch {
    // Fire-and-forget.
  }
}

/**
 * Record an entity trajectory evaluation (heat score and trajectory label
 * for a single entity at a point in time). Outcomes are logged when the
 * entity's actual trajectory is later confirmed.
 *
 * @param entityKey     Canonical entity key (e.g. 'country:RUS').
 * @param heat          Heat score 0–1.
 * @param trajectory    'heating' | 'stable' | 'cooling'.
 * @returns             The evaluation record id for later outcome wiring.
 */
export function recordEntityTrajectoryEvaluation(
  entityKey: string,
  heat: number,
  trajectory: string,
): string {
  try {
    const rec = recordAlgorithmEvaluation('entity-trajectory', {
      durationMs: 0,
      score: heat,
      label: trajectory,
      notes: `entity=${entityKey}`,
    });
    return rec.id;
  } catch {
    return '';
  }
}
