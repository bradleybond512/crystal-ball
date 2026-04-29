/* eslint-disable sonarjs/no-nested-template-literals, sonarjs/cognitive-complexity */
/**
 * After-action review + self-learning — Phase 6 of
 * docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Pure deterministic. Closes the loop on every high-impact situation:
 *   - Compares predicted severity / confidence / urgency against
 *     ground-truth observations after resolution
 *   - Classifies the prediction as correct / late / early /
 *     false_positive / missed
 *   - Detects late alerts (warning fired AFTER the event arrived)
 *   - Recommends threshold / source-weight tuning, gated by the
 *     existing policy-gate so unsafe auto-tuning is blocked
 *
 * No DOM, no fetch. Inputs are structural; outputs are JSON-serializable.
 *
 * Vision invariant: 'Do not auto-apply high-risk tuning without
 * policy-gate approval. Unknown algorithm metadata must fail closed
 * and require user approval.'
 */

import type { PredictionOutcome, Situation } from './situation-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface GroundTruthObservation {
  /** When the actual event arrived / impact began. */
  arrivedAt?: number;
  /** Whether the predicted event actually happened at all. */
  actuallyHappened: boolean;
  /** Severity tier of the actual outcome (matched against the
   *  prediction's severity at first emit). */
  actualSeverityTier?: Situation['severity'];
  /** Free-text observed impact summary. */
  observedImpact?: string;
}

export interface AfterActionInput {
  /** The resolved (or about-to-resolve) situation. */
  situation: Situation;
  /** Ground-truth observation collected after the event. */
  groundTruth: GroundTruthObservation;
  /** Now() override for tests. */
  now?: () => number;
}

export interface AfterActionReport {
  situationId: string;
  /** Verdict matching PredictionOutcome.verdict. */
  verdict: NonNullable<PredictionOutcome['verdict']>;
  /** Minutes between alert emission and event arrival. Negative when
   *  we warned after impact (late alert), positive when we warned
   *  ahead of time. */
  warningMinutes: number;
  /** Free-text rationale. */
  rationale: string;
  /** Plain-English brief — readable summary of the after-action,
   *  ready to render in the UI. */
  brief: string;
  /** Tuning recommendations (severity / confidence / urgency /
   *  source-weight). Each recommendation is gated — see
   *  AfterActionRecommendation.gateAction. */
  recommendations: readonly AfterActionRecommendation[];
}

export interface AfterActionRecommendation {
  id: string;
  /** Imperative phrase the operator (or policy-gate) sees. */
  text: string;
  /** Numeric delta the recommendation suggests. */
  delta: number;
  /** Field this recommendation would tune. */
  target: 'severity_threshold' | 'confidence_floor' | 'urgency_decay_rate' | 'source_weight';
  /** Required policy-gate disposition. Phase 1 of policy-gate already
   *  enforces 'require_user_approval' for ambiguous cases — this
   *  field declares the recommendation's required gate so the host
   *  can route it correctly. */
  gateAction: 'require_user_approval' | 'require_pr_review' | 'allow_auto' | 'deny';
}

// ── Public functions ────────────────────────────────────────────────────

/** Run after-action review and produce a structured report. */
export function reviewSituation(input: AfterActionInput): AfterActionReport {
  const s = input.situation;
  const gt = input.groundTruth;

  // 1. Determine verdict.
  const verdict = classifyVerdict(s, gt);

  // 2. Time-to-warn analysis. Positive leadMinutes = warned ahead;
  // negative = warned after impact (late warning).
  const arrivedAt = gt.arrivedAt;
  const leadMinutes = arrivedAt === undefined
    ? 0
    : Math.round((arrivedAt - s.firstSeen) / 60_000);

  // 3. Rationale.
  const rationale = composeRationale(s, gt, verdict, leadMinutes);

  // 4. Brief — UI-ready prose.
  const brief = composeBrief(s, gt, verdict, leadMinutes);

  // 5. Recommendations.
  const recommendations = recommendTuning(s, gt, verdict, leadMinutes);

  return {
    situationId: s.id,
    verdict,
    warningMinutes: leadMinutes,
    rationale,
    brief,
    recommendations,
  };
}

/** Apply the after-action verdict to the situation, returning a new
 *  Situation with a populated PredictionOutcome. The store can then
 *  upsert this. */
export function applyAfterActionReview(
  situation: Situation,
  report: AfterActionReport,
  now: number = Date.now(),
): Situation {
  return {
    ...situation,
    phase: 'resolved',
    lastUpdated: now,
    predictionOutcome: {
      ...situation.predictionOutcome,
      resolvedAt: now,
      verdict: report.verdict,
      notes: report.rationale,
    },
  };
}

// ── Verdict classifier ─────────────────────────────────────────────────

function classifyVerdict(
  s: Situation,
  gt: GroundTruthObservation,
): NonNullable<PredictionOutcome['verdict']> {
  if (!gt.actuallyHappened) {
    return 'false_positive';
  }
  // Late: arrived before we first emitted → warning came too late.
  if (gt.arrivedAt !== undefined && gt.arrivedAt < s.firstSeen) {
    return 'late';
  }
  // Early: predicted severity > actual severity by 2+ tiers.
  if (gt.actualSeverityTier && severityRank(s.severity) - severityRank(gt.actualSeverityTier) >= 2) {
    return 'early';
  }
  // Missed: situation never reached 'active' phase but the event
  // happened anyway. (Phase tracking from the Phase 3 watch-window.)
  if (s.phase !== 'active') {
    return 'missed';
  }
  return 'correct';
}

function severityRank(s: Situation['severity']): number {
  return ['fyi', 'watch', 'elevated', 'critical', 'emergency'].indexOf(s);
}

