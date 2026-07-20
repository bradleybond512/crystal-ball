/**
 * Frontend diagnostics export composer — per
 * docs/CLAUDE_FUNCTIONALITY_DIAGNOSTICS_PERFORMANCE_ROADMAP_2026-04-29.md
 * Priority 2.
 *
 * Wraps `buildExportBundle()` with the live diagnostics snapshot from
 * P1 plus the strategic-self-improvement sections so `Cmd+Shift+D`
 * produces the schema-v2 bundle the user expects when triaging.
 *
 * The Rust `copy_diagnostics` Tauri command still exists for log
 * tails — this module appends that output as a markdown appendix
 * after the structured frontend bundle, instead of letting the Rust
 * text replace the structured bundle entirely.
 *
 * Pure: no DOM, no fetch. Callers (log-bridge.ts) wire clipboard.
 */

import { aggregateSystemHealth, contextFromSnapshots } from './system-health';
import {
  buildExportBundle,
  exportBundleToMarkdown,
  redactString,
  type AlgorithmCalibrationSummary,
  type AlgorithmTraceEntry,
  type CorrelationSummary,
  type DiagnosticsExportBundle,
  type ExportBundleAppMeta,
  type ExportBundleEnvHints,
  type FeedHealthEntry,
  type PanelHealthSummary,
  type SituationSummary,
  type SystemInfo,
} from './export-bundle';
import { getLiveDiagnosticsSnapshot } from './live-diagnostics-snapshot';
import {
  getFeatureHealthRegistry,
  getNotificationTraceRegistry,
  getPanelHealthRegistry,
} from './diagnostics-state';
import { getAll as getAllSituations } from '@/services/intelligence/situation-store';
import { getCausalChainBuilder, type CausalChain } from '@/services/intelligence/causal-chain';

/** Pure mapping: live CausalChain → the export bundle's chain summary. */
export function causalChainToCorrelationSummary(c: CausalChain): CorrelationSummary {
  return {
    id: c.id,
    chainType: 'causal',
    title: `${c.rootCause.title} → ${c.leafEffects.length} downstream effect${c.leafEffects.length === 1 ? '' : 's'}`,
    confidence: c.overallConfidence,
    detectedAt: c.builtAt,
    eventIds: [...new Set(c.links.flatMap((l) => [l.causeId, l.effectId]))],
  };
}
import { summarizeScenarioCoverage } from '@/services/scenarios/scenario-library';
import { getActiveQualityDebt } from '@/services/quality/quality-debt-state';
import { getMissionStateDetail } from './mission-state-service';
import { dataFreshness } from '@/services/data-freshness';
import {
  getAlgorithmEvaluationLedger,
} from '@/services/algorithms/algorithms-state';
import { summarizeCalibration } from '@/services/algorithms/algorithm-evaluation-ledger';

// ── Public API ──────────────────────────────────────────────────────────

export interface ComposeFrontendDiagnosticsExportInput {
  app: ExportBundleAppMeta;
  env?: ExportBundleEnvHints;
  /** Optional Rust/sidecar log appendix to append after the bundle. */
  appendix?: string;
  /** Optional clock for tests. */
  now?: () => number;
}

export interface FrontendDiagnosticsExport {
  bundle: DiagnosticsExportBundle;
  /** Markdown payload suitable for clipboard / GitHub-issue paste. */
  markdown: string;
}

/**
 * Compose the frontend diagnostics export from live registry state.
 * Always returns a valid bundle even when subsystems throw — failures
 * become inline notes in the markdown rather than empty clipboard text.
 */
