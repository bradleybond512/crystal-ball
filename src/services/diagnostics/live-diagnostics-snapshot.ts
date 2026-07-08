/**
 * Live diagnostics snapshot aggregator — per
 * docs/CLAUDE_FUNCTIONALITY_DIAGNOSTICS_PERFORMANCE_ROADMAP_2026-04-29.md
 * Priority 1.
 *
 * Gathers the live source / provider / sidecar / feed state into one
 * structural snapshot the UI panels can render directly. Until now,
 * `SystemDiagnosticPanel.collect()` and `CommandCenterPanel.buildHtml()`
 * passed `sources: []`, `providers: []`, and a hard-coded `unknown`
 * sidecar — which made those panels less truthful than the underlying
 * services.
 *
 * Plan invariants:
 *   - Pure data composition. The aggregator reads from existing
 *     registries (api-diagnostic, providers/health, panel-health) but
 *     does not fetch on its own.
 *   - Sidecar status is captured via setSidecarHealth(...) — fetched by
 *     the host loop on its own cadence so this module stays sync.
 *   - Output is JSON-serializable so it can flow into the export
 *     bundle and the agent handoff packet.
 *   - No DOM, no globals at import time.
 */

import type { SourceDiagnostic as RuntimeSourceDiagnostic } from '@/services/api-diagnostic';
import { getAllProviderHealth } from '@/services/providers/provider-health';
import { getProviderHealthState } from '@/services/providers/providers-state';
import type {
  SourceDiagnostic,
  ProviderHealthRecord,
  SidecarHealth,
  HealthStatus,
} from './system-health-types';
import type { FeedHealthSnapshot } from './sentinel-feed-audit';
import {
  getDiagnosticEventBus,
  getNotificationTraceRegistry,
  getPanelHealthRegistry,
} from './diagnostics-state';
import type { DiagnosticEvent } from './diagnostic-events';
import type { NotificationTraceSummary, PanelHealth } from './system-health-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface LiveDiagnosticsSnapshot {
  generatedAt: number;
  panels: readonly PanelHealth[];
  sources: readonly SourceDiagnostic[];
  providers: readonly ProviderHealthRecord[];
  sidecar: SidecarHealth;
  feedSnapshots: readonly FeedHealthSnapshot[];
  notificationSummary: NotificationTraceSummary;
  recentEvents: readonly DiagnosticEvent[];
}

// ── Mutable singletons populated by the host loop ───────────────────────

let sidecarOverride: SidecarHealth | undefined;
let feedSnapshotMap = new Map<string, FeedHealthSnapshot>();

/** Source collector. The host boot wires the real api-diagnostic call;
 *  unit tests can leave it unset (returns [], which is the default
 *  diagnostic behavior when sources haven't been observed yet). */
let sourceCollector: (() => readonly RuntimeSourceDiagnostic[]) | undefined;

export function setSourceCollector(
  fn: (() => readonly RuntimeSourceDiagnostic[]) | undefined,
): void {
  sourceCollector = fn;
}

/** Host loop calls this after pinging /api/health (or after a request
 *  fails). The aggregator returns whatever was last set. */
export function setSidecarHealth(health: SidecarHealth): void {
  sidecarOverride = health;
}

/** Replace the entire feed-snapshot map. Called by the host's feed
 *  freshness tick — see data-loader.ts. */
export function setFeedSnapshots(snapshots: readonly FeedHealthSnapshot[]): void {
  feedSnapshotMap = new Map(snapshots.map((s) => [s.feedId, s]));
}

/** Update one feed snapshot in place. Used by individual data loaders
 *  on success/failure. */
export function recordFeedSnapshot(snapshot: FeedHealthSnapshot): void {
  feedSnapshotMap.set(snapshot.feedId, snapshot);
}

/** Reset all live state. Tests + storybook only. */
export function resetLiveDiagnosticsForTests(): void {
  sidecarOverride = undefined;
  feedSnapshotMap = new Map();
}

/**
 * Compose the live snapshot. Same input → same output: deterministic
 * given the underlying registry state.
 */
export function getLiveDiagnosticsSnapshot(now: () => number = Date.now): LiveDiagnosticsSnapshot {
  const generatedAt = now();
  const panels = getPanelHealthRegistry().all();
  const sources = collectSources();
  const providers = collectProviders(generatedAt);
  const sidecar = sidecarOverride ?? unknownSidecar('Sidecar reachability not yet probed.');
  const feedSnapshots = [...feedSnapshotMap.values()].sort((a, b) =>
    a.feedId.localeCompare(b.feedId),
  );
  // Stamp the summary with the snapshot's own (injectable) clock — the whole
  // snapshot is "as of generatedAt". The registry's summary() otherwise uses
  // real Date.now(), which made two same-clock snapshots differ by ~1 ms and
  // flaked the "deterministic given identical state" test on ms boundaries.
  const notificationSummary = { ...getNotificationTraceRegistry().summary(), generatedAt };
  const recentEvents = getDiagnosticEventBus().query().slice(-50);
  return {
    generatedAt,
    panels,
    sources,
    providers,
    sidecar,
    feedSnapshots,
    notificationSummary,
    recentEvents,
  };
}

