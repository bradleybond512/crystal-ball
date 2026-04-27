/**
 * Confidence × Urgency matrix — per
 * docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md sections 2 + 9.
 *
 * Section 9 (lines 206-219):
 *   High confidence + high urgency = notify now
 *   Low confidence + high urgency = watch window alert
 *   High confidence + low urgency = digest
 *   Low confidence + low urgency = background only
 *
 * The plan deliberately separates confidence (do we believe this?) from
 * urgency (how soon does it matter?). This module produces:
 *   - per-axis classifications from numeric inputs
 *   - a delivery priority for the notification ladder
 *   - a categorical situation tier (FYI / Watch / Elevated / Critical /
 *     Emergency) that the UI uses to decide presentation density
 *
 * Pure deterministic: no DOM, no fetch, no globals.
 *
 * Plan invariant: "Always separate confidence from urgency." We never
 * derive urgency from confidence or vice versa.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type UrgencyLevel = 'low' | 'medium' | 'high';

/** The categorical tier used by the Critical Event Command Center
 *  (plan section 2, lines 44-58). */
export type SituationTier = 'fyi' | 'watch' | 'elevated' | 'critical' | 'emergency';

/** Where this situation belongs in the notification ladder
 *  (plan section 3, lines 60-74). */
export type DeliveryPriority =
  | 'background'             // suppress UI surface; only available if asked
  | 'digest'                 // include in next morning/evening digest
  | 'watch_window'           // soft "watch this" alert; no banner
  | 'notify_now'             // banner + sound (Notification Center)
  | 'critical_persistent';   // persistent in-app + optional iMessage / focus

// ── Numeric → categorical ────────────────────────────────────────────────

/** Map a 0-1 truth/confidence score to the three-level scale.
 *  Thresholds align with the PR 1 truth-score labels:
 *    confirmed/likely  ≥ 0.65 → high
 *    plausible         ≥ 0.45 → medium
 *    weak/disputed    < 0.45 → low
 */
export function classifyConfidence(score01: number): ConfidenceLevel {
  if (!Number.isFinite(score01)) return 'low';
  if (score01 >= 0.65) return 'high';
  if (score01 >= 0.45) return 'medium';
  return 'low';
}

/** Map a 0-100 urgency input to the three-level scale. Urgency is
 *  domain-specific in nature (a 60-min weather lead time is high
 *  urgency; a 60-min market lead time is borderline) but for the
 *  matrix we want a single normalized scale. Callers should compute
 *  their own urgency before calling. */
export function classifyUrgency(score0to100: number): UrgencyLevel {
  if (!Number.isFinite(score0to100)) return 'low';
  if (score0to100 >= 70) return 'high';
  if (score0to100 >= 40) return 'medium';
  return 'low';
}

// ── The matrix itself ────────────────────────────────────────────────────

export interface DeliveryPriorityOptions {
  /** Plan section 8: "Low confidence but extreme possible impact" should
   *  watch-window alert, not background. When true, low/low gets bumped
   *  to watch_window. */
  potentialImpactExtreme?: boolean;
  /** Plan invariant: "Never notify repeatedly for the same unchanged
   *  situation." When true (caller has determined nothing changed
   *  meaningfully since last delivery), the priority is downgraded
   *  one rung. */
  unchangedSinceLastDelivery?: boolean;
}

export function deliveryPriorityFor(
  confidence: ConfidenceLevel,
  urgency: UrgencyLevel,
  options: DeliveryPriorityOptions = {},
): DeliveryPriority {
  const base = baseMatrix(confidence, urgency);
  let result = base;
  if (options.potentialImpactExtreme && result === 'background') {
    result = 'watch_window';
  }
  if (options.unchangedSinceLastDelivery) {
    result = downgrade(result);
  }
  return result;
}

