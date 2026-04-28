/**
 * Failure Prediction — per
 * docs/CLAUDE_NEXT_LEVEL_SELF_LEARNING_ROADMAP_2026-04-28.md PR 1.
 *
 * Pure deterministic per-capability risk classifier. Reads the latest
 * snapshots from existing diagnostic services (capability readiness,
 * algorithm health, provider redundancy, notification trace summary,
 * source freshness) and emits one PredictedRisk per capability with
 * a level + reasons + recommended actions.
 *
 * Plan invariants:
 *   - No ML, no random — all inputs → outputs are reproducible.
 *   - No DOM, no fetch, no globals at import time.
 *   - The function takes its inputs explicitly so tests can reproduce
 *     edge cases without booting the live registries.
 *   - Output is JSON-serializable for the diagnostics export bundle.
 *   - "unsafe" is reserved for cases where a critical capability the
 *     user already depends on is at risk of missing (e.g. weather
 *     warning with denied notification permission). Lower-confidence
 *     "this might break" predictions stay at "elevated" / "high".
 */

import type { CapabilityReadiness } from '@/services/ops/capability-readiness';
import type { AlgorithmHealth, AlgorithmHealthStatus } from '@/services/algorithms/algorithm-health';
import type { ProviderSnapshot } from '@/services/diagnostics/provider-redundancy';
import type { MissionDomain } from '@/services/ops/mission-types';

// ── Public API ──────────────────────────────────────────────────────────

export type PredictedRiskLevel = 'low' | 'elevated' | 'high' | 'unsafe';

export interface PredictionReason {
  /** Stable id ("source_stale", "notif_denied", "algo_failing"). */
  id: string;
  /** Free-text rationale, plan-readable. */
  text: string;
  /** Severity contribution. Higher = pushes toward unsafe. */
  weight: number;
}

export interface RecommendedAction {
  id: string;
  text: string;
  /** Whether this action requires user input (vs an automatic
   *  app-side fix). User actions surface in the safety case prompt;
   *  app actions queue for the repair-recommendation service. */
  needsUser: boolean;
}

export interface PredictedRisk {
  capabilityId: string;
  domain: MissionDomain;
  level: PredictedRiskLevel;
  /** 0-1 raw risk score before label bucketing — useful for sorting. */
  score: number;
  reasons: readonly PredictionReason[];
  /** Concrete remediation suggestions, sorted by importance. */
  recommendations: readonly RecommendedAction[];
}

export interface PredictedRiskReport {
  generatedAt: number;
  predictions: readonly PredictedRisk[];
  /** Highest level seen across all predictions. */
  worst: PredictedRiskLevel;
  /** Plain-English headline. */
  summary: string;
}

// ── Inputs ──────────────────────────────────────────────────────────────

/** Snapshot of recent notification dispatch trace. We summarize, not
 *  store the raw events, so this fits the JSON-serializable invariant. */
export interface NotificationTraceSummary {
  /** True when the OS-level permission is currently granted. */
  permissionGranted: boolean;
  /** Recent dispatch attempts in the last hour. */
  recentDispatchCount: number;
  /** Recent dispatch errors in the same window. */
  recentDispatchErrors: number;
}

/** Per-capability source freshness summary. */
export interface SourceFreshnessSummary {
  /** Maps capability id → freshness state. */
  byCapability: Record<string, {
    /** ms since the freshest source updated. Undefined = never seen. */
    msSinceFresh?: number;
    /** Number of upstream providers currently silent. */
    silentProviders: number;
    /** Number of upstream providers currently degraded. */
    degradedProviders: number;
  }>;
}

export interface PredictFailuresInput {
  generatedAt?: number;
  capabilityReadiness: readonly CapabilityReadiness[];
  algorithmHealth: readonly AlgorithmHealth[];
  providerSnapshots: readonly ProviderSnapshot[];
  notificationTrace: NotificationTraceSummary;
  sourceFreshness: SourceFreshnessSummary;
  /** Optional set of mission domains the user is *currently* depending
   *  on (active situation, mission ledger). Risk predictions for
   *  capabilities serving these domains escalate one level (elevated
   *  → high, high → unsafe). */
  activeDomains?: readonly MissionDomain[];
}

// ── Implementation ──────────────────────────────────────────────────────

const SAFETY_DOMAINS: ReadonlySet<MissionDomain> = new Set([
  'weather_safety',
  'cyber_exposure',
  'local_infrastructure',
]);

/** Hard staleness ceiling per domain in ms. Past this, the data is
 *  too old to be acted on and the capability flips toward unsafe. */
const STALENESS_CEILING_MS: Record<MissionDomain, number> = {
  weather_safety: 30 * 60 * 1000,
  conflict_escalation: 60 * 60 * 1000,
  cyber_exposure: 60 * 60 * 1000,
  food_commodity_shortage: 12 * 60 * 60 * 1000,
  energy_fuel_stress: 12 * 60 * 60 * 1000,
  travel_disruption: 60 * 60 * 1000,
  market_portfolio_risk: 5 * 60 * 1000,
  local_infrastructure: 60 * 60 * 1000,
};