// ── Recommendation engine ──────────────────────────────────────────────

function recommendTuning(
  s: Situation,
  _gt: GroundTruthObservation,
  verdict: NonNullable<PredictionOutcome['verdict']>,
  leadMinutes: number,
): AfterActionRecommendation[] {
  const out: AfterActionRecommendation[] = [];
  // Late alerts → recommend lowering the severity threshold so we
  // emit earlier next time. Always require user approval — auto-
  // applying threshold drops is the most failure-prone path.
  if (verdict === 'late') {
    out.push({
      id: `${s.id}:rec:lower-severity-threshold`,
      text: 'Lower severity threshold for this domain so the alert fires earlier.',
      delta: -0.05,
      target: 'severity_threshold',
      gateAction: 'require_user_approval',
    });
  }
  // False positives → raise the confidence floor for this source mix.
  if (verdict === 'false_positive') {
    out.push({
      id: `${s.id}:rec:raise-confidence-floor`,
      text: 'Raise the confidence floor for this source combination so noisy signals are suppressed.',
      delta: 0.05,
      target: 'confidence_floor',
      gateAction: 'require_user_approval',
    });
  }
  // Early alerts (predicted-severity-too-high) → maybe we trust this
  // source too much. Recommend a modest source-weight reduction
  // and PR-review the change because changing source weights affects
  // every domain.
  if (verdict === 'early') {
    out.push({
      id: `${s.id}:rec:reduce-source-weight`,
      text: 'Reduce weight of the dominant agreeing source so this prediction is less aggressive next time.',
      delta: -0.05,
      target: 'source_weight',
      gateAction: 'require_pr_review',
    });
  }
  // Missed (event happened, we never escalated) → boost source
  // weight or lower confidence floor. PR review.
  if (verdict === 'missed') {
    out.push({
      id: `${s.id}:rec:lower-confidence-floor`,
      text: 'Lower the confidence floor for this domain so we emit even when fewer sources agree.',
      delta: -0.05,
      target: 'confidence_floor',
      gateAction: 'require_pr_review',
    });
  }
  // Correct + lead time was very long (>120 min) → maybe we can
  // tighten urgency decay so urgency drops faster. Allow auto since
  // it's a non-safety adjustment.
  if (verdict === 'correct' && leadMinutes > 120) {
    out.push({
      id: `${s.id}:rec:tighten-urgency-decay`,
      text: 'Tighten urgency decay — long lead time without escalation means urgency was too high too long.',
      delta: 0.05,
      target: 'urgency_decay_rate',
      gateAction: 'allow_auto',
    });
  }
  return out;
}

// ── Brief / rationale composers ─────────────────────────────────────────

function composeRationale(
  s: Situation,
  gt: GroundTruthObservation,
  verdict: NonNullable<PredictionOutcome['verdict']>,
  leadMinutes: number,
): string {
  const parts: string[] = [`Verdict: ${verdict}`];
  if (gt.arrivedAt !== undefined) {
    parts.push(leadMinutes >= 0
      ? `Warned ${leadMinutes} min before arrival`
      : `Warned ${Math.abs(leadMinutes)} min AFTER arrival (late)`);
  }
  if (gt.actualSeverityTier) {
    parts.push(`Predicted '${s.severity}' vs actual '${gt.actualSeverityTier}'`);
  }
  if (gt.observedImpact) {
    parts.push(`Observed impact: ${gt.observedImpact}`);
  }
  return parts.join('. ') + '.';
}

function composeBrief(
  s: Situation,
  gt: GroundTruthObservation,
  verdict: NonNullable<PredictionOutcome['verdict']>,
  leadMinutes: number,
): string {
  const lines: string[] = [];
  // Header line — pattern from the vision doc: 'We warned X min
  // before arrival. <Match details>. Missed signal: ...'
  if (gt.arrivedAt !== undefined && leadMinutes >= 0) {
    lines.push(`We warned ${leadMinutes} min before arrival.`);
  } else if (gt.arrivedAt !== undefined && leadMinutes < 0) {
    lines.push(`Warning fired ${Math.abs(leadMinutes)} min AFTER the event arrived (late alert).`);
  }

  // Source agreement line
  const { agreeing, disagreeing } = s.sourceAgreement;
  if (agreeing.length > 0) {
    lines.push(`Sources confirmed: ${agreeing.slice(0, 3).join(', ')}${disagreeing.length > 0 ? ` (${disagreeing.length} disputed)` : ''}.`);
  }

  // Watch-window summary
  const confirmedCount = s.diagnosticsTrace.thresholdsCrossed.filter((t) => t.startsWith('confirmed:')).length;
  const missedCount = s.diagnosticsTrace.thresholdsCrossed.filter((t) => t.startsWith('missed:')).length;
  if (confirmedCount > 0 || missedCount > 0) {
    const parts: string[] = [];
    if (confirmedCount > 0) parts.push(`${confirmedCount} expected signal(s) confirmed`);
    if (missedCount > 0) parts.push(`${missedCount} expected signal(s) missed`);
    lines.push(`Watch-window: ${parts.join(' / ')}.`);
  }

  // Verdict-specific recommendation hint
  if (verdict === 'late') {
    lines.push('Recommendation: lower severity threshold to fire earlier next time.');
  } else if (verdict === 'false_positive') {
    lines.push('Recommendation: raise confidence floor to suppress noisy source mixes.');
  } else if (verdict === 'missed') {
    lines.push('Recommendation: lower confidence floor — event happened without us escalating.');
  } else if (verdict === 'early') {
    lines.push('Recommendation: reduce dominant-source weight — predicted severity exceeded actual by 2+ tiers.');
  }

  return lines.join('\n');
}
