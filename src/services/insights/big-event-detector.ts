/**
 * Big Event Detector — per
 * docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md section 8 (lines 189-204).
 *
 * Triggers when ANY of these are true (the plan's exact list):
 *   - Rapid severity jump
 *   - Many sources converge
 *   - Official source confirms weak signals
 *   - User exposure is high
 *   - Multiple domains overlap
 *   - High confidence + high impact
 *   - Low confidence but extreme possible impact
 *   - Prediction model crosses threshold
 *
 * The detector outputs a list of triggers (with rationale strings)
 * plus a 0-100 score and a SituationTier. PR 4 of the plan will wire
 * the result into the notification ladder; PR 5 will wire it into the
 * Critical Event Command Center. This module is intentionally headless:
 * no DOM, no fetch, no runtime config.
 *
 * Plan invariant: "Keep the first PR deterministic and unit-tested."
 */

import {
  classifyConfidence,
  classifyUrgency,
  deliveryPriorityFor,
  tierFor,
  explainPriority,
  type ConfidenceLevel,
  type DeliveryPriority,
  type SituationTier,
  type UrgencyLevel,
} from './confidence-urgency-matrix';

// ── Trigger taxonomy ─────────────────────────────────────────────────────

export type BigEventTriggerKind =
  | 'rapid_severity_jump'
  | 'many_sources_converge'
  | 'official_confirms_weak'
  | 'high_personal_exposure'
  | 'multi_domain_overlap'
  | 'high_confidence_high_impact'
  | 'low_confidence_extreme_impact'
  | 'forecast_threshold_crossed';

export interface BigEventTrigger {
  kind: BigEventTriggerKind;
  /** Per-trigger contribution to the total score (0-100). Larger =
   *  louder. Multiple triggers sum, but the total is clamped to 100. */
  weight: number;
  /** Human-readable rationale for the explanation surface. */
  rationale: string;
}

// ── Inputs ───────────────────────────────────────────────────────────────

export interface BigEventInput {
  /** Stable id (typically the underlying NormalizedFact or situation id). */
  id: string;
  /** Domain string — used for overlap detection and downstream display. */
  domain: string;
  /** Current severity 0-100. */
  severityScore: number;
  /** Severity at the previous evaluation, if known. Required for
   *  rapid-jump detection. */
  previousSeverityScore?: number;
  /** Truth/confidence score in 0-1 (matches PR 1 truth-score output). */
  truthScore: number;
  /** Distinct attesting providers. */
  sourceCount: number;
  /** Was at least one attesting provider an official source (NWS, USGS,
   *  CISA, JMA, OCHA, …)? Drives the "official confirms weak signals"
   *  trigger. */
  hasOfficialSource: boolean;
  /** Distinct domains the situation spans (e.g. ['weather','infra']). */
  overlappingDomains: readonly string[];
  /** Personal exposure 0-100 — the "is the user in the path?" signal.
   *  PR 7 of the algorithm plan will populate this from the watchlist
   *  relevance engine. For now callers compute it however they like. */
  userExposure: number;
  /** Worst-plausible impact 0-100. Distinct from severityScore: a
   *  M5.0 quake near a nuclear plant has moderate severity but extreme
   *  potentialImpact. */
  potentialImpact: number;
  /** True when a forecast model just crossed an alerting threshold
   *  (e.g. hurricane track entered the cone of an inhabited region,
   *  drought index crossed D3, market drawdown crossed -2σ). */
  forecastThresholdCrossed?: boolean;
}

// ── Output ──────────────────────────────────────────────────────────────

export interface BigEventResult {
  /** True when at least one trigger fired and total score ≥ threshold. */
  isBigEvent: boolean;
  triggers: BigEventTrigger[];
  /** 0-100. Sum of trigger weights, clamped. */
  totalScore: number;
  confidence: ConfidenceLevel;
  urgency: UrgencyLevel;
  tier: SituationTier;
  /** Where this lands on the notification ladder. */
  deliveryPriority: DeliveryPriority;
  /** Why the user is being notified (or not). */
  explanation: string;
}

// ── Configuration ────────────────────────────────────────────────────────

export interface BigEventDetectorOptions {
  /** Total-score threshold for `isBigEvent = true`. Default 40 — one
   *  strong trigger or two medium ones. */
  threshold?: number;
  /** "Rapid" jump in severity (current minus previous). Default 25. */
  rapidJumpDelta?: number;
  /** Sources required to fire `many_sources_converge`. Default 4. */
  manySourcesThreshold?: number;
  /** Truth score below which `official_confirms_weak` is interesting
   *  (otherwise we wouldn't call the original signal "weak"). Default 0.5. */
  weakSignalCeiling?: number;
  /** User-exposure score above which `high_personal_exposure` fires.
   *  Default 70. */
  exposureFloor?: number;
  /** Domains that, when overlapping, count toward `multi_domain_overlap`.
   *  Default: any 2+ distinct domains. */
  multiDomainMinimum?: number;
  /** Potential impact above which `low_confidence_extreme_impact`
   *  fires when truth score is low. Default 80. */
  extremeImpactFloor?: number;
}

// ── The detector ────────────────────────────────────────────────────────

