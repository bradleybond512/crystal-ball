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
import { detectBigEvent, type BigEventInput } from '@/services/insights/big-event-detector';
import { feedbackMultiplier } from '@/services/hypothesis-feedback';
import { analogScoreFor, type Episode, type Recall } from '@/services/cognition/episodic-memory';

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

// ── big-event-detector.rapidJumpDelta fixtures ──────────────────────────

/**
 * Downstream decision: does the `rapid_severity_jump` trigger fire?
 * T* cases have genuine jumps that SHOULD fire; F* cases are noise that
 * should NOT fire. A delta too HIGH misses T2 (jump=28); a delta too LOW
 * fires on anything — but the F* cases keep their jump below the valid
 * minimum (15), so they never fire regardless, making the lower bound
 * sanity-only. Discrimination comes from the T2/T3 cases.
 */
interface JumpCase {
  id: string;
  previousSeverityScore: number;
  severityScore: number;
  /** Should `rapid_severity_jump` fire for this input at this delta? */
  expectFired: boolean;
}

const JUMP_CASES: readonly JumpCase[] = [
  // jump=45 — always fires at any valid delta [15,40]. Sanity guard.
  { id: 'T1-huge-jump', previousSeverityScore: 20, severityScore: 65, expectFired: true },
  // jump=28 — fires when delta ≤ 28. At default (25): passes.
  // Moving delta above 28 (e.g. 30) breaks this case → blocks increase.
  { id: 'T2-clear-jump', previousSeverityScore: 30, severityScore: 58, expectFired: true },
  // jump=20 — fires when delta ≤ 20. NOT passing at default (25). Becomes
  // passing if delta decreases, but won't block an increase.
  { id: 'T3-moderate-jump', previousSeverityScore: 40, severityScore: 60, expectFired: true },
  // jump=2 — well below min delta (15). Never fires. Sanity guard.
  { id: 'F1-noise', previousSeverityScore: 50, severityScore: 52, expectFired: false },
  // jump=11 — below min delta. Never fires.
  { id: 'F2-slight-uptick', previousSeverityScore: 45, severityScore: 56, expectFired: false },
  // jump=3 — stable reading. Never fires.
  { id: 'F3-stable', previousSeverityScore: 60, severityScore: 63, expectFired: false },
];

function jumpBaseInput(c: JumpCase): BigEventInput {
  return {
    id: `safety-${c.id}`,
    domain: 'weather',
    severityScore: c.severityScore,
    previousSeverityScore: c.previousSeverityScore,
    // All other triggers suppressed:
    truthScore: 0.6,            // < 0.65 → no high_confidence_high_impact
    sourceCount: 1,             // < 4 → no many_sources_converge
    hasOfficialSource: false,
    overlappingDomains: ['weather'], // single domain → no multi_domain_overlap
    userExposure: 0,
    potentialImpact: 50,        // < 70 and < 80 → no high/extreme impact
    forecastThresholdCrossed: false,
  };
}

function scoreBigEventRapidJumpDelta(rapidJumpDelta: number): TuningSafetyScore {
  const passingCaseIds: string[] = [];
  for (const c of JUMP_CASES) {
    const result = detectBigEvent(jumpBaseInput(c), { rapidJumpDelta });
    const fired = result.triggers.some((t) => t.kind === 'rapid_severity_jump');
    if (fired === c.expectFired) passingCaseIds.push(c.id);
  }
  return {
    hitRate: passingCaseIds.length / JUMP_CASES.length,
    cases: JUMP_CASES.length,
    passingCaseIds,
  };
}

// ── big-event-detector.exposureFloor fixtures ────────────────────────────

/**
 * Downstream decision: does the `high_personal_exposure` trigger fire?
 * T* cases are users genuinely in the path (SHOULD fire); F* cases are
 * users outside the path (should NOT fire). A floor too HIGH (e.g. 86)
 * misses T1/T2; a floor too LOW (e.g. 55) fires on F3 (moderate exposure).
 * The fixture peaks in [56, 65] where both subsets are handled correctly.
 */
interface ExposureCase {
  id: string;
  userExposure: number;
  /** Should `high_personal_exposure` fire for this input at this floor? */
  expectFired: boolean;
}

