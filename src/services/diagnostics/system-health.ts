/**
 * System Health Aggregator skeleton — per
 * docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md PR 4 (lines 443-459).
 *
 * Joins panel health + feature health + source / provider / notification /
 * sidecar diagnostics into one deterministic SystemHealthReport. Pure:
 * no DOM, no fetch, no globals.
 *
 * Plan invariants:
 *   - One critical feature in 'unsafe' state flips the whole system to
 *     'unsafe' (gameplan: "never miss what matters")
 *   - Recommendations are derived from the worst feature's
 *     `recommendedAction` so the user always has a concrete next step
 *   - Output is JSON-serializable (PR 8 export bundle ships this exact
 *     shape)
 */

import type {
  FeatureHealth,
  HealthStatus,
  NotificationTraceSummary,
  PanelHealth,
  PanelId,
  ProviderHealthRecord,
  ProviderId,
  ServiceId,
  SidecarHealth,
  SourceDiagnostic,
  SourceId,
  SystemHealthReport,
} from './system-health-types';
import type {
  FeatureHealthRegistry,
  FeatureStatusContext,
} from './feature-health-registry';

// ── Public API ──────────────────────────────────────────────────────────

export interface SystemHealthAggregatorInput {
  /** ms timestamp for the report. Defaults to Date.now(). */
  generatedAt?: number;
  panels: readonly PanelHealth[];
  features: readonly FeatureHealth[];
  sources: readonly SourceDiagnostic[];
  providers: readonly ProviderHealthRecord[];
  notifications: NotificationTraceSummary;
  sidecar: SidecarHealth;
  /** Service id → status lookup. Only consulted via the helper that
   *  joins feature dependencies; harmless to omit. */
  serviceStatuses?: ReadonlyMap<ServiceId, HealthStatus>;
}

/** Pure function: takes the snapshots, returns the report. */
export function aggregateSystemHealth(input: SystemHealthAggregatorInput): SystemHealthReport {
  const generatedAt = input.generatedAt ?? Date.now();
  const status = decideSystemStatus(input);
  const summary = describeSystemSummary(status, input);
  const recommendations = collectRecommendations(input);

  return {
    generatedAt,
    status,
    summary,
    features: [...input.features],
    panels: [...input.panels],
    sources: [...input.sources],
    providers: [...input.providers],
    notifications: input.notifications,
    sidecar: input.sidecar,
    recommendations,
  };
}

/** Build a FeatureStatusContext from already-computed panel / source /
 *  provider snapshots. Convenience wrapper so callers don't have to
 *  build the maps themselves. */
export function contextFromSnapshots(snapshots: {
  panels: readonly PanelHealth[];
  sources: readonly SourceDiagnostic[];
  providers: readonly ProviderHealthRecord[];
  serviceStatuses?: ReadonlyMap<ServiceId, HealthStatus>;
}): FeatureStatusContext {
  const panelStatuses = new Map<PanelId, HealthStatus>();
  for (const p of snapshots.panels) panelStatuses.set(p.panelId, p.status);
  const sourceStatuses = new Map<SourceId, HealthStatus>();
  for (const s of snapshots.sources) sourceStatuses.set(s.sourceId, s.status);
  const providerStatuses = new Map<ProviderId, HealthStatus>();
  for (const p of snapshots.providers) providerStatuses.set(p.providerId, p.status);
  return {
    panelStatuses,
    sourceStatuses,
    providerStatuses,
    serviceStatuses: snapshots.serviceStatuses,
  };
}

/** End-to-end: given the registries + snapshot inputs, produce the full
 *  SystemHealthReport. The wiring layer (panel-layout / refresh-scheduler)
 *  uses this; the registries themselves stay decoupled. */
export function aggregateFromRegistries(args: {
  features: FeatureHealthRegistry;
  panels: readonly PanelHealth[];
  sources: readonly SourceDiagnostic[];
  providers: readonly ProviderHealthRecord[];
  notifications: NotificationTraceSummary;
  sidecar: SidecarHealth;
  serviceStatuses?: ReadonlyMap<ServiceId, HealthStatus>;
  generatedAt?: number;
}): SystemHealthReport {
  const context = contextFromSnapshots(args);
  const features = args.features.all(context);
  return aggregateSystemHealth({
    generatedAt: args.generatedAt,
    panels: args.panels,
    features,
    sources: args.sources,
    providers: args.providers,
    notifications: args.notifications,
    sidecar: args.sidecar,
    serviceStatuses: args.serviceStatuses,
  });
}

// ── System status calculator ───────────────────────────────────────────

const STATUS_SEVERITY: Record<HealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  stale: 3,
  blind: 4,
  failing: 5,
  unsafe: 6,
};

function decideSystemStatus(input: SystemHealthAggregatorInput): HealthStatus {
  // Any critical feature in failing/unsafe → unsafe. This is the
  // gameplan's "never miss what matters" rule.
  if (hasFailingCriticalFeature(input.features)) return 'unsafe';

  // Sidecar is the data backbone: if it's failing, treat the whole
  // system as failing rather than letting individual features paper over.
  if (input.sidecar.status === 'failing' || input.sidecar.status === 'unsafe') {
    return input.sidecar.status;
  }

  const worst = worstObservedStatus(input);

  // Treat lone unsafe-suppressions in the notification trace as a clear
  // safety signal even if everything else looks fine. The aggregator
  // doesn't have to know which alert; the notification panel will.
  if (input.notifications.unsafeSuppressions.length > 0 && worst === 'healthy') {
    return 'degraded';
  }

  return worst;
}