export function predictFailures(input: PredictFailuresInput): PredictedRiskReport {
  const generatedAt = input.generatedAt ?? Date.now();
  const activeDomains = new Set<MissionDomain>(input.activeDomains);
  const algoByDomain = indexAlgorithmsByDomain(input.algorithmHealth);
  const predictions: PredictedRisk[] = input.capabilityReadiness.map((cap) =>
    predictForCapability(cap, {
      algoByDomain,
      providerSnapshots: input.providerSnapshots,
      notificationTrace: input.notificationTrace,
      sourceFreshness: input.sourceFreshness,
      activeDomains,
    }),
  );

  predictions.sort((a, b) => b.score - a.score);
  const worst = predictions.reduce<PredictedRiskLevel>(
    (acc, p) => worseLevel(acc, p.level),
    'low',
  );
  return {
    generatedAt,
    predictions,
    worst,
    summary: buildSummary(predictions, worst),
  };
}

interface PredictionContext {
  algoByDomain: Map<string, readonly AlgorithmHealth[]>;
  providerSnapshots: readonly ProviderSnapshot[];
  notificationTrace: NotificationTraceSummary;
  sourceFreshness: SourceFreshnessSummary;
  activeDomains: ReadonlySet<MissionDomain>;
}

function readinessReason(cap: CapabilityReadiness): PredictionReason | undefined {
  if (cap.level === 'not_ready') {
    return { id: 'capability_not_ready', text: `${cap.label} is not ready: ${cap.summary}`, weight: 0.6 };
  }
  if (cap.level === 'partial') {
    return { id: 'capability_partial', text: `${cap.label} is partially ready: ${cap.summary}`, weight: 0.3 };
  }
  return undefined;
}

function freshnessReasons(
  cap: CapabilityReadiness,
  ctx: PredictionContext,
): PredictionReason[] {
  const fresh = ctx.sourceFreshness.byCapability[cap.capabilityId];
  if (!fresh) return [];
  const out: PredictionReason[] = [];
  const ceiling = STALENESS_CEILING_MS[cap.domain] ?? 60 * 60 * 1000;
  if (fresh.msSinceFresh !== undefined && fresh.msSinceFresh > ceiling) {
    out.push({
      id: 'source_stale',
      text: `Source for ${cap.label} hasn't updated in ${Math.round(fresh.msSinceFresh / 60_000)} min`,
      weight: SAFETY_DOMAINS.has(cap.domain) ? 0.5 : 0.3,
    });
  }
  if (fresh.silentProviders > 0) {
    out.push({
      id: 'silent_providers',
      text: `${fresh.silentProviders} provider${fresh.silentProviders > 1 ? 's' : ''} silent for ${cap.label}`,
      weight: 0.3,
    });
  }
  if (fresh.degradedProviders >= 2) {
    out.push({
      id: 'degraded_providers',
      text: `${fresh.degradedProviders} providers degraded for ${cap.label} — redundancy thin`,
      weight: 0.25,
    });
  }
  return out;
}

function algorithmReasons(
  cap: CapabilityReadiness,
  ctx: PredictionContext,
): PredictionReason[] {
  const algos = ctx.algoByDomain.get(cap.domain) ?? [];
  const out: PredictionReason[] = [];
  for (const algo of algos) {
    const w = algorithmWeight(algo.status, algo.criticality);
    if (w === 0) continue;
    out.push({
      id: `algo_${algo.status}`,
      text: `${algo.label} (${algo.criticality}) is ${algo.status}: ${algo.reason}`,
      weight: w,
    });
  }
  return out;
}

function notificationReasons(
  cap: CapabilityReadiness,
  ctx: PredictionContext,
): { reasons: PredictionReason[]; actions: RecommendedAction[] } {
  const reasons: PredictionReason[] = [];
  const actions: RecommendedAction[] = [];
  if (SAFETY_DOMAINS.has(cap.domain) && !ctx.notificationTrace.permissionGranted) {
    reasons.push({
      id: 'notif_denied',
      text: 'OS notification permission is denied — safety alerts cannot reach you',
      weight: 0.7,
    });
    actions.push({
      id: 'enable_notifications',
      text: 'Enable notifications for Crystal Ball in System Settings → Notifications',
      needsUser: true,
    });
  }
  const dispatched = ctx.notificationTrace.recentDispatchCount;
  if (dispatched > 0) {
    const errorRate = ctx.notificationTrace.recentDispatchErrors / dispatched;
    if (errorRate >= 0.5) {
      reasons.push({
        id: 'notif_error_rate',
        text: `Notification dispatch error rate is ${Math.round(errorRate * 100)}% in the last hour`,
        weight: 0.4,
      });
    }
  }
  return { reasons, actions };
}

