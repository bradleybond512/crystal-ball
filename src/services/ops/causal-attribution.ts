/**
 * Causal Attribution Engine — per
 * docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md Layer 3.
 *
 * Pure deterministic root-cause analyzer. Given a mission record, a
 * notification trace summary, the algorithm-evaluations recorded for
 * the mission's domain, and any diagnostic events that fired during
 * the mission window, produce a ranked list of likely causes for
 * what happened (or didn't happen).
 *
 * Why this matters: without causal attribution, the self-correction
 * loop can tune the wrong knob. A missed weather warning could look
 * like a "weather-urgency algorithm bug" when the real chain was
 * "no saved place → no polygon match → no mission opened → no
 * notification." Tuning urgency in that case would do nothing.
 *
 * Plan invariants:
 *   - No DOM, no fetch, no globals at import time.
 *   - JSON-serializable for the diagnostics export bundle.
 *   - Deterministic — same inputs ⇒ same ordered cause list.
 *   - Categories from the plan: missing_configuration, provider_failure,
 *     stale_data, algorithm_threshold, notification_suppression,
 *     dedupe_suppression, user_permission, sidecar_failure,
 *     insufficient_evidence, true_negative.
 *   - The engine NEVER touches state. It only reads inputs and emits
 *     a structured analysis.
 */

import type { MissionRecord } from './mission-types';
import type { EvaluationRecord } from '@/services/algorithms/algorithm-evaluation-ledger';

// ── Public API ──────────────────────────────────────────────────────────

export type CausalCategory =
  | 'missing_configuration'
  | 'provider_failure'
  | 'stale_data'
  | 'algorithm_threshold'
  | 'notification_suppression'
  | 'dedupe_suppression'
  | 'user_permission'
  | 'sidecar_failure'
  | 'insufficient_evidence'
  | 'true_negative';

export interface CausalCandidate {
  category: CausalCategory;
  /** 0-1 confidence the analyzer assigns to this category. */
  confidence: number;
  /** Free-text rationale that explains the chain ("no saved place →
   *  no polygon match → no mission opened"). */
  reason: string;
  /** Concrete remediation (used by the repair-recommendation engine
   *  in roadmap Layer 7 of the next-level doc). */
  remediation?: string;
}

export interface CausalAttribution {
  missionId: string;
  /** What kind of outcome we're explaining. */
  outcomeKind: CausalOutcomeKind;
  /** Ordered cause candidates, highest confidence first. */
  candidates: readonly CausalCandidate[];
  /** Compact text summary the UI can show ("No saved place — could
   *  not match the polygon"). */
  summary: string;
}

export type CausalOutcomeKind =
  | 'missed_warning'
  | 'late_warning'
  | 'noisy_warning'
  | 'silent_signal'
  | 'true_positive'
  | 'true_negative'
  | 'unknown';

// ── Inputs ──────────────────────────────────────────────────────────────

export interface NotificationTraceForCausal {
  /** Whether the OS-level permission was granted at the time the
   *  mission was active. */
  permissionGranted: boolean;
  /** Whether a notification was actually dispatched for this mission. */
  dispatched: boolean;
  /** Whether the dispatcher suppressed the alert (quiet hours,
   *  repeat suppression, etc.) — true means routing knew about it
   *  but chose not to deliver. */
  suppressed: boolean;
  /** Free-text suppression reason when suppressed=true. */
  suppressionReason?: string;
  /** True when the dispatcher saw it but treated it as a duplicate
   *  of an earlier notification within the dedupe window. */
  dedupedAsDuplicate: boolean;
}

export interface DiagnosticEventForCausal {
  kind: 'sidecar_unreachable' | 'provider_silent' | 'provider_degraded' | 'source_stale' | 'config_missing' | 'other';
  detail: string;
  at: number;
}

export interface AttributeCausesInput {
  mission: MissionRecord;
  outcomeKind: CausalOutcomeKind;
  notificationTrace: NotificationTraceForCausal;
  /** Algorithm evaluations recorded during the mission window. */
  algorithmEvaluations: readonly EvaluationRecord[];
  /** Diagnostic events that fired during the mission window. */
  diagnosticEvents: readonly DiagnosticEventForCausal[];
  /** Pre-computed config gaps (e.g. "no saved place set",
   *  "OTX_API_KEY missing"). */
  configGaps: readonly string[];
}

// ── Implementation ──────────────────────────────────────────────────────