const EXPOSURE_CASES: readonly ExposureCase[] = [
  // exposure=85 — fires at any floor ≤ 85. At default (70): passes.
  { id: 'T1-direct-path', userExposure: 85, expectFired: true },
  // exposure=80 — fires at any floor ≤ 80. At default (70): passes.
  // Moving floor above 80 breaks this case → blocks large increases.
  { id: 'T2-clear-exposure', userExposure: 80, expectFired: true },
  // exposure=65 — fires at floor ≤ 65. NOT passing at default (70).
  { id: 'T3-borderline', userExposure: 65, expectFired: true },
  // exposure=20 — always below any valid floor (min=50). Never fires.
  { id: 'F1-not-in-path', userExposure: 20, expectFired: false },
  // exposure=40 — below min valid floor (50). Never fires.
  { id: 'F2-low-exposure', userExposure: 40, expectFired: false },
  // exposure=55 — fires at floor ≤ 55. At default (70): doesn't fire → passes.
  // Moving floor below 56 breaks this case → blocks large decreases.
  { id: 'F3-moderate-exposure', userExposure: 55, expectFired: false },
];

function exposureBaseInput(id: string, userExposure: number): BigEventInput {
  return {
    id: `safety-${id}`,
    domain: 'weather',
    severityScore: 50,
    // All other triggers suppressed:
    truthScore: 0.6,
    sourceCount: 1,
    hasOfficialSource: false,
    overlappingDomains: ['weather'],
    userExposure,
    potentialImpact: 50,
    forecastThresholdCrossed: false,
  };
}

function scoreBigEventExposureFloor(exposureFloor: number): TuningSafetyScore {
  const passingCaseIds: string[] = [];
  for (const c of EXPOSURE_CASES) {
    const result = detectBigEvent(exposureBaseInput(c.id, c.userExposure), { exposureFloor });
    const fired = result.triggers.some((t) => t.kind === 'high_personal_exposure');
    if (fired === c.expectFired) passingCaseIds.push(c.id);
  }
  return {
    hitRate: passingCaseIds.length / EXPOSURE_CASES.length,
    cases: EXPOSURE_CASES.length,
    passingCaseIds,
  };
}

// ── hypothesis-feedback.downPenalty fixtures ─────────────────────────────

/**
 * Downstream decision: is a hypothesis demoted (feedback multiplier < 1.0)?
 * U* cases are net-positive feedback (SHOULD NOT be demoted); D* cases are
 * net-negative (SHOULD be demoted). M1 is a slight net-positive edge that
 * becomes demoted at high penalties (> 0.6); D1 is balanced feedback that
 * stops being demoted at very low penalties (< 0.35). Both extremes regress
 * different subsets — the fixture peaks in [0.4, 0.6].
 */
const FEEDBACK_DEMOTE_THRESHOLD = 1; // mult strictly below 1.0 → demoted

interface FeedbackCase {
  id: string;
  up: number;
  down: number;
  expectDemoted: boolean;
}

const FEEDBACK_CASES: readonly FeedbackCase[] = [
  // up=4, down=0: mult always 1.3. Never demoted.
  { id: 'U1-all-up', up: 4, down: 0, expectDemoted: false },
  // up=3, down=1: mult ≥ 1.05 across [0.3,0.7]. Always not demoted.
  { id: 'U2-mostly-up', up: 3, down: 1, expectDemoted: false },
  // up=2, down=1: mult=1.033 at 0.5, drops below 1.0 at penalty ≈ 0.6.
  // In passing set at default (0.5); fails when penalty > 0.6 → blocks increase.
  { id: 'M1-slight-edge', up: 2, down: 1, expectDemoted: false },
  // up=5, down=4: mult=0.944 at 0.5 (demoted); rises to 1.033 at penalty=0.3
  // (not demoted). In passing set at default (0.5); fails at penalty ≤ 0.35
  // → blocks decrease. Avoids the boundary problem of equal-vote cases.
  { id: 'D1-slight-down-majority', up: 5, down: 4, expectDemoted: true },
  // up=1, down=3: mult ≤ 0.85 across [0.3,0.7]. Always demoted.
  { id: 'D2-mostly-down', up: 1, down: 3, expectDemoted: true },
  // up=0, down=4: mult=0.5 (floor). Always demoted.
  { id: 'D3-all-down', up: 0, down: 4, expectDemoted: true },
];

function scoreFeedbackDownPenalty(downPenalty: number): TuningSafetyScore {
  const passingCaseIds: string[] = [];
  for (const c of FEEDBACK_CASES) {
    const mult = feedbackMultiplier(c.up, c.down, downPenalty);
    const demoted = mult < FEEDBACK_DEMOTE_THRESHOLD;
    if (demoted === c.expectDemoted) passingCaseIds.push(c.id);
  }
  return {
    hitRate: passingCaseIds.length / FEEDBACK_CASES.length,
    cases: FEEDBACK_CASES.length,
    passingCaseIds,
  };
}

