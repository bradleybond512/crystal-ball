/**
 * Feature Health Registry — per
 * docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md PR 3 (lines 422-441)
 * and the elite gameplan's "every degraded feature must include user
 * impact and recommended next action" invariant.
 *
 * Maps each capability (weather warnings, Personal Storm Mode, ADS-B
 * aggregation, shortage forecasts, Command Center, notification routing,
 * reasoning layer, sidecar) to its panel / service / source / provider
 * dependencies, and joins those dependency statuses with locally-recorded
 * success / failure events to produce a deterministic FeatureHealth.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 *
 * Plan invariants:
 *   - Definitions require `userImpactWhenDegraded` + `recommendedAction…`
 *     so the FeatureHealth output is never missing remediation guidance
 *   - Critical features escalate dependency failures to 'unsafe'
 *   - Confidence multiplier is derived from status by a single helper so
 *     downstream scoring stays consistent
 */

import type {
  FeatureDependencies,
  FeatureHealth,
  FeatureId,
  HealthStatus,
  PanelId,
  ProviderId,
  ServiceId,
  SourceId,
} from './system-health-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface FeatureDefinition {
  featureId: FeatureId;
  label: string;
  /** Safety-critical features (weather warnings, Personal Storm Mode,
   *  evacuation alerts, …) escalate dependency failures to 'unsafe'. */
  critical: boolean;
  dependencies: FeatureDependencies;
  /** Plan invariant: when the feature degrades we must know what the
   *  user actually loses and what they can do about it. Required on
   *  every definition; can be overridden per-observation. */
  userImpactWhenDegraded: string;
  recommendedActionWhenDegraded: string;
  /** Confidence multiplier overrides. Defaults are provided by
   *  defaultConfidenceFor(status). */
  confidenceMultiplierOverrides?: Partial<Record<HealthStatus, number>>;
}

/** Snapshot of dependency statuses for status computation. The
 *  aggregator builds this from the panel registry + provider / source
 *  registries before calling `all()`. */
export interface FeatureStatusContext {
  panelStatuses?: ReadonlyMap<PanelId, HealthStatus>;
  serviceStatuses?: ReadonlyMap<ServiceId, HealthStatus>;
  sourceStatuses?: ReadonlyMap<SourceId, HealthStatus>;
  providerStatuses?: ReadonlyMap<ProviderId, HealthStatus>;
}

