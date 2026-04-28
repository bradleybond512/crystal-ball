/**
 * Capability Readiness — per
 * docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md PR 7.
 *
 * The gameplan's Phase 1 success metric is "the user can ask 'why
 * didn't I get warned?' and Crystal Ball answers precisely." This
 * module produces the user-facing readiness checklist that sits
 * behind that promise: what fraction of each capability's
 * preconditions are satisfied, what's missing, and what to do about
 * it.
 *
 * Pure deterministic.
 */

import type { MissionDomain } from './mission-types';

// ── Public API ──────────────────────────────────────────────────────────

export type ReadinessLevel = 'ready' | 'partial' | 'not_ready' | 'unknown';

export interface ReadinessCheckpoint {
  id: string;
  label: string;
  /** Did this checkpoint pass? Undefined = unknown / not measured. */
  satisfied: boolean | undefined;
  /** Free-text reason — surfaced in the inspector. */
  reason: string;
  /** Concrete next-action suggestion when not satisfied. */
  remediation?: string;
}

export interface CapabilityReadiness {
  capabilityId: string;
  label: string;
  /** Mission domain this capability supports. */
  domain: MissionDomain;
  level: ReadinessLevel;
  /** Fraction of measured checkpoints that passed. NaN when none
   *  are measured. */
  score: number;
  checkpoints: readonly ReadinessCheckpoint[];
  summary: string;
}

export interface CapabilityReadinessReport {
  generatedAt: number;
  capabilities: readonly CapabilityReadiness[];
  /** Plain-English overview. */
  summary: string;
  /** Concrete remediations sorted by importance. */
  recommendations: readonly string[];
}

// ── Capability evaluator ───────────────────────────────────────────────

export interface EvaluateCapabilitiesInput {
  generatedAt?: number;
  capabilities: readonly CapabilityDefinition[];
}

export interface CapabilityDefinition {
  capabilityId: string;
  label: string;
  domain: MissionDomain;
  checkpoints: readonly CapabilityCheckpoint[];
}

export interface CapabilityCheckpoint {
  id: string;
  label: string;
  /** True / false / undefined (unknown). */
  satisfied: boolean | undefined;
  /** Required for the capability to be considered ready. When false
   *  the checkpoint contributes to the score but a missed value
   *  doesn't block 'ready'. */
  required: boolean;
  reason: string;
  remediation?: string;
}

export function evaluateCapabilities(
  input: EvaluateCapabilitiesInput,
): CapabilityReadinessReport {
  const generatedAt = input.generatedAt ?? Date.now();
  const capabilities: CapabilityReadiness[] = [];
  for (const def of input.capabilities) {
    capabilities.push(evaluateOne(def));
  }
  return {
    generatedAt,
    capabilities,
    summary: buildSummary(capabilities),
    recommendations: collectRecommendations(capabilities),
  };
}

function evaluateOne(def: CapabilityDefinition): CapabilityReadiness {
  const measured = def.checkpoints.filter((c) => c.satisfied !== undefined);
  const measuredPassed = measured.filter((c) => c.satisfied === true).length;
  const score = measured.length === 0 ? Number.NaN : measuredPassed / measured.length;

  const requiredMissing = def.checkpoints.filter(
    (c) => c.required && c.satisfied === false,
  );
  const anyUnknown = def.checkpoints.some((c) => c.satisfied === undefined);

  let level: ReadinessLevel;
  if (measured.length === 0) {
    level = 'unknown';
  } else if (requiredMissing.length === 0 && !anyUnknown && measuredPassed === measured.length) {
    level = 'ready';
  } else if (requiredMissing.length === 0 && measuredPassed > 0) {
    level = 'partial';
  } else if (requiredMissing.length > 0) {
    level = 'not_ready';
  } else {
    level = 'partial';
  }

  return {
    capabilityId: def.capabilityId,
    label: def.label,
    domain: def.domain,
    level,
    score,
    checkpoints: def.checkpoints.map((c) => ({
      id: c.id,
      label: c.label,
      satisfied: c.satisfied,
      reason: c.reason,
      remediation: c.remediation,
    })),
    summary: buildCapabilitySummary(level, requiredMissing, def.checkpoints.length, measuredPassed),
  };
}

