/**
 * System health types — per
 * docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md PR 1
 * (lines 397-410). Shared type contracts for the diagnostics layer.
 *
 * Pure type module: no runtime, no DOM, no fetch. Consumers in
 * `feature-health-registry`, `panel-health-registry`,
 * `system-health` aggregator (PRs 2-4) read and write these shapes.
 *
 * Plan invariant: every diagnostic record must be inspectable by
 * humans AND machines (the diagnostic export bundle in PR 8 ships
 * this exact JSON to a debug surface).
 */

// ── Common identity types ────────────────────────────────────────────────

/** Free-form ids — convention is kebab-case. The diagnostics layer
 *  doesn't validate the format; downstream consumers pin the
 *  vocabulary they expect. Kept as string aliases for documentation
 *  value; the runtime representation is `string`. */
/* eslint-disable sonarjs/redundant-type-aliases */
export type FeatureId = string;
export type PanelId = string;
export type ServiceId = string;
export type SourceId = string;
export type ProviderId = string;
/* eslint-enable sonarjs/redundant-type-aliases */

/** Five-level overall status used across feature, panel, source,
 *  provider, and the system aggregator. Identical to the plan's
 *  status enum. */
export type HealthStatus =
  | 'healthy'      // operating as expected
  | 'degraded'     // working but with reduced confidence
  | 'failing'      // recent failures, needs attention
  | 'stale'        // data hasn't refreshed in expected window
  | 'blind'        // no data at all (no provider, no signal)
  | 'unsafe'       // safety-critical signal is missing or broken
  | 'unknown';     // never reported in / not yet observed

// ── Feature health ───────────────────────────────────────────────────────

export interface FeatureDependencies {
  panels: readonly PanelId[];
  services: readonly ServiceId[];
  sources: readonly SourceId[];
  providers: readonly ProviderId[];
}

export interface FeatureHealth {
  featureId: FeatureId;
  /** Human-readable label. */
  label: string;
  /** True for safety-critical features (weather warnings, evacuation,
   *  power-outage alerts, …). Affects the system status: a single
   *  failing critical feature can flip the system to 'unsafe'. */
  critical: boolean;
  status: HealthStatus;
  /** ms timestamp of the most-recent successful refresh. Undefined
   *  when never observed. */
  lastSuccessAt?: number;
  /** ms timestamp of the most-recent failure (any kind). */
  lastFailureAt?: number;
  /** Free-text reason for the current status. Always set so the UI
   *  can render "why is this degraded?" without joining tables. */
  reason: string;
  /** Confidence multiplier (0..1) that downstream scorers should
   *  apply when this feature contributes to a higher-level claim.
   *  1.0 = no penalty; 0.0 = ignore the feature entirely. */
  confidenceMultiplier: number;
  /** What the feature depends on. */
  dependencies: FeatureDependencies;
}

// ── Panel health ─────────────────────────────────────────────────────────

export interface PanelHealth {
  panelId: PanelId;
  /** Human-readable label. */
  label?: string;
  status: HealthStatus;
  /** Has the panel been instantiated and inserted into the DOM? */
  mounted: boolean;
  /** Is the panel currently in the user's enabled set? */
  enabled: boolean;
  /** Is the panel currently visible (in viewport / not collapsed)? */
  visible: boolean;
  /** ms timestamp of the panel's most-recent render. */
  lastRenderAt?: number;
  /** ms timestamp of the most-recent data update the panel processed. */
  lastDataUpdateAt?: number;
  /** ms timestamp of the panel's most-recent error. */
  lastErrorAt?: number;
  /** Free-text most-recent error message. */
  lastError?: string;
  /** ms since the panel last refreshed. Undefined when never refreshed. */
  staleAgeMs?: number;
  /** Other panels / services this panel depends on. PanelId and
   *  ServiceId are the same underlying string type; the union is
   *  documentation. */
  dependencies: readonly string[];
}

// ── Source diagnostic ───────────────────────────────────────────────────

export interface SourceDiagnostic {
  sourceId: SourceId;
  /** Human-readable label. */
  label?: string;
  status: HealthStatus;
  /** ms timestamp of the most-recent successful fetch. */
  lastSuccessAt?: number;
  /** ms timestamp of the most-recent failure. */
  lastFailureAt?: number;
  /** Provider ids backing this source (e.g. NWS for weather). */
  providers: readonly ProviderId[];
  /** Free-text reason. */
  reason: string;
}

// ── Provider health record (lightweight — provider registry has more) ──

export interface ProviderHealthRecord {
  providerId: ProviderId;
  status: HealthStatus;
  /** Rolling success rate over the most-recent window (0..1). */
  successRate: number;
  /** Mean latency in ms over the most-recent window. */
  meanLatencyMs?: number;
  /** ms timestamp of the most-recent call. */
  lastCallAt?: number;
  /** ms timestamp of the most-recent failure. */
  lastFailureAt?: number;
  /** Optional rate-limit hint from the provider. */
  rateLimitedUntilMs?: number;
}

// ── Notification trace summary ─────────────────────────────────────────

export interface NotificationTraceSummary {
  /** ms timestamp the summary was generated. */
  generatedAt: number;
  /** Total notification candidates seen since the start of the window. */
  candidates: number;
  /** Candidates that actually dispatched. */
  dispatched: number;
  /** Candidates suppressed and the reasons (deduped + counted). */
  suppressedByReason: Record<string, number>;
  /** Recent unsafe events — e.g. a critical weather alert that was
   *  suppressed by quiet hours when the user had bypass disabled. */
  unsafeSuppressions: readonly {
    candidateId: string;
    reason: string;
    at: number;
  }[];
}

// ── Sidecar health ─────────────────────────────────────────────────────

export interface SidecarHealth {
  status: HealthStatus;
  /** ms timestamp of the most-recent successful sidecar ping. */
  lastReachableAt?: number;
  /** Sidecar version string when known. */
  version?: string;
  /** Bearer-auth status. */
  authenticated: boolean;
  /** Free-text reason. */
  reason: string;
}

// ── System aggregator output ───────────────────────────────────────────

export interface SystemHealthReport {
  generatedAt: number;
  status: HealthStatus;
  /** Plain-English one-line summary the UI / Claude debug bundle can
   *  surface without parsing the rest of the report. */
  summary: string;
  features: readonly FeatureHealth[];
  panels: readonly PanelHealth[];
  sources: readonly SourceDiagnostic[];
  providers: readonly ProviderHealthRecord[];
  notifications: NotificationTraceSummary;
  sidecar: SidecarHealth;
  /** Targeted remediation hints — same pattern as the weather miss
   *  diagnostic. */
  recommendations: readonly string[];
}
