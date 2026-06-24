/**
 * Self-Test Runner — per
 * docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md PR 7 (lines 516-534).
 *
 * Pure deterministic test sequencer. The runner doesn't know how to
 * fetch the sidecar or read notification permission; the host wires
 * those probes in as adapter functions. That keeps this module
 * server-agnostic and trivially testable, while still giving the user
 * a single "run smoke tests now" surface.
 *
 * Plan invariants:
 *   - Every test returns a SelfTestResult with `status` in
 *     `pass|fail|warn|skipped` and a free-text reason
 *   - The aggregate status follows the worst result (fail > warn >
 *     pass), with skipped counted separately
 *   - Long-running tests have a per-test timeout enforced by the
 *     runner (probes are required to be promise-shaped)
 *   - JSON-serializable output for the export bundle (PR 8)
 */

// ── Public API ──────────────────────────────────────────────────────────

export type SelfTestStatus = 'pass' | 'fail' | 'warn' | 'skipped';

/** The plan's test list, with stable ids. */
export type SelfTestId =
  | 'sidecar_diag'
  | 'notification_permission'
  | 'saved_places'
  | 'nws_polygon_fixture'
  | 'provider_registry_loaded'
  | 'storage_available'
  | 'data_source_probes'
  | 'recent_renderer_errors'
  | 'panel_registry_mounted'
  | 'diagnostics_liveness';

export interface SelfTestResult {
  /** SelfTestId for the standard nine; arbitrary strings welcome for
   *  app-specific extras. The wider type is documented via the
   *  SelfTestId alias above. */
  id: string;
  label: string;
  status: SelfTestStatus;
  /** Free-text reason — surfaced in the UI. */
  reason: string;
  /** Optional structured detail for the inspector. */
  detail?: Record<string, unknown>;
  /** ms wall-clock duration of the test. */
  durationMs: number;
  /** ms timestamp when the test ran. */
  at: number;
}

export interface SelfTestReport {
  generatedAt: number;
  /** Aggregate status: the worst non-skipped result. */
  status: SelfTestStatus;
  results: readonly SelfTestResult[];
  /** Counts by status (pass/fail/warn/skipped). */
  counts: Record<SelfTestStatus, number>;
  /** Total wall-clock time across the run. */
  totalDurationMs: number;
  /** Plain-English headline. */
  summary: string;
}

/** Probe outcome a self-test definition returns (no timing). The
 *  runner adds duration + timestamp. */