export interface FeatureHealthRegistryOptions {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

export interface FeatureHealthRegistry {
  register: (definition: FeatureDefinition) => void;
  recordSuccess: (featureId: FeatureId, at?: number) => void;
  recordFailure: (featureId: FeatureId, reason: string, at?: number) => void;
  setEnabled: (featureId: FeatureId, enabled: boolean) => void;
  /** Override the user-impact / recommended-action strings for the next
   *  status computation (e.g. when the failure mode is more specific
   *  than the registration default). */
  setRemediationOverride: (
    featureId: FeatureId,
    override: { userImpact?: string; recommendedAction?: string },
  ) => void;
  /** Compute the current FeatureHealth, joining recorded success /
   *  failure events with the dependency statuses in `context`. Returns
   *  undefined when not registered. */
  get: (featureId: FeatureId, context?: FeatureStatusContext) => FeatureHealth | undefined;
  all: (context?: FeatureStatusContext) => FeatureHealth[];
  byStatus: (status: HealthStatus, context?: FeatureStatusContext) => FeatureHealth[];
  /** All feature definitions, in registration order. */
  definitions: () => FeatureDefinition[];
  clear: () => void;
}

const DEFAULT_STALE_MS = 5 * 60 * 1000;

// ── Internal state ──────────────────────────────────────────────────────

interface FeatureEntry {
  definition: FeatureDefinition;
  enabled: boolean;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastFailureReason?: string;
  remediationOverride?: { userImpact?: string; recommendedAction?: string };
}

export function createFeatureHealthRegistry(
  options: FeatureHealthRegistryOptions = {},
): FeatureHealthRegistry {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<FeatureId, FeatureEntry>();
  // Preserve insertion order separately so `definitions()` returns a
  // stable ordering even after enable/disable churn.
  const order: FeatureId[] = [];

  function register(definition: FeatureDefinition): void {
    if (!definition.userImpactWhenDegraded) {
      throw new Error(
        `Feature "${definition.featureId}": userImpactWhenDegraded is required`,
      );
    }
    if (!definition.recommendedActionWhenDegraded) {
      throw new Error(
        `Feature "${definition.featureId}": recommendedActionWhenDegraded is required`,
      );
    }
    const existing = entries.get(definition.featureId);
    if (existing) {
      entries.set(definition.featureId, { ...existing, definition });
      return;
    }
    entries.set(definition.featureId, { definition, enabled: true });
    order.push(definition.featureId);
  }

  function ensureEntry(featureId: FeatureId): FeatureEntry {
    const e = entries.get(featureId);
    if (!e) throw new Error(`Feature "${featureId}" is not registered`);
    return e;
  }

  function recordSuccess(featureId: FeatureId, at?: number): void {
    const e = ensureEntry(featureId);
    e.lastSuccessAt = at ?? now();
    // A success clears the most-recent failure entirely — the feature
    // recovered. (The dep rollup can still report stale.) Clearing
    // both fields means status decisions reduce to "is there an
    // unresolved failure?" without timestamp tie-breaks.
    e.lastFailureReason = undefined;
    e.lastFailureAt = undefined;
  }

  function recordFailure(featureId: FeatureId, reason: string, at?: number): void {
    const e = ensureEntry(featureId);
    e.lastFailureAt = at ?? now();
    e.lastFailureReason = reason;
  }

  function setEnabled(featureId: FeatureId, enabled: boolean): void {
    const e = ensureEntry(featureId);
    e.enabled = enabled;
  }

  function setRemediationOverride(
    featureId: FeatureId,
    override: { userImpact?: string; recommendedAction?: string },
  ): void {
    const e = ensureEntry(featureId);
    e.remediationOverride = { ...override };
  }

  function get(featureId: FeatureId, context?: FeatureStatusContext): FeatureHealth | undefined {
    const e = entries.get(featureId);
    if (!e) return undefined;
    return computeFeatureHealth(e, context ?? {}, now());
  }

  function all(context?: FeatureStatusContext): FeatureHealth[] {
    const ctx = context ?? {};
    const t = now();
    const list: FeatureHealth[] = [];
    for (const id of order) {
      const e = entries.get(id);
      if (e) list.push(computeFeatureHealth(e, ctx, t));
    }
    return list;
  }

  function byStatus(status: HealthStatus, context?: FeatureStatusContext): FeatureHealth[] {
    return all(context).filter((f) => f.status === status);
  }

  function definitions(): FeatureDefinition[] {
    const list: FeatureDefinition[] = [];
    for (const id of order) {
      const e = entries.get(id);
      if (e) list.push(e.definition);
    }
    return list;
  }

  function clear(): void {
    entries.clear();
    order.length = 0;
  }

  return {
    register,
    recordSuccess,
    recordFailure,
    setEnabled,
    setRemediationOverride,
    get,
    all,
    byStatus,
    definitions,
    clear,
  };
}

// ── Status calculator ──────────────────────────────────────────────────

function computeFeatureHealth(
  entry: FeatureEntry,
  context: FeatureStatusContext,
  t: number,
): FeatureHealth {
  const { definition } = entry;
  const depRoll = rollUpDependencies(definition.dependencies, context);
  const status = decideFeatureStatus(entry, depRoll, t);
  const reason = describeReason(entry, depRoll, status);
  const isDegraded = status !== 'healthy' && status !== 'unknown';
  const remediation = entry.remediationOverride ?? {};
  const userImpact = isDegraded
    ? (remediation.userImpact ?? definition.userImpactWhenDegraded)
    : '';
  const recommendedAction = isDegraded
    ? (remediation.recommendedAction ?? definition.recommendedActionWhenDegraded)
    : '';
  const confidenceMultiplier =
    definition.confidenceMultiplierOverrides?.[status] ?? defaultConfidenceFor(status);

  return {
    featureId: definition.featureId,
    label: definition.label,
    critical: definition.critical,
    status,
    lastSuccessAt: entry.lastSuccessAt,
    lastFailureAt: entry.lastFailureAt,
    reason,
    userImpact,
    recommendedAction,
    confidenceMultiplier,
    dependencies: definition.dependencies,
  };
}

interface DependencyRollup {
  /** The worst non-healthy dependency status seen. 'unknown' if every
   *  dependency lookup miss / is healthy. */
  worst: HealthStatus;
  /** Names of dependencies in their worst state, capped at 3 for the
   *  reason string. */
  exemplars: string[];
}

const STATUS_SEVERITY: Record<HealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  stale: 3,
  blind: 4,
  failing: 5,
  unsafe: 6,
};