function buildCapabilitySummary(
  level: ReadinessLevel,
  requiredMissing: readonly CapabilityCheckpoint[],
  total: number,
  measuredPassed: number,
): string {
  if (level === 'ready') return `Ready — all ${total} checkpoints satisfied.`;
  if (level === 'unknown') return 'Not enough data to evaluate.';
  if (level === 'not_ready') {
    const which = requiredMissing.map((c) => c.label).slice(0, 3).join(', ');
    return `Not ready — required checkpoints missing: ${which}.`;
  }
  return `Partial — ${measuredPassed} of ${total} checkpoints satisfied.`;
}

function buildSummary(capabilities: readonly CapabilityReadiness[]): string {
  if (capabilities.length === 0) return 'No capabilities configured.';
  const counts = { ready: 0, partial: 0, not_ready: 0, unknown: 0 };
  for (const c of capabilities) counts[c.level] += 1;
  const parts: string[] = [];
  if (counts.ready) parts.push(`${counts.ready} ready`);
  if (counts.partial) parts.push(`${counts.partial} partial`);
  if (counts.not_ready) parts.push(`${counts.not_ready} not ready`);
  if (counts.unknown) parts.push(`${counts.unknown} unknown`);
  return `Capabilities: ${parts.join(', ')}.`;
}

function collectRecommendations(
  capabilities: readonly CapabilityReadiness[],
): readonly string[] {
  const out: string[] = [];
  for (const c of capabilities) {
    if (c.level === 'ready') continue;
    for (const cp of c.checkpoints) {
      if (cp.satisfied === false && cp.remediation) {
        out.push(`${c.label}: ${cp.remediation}`);
      }
      if (out.length >= 8) return out;
    }
  }
  return out;
}

// ── Default capability catalog ─────────────────────────────────────────

/** A starter catalog matching the gameplan's Phase 1 capabilities.
 *  The host fills in `satisfied` / `reason` / `remediation` from the
 *  feature health registry, panel registry, sidecar status, and
 *  notification registry. */
export function defaultCapabilityCatalog(): CapabilityDefinition[] {
  return [
    {
      capabilityId: 'why_didnt_i_get_warned',
      label: '"Why didn\'t I get warned?" answerable',
      domain: 'weather_safety',
      checkpoints: [
        { id: 'panel_health_registry', label: 'Panel health registry mounted', satisfied: undefined, required: true, reason: 'unset' },
        { id: 'feature_health_registry', label: 'Feature health registry registered', satisfied: undefined, required: true, reason: 'unset' },
        { id: 'notification_trace', label: 'Notification trace registry active', satisfied: undefined, required: true, reason: 'unset' },
        { id: 'self_test_runs', label: 'Self-test runner can fire', satisfied: undefined, required: false, reason: 'unset' },
      ],
    },
    {
      capabilityId: 'storm_mode_engagement',
      label: 'Storm Mode auto-engagement',
      domain: 'weather_safety',
      checkpoints: [
        { id: 'saved_places', label: 'At least one saved place', satisfied: undefined, required: true, reason: 'unset' },
        { id: 'nws_provider', label: 'NWS provider authenticated', satisfied: undefined, required: true, reason: 'unset' },
        { id: 'notification_permission', label: 'Notification permission granted', satisfied: undefined, required: true, reason: 'unset' },
      ],
    },
    {
      capabilityId: 'time_to_warn_metrics',
      label: 'Time-to-warn metrics available',
      domain: 'weather_safety',
      checkpoints: [
        { id: 'mission_ledger', label: 'Mission ledger present', satisfied: undefined, required: true, reason: 'unset' },
        { id: 'time_to_warn_engine', label: 'Time-to-warn engine wired', satisfied: undefined, required: true, reason: 'unset' },
      ],
    },
    {
      capabilityId: 'closed_loop_self_improvement',
      label: 'Closed-loop self-improvement',
      domain: 'weather_safety',
      checkpoints: [
        { id: 'algorithm_eval_ledger', label: 'Algorithm Evaluation Ledger active', satisfied: undefined, required: true, reason: 'unset' },
        { id: 'algorithm_health', label: 'Algorithm Health Aggregator wired', satisfied: undefined, required: true, reason: 'unset' },
        { id: 'safe_adjustment', label: 'Safe Adjustment proposals reviewed', satisfied: undefined, required: false, reason: 'unset' },
      ],
    },
  ];
}