export interface ProbeOutcome {
  status: SelfTestStatus;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface SelfTestDefinition {
  id: string;
  label: string;
  /** Probe — returns ProbeOutcome (sync or async). Throwing is treated
   *  as a fail with the error message as reason. */
  probe: () => ProbeOutcome | Promise<ProbeOutcome>;
  /** Per-test timeout in ms. Defaults to 5000. */
  timeoutMs?: number;
  /** Reason used when the test is skipped — e.g. when its dependencies
   *  aren't available in this build (web vs desktop). */
  skipReason?: string;
}

export interface SelfTestRunnerOptions {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5000;

// ── Runner ─────────────────────────────────────────────────────────────

export async function runSelfTests(
  definitions: readonly SelfTestDefinition[],
  options: SelfTestRunnerOptions = {},
): Promise<SelfTestReport> {
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const results: SelfTestResult[] = [];

  for (const def of definitions) {
    if (def.skipReason) {
      results.push({
        id: def.id,
        label: def.label,
        status: 'skipped',
        reason: def.skipReason,
        durationMs: 0,
        at: now(),
      });
      continue;
    }
    const before = now();
    try {
      const outcome = await runWithTimeout(def, def.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const after = now();
      results.push({
        id: def.id,
        label: def.label,
        status: outcome.status,
        reason: outcome.reason,
        detail: outcome.detail,
        durationMs: after - before,
        at: before,
      });
    } catch (error) {
      const after = now();
      results.push({
        id: def.id,
        label: def.label,
        status: 'fail',
        reason: error instanceof Error ? error.message : String(error),
        durationMs: after - before,
        at: before,
      });
    }
  }

  const counts = countResults(results);
  const status = aggregateStatus(results);
  const totalDurationMs = now() - startedAt;
  const summary = describeSummary(status, counts);

  return {
    generatedAt: startedAt,
    status,
    results,
    counts,
    totalDurationMs,
    summary,
  };
}

async function runWithTimeout(
  def: SelfTestDefinition,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const probePromise = Promise.resolve().then(() => def.probe());
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<ProbeOutcome>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Self-test "${def.id}" timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    const winner = await Promise.race([probePromise, timeoutPromise]);
    return winner;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

// ── Aggregation ────────────────────────────────────────────────────────

function countResults(results: readonly SelfTestResult[]): Record<SelfTestStatus, number> {
  const counts: Record<SelfTestStatus, number> = {
    pass: 0,
    fail: 0,
    warn: 0,
    skipped: 0,
  };
  for (const r of results) counts[r.status] += 1;
  return counts;
}

function aggregateStatus(results: readonly SelfTestResult[]): SelfTestStatus {
  let worst: SelfTestStatus = 'pass';
  for (const r of results) {
    if (r.status === 'fail') return 'fail';
    if (r.status === 'warn' && worst === 'pass') worst = 'warn';
  }
  // If every test was skipped we surface 'skipped' so the UI doesn't
  // claim a green pass.
  if (results.every((r) => r.status === 'skipped')) return 'skipped';
  return worst;
}

function describeSummary(
  status: SelfTestStatus,
  counts: Record<SelfTestStatus, number>,
): string {
  const total = counts.pass + counts.fail + counts.warn + counts.skipped;
  if (total === 0) return 'No self-tests configured.';
  if (status === 'pass') {
    return `All ${counts.pass} self-tests passed.`;
  }
  if (status === 'skipped') {
    return `All ${counts.skipped} self-tests skipped.`;
  }
  const parts: string[] = [];
  if (counts.fail) parts.push(`${counts.fail} failed`);
  if (counts.warn) parts.push(`${counts.warn} warned`);
  if (counts.pass) parts.push(`${counts.pass} passed`);
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  return `Self-tests: ${parts.join(', ')}.`;
}

// ── Standard probe builders ────────────────────────────────────────────

/** The plan's "standard nine" — adapter functions wire host-specific
 *  probes (sidecar fetch, notification permission, etc.) and the
 *  runner orchestrates. Each builder returns a `SelfTestDefinition`
 *  the host can splice into its `runSelfTests([...])` call. */

export interface StandardProbeAdapters {
  fetchSidecarDiag?: () => Promise<{ ok: boolean; reason?: string; detail?: Record<string, unknown> }>;
  checkNotificationPermission?: () => Promise<'granted' | 'denied' | 'default' | 'unsupported'>;
  countSavedPlaces?: () => number;
  runNwsPolygonFixture?: () => Promise<{ ok: boolean; reason?: string }>;
  countProviderRegistry?: () => number;
  isStorageAvailable?: () => { indexedDb: boolean; localStorage: boolean };
  probeDataSources?: () => Promise<{
    healthy: number;
    degraded: number;
    failing: number;
    detail?: Record<string, unknown>;
  }>;
  countRecentRendererErrors?: (windowMs: number) => number;
  countMountedPanels?: () => { mounted: number; total: number };
}

export function standardSelfTestDefinitions(
  adapters: StandardProbeAdapters,
): SelfTestDefinition[] {
  return [
    sidecarDiagDefinition(adapters.fetchSidecarDiag),
    notificationPermissionDefinition(adapters.checkNotificationPermission),
    savedPlacesDefinition(adapters.countSavedPlaces),
    nwsPolygonFixtureDefinition(adapters.runNwsPolygonFixture),
    providerRegistryDefinition(adapters.countProviderRegistry),
    storageAvailableDefinition(adapters.isStorageAvailable),
    dataSourceProbesDefinition(adapters.probeDataSources),
    rendererErrorsDefinition(adapters.countRecentRendererErrors),
    panelRegistryDefinition(adapters.countMountedPanels),
  ];
}

function sidecarDiagDefinition(
  fetchSidecarDiag?: StandardProbeAdapters['fetchSidecarDiag'],
): SelfTestDefinition {
  if (!fetchSidecarDiag) {
    return {
      id: 'sidecar_diag',
      label: 'Sidecar /api/diag',
      probe: () => ({ status: 'skipped', reason: 'No sidecar adapter wired in.' }),
      skipReason: 'No sidecar adapter wired in.',
    };
  }
  return {
    id: 'sidecar_diag',
    label: 'Sidecar /api/diag',
    probe: async () => {
      const r = await fetchSidecarDiag();
      return r.ok
        ? { status: 'pass', reason: 'Sidecar reachable.', detail: r.detail }
        : { status: 'fail', reason: r.reason ?? 'Sidecar unreachable.', detail: r.detail };
    },
  };
}

function notificationPermissionDefinition(
  check?: StandardProbeAdapters['checkNotificationPermission'],
): SelfTestDefinition {
  if (!check) {
    return {
      id: 'notification_permission',
      label: 'Notification permission',
      probe: () => ({ status: 'skipped', reason: 'No permission adapter wired in.' }),
      skipReason: 'No permission adapter wired in.',
    };
  }
  return {
    id: 'notification_permission',
    label: 'Notification permission',
    probe: async () => {
      const state = await check();
      switch (state) {
        case 'granted': {
          return { status: 'pass', reason: 'Permission granted.' };
        }
        case 'denied': {
          return {
            status: 'fail',
            reason: 'Notification permission denied — critical alerts cannot reach the user. Open System Settings → Notifications to grant access.',
          };
        }
        case 'default': {
          return {
            status: 'warn',
            reason: 'Permission not yet requested. Use the storm-mode banner to prompt the user.',
          };
        }
        case 'unsupported': {
          return { status: 'warn', reason: 'Notifications not supported in this runtime.' };
        }
      }
    },
  };
}

function savedPlacesDefinition(
  count?: StandardProbeAdapters['countSavedPlaces'],
): SelfTestDefinition {
  if (!count) {
    return {
      id: 'saved_places',
      label: 'Saved places',
      probe: () => ({ status: 'skipped', reason: 'No saved-places adapter wired in.' }),
      skipReason: 'No saved-places adapter wired in.',
    };
  }
  return {
    id: 'saved_places',
    label: 'Saved places',
    probe: () => {
      const n = count();
      return n === 0
        ? {
            status: 'fail',
            reason: 'No saved places — weather warnings cannot match a location. Add at least one in Settings → Locations.',
          }
        : { status: 'pass', reason: `${n} saved place${n === 1 ? '' : 's'} configured.` };
    },
  };
}

function nwsPolygonFixtureDefinition(
  fixture?: StandardProbeAdapters['runNwsPolygonFixture'],
): SelfTestDefinition {
  if (!fixture) {
    return {
      id: 'nws_polygon_fixture',
      label: 'NWS polygon fixture',
      probe: () => ({ status: 'skipped', reason: 'No fixture adapter wired in.' }),
      skipReason: 'No fixture adapter wired in.',
    };
  }
  return {
    id: 'nws_polygon_fixture',
    label: 'NWS polygon fixture',
    probe: async () => {
      const r = await fixture();
      return r.ok
        ? { status: 'pass', reason: 'Polygon match fixture passed.' }
        : { status: 'fail', reason: r.reason ?? 'Polygon match fixture failed.' };
    },
  };
}

function providerRegistryDefinition(
  count?: StandardProbeAdapters['countProviderRegistry'],
): SelfTestDefinition {
  if (!count) {
    return {
      id: 'provider_registry_loaded',
      label: 'Provider registry',
      probe: () => ({ status: 'skipped', reason: 'No provider registry adapter wired in.' }),
      skipReason: 'No provider registry adapter wired in.',
    };
  }
  return {
    id: 'provider_registry_loaded',
    label: 'Provider registry',
    probe: () => {
      const n = count();
      return n === 0
        ? { status: 'fail', reason: 'Provider registry is empty — no data sources will resolve.' }
        : { status: 'pass', reason: `${n} provider${n === 1 ? '' : 's'} registered.` };
    },
  };
}

function storageAvailableDefinition(
  check?: StandardProbeAdapters['isStorageAvailable'],
): SelfTestDefinition {
  if (!check) {
    return {
      id: 'storage_available',
      label: 'Storage availability',
      probe: () => ({ status: 'skipped', reason: 'No storage adapter wired in.' }),
      skipReason: 'No storage adapter wired in.',
    };
  }
  return {
    id: 'storage_available',
    label: 'Storage availability',
    probe: () => {
      const r = check();
      if (!r.indexedDb && !r.localStorage) {
        return { status: 'fail', reason: 'Neither IndexedDB nor localStorage is available.' };
      }
      if (!r.indexedDb) {
        return { status: 'warn', reason: 'IndexedDB unavailable — analyst memory falls back to localStorage.' };
      }
      if (!r.localStorage) {
        return { status: 'warn', reason: 'localStorage unavailable — bootstrap caches will not persist.' };
      }
      return { status: 'pass', reason: 'Both IndexedDB and localStorage are available.' };
    },
  };
}

function dataSourceProbesDefinition(
  probes?: StandardProbeAdapters['probeDataSources'],
): SelfTestDefinition {
  if (!probes) {
    return {
      id: 'data_source_probes',
      label: 'Core data source probes',
      probe: () => ({ status: 'skipped', reason: 'No data-source adapter wired in.' }),
      skipReason: 'No data-source adapter wired in.',
    };
  }
  return {
    id: 'data_source_probes',
    label: 'Core data source probes',
    probe: async () => {
      const r = await probes();
      if (r.failing > 0) {
        return {
          status: 'fail',
          reason: `${r.failing} data source${r.failing === 1 ? '' : 's'} failing, ${r.degraded} degraded, ${r.healthy} healthy.`,
          detail: r.detail,
        };
      }
      if (r.degraded > 0) {
        return {
          status: 'warn',
          reason: `${r.degraded} data source${r.degraded === 1 ? '' : 's'} degraded, ${r.healthy} healthy.`,
          detail: r.detail,
        };
      }
      return {
        status: 'pass',
        reason: `${r.healthy} data source${r.healthy === 1 ? '' : 's'} healthy.`,
        detail: r.detail,
      };
    },
  };
}

function rendererErrorsDefinition(
  count?: StandardProbeAdapters['countRecentRendererErrors'],
): SelfTestDefinition {
  if (!count) {
    return {
      id: 'recent_renderer_errors',
      label: 'Recent renderer errors',
      probe: () => ({ status: 'skipped', reason: 'No renderer-error adapter wired in.' }),
      skipReason: 'No renderer-error adapter wired in.',
    };
  }
  return {
    id: 'recent_renderer_errors',
    label: 'Recent renderer errors',
    probe: () => {
      const windowMs = 5 * 60 * 1000;
      const n = count(windowMs);
      if (n >= 5) {
        return {
          status: 'fail',
          reason: `${n} renderer errors in the last 5 minutes — open the diagnostics overlay (⌘⇧D).`,
        };
      }
      if (n >= 1) {
        return {
          status: 'warn',
          reason: `${n} renderer error${n === 1 ? '' : 's'} in the last 5 minutes.`,
        };
      }
      return { status: 'pass', reason: 'No renderer errors in the last 5 minutes.' };
    },
  };
}

function panelRegistryDefinition(
  check?: StandardProbeAdapters['countMountedPanels'],
): SelfTestDefinition {
  if (!check) {
    return {
      id: 'panel_registry_mounted',
      label: 'Panel registry mounted',
      probe: () => ({ status: 'skipped', reason: 'No panel adapter wired in.' }),
      skipReason: 'No panel adapter wired in.',
    };
  }
  return {
    id: 'panel_registry_mounted',
    label: 'Panel registry mounted',
    probe: () => {
      const r = check();
      if (r.total === 0) {
        return { status: 'warn', reason: 'No panels registered yet.' };
      }
      if (r.mounted === 0) {
        return {
          status: 'fail',
          reason: `0 of ${r.total} panels mounted — the layout did not initialise.`,
        };
      }
      return {
        status: 'pass',
        reason: `${r.mounted} of ${r.total} panel${r.total === 1 ? '' : 's'} mounted.`,
      };
    },
  };
}
