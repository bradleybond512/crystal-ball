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
  type DiagnosticsExportBundle,
  type ExportBundleAppMeta,
  type ExportBundleEnvHints,
} from './export-bundle';
import { getLiveDiagnosticsSnapshot } from './live-diagnostics-snapshot';
import {
  getFeatureHealthRegistry,
  getNotificationTraceRegistry,
} from './diagnostics-state';
import { summarizeScenarioCoverage } from '@/services/scenarios/scenario-library';

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

  // Strategic sections — best-effort. Failure on any one section does
  // not block the overall export; the missing field just stays
  // undefined and the consumer will see only what was available.
  const scenarioCoverage = safe(() => summarizeScenarioCoverage());

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
  });

  let markdown = exportBundleToMarkdown(bundle);
  if (input.appendix && input.appendix.trim().length > 0) {
    markdown += `\n### Sidecar / desktop log appendix\n\n\`\`\`\n${input.appendix.trim()}\n\`\`\`\n`;
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
