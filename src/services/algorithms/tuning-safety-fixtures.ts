/**
 * Tuning Safety Fixtures — B2-enable of the self-improvement gameplan.
 *
 * The policy gate auto-applies a low/medium tuning only when `replayPassed`
 * is true. The original plan was to derive that from the replay-harness /
 * backtest-engine, but neither yields an honest per-tuning signal (the
 * replay catalog is permanently-failing regression demos; the backtest
 * engine models driver-weights, not these knobs — see the gameplan's
 * B2-enable finding).
 *
 * This module is the honest replacement: a small **regression-guard**
 * suite of hand-authored, obviously-labeled scenarios per tunable knob. A
 * candidate parameter value is "safe" iff it does not REGRESS the suite's
 * hit rate versus the value currently in force. The scorer runs the REAL
 * algorithm (not a reimplementation), so it exercises the actual code path
 * a change would affect.
 *
 * HONESTY / SCOPE: this is a regression guard against known scenarios, NOT
 * a proof the tuning is optimal on live data. Its value is that it
 * *discriminates* — it blocks a change that breaks a known-good scenario
 * and allows one that doesn't. The `≥20 graded samples` gate (separate)
 * still requires real-world evidence before anything auto-applies; this
 * guard sits on top of that, never replaces it.
 */

import { evaluateNegativeEvidence, type ExpectedSignal } from '@/services/intelligence/negative-evidence';
import type { NormalizedFact } from '@/services/intelligence/types';

export interface TuningSafetyScore {
  /** Fraction of fixtures whose suppress/keep decision matched ground truth. */
  hitRate: number;
  /** Number of fixtures scored. */
  cases: number;
  /** Ids of the fixtures that PASSED (decision matched ground truth) at this
   *  candidate value. Used for set-wise non-regression so a change can never
   *  break a currently-passing scenario even while fixing a different one. */
  passingCaseIds: readonly string[];
}

// ── negative-evidence.maxPenalty fixtures ────────────────────────────────

/**
 * Representative downstream decision modeled by the fixtures: a consumer
 * deprioritizes ("suppresses") an event when negative-evidence drops its
 * adjusted confidence below this threshold. The fixtures ask: does a given
 * maxPenalty preserve the CORRECT suppress/keep decision on each scenario?
 */
const SUPPRESS_THRESHOLD = 0.5;

interface NegEvSafetyCase {
  id: string;
  /** Base confidence before the absence penalty. */
  baseConfidence: number;
  /** Absence penalties for expected-but-missing follow-on signals. */
  absencePenalties: readonly number[];
  /** Ground truth: SHOULD this event be suppressed (penalty justified)? */
  expectSuppressed: boolean;
}

/**
 * Six labeled scenarios spanning the real tradeoff:
 *   - T* (true-absence): an expected signal genuinely never arrived and the
 *     event was a false alarm — the penalty SHOULD pull confidence down
 *     enough to suppress. A maxPenalty too LOW fails to suppress these.
 *   - F* (false-absence): the event was real (strong base confidence) despite
 *     a missing signal — it should NOT be suppressed. A maxPenalty too HIGH
 *     wrongly suppresses these.
 * The optimum is a MIDDLE value; both extremes regress. Bases are kept clear
 * of the suppression threshold so the scoring is stable.
 */
const NEG_EV_CASES: readonly NegEvSafetyCase[] = [
  { id: 'T1-false-alarm-high-base', baseConfidence: 0.74, absencePenalties: [0.3, 0.3], expectSuppressed: true },
  { id: 'T2-false-alarm-mid-base', baseConfidence: 0.66, absencePenalties: [0.3, 0.3], expectSuppressed: true },
  { id: 'T3-false-alarm-higher-base', baseConfidence: 0.78, absencePenalties: [0.3, 0.3], expectSuppressed: true },
  { id: 'F1-real-strong-evidence', baseConfidence: 0.95, absencePenalties: [0.3, 0.3], expectSuppressed: false },
  { id: 'F2-real-strong-evidence', baseConfidence: 0.92, absencePenalties: [0.3, 0.3], expectSuppressed: false },
  { id: 'F3-real-small-penalty', baseConfidence: 0.9, absencePenalties: [0.3], expectSuppressed: false },
];

const PARENT_OCCURRED_AT = 0;
const SCORE_NOW = 1_000_000; // well past every signal window → all missing

function caseParent(id: string): NormalizedFact {
  return {
    id: `safety-${id}`,
    domain: 'weather',
    eventType: 'earthquake',
    claim: 'safety fixture parent',
    severity: 'moderate',
    occurredAt: PARENT_OCCURRED_AT,
    locationPrecision: 'point',
    entities: ['XX'],
    sources: [{ providerId: 'p0', observedAt: PARENT_OCCURRED_AT }],
  };
}

function caseExpected(absencePenalties: readonly number[]): ExpectedSignal[] {
  return absencePenalties.map((absencePenalty, i) => ({
    id: `sig-${i}`,
    label: `expected signal ${i}`,
    domain: 'weather',
    windowStartMs: 0,
    windowEndMs: 1000,
    absencePenalty,
  }));
}

/** Run the negative-evidence engine at `maxPenalty` across the fixtures and
 *  return the suppress/keep hit rate. Calls the REAL algorithm. */
