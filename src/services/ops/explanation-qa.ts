/**
 * Explanation QA scorer — per
 * docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md PR 3.
 *
 * Pure deterministic checklist that grades the quality of a "why
 * this alert?" explanation. The gameplan's "Why Layer" section
 * lists the things every score needs: corroborating sources, the
 * affected place, what changed, uncertainty, and a recommended
 * action. This module turns that list into a structured score so
 * the closed-loop layer can detect drift in explanation quality
 * over time (an alert that suddenly stops citing sources is a
 * regression).
 *
 * No DOM, no fetch, no globals at import time.
 */

// ── Public API ──────────────────────────────────────────────────────────

export interface ExplanationInput {
  /** Free-text headline, e.g. "Tornado warning at home". */
  headline: string;
  /** Free-text reason / why bullet list. */
  reason: string;
  /** List of corroborating sources (NWS, USGS, EIA, watchlist, …). */
  sources: readonly string[];
  /** Affected places (saved-place ids or labels). */
  places: readonly string[];
  /** What changed since the last update. Empty string = no change tracking. */
  whatChanged?: string;
  /** Uncertainty caveats — what we don't know. */
  uncertainty?: string;
  /** Recommended user action. */
  recommendedAction?: string;
  /** Confidence multiplier 0..1 we're claiming. */
  confidence?: number;
  /** Numeric score the alert is asserting (e.g. risk = 82). */
  score?: number;
}

export type CheckId =
  | 'has_headline'
  | 'has_reason'
  | 'cites_sources'
  | 'multi_source'
  | 'names_place'
  | 'has_what_changed'
  | 'has_uncertainty'
  | 'has_recommended_action'
  | 'has_confidence';

export interface CheckResult {
  id: CheckId;
  /** Display label. */
  label: string;
  /** Did the explanation pass this check? */
  passed: boolean;
  /** Free-text reason — surfaced in the inspector. */
  reason: string;
  /** Weight used in the overall score (0..1). */
  weight: number;
}

export interface ExplanationQAScore {
  /** 0..1 weighted score. */
  score: number;
  /** Letter grade. */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  results: readonly CheckResult[];
  /** Concrete fixes the operator can apply to lift the score. */
  fixes: readonly string[];
}

// ── Default check set ──────────────────────────────────────────────────

const DEFAULT_WEIGHTS: Record<CheckId, number> = {
  has_headline: 0.05,
  has_reason: 0.15,
  cites_sources: 0.15,
  multi_source: 0.1,
  names_place: 0.1,
  has_what_changed: 0.1,
  has_uncertainty: 0.1,
  has_recommended_action: 0.15,
  has_confidence: 0.1,
};

export function scoreExplanation(input: ExplanationInput): ExplanationQAScore {
  const results: CheckResult[] = [
    runCheck('has_headline', 'Headline', !!input.headline.trim(), 'Headline is empty.'),
    runCheck(
      'has_reason',
      'Reason / why',
      input.reason.trim().length >= 16,
      'Reason is missing or too short (need at least 16 chars).',
    ),
    runCheck('cites_sources', 'Cites at least one source', input.sources.length >= 1, 'No source cited.'),
    runCheck(
      'multi_source',
      'Multiple corroborating sources',
      input.sources.length >= 2,
      'Only one source cited — multi-source corroboration not visible.',
    ),
    runCheck('names_place', 'Names the affected place(s)', input.places.length >= 1, 'No place named.'),
    runCheck(
      'has_what_changed',
      'What changed',
      !!input.whatChanged && input.whatChanged.trim().length > 0,
      'No "what changed" delta — readers can\'t tell if this is escalating.',
    ),
    runCheck(
      'has_uncertainty',
      'Uncertainty / caveats',
      !!input.uncertainty && input.uncertainty.trim().length > 0,
      'No uncertainty caveat — overconfidence risk.',
    ),
    runCheck(
      'has_recommended_action',
      'Recommended action',
      !!input.recommendedAction && input.recommendedAction.trim().length > 0,
      'No recommended action — readers don\'t know what to do.',
    ),
    runCheck(
      'has_confidence',
      'Confidence stated',
      input.confidence !== undefined && input.confidence >= 0 && input.confidence <= 1,
      'Confidence not stated or out of [0..1].',
    ),
  ];
  const score = sumWeighted(results);
  return {
    score,
    grade: pickGrade(score),
    results,
    fixes: results.filter((r) => !r.passed).map((r) => fixFor(r.id)),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function runCheck(
  id: CheckId,
  label: string,
  passed: boolean,
  failReason: string,
): CheckResult {
  return {
    id,
    label,
    passed,
    reason: passed ? 'OK' : failReason,
    weight: DEFAULT_WEIGHTS[id],
  };
}

function sumWeighted(results: readonly CheckResult[]): number {
  let score = 0;
  for (const r of results) {
    if (r.passed) score += r.weight;
  }
  // Snap to 1 within float error so a perfect-pass returns exactly 1.0.
  if (Math.abs(score - 1) < 1e-9) return 1;
  return Math.min(1, Math.max(0, score));
}

function pickGrade(score: number): ExplanationQAScore['grade'] {
  if (score >= 0.9) return 'A';
  if (score >= 0.8) return 'B';
  if (score >= 0.7) return 'C';
  if (score >= 0.6) return 'D';
  return 'F';
}

function fixFor(id: CheckId): string {
  switch (id) {
    case 'has_headline': {
      return 'Add a 1-line headline that names the threat.';
    }
    case 'has_reason': {
      return 'Expand the reason to at least one full sentence explaining why we care.';
    }
    case 'cites_sources': {
      return 'Cite the underlying source (NWS / USGS / EIA / watchlist match).';
    }
    case 'multi_source': {
      return 'Pull in a second corroborating source so readers see independent agreement.';
    }
    case 'names_place': {
      return 'Name the affected place explicitly (saved-place label or coordinates).';
    }
    case 'has_what_changed': {
      return 'State what changed since the last update (e.g. "wind tag increased to 70 mph").';
    }
    case 'has_uncertainty': {
      return 'Add an uncertainty caveat ("radar source 8 min stale", "no lightning feed", …).';
    }
    case 'has_recommended_action': {
      return 'Tell the user what to do ("shelter now", "monitor", "no action needed").';
    }
    case 'has_confidence': {
      return 'Include a confidence number in [0,1].';
    }
  }
}