export function attributeCauses(input: AttributeCausesInput): CausalAttribution {
  const candidates: CausalCandidate[] = [];

  // 1. Missing configuration is almost always the deepest root cause —
  //    every downstream stage will fail when this is true. Push it
  //    high.
  for (const gap of input.configGaps) {
    candidates.push({
      category: 'missing_configuration',
      confidence: 0.95,
      reason: gap,
      remediation: gapToRemediation(gap),
    });
  }

  // 2. User permission (notification denial) is the next-highest
  //    explanation for missed warnings on safety domains.
  if (
    !input.notificationTrace.permissionGranted &&
    isSafetyOutcome(input.outcomeKind)
  ) {
    candidates.push({
      category: 'user_permission',
      confidence: 0.9,
      reason: 'OS notification permission was denied — the dispatcher could not reach you',
      remediation: 'Enable notifications for Crystal Ball in System Settings → Notifications',
    });
  }

  // 3. Sidecar / provider failures during the window.
  for (const event of input.diagnosticEvents) {
    candidates.push(diagnosticToCandidate(event));
  }

  // 4. Notification suppression — known reason, dispatcher saw it.
  if (input.notificationTrace.suppressed) {
    candidates.push({
      category: 'notification_suppression',
      confidence: 0.8,
      reason: input.notificationTrace.suppressionReason ?? 'Dispatcher suppressed the notification',
      remediation: 'Check quiet-hours bypass settings and notification thresholds',
    });
  }

  // 5. Dedupe / repeat suppression.
  if (input.notificationTrace.dedupedAsDuplicate) {
    candidates.push({
      category: 'dedupe_suppression',
      confidence: 0.75,
      reason: 'Treated as duplicate of an earlier notification within the dedupe window',
      remediation: 'Review dedupe-window setting; the meaningful-change test may be too coarse',
    });
  }

  // 6. Algorithm threshold — fired only when an actual algorithm
  //    decision underweighted the situation.
  for (const evalRec of input.algorithmEvaluations) {
    const c = algorithmEvaluationToCandidate(evalRec, input.outcomeKind);
    if (c) candidates.push(c);
  }

  // 7. Insufficient evidence: when no other cause fired but the
  //    outcome was a missed/late warning. Last resort.
  if (
    candidates.length === 0 &&
    (input.outcomeKind === 'missed_warning' || input.outcomeKind === 'late_warning' || input.outcomeKind === 'silent_signal')
  ) {
    candidates.push({
      category: 'insufficient_evidence',
      confidence: 0.5,
      reason: 'No specific failure point identified — likely an evidence gap (single source, low corroboration)',
      remediation: 'Increase source coverage or relax confidence threshold',
    });
  }

  // 8. True positive / true negative — explicit "no fault" outcomes
  //    so the closed-loop layer can reason about them.
  if (input.outcomeKind === 'true_positive' || input.outcomeKind === 'true_negative') {
    candidates.push({
      category: 'true_negative',
      confidence: 1,
      reason: input.outcomeKind === 'true_positive'
        ? 'Warning fired and the event happened — no fault'
        : 'No warning fired and no event happened — no fault',
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const summary = buildSummary(input.outcomeKind, candidates);

  return {
    missionId: input.mission.id,
    outcomeKind: input.outcomeKind,
    candidates,
    summary,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function isSafetyOutcome(kind: CausalOutcomeKind): boolean {
  return kind === 'missed_warning' || kind === 'late_warning' || kind === 'silent_signal';
}

function gapToRemediation(gap: string): string {
  const lower = gap.toLowerCase();
  if (lower.includes('saved place') || lower.includes('savedplace')) {
    return 'Add a saved place in Settings → Locations so the polygon matcher can match alerts to your area';
  }
  if (lower.includes('api key') || lower.includes('api_key') || lower.includes('token')) {
    return 'Add the API key in Settings → API Keys';
  }
  if (lower.includes('notification')) {
    return 'Enable notifications in System Settings';
  }
  return `Resolve: ${gap}`;
}

function diagnosticToCandidate(event: DiagnosticEventForCausal): CausalCandidate {
  switch (event.kind) {
    case 'sidecar_unreachable': {
      return {
        category: 'sidecar_failure',
        confidence: 0.85,
        reason: `Sidecar unreachable: ${event.detail}`,
        remediation: 'Restart Crystal Ball or check the sidecar log at ~/Library/Logs/com.bradleybond.crystalball/local-api.log',
      };
    }
    case 'provider_silent': {
      return {
        category: 'provider_failure',
        confidence: 0.8,
        reason: `Provider silent: ${event.detail}`,
        remediation: 'Provider has stopped responding — check provider status page or rotate to backup',
      };
    }
    case 'provider_degraded': {
      return {
        category: 'provider_failure',
        confidence: 0.6,
        reason: `Provider degraded: ${event.detail}`,
        remediation: 'Provider is responding but with elevated errors — monitor and rotate if it persists',
      };
    }
    case 'source_stale': {
      return {
        category: 'stale_data',
        confidence: 0.75,
        reason: `Source data is stale: ${event.detail}`,
        remediation: 'Force a refresh, or check whether the upstream is publishing within its expected interval',
      };
    }
    case 'config_missing': {
      return {
        category: 'missing_configuration',
        confidence: 0.9,
        reason: `Missing configuration: ${event.detail}`,
        remediation: gapToRemediation(event.detail),
      };
    }
    default: {
      return {
        category: 'insufficient_evidence',
        confidence: 0.4,
        reason: `Diagnostic event: ${event.detail}`,
      };
    }
  }
}

function algorithmEvaluationToCandidate(
  evalRec: EvaluationRecord,
  outcomeKind: CausalOutcomeKind,
): CausalCandidate | null {
  // Only treat algorithm threshold as a cause when the evaluation
  // was graded as miss/inconclusive AND the outcome was bad.
  if (outcomeKind !== 'missed_warning' && outcomeKind !== 'late_warning' && outcomeKind !== 'silent_signal') {
    return null;
  }
  if (evalRec.outcome !== 'miss' && evalRec.outcome !== 'inconclusive') return null;
  return {
    category: 'algorithm_threshold',
    confidence: evalRec.outcome === 'miss' ? 0.7 : 0.5,
    reason: `Algorithm "${evalRec.algorithmId}" graded as ${evalRec.outcome}: ${evalRec.outcomeReason ?? 'no reason recorded'}`,
    remediation: `Run a counterfactual replay against ${evalRec.algorithmId} with a tighter threshold`,
  };
}

function buildSummary(outcomeKind: CausalOutcomeKind, candidates: readonly CausalCandidate[]): string {
  if (candidates.length === 0) return `No causes identified for ${outcomeKind}.`;
  const top = candidates[0]!;
  return `${outcomeKind}: ${top.reason}`;
}