function scoreNegativeEvidenceMaxPenalty(maxPenalty: number): TuningSafetyScore {
  const passingCaseIds: string[] = [];
  for (const c of NEG_EV_CASES) {
    const result = evaluateNegativeEvidence(
      caseParent(c.id),
      caseExpected(c.absencePenalties),
      [], // no candidate facts → every expected signal is missing
      c.baseConfidence,
      { now: SCORE_NOW, maxPenalty },
    );
    const suppressed = result.adjustedConfidence < SUPPRESS_THRESHOLD;
    if (suppressed === c.expectSuppressed) passingCaseIds.push(c.id);
  }
  return {
    hitRate: passingCaseIds.length / NEG_EV_CASES.length,
    cases: NEG_EV_CASES.length,
    passingCaseIds,
  };
}

// ── correlation-feedback.feedbackThreshold fixtures ─────────────────────

/**
 * Correlation-feedback is a monotone threshold gate: `mult >= threshold`.
 * A true discrimination suite (where different threshold values produce
 * different scores) would require ground-truth about borderline rules —
 * which would freeze the knob at the current value.
 *
 * Instead, this suite provides SANITY-GUARD cases: six pairs far from the
 * threshold range (0.30–0.80) where the correct enable/disable decision
 * is unambiguous for any value in [0.3, 0.8]. It passes for all valid
 * thresholds, so `proposeTuningSafety` returns true and the evidence gate
 * (≥20 graded samples, the separate ledger gate) provides the actual
 * quality signal.
 *
 * What it DOES catch: a degenerate stored value outside the declared
 * bounds (already clamped by the store) or a scorer implementation bug.
 */
interface CorrelFeedbackCase {
  id: string;
  /** Feedback multiplier getPairFeedbackMult() would return. */
  mult: number;
  /** Ground truth: should this rule be enabled at this mult level? */
  expectEnabled: boolean;
}

const CORREL_FEEDBACK_CASES: readonly CorrelFeedbackCase[] = [
  { id: 'E1-strong', mult: 0.95, expectEnabled: true },   // well-confirmed correlation
  { id: 'E2-good', mult: 0.85, expectEnabled: true },     // reliable, rarely dismissed
  { id: 'E3-solid', mult: 0.9, expectEnabled: true },     // consistently good signal
  { id: 'D1-noise', mult: 0.05, expectEnabled: false },   // user dismisses every trigger
  { id: 'D2-stale', mult: 0.1, expectEnabled: false },    // badly degraded
  { id: 'D3-low', mult: 0.2, expectEnabled: false },      // well below any valid threshold
];

function scoreCorrelationFeedbackThreshold(threshold: number): TuningSafetyScore {
  const passingCaseIds: string[] = [];
  for (const c of CORREL_FEEDBACK_CASES) {
    const enabled = c.mult >= threshold;
    if (enabled === c.expectEnabled) passingCaseIds.push(c.id);
  }
  return {
    hitRate: passingCaseIds.length / CORREL_FEEDBACK_CASES.length,
    cases: CORREL_FEEDBACK_CASES.length,
    passingCaseIds,
  };
}

// ── Registry + public API ────────────────────────────────────────────────

type SafetyScorer = (candidateValue: number) => TuningSafetyScore;

const SCORERS: Record<string, SafetyScorer> = {
  'negative-evidence:maxPenalty': scoreNegativeEvidenceMaxPenalty,
  'correlation-feedback:feedbackThreshold': scoreCorrelationFeedbackThreshold,
};

function scorerKey(algorithmId: string, parameterId: string): string {
  return `${algorithmId}:${parameterId}`;
}

/** Score a candidate value against the knob's safety fixtures. Returns null
 *  when no fixtures are declared for this knob. */
export function scoreTuningSafety(
  algorithmId: string,
  parameterId: string,
  candidateValue: number,
): TuningSafetyScore | null {
  const scorer = SCORERS[scorerKey(algorithmId, parameterId)];
  return scorer ? scorer(candidateValue) : null;
}

/**
 * Honest per-proposal safety signal for the policy gate's `replayPassed`.
 * True iff fixtures exist for this knob AND moving from `currentValue` to
 * `nextValue` does not break ANY currently-passing fixture (set-wise
 * non-regression — a strictly stronger guarantee than "aggregate hit rate
 * didn't drop", which could mask a swap that fixes one case while breaking
 * another). Fail-closed (false) when no fixtures are declared.
 */
export function proposeTuningSafety(
  algorithmId: string,
  parameterId: string,
  currentValue: number,
  nextValue: number,
): boolean {
  const current = scoreTuningSafety(algorithmId, parameterId, currentValue);
  const next = scoreTuningSafety(algorithmId, parameterId, nextValue);
  if (!current || !next) return false;
  const nextPass = new Set(next.passingCaseIds);
  // Every fixture passing at the current value must still pass at the next.
  return current.passingCaseIds.every((id) => nextPass.has(id));
}

/** True when a knob has a declared safety suite (so the loop can act on it). */
export function hasTuningSafetyFixtures(algorithmId: string, parameterId: string): boolean {
  return scorerKey(algorithmId, parameterId) in SCORERS;
}