function rollUpDependencies(
  deps: FeatureDependencies,
  context: FeatureStatusContext,
): DependencyRollup {
  const items: { id: string; status: HealthStatus }[] = [];
  for (const id of deps.panels) {
    items.push({ id, status: context.panelStatuses?.get(id) ?? 'unknown' });
  }
  for (const id of deps.services) {
    items.push({ id, status: context.serviceStatuses?.get(id) ?? 'unknown' });
  }
  for (const id of deps.sources) {
    items.push({ id, status: context.sourceStatuses?.get(id) ?? 'unknown' });
  }
  for (const id of deps.providers) {
    items.push({ id, status: context.providerStatuses?.get(id) ?? 'unknown' });
  }
  let worst: HealthStatus = 'healthy';
  for (const it of items) {
    if (STATUS_SEVERITY[it.status] > STATUS_SEVERITY[worst]) worst = it.status;
  }
  const exemplars = items
    .filter((it) => it.status === worst && worst !== 'healthy' && worst !== 'unknown')
    .slice(0, 3)
    .map((it) => it.id);
  return { worst, exemplars };
}

function decideFeatureStatus(
  entry: FeatureEntry,
  depRoll: DependencyRollup,
  t: number,
): HealthStatus {
  // Disabled features are explicitly out of scope.
  if (!entry.enabled) return 'unknown';

  // Any unresolved local failure trumps stale signals — show what
  // broke. recordSuccess clears lastFailureAt, so this is simply:
  // "is there a failure that hasn't been resolved by a later success?"
  if (entry.lastFailureAt !== undefined) {
    return entry.definition.critical ? 'unsafe' : 'failing';
  }

  // Dependency rollup: failing / unsafe deps escalate to unsafe for
  // critical features, failing otherwise.
  if (depRoll.worst === 'unsafe') return 'unsafe';
  if (depRoll.worst === 'failing') {
    return entry.definition.critical ? 'unsafe' : 'failing';
  }
  if (depRoll.worst === 'blind') return 'blind';
  if (depRoll.worst === 'stale') return 'stale';
  if (depRoll.worst === 'degraded') return 'degraded';

  // No deps tripping. Check local data freshness.
  if (entry.lastSuccessAt === undefined) return 'blind';
  const age = t - entry.lastSuccessAt;
  if (age >= DEFAULT_STALE_MS) return 'stale';

  return 'healthy';
}

function describeReason(
  entry: FeatureEntry,
  depRoll: DependencyRollup,
  status: HealthStatus,
): string {
  if (status === 'healthy') return 'All dependencies healthy.';
  if (status === 'unknown') {
    return entry.enabled ? 'No status reported yet.' : 'Feature disabled.';
  }
  if (entry.lastFailureReason) return entry.lastFailureReason;
  if (depRoll.exemplars.length > 0) {
    const which = depRoll.exemplars.join(', ');
    return `Dependency ${pluralize('issue', depRoll.exemplars.length)}: ${which} (${depRoll.worst}).`;
  }
  if (status === 'blind') return 'No successful refresh observed yet.';
  if (status === 'stale') return 'Last refresh exceeded the freshness window.';
  return `Feature ${status}.`;
}

function pluralize(noun: string, n: number): string {
  return n === 1 ? noun : `${noun}s`;
}

// ── Confidence multiplier defaults ─────────────────────────────────────

export function defaultConfidenceFor(status: HealthStatus): number {
  switch (status) {
    case 'healthy': {
      return 1;
    }
    case 'unknown': {
      return 1;
    }
    case 'degraded': {
      return 0.7;
    }
    case 'stale': {
      return 0.5;
    }
    case 'blind': {
      return 0;
    }
    case 'failing': {
      return 0.2;
    }
    case 'unsafe': {
      return 0;
    }
  }
}

// ── Convenience: standard feature catalog ──────────────────────────────