function hasFailingCriticalFeature(features: readonly FeatureHealth[]): boolean {
  return features.some(
    (f) => f.critical && (f.status === 'unsafe' || f.status === 'failing'),
  );
}

function worstObservedStatus(input: SystemHealthAggregatorInput): HealthStatus {
  let worst: HealthStatus = 'healthy';
  worst = worstOf(worst, input.features.map((f) => f.status));
  worst = worstOf(worst, input.sources.map((s) => s.status));
  worst = worstOf(worst, input.providers.map((p) => p.status));
  if (STATUS_SEVERITY[input.sidecar.status] > STATUS_SEVERITY[worst]) worst = input.sidecar.status;
  return worst;
}

function worstOf(seed: HealthStatus, statuses: readonly HealthStatus[]): HealthStatus {
  let worst = seed;
  for (const s of statuses) {
    if (STATUS_SEVERITY[s] > STATUS_SEVERITY[worst]) worst = s;
  }
  return worst;
}

// ── Summary + recommendations ──────────────────────────────────────────

function describeSystemSummary(
  status: HealthStatus,
  input: SystemHealthAggregatorInput,
): string {
  if (status === 'healthy') return 'All features and providers reporting healthy.';
  if (status === 'unknown') return 'No status reported yet — diagnostics still warming up.';

  const criticalSummary = describeCriticalFailures(input.features);
  if (criticalSummary) return criticalSummary;

  const tallySummary = describeFeatureTally(input.features);
  if (tallySummary) return tallySummary;

  if (input.sidecar.status !== 'healthy') {
    return `Sidecar ${input.sidecar.status}: ${input.sidecar.reason || 'no detail'}.`;
  }
  return `System ${status}.`;
}

function describeCriticalFailures(features: readonly FeatureHealth[]): string | undefined {
  const failingCritical = features.filter(
    (f) => f.critical && (f.status === 'unsafe' || f.status === 'failing'),
  );
  if (failingCritical.length === 0) return undefined;
  const labels = failingCritical.map((f) => f.label).slice(0, 3).join(', ');
  return `Critical ${pluralize('feature', failingCritical.length)} ${plurVerb(failingCritical.length)} unsafe: ${labels}.`;
}

function describeFeatureTally(features: readonly FeatureHealth[]): string | undefined {
  const tally = countByStatus(features.map((f) => f.status));
  const parts: string[] = [];
  if (tally.failing) parts.push(`${tally.failing} failing`);
  if (tally.degraded) parts.push(`${tally.degraded} degraded`);
  if (tally.stale) parts.push(`${tally.stale} stale`);
  if (tally.blind) parts.push(`${tally.blind} blind`);
  return parts.length === 0 ? undefined : `Features: ${parts.join(', ')}.`;
}

function collectRecommendations(input: SystemHealthAggregatorInput): readonly string[] {
  const seen = new Set<string>();
  const recs: string[] = [];

  // Critical features come first.
  const critical = input.features
    .filter(
      (f) => f.critical && f.recommendedAction && f.status !== 'healthy' && f.status !== 'unknown',
    )
    .sort((a, b) => STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status]);
  for (const f of critical) addRec(seen, recs, `${f.label}: ${f.recommendedAction}`);

  // Then non-critical features.
  const nonCritical = input.features
    .filter(
      (f) => !f.critical && f.recommendedAction && f.status !== 'healthy' && f.status !== 'unknown',
    )
    .sort((a, b) => STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status]);
  for (const f of nonCritical) addRec(seen, recs, `${f.label}: ${f.recommendedAction}`);

  if (input.sidecar.status === 'failing' || input.sidecar.status === 'unsafe') {
    addRec(
      seen,
      recs,
      `Sidecar: ${input.sidecar.reason || 'restart Crystal Ball to relaunch the embedded sidecar'}.`,
    );
  }
  if (input.notifications.unsafeSuppressions.length > 0) {
    addRec(
      seen,
      recs,
      'Notifications: review unsafe suppressions in the diagnostics panel — a critical alert was held back.',
    );
  }

  return recs.slice(0, 6);
}

function addRec(seen: Set<string>, recs: string[], rec: string): void {
  if (seen.has(rec)) return;
  seen.add(rec);
  recs.push(rec);
}

function countByStatus(statuses: readonly HealthStatus[]): Record<HealthStatus, number> {
  const tally: Record<HealthStatus, number> = {
    healthy: 0,
    degraded: 0,
    failing: 0,
    stale: 0,
    blind: 0,
    unsafe: 0,
    unknown: 0,
  };
  for (const s of statuses) tally[s] += 1;
  return tally;
}

function pluralize(noun: string, n: number): string {
  return n === 1 ? noun : `${noun}s`;
}

function plurVerb(n: number): string {
  return n === 1 ? 'is' : 'are';
}

// ── Re-export the registry factory for callers that only need the
//    aggregator surface. ────────────────────────────────────────────────

export { createFeatureHealthRegistry } from './feature-health-registry';