// Plan-specified corners + medium row. Lookup table beats a long if-chain
// for both readability and the cognitive-complexity ceiling.
const MATRIX: Record<ConfidenceLevel, Record<UrgencyLevel, DeliveryPriority>> = {
  high:   { high: 'notify_now',   medium: 'notify_now',  low: 'digest' },
  medium: { high: 'watch_window', medium: 'digest',      low: 'background' },
  low:    { high: 'watch_window', medium: 'background',  low: 'background' },
};

function baseMatrix(confidence: ConfidenceLevel, urgency: UrgencyLevel): DeliveryPriority {
  return MATRIX[confidence][urgency];
}

const PRIORITY_LADDER: DeliveryPriority[] = [
  'background',
  'digest',
  'watch_window',
  'notify_now',
  'critical_persistent',
];

function downgrade(p: DeliveryPriority): DeliveryPriority {
  const idx = PRIORITY_LADDER.indexOf(p);
  if (idx <= 0) return 'background';
  return PRIORITY_LADDER[idx - 1]!;
}

/** True when `a` is at least as urgent as `b`. Useful when merging
 *  duplicate situations: "use whichever priority is higher". */
export function priorityAtLeast(a: DeliveryPriority, b: DeliveryPriority): boolean {
  return PRIORITY_LADDER.indexOf(a) >= PRIORITY_LADDER.indexOf(b);
}

// ── Tier (presentation density) ──────────────────────────────────────────

export interface TierInputs {
  confidence: ConfidenceLevel;
  urgency: UrgencyLevel;
  /** Plan section 8: severity score on 0-100, used to push to Critical
   *  even when confidence is medium. */
  severityScore: number;
  /** When true, the situation is "the user is in the path" — bumps
   *  Watch → Elevated and Elevated → Critical. */
  highPersonalExposure?: boolean;
}

export function tierFor(inputs: TierInputs): SituationTier {
  const { confidence, urgency, severityScore, highPersonalExposure } = inputs;
  let tier = baseTier(confidence, urgency, severityScore);
  if (highPersonalExposure) tier = bumpTier(tier);
  return tier;
}

function baseTier(c: ConfidenceLevel, u: UrgencyLevel, severity: number): SituationTier {
  // Severity dominates the top of the scale. A 95-severity event with
  // medium confidence is still Critical — the plan example for "low
  // confidence but extreme possible impact" (section 8) is exactly
  // this case (we surface but don't auto-notify).
  if (severity >= 90 && c !== 'low' && u === 'high') return 'emergency';
  if (severity >= 75 && (c === 'high' || u === 'high')) return 'critical';
  if (severity >= 60 || (c === 'high' && u !== 'low')) return 'elevated';
  if (severity >= 35 || u !== 'low' || c === 'medium') return 'watch';
  return 'fyi';
}

const TIER_LADDER: SituationTier[] = ['fyi', 'watch', 'elevated', 'critical', 'emergency'];

function bumpTier(t: SituationTier): SituationTier {
  const idx = TIER_LADDER.indexOf(t);
  if (idx === -1 || idx === TIER_LADDER.length - 1) return t;
  return TIER_LADDER[idx + 1]!;
}

// ── Explanation ──────────────────────────────────────────────────────────

/** A short, human-readable line for the UI's "why am I being notified?"
 *  surface. The plan invariant: "Always explain why the user is being
 *  notified." */
export function explainPriority(
  confidence: ConfidenceLevel,
  urgency: UrgencyLevel,
  priority: DeliveryPriority,
): string {
  switch (priority) {
    case 'critical_persistent': {
      return `Critical: ${confidence} confidence, ${urgency} urgency — persistent until acknowledged`;
    }
    case 'notify_now': {
      return `${capitalize(confidence)} confidence and ${urgency} urgency — notifying now`;
    }
    case 'watch_window': {
      return `${capitalize(confidence)} confidence but ${urgency} urgency — added to watch window`;
    }
    case 'digest': {
      return `${capitalize(confidence)} confidence, ${urgency} urgency — included in next digest`;
    }
    case 'background': {
      return `${capitalize(confidence)} confidence, ${urgency} urgency — kept in background`;
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