/** A starter set of definitions matching the plan's PR 3 list. Apps
 *  bootstrap by passing these through `register()`. Kept as a function
 *  so callers can spread + override fields without sharing mutable
 *  references. */
export function defaultFeatureCatalog(): FeatureDefinition[] {
  return [
    {
      featureId: 'weather_warning',
      label: 'Weather warnings',
      critical: true,
      dependencies: {
        panels: ['nws-alerts', 'personal-storm-mode'],
        services: ['weather-warning-router', 'nws-polygon-match'],
        sources: ['weather'],
        providers: ['nws-alerts'],
      },
      userImpactWhenDegraded:
        'You may not be alerted to severe weather threatening your saved places.',
      recommendedActionWhenDegraded:
        'Open Settings → Locations and confirm at least one saved place; check the diagnostics panel for the failing provider.',
    },
    {
      featureId: 'personal_storm_mode',
      label: 'Personal Storm Mode',
      critical: true,
      dependencies: {
        panels: ['personal-storm-mode'],
        services: ['weather-warning-router'],
        sources: ['weather'],
        providers: ['nws-alerts'],
      },
      userImpactWhenDegraded:
        'Storm Mode will not auto-engage when severe weather approaches your home.',
      recommendedActionWhenDegraded:
        'Verify Personal Storm Mode is enabled in Settings and that NWS alerts are reaching the app.',
    },
    {
      featureId: 'adsb_aggregation',
      label: 'ADS-B aggregation',
      critical: false,
      dependencies: {
        panels: ['flights'],
        services: ['adsb-merge'],
        sources: ['flights'],
        providers: ['adsbexchange', 'opensky'],
      },
      userImpactWhenDegraded:
        'Live aircraft positions may be incomplete or delayed.',
      recommendedActionWhenDegraded:
        'Re-authenticate the ADS-B providers in Settings → API Keys.',
    },
    {
      featureId: 'shortage_forecasts',
      label: 'Shortage forecasts',
      critical: false,
      dependencies: {
        panels: ['shortage-watch'],
        services: ['shortage-score'],
        sources: ['commodities', 'agriculture'],
        providers: ['fred', 'usda'],
      },
      userImpactWhenDegraded:
        'Commodity shortage early warnings may be inaccurate or stale.',
      recommendedActionWhenDegraded:
        'Check the data freshness panel and refresh commodity feeds.',
    },
    {
      featureId: 'command_center',
      label: 'Command Center',
      critical: false,
      dependencies: {
        panels: ['command-center'],
        services: ['situation-engine', 'analyst-loop'],
        sources: [],
        providers: [],
      },
      userImpactWhenDegraded:
        'The top-of-app summary may not reflect what currently matters most.',
      recommendedActionWhenDegraded:
        'Open the diagnostics panel to identify which underlying service is degraded.',
    },
    {
      featureId: 'notification_routing',
      label: 'Notification routing',
      critical: true,
      dependencies: {
        panels: [],
        services: ['notification-router', 'notification-dispatcher'],
        sources: [],
        providers: [],
      },
      userImpactWhenDegraded:
        'Critical alerts may not reach you as native macOS notifications.',
      recommendedActionWhenDegraded:
        'Confirm Notification Center permissions for Crystal Ball in System Settings.',
    },
    {
      featureId: 'reasoning_layer',
      label: 'Reasoning layer',
      critical: false,
      dependencies: {
        panels: ['analyst-hud'],
        services: ['analyst-loop', 'mode-forecast'],
        sources: [],
        providers: [],
      },
      userImpactWhenDegraded:
        'Cross-domain hypotheses, posture advisories, and auto-briefs may stop updating.',
      recommendedActionWhenDegraded:
        'Open the reasoning diagnostics overlay (⌘⇧D) to see which subsystem is silent.',
    },
    {
      featureId: 'sidecar',
      label: 'Sidecar',
      critical: true,
      dependencies: {
        panels: [],
        services: ['sidecar-bridge'],
        sources: [],
        providers: [],
      },
      userImpactWhenDegraded:
        'Most data feeds, MCP tools, and analyst write-back are unavailable.',
      recommendedActionWhenDegraded:
        'Restart the app so the embedded sidecar relaunches; check ~/Library/Logs/com.bradleybond.crystalball.',
    },
  ];
}