// ── Source adapter ──────────────────────────────────────────────────────

/** Map api-diagnostic's runtime SourceDiagnostic → system-health
 *  SourceDiagnostic. The two share a name but diverged early. */
export function adaptRuntimeSource(src: RuntimeSourceDiagnostic): SourceDiagnostic {
  return {
    sourceId: src.id,
    label: src.name,
    status: mapHealth(src.status),
    lastSuccessAt: src.lastUpdateMs ?? undefined,
    providers: [],
    reason: src.notes[0] ?? `${src.status}`,
  };
}

function mapHealth(status: RuntimeSourceDiagnostic['status']): HealthStatus {
  // RuntimeSourceDiagnostic.status: 'healthy' | 'degraded' | 'failing' | 'silent' | 'unknown'
  // system-health HealthStatus: 'healthy' | 'degraded' | 'failing' | 'stale' | 'blind' | 'unsafe' | 'unknown'
  // 'silent' (no data at all) maps to 'blind' on the system-health side.
  if (status === 'silent') return 'blind';
  return status;
}

function collectSources(): SourceDiagnostic[] {
  // The host boot wires `setSourceCollector(() => diagnoseAll().sources)`
  // — keeping api-diagnostic out of this module's static graph means
  // unit tests can import this module without dragging in
  // import.meta.env.DEV-style transitive deps.
  const fn = sourceCollector;
  if (!fn) return [];
  try {
    return fn().map((s) => adaptRuntimeSource(s));
  } catch {
    return [];
  }
}

// ── Provider adapter ────────────────────────────────────────────────────

function collectProviders(now: number): ProviderHealthRecord[] {
  try {
    const state = getProviderHealthState();
    const all = getAllProviderHealth(state, now);
    return all.map((p) => ({
      providerId: p.providerId,
      status: mapProviderStatus(p.status),
      successRate: p.successRate,
      meanLatencyMs: p.p50LatencyMs > 0 ? p.p50LatencyMs : undefined,
      lastCallAt: p.lastSuccessAt,
      lastFailureAt: undefined,
      rateLimitedUntilMs: undefined,
    }));
  } catch {
    return [];
  }
}

function mapProviderStatus(status: string): HealthStatus {
  // provider-health.ts: 'healthy' | 'stale' | 'degraded' | 'down' | 'unknown_provider'
  // system-health HealthStatus: uses 'failing' instead of 'down'.
  if (status === 'down') return 'failing';
  if (status === 'unknown_provider') return 'unknown';
  if (status === 'healthy' || status === 'degraded' || status === 'stale') {
    return status;
  }
  return 'unknown';
}

// ── Helpers ─────────────────────────────────────────────────────────────

function unknownSidecar(reason: string): SidecarHealth {
  return {
    status: 'unknown',
    authenticated: false,
    reason,
  };
}

/** Build a SidecarHealth from the /api/health JSON response. */
export function sidecarHealthFromPayload(
  payload: unknown,
  reachableAt: number,
): SidecarHealth {
  if (!payload || typeof payload !== 'object') {
    return {
      status: 'failing',
      authenticated: false,
      reason: 'Sidecar /api/health returned an unexpected shape.',
    };
  }
  const obj = payload as Record<string, unknown>;
  const ok = obj.ok === true;
  const port = typeof obj.port === 'number' ? obj.port : undefined;
  const uptimeMs = typeof obj.uptime_ms === 'number' ? obj.uptime_ms : undefined;
  return {
    status: ok ? 'healthy' : 'failing',
    lastReachableAt: reachableAt,
    version: typeof obj.version === 'string' ? obj.version : undefined,
    authenticated: ok,
    reason: ok
      ? `Sidecar reachable on :${port ?? '?'} (uptime ${formatUptime(uptimeMs)})`
      : `Sidecar /api/health responded but ok=false`,
  };
}

/** Build a SidecarHealth for a network/auth failure. */
export function sidecarHealthFromError(error: unknown, attemptedAt: number): SidecarHealth {
  const message = error instanceof Error ? error.message : String(error);
  const isAuth = /401|unauthor/i.test(message);
  return {
    status: isAuth ? 'degraded' : 'failing',
    lastReachableAt: undefined,
    authenticated: false,
    reason: isAuth
      ? `Sidecar reachable but bearer-auth rejected at ${new Date(attemptedAt).toISOString()}`
      : `Sidecar /api/health unreachable: ${message}`,
  };
}

function formatUptime(ms?: number): string {
  if (typeof ms !== 'number') return '?';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}