export function composeFrontendDiagnosticsExport(
  input: ComposeFrontendDiagnosticsExportInput,
): FrontendDiagnosticsExport {
  const now = input.now ?? Date.now;
  const snapshot = getLiveDiagnosticsSnapshot(now);

  const featureContext = contextFromSnapshots({
    panels: snapshot.panels,
    sources: snapshot.sources,
    providers: snapshot.providers,
  });
  const features = getFeatureHealthRegistry().all(featureContext);

  const systemHealth = aggregateSystemHealth({
    panels: snapshot.panels,
    features,
    sources: snapshot.sources,
    providers: snapshot.providers,
    notifications: snapshot.notificationSummary,
    sidecar: snapshot.sidecar,
  });

  // Strategic + diagnostic sections — best-effort. Failure on any one
  // section does not block the overall export.
  const scenarioCoverage = safe(() => summarizeScenarioCoverage());
  const qualityDebt = safe(() => getActiveQualityDebt());
  const missionStateDetail = safe(() => getMissionStateDetail());
  const missionState = missionStateDetail
    ? {
        state: missionStateDetail.state,
        staleFeedCount: missionStateDetail.staleFeedCount,
        criticalStaleFeedCount: missionStateDetail.criticalStaleFeedCount,
      }
    : undefined;

  const feedHealth = safe((): FeedHealthEntry[] =>
    dataFreshness.getAllSources().map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      lastUpdateIso: s.lastUpdate ? s.lastUpdate.toISOString() : null,
    })),
  );

  const algorithmState = safe((): AlgorithmCalibrationSummary[] => {
    const ledger = getAlgorithmEvaluationLedger();
    return summarizeCalibration(ledger.all()).map((c) => ({
      algorithmId: c.algorithmId,
      domain: c.domain,
      graded: c.graded,
      hitRate: Number.isNaN(c.hitRate) ? 0 : c.hitRate,
      weightedHitRate: Number.isNaN(c.weightedHitRate) ? 0 : c.weightedHitRate,
      meanDurationMs: Number.isNaN(c.meanDurationMs) ? 0 : c.meanDurationMs,
    }));
  });

  const systemInfo = safe((): SystemInfo => {
    const g = globalThis as unknown as {
      __APP_VERSION__?: string;
      performance?: { now(): number };
      // Chrome-only memory API
      memory?: { usedJSHeapSize?: number };
    };
    return {
      appVersion: input.app.version,
      buildHash: input.app.buildHash,
      uptimeMs: g.performance ? Math.round(g.performance.now()) : undefined,
      memoryUsedBytes: g.memory?.usedJSHeapSize,
    };
  });

  const panelHealthSummary = safe((): PanelHealthSummary => {
    const all = getPanelHealthRegistry().all();
    let rendered = 0;
    let degraded = 0;
    let errored = 0;
    for (const p of all) {
      if (p.status === 'healthy') rendered++;
      else if (p.status === 'degraded' || p.status === 'stale') degraded++;
      else if (p.status === 'failing' || p.status === 'blind' || p.status === 'unsafe') errored++;
    }
    return {
      total: all.length,
      rendered,
      degraded,
      errored,
      entries: all.map((p) => ({
        panelId: p.panelId,
        label: p.label,
        status: p.status,
        lastRenderAt: p.lastRenderAt,
        lastErrorAt: p.lastErrorAt,
        reason: p.lastError,
      })),
    };
  });

  const situations = safe((): SituationSummary[] =>
    getAllSituations()
      .filter((s) => s.status !== 'resolved')
      .map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        severity: s.severity,
        domain: s.domain,
        startedAt: s.startedAt,
        updatedAt: s.updatedAt,
        observationIds: s.observationIds,
        correlationIds: s.correlationIds,
        confidence: s.confidence,
        tags: s.tags,
        summary: s.summary,
      })),
  );

  // Chains come from the LIVE causal-chain builder (the panelized system)
  // — the dead correlator-v2 singleton was never started and always
  // exported an empty list here.
  const correlations = safe((): CorrelationSummary[] =>
    getCausalChainBuilder().getChains().map((c) => causalChainToCorrelationSummary(c)),
  );

  const algorithmTrace = safe((): AlgorithmTraceEntry[] => {
    if (!situations) return [];
    return situations.map((s) => ({
      situationId: s.id,
      algorithmId: 'situation-clustering',
      confidence: s.confidence,
      evidenceChain: [
        ...s.observationIds.map((id) => ({ kind: 'observation' as const, id })),
        ...s.correlationIds.map((id) => ({ kind: 'correlation' as const, id })),
      ],
    }));
  });

  const bundle = buildExportBundle({
    now,
    app: input.app,
    env: input.env,
    systemHealth,
    notifications: {
      registry: getNotificationTraceRegistry(),
    },
    events: { snapshot: [...snapshot.recentEvents] },
    scenarioCoverage,
    qualityDebt,
    missionState,
    feedHealth,
    algorithmState,
    systemInfo,
    panelHealthSummary,
    situations,
    correlations,
    algorithmTrace,
  });

  let markdown = exportBundleToMarkdown(bundle);
  if (input.appendix && input.appendix.trim().length > 0) {
    // The Rust log tails + client breadcrumbs are raw — run them through the
    // same redaction the structured bundle gets so a shared "debug bundle"
    // can't leak credentials, request-URL secrets, emails, or the OS username.
    const safeAppendix = redactString(input.appendix.trim());
    markdown += `\n### Sidecar / desktop log appendix\n\n\`\`\`\n${safeAppendix}\n\`\`\`\n`;
  }

  return { bundle, markdown };
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