// ── episodic-analog.minSim fixtures (cognition PR 12) ────────────────────

/**
 * Downstream decision modeled: does the analog engine emit an ELEVATED
 * signal (analogScoreFor returns non-null AND ≥ 0.5) for a hypothesis?
 *
 * T* cases are genuine recurring patterns — three close analogs (sim
 * ≥ 0.50) that all materialized SHOULD produce an elevated signal. A
 * minSim too HIGH disqualifies them (analog count < 3 → null → no signal).
 *
 * F* cases are spurious weak matches — three low-similarity "analogs"
 * that happened to materialize should NOT drive an elevated signal. A
 * minSim too LOW lets them qualify and fires wrongly.
 *
 * N1 is a sanity guard: strong analogs that all fizzled must never read
 * as elevated at any valid minSim (score 0 either way).
 *
 * The optimum sits around the default (0.45): one step up (0.50) keeps
 * every passing case; larger increases break T1, decreases toward 0.40
 * break F3. Calls the REAL analogScoreFor with an explicit minSim.
 */
interface AnalogSafetyCase {
  id: string;
  /** Similarities of the three candidate analogs. */
  sims: readonly [number, number, number];
  outcome: 'materialized' | 'fizzled';
  /** Ground truth: should the analog signal read "elevated"? */
  expectElevated: boolean;
}

const ANALOG_CASES: readonly AnalogSafetyCase[] = [
  // Genuine pattern at sim ≥ 0.50 — breaks when minSim rises above 0.50.
  { id: 'T1-recurring-pattern', sims: [0.5, 0.52, 0.55], outcome: 'materialized', expectElevated: true },
  // Spurious matches: progressively higher weak-similarity bands. Each
  // blocks a deeper decrease (F1 blocks ≤0.31, F2 ≤0.36, F3 ≤0.40).
  { id: 'F1-noise-low', sims: [0.31, 0.33, 0.35], outcome: 'materialized', expectElevated: false },
  { id: 'F2-noise-mid', sims: [0.36, 0.37, 0.39], outcome: 'materialized', expectElevated: false },
  { id: 'F3-noise-high', sims: [0.4, 0.41, 0.43], outcome: 'materialized', expectElevated: false },
  // Sanity: strong analogs that fizzled are never "elevated".
  { id: 'N1-fizzled-strong', sims: [0.5, 0.55, 0.58], outcome: 'fizzled', expectElevated: false },
];

function analogCaseRecalls(c: AnalogSafetyCase): Recall[] {
  return c.sims.map((similarity, i): Recall => {
    const episode: Episode = {
      id: `safety-${c.id}-${i}`,
      kind: 'hypothesis',
      signature: `safety-${c.id}`,
      summary: 'safety fixture episode',
      domains: ['conflict'],
      entities: ['XX'],
      createdAt: 0,
      resolvedAt: 1000,
      outcome: c.outcome,
      vector: [],
      tier: 'hashed',
    };
    return { episode, similarity, ageDays: 1, explanation: 'safety fixture' };
  });
}

/** Run the REAL analog scorer at `minSim` across the fixtures and return
 *  the elevated/quiet hit rate. */
function scoreEpisodicAnalogMinSim(minSim: number): TuningSafetyScore {
  const passingCaseIds: string[] = [];
  for (const c of ANALOG_CASES) {
    const score = analogScoreFor(analogCaseRecalls(c), { minSim });
    const elevated = score !== null && score >= 0.5;
    if (elevated === c.expectElevated) passingCaseIds.push(c.id);
  }
  return {
    hitRate: passingCaseIds.length / ANALOG_CASES.length,
    cases: ANALOG_CASES.length,
    passingCaseIds,
  };
}

// ── Registry + public API ────────────────────────────────────────────────

type SafetyScorer = (candidateValue: number) => TuningSafetyScore;

const SCORERS: Record<string, SafetyScorer> = {
  'negative-evidence:maxPenalty': scoreNegativeEvidenceMaxPenalty,
  'correlation-feedback:feedbackThreshold': scoreCorrelationFeedbackThreshold,
  'big-event-detector:rapidJumpDelta': scoreBigEventRapidJumpDelta,
  'big-event-detector:exposureFloor': scoreBigEventExposureFloor,
  'hypothesis-feedback:downPenalty': scoreFeedbackDownPenalty,
  'episodic-analog:minSim': scoreEpisodicAnalogMinSim,
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