export function detectBigEvent(
  input: BigEventInput,
  options: BigEventDetectorOptions = {},
): BigEventResult {
  const opts = withDefaults(options);
  const triggers = collectTriggers(input, opts);
  const totalScore = clamp(0, 100, sumWeights(triggers));

  const confidence = classifyConfidence(input.truthScore);
  const urgency = computeUrgency(input);
  const tier = tierFor({
    confidence,
    urgency,
    severityScore: input.severityScore,
    highPersonalExposure: input.userExposure >= opts.exposureFloor,
  });
  const deliveryPriority = deliveryPriorityFor(confidence, urgency, {
    potentialImpactExtreme: input.potentialImpact >= opts.extremeImpactFloor,
  });

  const isBigEvent = triggers.length > 0 && totalScore >= opts.threshold;
  const explanation = explainResult(isBigEvent, triggers, confidence, urgency, deliveryPriority);

  return {
    isBigEvent,
    triggers,
    totalScore,
    confidence,
    urgency,
    tier,
    deliveryPriority,
    explanation,
  };
}

// ── Trigger collection ─────────────────────────────────────────────────

function collectTriggers(input: BigEventInput, opts: Required<BigEventDetectorOptions>): BigEventTrigger[] {
  const triggers: BigEventTrigger[] = [];

  if (
    input.previousSeverityScore !== undefined &&
    input.severityScore - input.previousSeverityScore >= opts.rapidJumpDelta
  ) {
    const delta = input.severityScore - input.previousSeverityScore;
    triggers.push({
      kind: 'rapid_severity_jump',
      weight: clamp(0, 35, Math.round(delta)),
      rationale: `Severity jumped ${delta} points (${input.previousSeverityScore} → ${input.severityScore})`,
    });
  }

  if (input.sourceCount >= opts.manySourcesThreshold) {
    triggers.push({
      kind: 'many_sources_converge',
      weight: 25,
      rationale: `${input.sourceCount} sources now agree`,
    });
  }

  if (input.hasOfficialSource && input.truthScore < opts.weakSignalCeiling) {
    triggers.push({
      kind: 'official_confirms_weak',
      weight: 30,
      rationale: 'Official source has now confirmed an earlier weak signal',
    });
  }

  if (input.userExposure >= opts.exposureFloor) {
    triggers.push({
      kind: 'high_personal_exposure',
      weight: 30,
      rationale: `Personal exposure ${input.userExposure}/100 — user is in the path`,
    });
  }

  const distinctDomains = new Set(input.overlappingDomains).size;
  if (distinctDomains >= opts.multiDomainMinimum) {
    triggers.push({
      kind: 'multi_domain_overlap',
      weight: 20,
      rationale: `Cross-domain overlap across ${distinctDomains} domains`,
    });
  }

  if (input.truthScore >= 0.65 && input.potentialImpact >= 70) {
    triggers.push({
      kind: 'high_confidence_high_impact',
      weight: 35,
      rationale: 'High confidence + high potential impact',
    });
  }

  if (input.truthScore < 0.45 && input.potentialImpact >= opts.extremeImpactFloor) {
    triggers.push({
      kind: 'low_confidence_extreme_impact',
      weight: 25,
      rationale: 'Low confidence today but the worst-case impact is extreme',
    });
  }

  if (input.forecastThresholdCrossed === true) {
    triggers.push({
      kind: 'forecast_threshold_crossed',
      weight: 25,
      rationale: 'Forecast model just crossed an alerting threshold',
    });
  }

  return triggers;
}

// ── Urgency derivation ──────────────────────────────────────────────────
//
// Urgency is not directly an input here — we derive it from the inputs
// the caller does pass. This keeps the matrix's confidence/urgency
// separation honest while allowing a single call site.

function computeUrgency(input: BigEventInput): UrgencyLevel {
  // Start from severity as a 0-100 urgency baseline.
  let urgency = input.severityScore;
  // Forecast-threshold-crossed events are always at least medium-high.
  if (input.forecastThresholdCrossed) urgency = Math.max(urgency, 70);
  // Rapid jumps are urgent regardless of starting severity.
  if (input.previousSeverityScore !== undefined) {
    const delta = input.severityScore - input.previousSeverityScore;
    if (delta >= 30) urgency = Math.max(urgency, 75);
    else if (delta >= 15) urgency = Math.max(urgency, 55);
  }
  // Personal exposure adds modestly (severity & forecast carry the
  // weight; we don't want exposure alone to flip urgency).
  if (input.userExposure >= 80) urgency = Math.max(urgency, 60);
  return classifyUrgency(urgency);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function withDefaults(opts: BigEventDetectorOptions): Required<BigEventDetectorOptions> {
  return {
    threshold: opts.threshold ?? 40,
    rapidJumpDelta: opts.rapidJumpDelta ?? 25,
    manySourcesThreshold: opts.manySourcesThreshold ?? 4,
    weakSignalCeiling: opts.weakSignalCeiling ?? 0.5,
    exposureFloor: opts.exposureFloor ?? 70,
    multiDomainMinimum: opts.multiDomainMinimum ?? 2,
    extremeImpactFloor: opts.extremeImpactFloor ?? 80,
  };
}

function sumWeights(triggers: readonly BigEventTrigger[]): number {
  let s = 0;
  for (const t of triggers) s += t.weight;
  return s;
}

function clamp(min: number, max: number, x: number): number {
  return Math.max(min, Math.min(max, x));
}

function explainResult(
  isBig: boolean,
  triggers: readonly BigEventTrigger[],
  confidence: ConfidenceLevel,
  urgency: UrgencyLevel,
  priority: DeliveryPriority,
): string {
  if (!isBig) {
    return `Below big-event threshold (${triggers.length} trigger${triggers.length === 1 ? '' : 's'}): ${
      explainPriority(confidence, urgency, priority)
    }`;
  }
  // Lead with the strongest trigger to keep the line short.
  const strongest = [...triggers].sort((a, b) => b.weight - a.weight)[0];
  const others = triggers.length > 1 ? ` (+${triggers.length - 1} more)` : '';
  return `Big event: ${strongest!.rationale}${others}. ${explainPriority(confidence, urgency, priority)}.`;
}