function checkpointRecommendations(cap: CapabilityReadiness): RecommendedAction[] {
  const out: RecommendedAction[] = [];
  for (const cp of cap.checkpoints) {
    if (cp.satisfied === false && cp.remediation) {
      out.push({ id: cp.id, text: cp.remediation, needsUser: looksUserAction(cp.remediation) });
    }
  }
  return out;
}

function predictForCapability(
  cap: CapabilityReadiness,
  ctx: PredictionContext,
): PredictedRisk {
  const reasons: PredictionReason[] = [];
  const recommendations: RecommendedAction[] = [];

  const r1 = readinessReason(cap);
  if (r1) reasons.push(r1);
  recommendations.push(...checkpointRecommendations(cap));

  const notif = notificationReasons(cap, ctx);
  reasons.push(
    ...freshnessReasons(cap, ctx),
    ...algorithmReasons(cap, ctx),
    ...notif.reasons,
  );
  recommendations.push(...notif.actions);

  const totalWeight = reasons.reduce((sum, r) => sum + r.weight, 0);
  let level = bucketLevel(totalWeight);

  // 6. Active-domain escalation.
  if (ctx.activeDomains.has(cap.domain) && level !== 'low') {
    level = escalate(level);
  }

  return {
    capabilityId: cap.capabilityId,
    domain: cap.domain,
    level,
    score: clamp01(totalWeight),
    reasons,
    recommendations: dedupeRecommendations(recommendations),
  };
}

function indexAlgorithmsByDomain(
  algorithms: readonly AlgorithmHealth[],
): Map<string, readonly AlgorithmHealth[]> {
  // The algorithm health domain is fine-grained ('weather_polygon',
  // 'truth_score', etc.), and CapabilityReadiness uses MissionDomain
  // ('weather_safety', etc.). Map known fine domains to their parent.
  const PARENT_DOMAIN: Record<string, MissionDomain> = {
    weather_polygon: 'weather_safety',
    weather_urgency: 'weather_safety',
    truth_score: 'cyber_exposure', // generic — re-bucket if we ever
    evidence_graph: 'cyber_exposure',
    situation_clustering: 'cyber_exposure',
    baseline_deviation: 'cyber_exposure',
    compound_risk: 'cyber_exposure',
    forecast_calibration: 'market_portfolio_risk',
    watchlist_relevance: 'cyber_exposure',
    negative_evidence: 'cyber_exposure',
    shortage_score: 'food_commodity_shortage',
    reasoning_hypothesis: 'cyber_exposure',
    other: 'local_infrastructure',
  };
  const out = new Map<string, AlgorithmHealth[]>();
  for (const algo of algorithms) {
    const parent = PARENT_DOMAIN[algo.domain];
    if (!parent) continue;
    const list = out.get(parent) ?? [];
    list.push(algo);
    out.set(parent, list);
  }
  return out;
}

const ALGO_STATUS_BASE: Record<AlgorithmHealthStatus, number> = {
  healthy: 0,
  unknown: 0,
  degraded: 0.2,
  failing: 0.4,
  unsafe: 0.6,
};

const ALGO_CRITICALITY_MULT: Record<'safety' | 'high' | 'medium' | 'low', number> = {
  safety: 1.5,
  high: 1,
  medium: 0.7,
  low: 0.4,
};

function algorithmWeight(
  status: AlgorithmHealthStatus,
  criticality: 'safety' | 'high' | 'medium' | 'low',
): number {
  return ALGO_STATUS_BASE[status] * ALGO_CRITICALITY_MULT[criticality];
}

function bucketLevel(weight: number): PredictedRiskLevel {
  if (weight >= 0.7) return 'unsafe';
  if (weight >= 0.45) return 'high';
  if (weight >= 0.2) return 'elevated';
  return 'low';
}

function escalate(level: PredictedRiskLevel): PredictedRiskLevel {
  if (level === 'elevated') return 'high';
  if (level === 'high') return 'unsafe';
  return level;
}

function worseLevel(a: PredictedRiskLevel, b: PredictedRiskLevel): PredictedRiskLevel {
  const order: PredictedRiskLevel[] = ['low', 'elevated', 'high', 'unsafe'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function dedupeRecommendations(input: readonly RecommendedAction[]): RecommendedAction[] {
  const seen = new Map<string, RecommendedAction>();
  for (const r of input) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}

function looksUserAction(text: string): boolean {
  const t = text.toLowerCase();
  return /enable|grant|add|install|configure|sign in|set up|allow/.test(t);
}

function buildSummary(predictions: readonly PredictedRisk[], worst: PredictedRiskLevel): string {
  if (predictions.length === 0) return 'No capabilities to evaluate.';
  if (worst === 'low') return 'All capabilities are healthy.';
  const top = predictions.slice(0, 3).filter((p) => p.level !== 'low');
  const labels = top.map((p) => `${p.capabilityId} (${p.level})`).join(', ');
  return `Worst predicted risk: ${worst}. Top concerns: ${labels}.`;
}
