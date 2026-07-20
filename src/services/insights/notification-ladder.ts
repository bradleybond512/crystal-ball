/**
 * Notification ladder — Insights PR 4.
 *
 * Bridges the Big Event Detector + Confidence/Urgency Matrix output
 * into the Notification Trace Registry so every candidate gets a
 * recorded life-cycle ("created → urgency check → relevance check →
 * dedupe → quiet-hours → rung → native result → user action").
 *
 * Pure deterministic glue. No DOM, no fetch. The host calls
 * `routeBigEventToLadder` whenever a new BigEventResult lands, and
 * the ladder records the trace + decides the rung.
 */

import type {
  BigEventResult,
  BigEventInput,
} from './big-event-detector';
import type {
  DeliveryPriority,
  SituationTier,
} from './confidence-urgency-matrix';
import type {
  NotificationTraceRegistry,
  NotificationRung,
  NotificationDomain,
  NotificationUrgency,
} from '@/services/diagnostics/notification-trace';
import type { AlertExplanation } from '@/services/intelligence/explainer';
import { attentionWeight, nextActiveHour } from '@/services/cognition/operator-model';

// ── Public API ──────────────────────────────────────────────────────────

export interface RouteToLadderOptions {
  /** Stable id for this candidate. Defaults to `bigEvent-${at}-${i}`. */
  candidateId?: string;
  /** Upstream alert / situation id. */
  situationId?: string;
  domain: NotificationDomain;
  /** Headline shown to the user when delivered. */
  headline?: string;
  /** Plain-English summary of the situation. */
  summary?: string;
  /** Whether quiet hours are active. */
  quietHoursActive?: boolean;
  /** Whether the user has the weather quiet-hours bypass enabled. */
  quietHoursBypassEnabled?: boolean;
  /** Whether the candidate has already been dispatched in the
   *  recent window (used for dedupe). */
  dedupeMatch?: boolean;
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
  /**
   * Pre-computed explanation from the Explain stage. When provided, it
   * is passed through to `LadderDecision` so the dispatcher can attach
   * it to the notification payload.
   */
  explanation?: AlertExplanation;
  /**
   * Whether to apply operator-model attention-rhythm deferral for
   * non-safety-critical notifications. When true, a low attentionWeight
   * at the current hour may defer the notification to the next active
   * window. SAFETY-CRITICAL NOTIFICATIONS ARE NEVER DEFERRED regardless
   * of this flag — the safetyCritical check gates the deferral branch
   * so the safety path cannot reach it.
   */
  applyAttentionDeferral?: boolean;
  /** Threshold below which attentionWeight triggers deferral (default 0.3). */
  attentionDeferralThreshold?: number;
}

export interface LadderDecision {
  candidateId: string;
  rung: NotificationRung;
  /** Was this candidate dispatched? False = suppressed. */
  dispatched: boolean;
  reason: string;
  /** True = the candidate is safety-critical and was suppressed. The
   *  notification trace registry will surface this as
   *  `unsafeSuppressions`. */
  unsafeSuppression: boolean;
  /**
   * Human-readable explanation attached by the Explain stage.
   * Present when the caller passed `options.explanation`. Undefined
   * when the caller did not invoke the Explain stage (e.g. tests that
   * only care about rung assignment).
   */
  explanation?: AlertExplanation;
  /**
   * If set, the notification was deferred to the user's next active
   * hour per the operator-model attention rhythm. The value is the
   * Unix-ms timestamp of the next active window.
   * NOTE: safety-critical notifications are NEVER deferred; this field
   * is absent for them.
   */
  deferredUntil?: number;
}

let nextAutoId = 1;

/** Route a Big Event into the notification trace registry. The
 *  registry records the full life-cycle; this function returns the
 *  decision so the dispatcher can act on it. */
export function routeBigEventToLadder(
  registry: NotificationTraceRegistry,
  result: BigEventResult,
  input: BigEventInput,
  options: RouteToLadderOptions,
): LadderDecision {
  const now = options.now ?? (() => Date.now());
  const at = now();
  const candidateId = options.candidateId ?? `bigEvent-${at}-${nextAutoId++}`;
  const urgency = mapTierToUrgency(result.tier);
  // Use a Set so adding a new SituationTier that warrants safety-critical
  // treatment requires an explicit update here rather than silently passing
  // through a two-term OR and inheriting non-critical behaviour.
  const SAFETY_CRITICAL_TIERS = new Set<SituationTier>(['emergency', 'critical']);
  const safetyCritical = SAFETY_CRITICAL_TIERS.has(result.tier);

  registry.register({
    candidateId,
    situationId: options.situationId,
    domain: options.domain,
    urgency,
    confidence: input.truthScore,
    userRelevance: input.userExposure / 100,
    safetyCritical,
    createdAt: at,
    headline: options.headline,
  });

  registry.recordEvent(candidateId, {
    kind: 'urgency_check',
    reason: `Tier ${result.tier} (score ${result.totalScore}, urgency ${result.urgency}).`,
    detail: { tier: result.tier, totalScore: result.totalScore, urgency: result.urgency },
  });

  registry.recordEvent(candidateId, {
    kind: 'relevance_check',
    reason: `User exposure ${input.userExposure}/100.`,
    detail: { exposure: input.userExposure },
  });

  registry.recordEvent(candidateId, {
    kind: 'dedupe_check',
    reason: options.dedupeMatch ? 'Match against recent dispatch found.' : 'No dedupe match.',
    detail: { dedupeMatch: !!options.dedupeMatch },
  });

  if (options.dedupeMatch) {
    registry.suppress(candidateId, 'duplicate-of-recent', at);
    return {
      candidateId,
      rung: 'silent',
      dispatched: false,
      reason: 'Suppressed — duplicate of a recent dispatch.',
      unsafeSuppression: false,
    };
  }

  const quietActive = !!options.quietHoursActive;
  const quietBypass = !!options.quietHoursBypassEnabled;
  registry.recordEvent(candidateId, {
    kind: 'quiet_hours_check',
    reason: describeQuietHours(quietActive, quietBypass),
    detail: { quietActive, quietBypass },
  });

  // Quiet-hours suppression — but never for safety-critical.
  if (quietActive && !quietBypass && !safetyCritical) {
    registry.suppress(candidateId, 'quiet-hours-no-bypass', at);
    return {
      candidateId,
      rung: 'silent',
      dispatched: false,
      reason: 'Suppressed — quiet hours active and bypass disabled.',
      unsafeSuppression: false,
    };
  }
  if (quietActive && !quietBypass && safetyCritical) {
    // Safety-critical event during quiet hours where bypass is OFF —
    // gameplan invariant: never miss what matters. We still dispatch
    // but we record the unsafe gap so the user can see they came
    // close to missing this.
    registry.recordEvent(candidateId, {
      kind: 'urgency_check',
      reason: 'Safety-critical override: dispatching despite quiet hours.',
    });
  }

  // Attention-rhythm deferral — ONLY for non-safety-critical notifications.
  // Safety-critical events MUST NOT enter this branch. The `!safetyCritical`
  // guard is the structural guarantee: the safety path physically cannot
  // reach the deferral code.
  if (options.applyAttentionDeferral && !safetyCritical) {
    const deferral = maybeDeferForAttention(registry, candidateId, options, at);
    if (deferral) return deferral;
  }

  const rung = pickRung(result.deliveryPriority, safetyCritical);
  registry.dispatch(candidateId, rung, at);
  return {
    candidateId,
    rung,
    dispatched: true,
    reason: `Dispatched at rung "${rung}" (priority ${result.deliveryPriority}).`,
    unsafeSuppression: false,
    explanation: options.explanation,
  };
}

/** Attention-rhythm deferral for non-safety-critical events. Returns a silent
 *  decision when the current attention weight is below threshold and a later
 *  active window exists; returns null to let the caller dispatch now. */
function maybeDeferForAttention(
  registry: NotificationTraceRegistry,
  candidateId: string,
  options: RouteToLadderOptions,
  at: number,
): LadderDecision | null {
  const threshold = options.attentionDeferralThreshold ?? 0.3;
  const currentAttention = attentionWeight(at);
  if (currentAttention >= threshold) return null;

  const nextWindow = nextActiveHour(at, threshold);
  const windowNote = nextWindow
    ? ` Next active window: ${new Date(nextWindow).toISOString()}.`
    : ' No active window found in 24h — dispatching now.';
  registry.recordEvent(candidateId, {
    kind: 'urgency_check',
    reason: `Attention-rhythm deferral: weight ${currentAttention.toFixed(2)} < threshold ${threshold}.${windowNote}`,
    detail: { currentAttention, threshold, nextWindow },
  });

  if (nextWindow === undefined) return null; // No active window in 24h — dispatch now.

  // Defer: record as silent now; host is responsible for re-routing at nextWindow.
  registry.suppress(candidateId, 'quiet-hours-no-bypass', at);
  return {
    candidateId,
    rung: 'silent',
    dispatched: false,
    reason: `Deferred — low attention weight (${currentAttention.toFixed(2)}). Next active window: ${new Date(nextWindow).toISOString()}.`,
    unsafeSuppression: false,
    deferredUntil: nextWindow,
  };
}

function describeQuietHours(active: boolean, bypass: boolean): string {
  if (!active) return 'Quiet hours not active.';
  return bypass
    ? 'Quiet hours active but bypass is enabled.'
    : 'Quiet hours active and bypass is disabled.';
}

// ── Helpers ─────────────────────────────────────────────────────────────

function mapTierToUrgency(tier: SituationTier): NotificationUrgency {
  switch (tier) {
    case 'emergency': {
      return 'critical';
    }
    case 'critical': {
      return 'critical';
    }
    case 'elevated': {
      return 'high';
    }
    case 'watch': {
      return 'normal';
    }
    case 'fyi': {
      return 'low';
    }
  }
}

function pickRung(priority: DeliveryPriority, safetyCritical: boolean): NotificationRung {
  switch (priority) {
    case 'critical_persistent': {
      return safetyCritical ? 'announcement' : 'critical';
    }
    case 'notify_now': {
      // Safety-critical (emergency/critical tier) events top out at 'notify_now'
      // from the confidence×urgency matrix — nothing ever produces
      // 'critical_persistent'. Escalate them to the DND-bypassing 'critical' rung
      // so a genuine emergency is NOT delivered at the same rung as an ordinary
      // notification. (Non-safety events stay at 'banner_sound'.)
      return safetyCritical ? 'critical' : 'banner_sound';
    }
    case 'watch_window': {
      return 'banner';
    }
    case 'digest': {
      return 'in_app';
    }
    case 'background': {
      return 'silent';
    }
  }
}

/** Reset internal counters. Tests + storybook only. */
export function resetNotificationLadderState(): void {
  nextAutoId = 1;
}
