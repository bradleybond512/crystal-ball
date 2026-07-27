/**
 * Sidecar Pusher — mirrors renderer-side reasoning state to the sidecar so
 * external agents (the Crystal Ball MCP server, scheduled scripts) can read
 * it via HTTP without needing access to the renderer's localStorage.
 *
 * The renderer is the source of truth for:
 *   - the analyst-loop snapshot (cb:analyst-hypotheses)
 *   - the mode-forecast snapshot (cb:mode-advisory)
 *   - hypothesis-accuracy stats (read on demand)
 *   - hypothesis-thread state (read on demand)
 *
 * On each event we POST a compact projection to the sidecar's in-memory
 * cache. The sidecar exposes matching GET endpoints registered as MCP tools.
 *
 * Pushes are silent (errors swallowed) since they're a best-effort mirror.
 */

import { isDesktopRuntime } from './runtime';
import { isGhostMode } from './mode-manager';
import type { AnalystSnapshot } from './analyst-loop';
import type { ForecastSnapshot } from './mode-forecast';
import { getKindAccuracy } from './hypothesis-accuracy';
import { getAllThreads } from './hypothesis-threads';
import { getHotEntities, getEntityMentions } from './hypothesis-entities';
import { dumpDebug, getErrorCounts, type DebugEntry } from './reasoning-debug';
import { getMetricsSnapshot, type MetricsSnapshot } from './reasoning-metrics';
import { getPipelineTraceRegistry } from './diagnostics/diagnostics-state';
import { registerRecurringLoop } from './diagnostics/recurring-loops';
import {
  getAlgorithmDefinitions,
  getAlgorithmEvaluationLedger,
} from './algorithms/algorithms-state';
import { getAlgorithmLedgerPersistenceStatus } from './algorithms/algorithm-ledger-persistence';
import { getTunings } from './algorithms/tunable-params-store';
import { getTuningDecisions } from './algorithms/tuning-decision-log';
import {
  buildAlgorithmDiagnosticsSnapshot,
  type AlgorithmDiagnosticsSnapshot,
} from './algorithms/algorithm-diagnostics';
import { getCalibrationStore } from './intelligence/forecast-calibration-adapter';
import { getSpotPriceDiagnostics } from './market/spot-price-store';
import { getLatestStormReportBatch } from './spc-outlook';

const ENDPOINT = '/api/analyst-state';

interface AccuracyRow { kind: string; hits: number; misses: number; ratio: number }
interface ThreadRow {
  signature: string;
  kind: string;
  region?: string;
  cycleCount: number;
  confidence: number;
  trajectory: string;
  peakRisk: string;
  firstSeen: number;
  lastSeen: number;
}
interface EntityRow { entity: string; kind: string; hypothesisCount: number }

interface PushPayload {
  timestamp: number;
  analyst?: AnalystSnapshot;
  forecast?: ForecastSnapshot;
  accuracy?: AccuracyRow[];
  threads?: ThreadRow[];
  hotEntities?: EntityRow[];
  entityCount?: number;
  ghostMode?: boolean;
  /** Last N debug entries, tail of the ring buffer. */
  debugLog?: DebugEntry[];
  /** Error counters per category. */
  debugErrorCounts?: Record<string, number>;
  /** Metrics snapshot (latencies + counters). */
  metrics?: MetricsSnapshot;
  /** Pipeline trace registry snapshot (fact lifecycle). */
  pipelineTrace?: ReturnType<ReturnType<typeof getPipelineTraceRegistry>['snapshot']>;
  /** Compact algorithm health, latency, tuning, and evaluation snapshot. */
  algorithmDiagnostics?: AlgorithmDiagnosticsSnapshot;
}

let lastPushAt = 0;
const MIN_PUSH_INTERVAL_MS = 2000; // debounce to coalesce burst events
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPayload: PushPayload = { timestamp: 0 };
let flushInFlight = false;

async function flush(): Promise<void> {
  pendingTimer = null;
  if (!isDesktopRuntime()) return;
  // Only one in-flight POST at a time. A second flush() call during an
  // existing fetch could otherwise deliver stale state out of order
  // (the earlier flush snapshotted pendingPayload before the second's
  // buildup). Re-schedule instead, so the next flush picks up the full
  // accumulated payload.
  if (flushInFlight) { schedule(); return; }
  flushInFlight = true;
  const payload: PushPayload = { ...pendingPayload, timestamp: Date.now(), ghostMode: isGhostMode() };
  pendingPayload = { timestamp: 0 };
  lastPushAt = Date.now();
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch { /* silent — best effort */ }
  finally {
    flushInFlight = false;
    // If events accumulated during the in-flight POST, push again soon.
    if (hasPendingPayload()) schedule();
  }
}

function hasPendingPayload(): boolean {
  return pendingPayload.analyst !== undefined
    || pendingPayload.forecast !== undefined
    || (pendingPayload.accuracy?.length ?? 0) > 0
    || (pendingPayload.threads?.length ?? 0) > 0
    || (pendingPayload.hotEntities?.length ?? 0) > 0
    || pendingPayload.debugLog !== undefined
    || pendingPayload.debugErrorCounts !== undefined
    || pendingPayload.metrics !== undefined
    || pendingPayload.pipelineTrace !== undefined
    || pendingPayload.algorithmDiagnostics !== undefined;
}

function schedule(): void {
  if (pendingTimer !== null) return;
  // If a flush is in flight, skip scheduling — its finally will call
  // schedule() again after completion (single-pending-timer invariant).
  if (flushInFlight) return;
  const since = Date.now() - lastPushAt;
  const wait = since >= MIN_PUSH_INTERVAL_MS ? 0 : (MIN_PUSH_INTERVAL_MS - since);
  pendingTimer = setTimeout(() => { void flush(); }, wait);
}

function summarizeAccuracy(): PushPayload['accuracy'] {
  const out: PushPayload['accuracy'] = [];
  for (const [kind, stats] of getKindAccuracy()) {
    const total = stats.hits + stats.misses;
    if (total === 0) continue;
    out.push({ kind, hits: stats.hits, misses: stats.misses, ratio: stats.hits / total });
  }
  return out;
}

function summarizeThreads(): PushPayload['threads'] {
  return getAllThreads().slice(0, 20).map(t => ({
    signature: t.signature,
    kind: t.kind,
    region: t.region,
    cycleCount: t.cycleCount,
    confidence: t.latest.confidence,
    trajectory: t.trajectory,
    peakRisk: t.peakRisk,
    firstSeen: t.firstSeen,
    lastSeen: t.lastSeen,
  }));
}

function summarizeEntities(): { hot: PushPayload['hotEntities']; total: number } {
  const all = getEntityMentions();
  const hot = getHotEntities().slice(0, 12).map(m => ({
    entity: m.entity,
    kind: m.kind,
    hypothesisCount: m.hypothesisIds.length,
  }));
  return { hot, total: all.length };
}

function refreshDiagnosticPayload(): void {
  pendingPayload.debugLog = dumpDebug().slice(-50);
  pendingPayload.debugErrorCounts = { ...getErrorCounts() };
  pendingPayload.metrics = getMetricsSnapshot();
  pendingPayload.pipelineTrace = getPipelineTraceRegistry().snapshot();
  pendingPayload.algorithmDiagnostics = buildAlgorithmDiagnosticsSnapshot({
    definitions: getAlgorithmDefinitions(),
    records: getAlgorithmEvaluationLedger().all(),
    forecastPredictions: getCalibrationStore().all(),
    marketSpotPrices: getSpotPriceDiagnostics(),
    weatherReportBatch: getLatestStormReportBatch(),
    persistence: getAlgorithmLedgerPersistenceStatus(),
    tunings: getTunings(),
    tuningDecisions: getTuningDecisions(),
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startSidecarPusher(): void {
  if (started) return;
  started = true;
  if (!isDesktopRuntime()) return;

  registerRecurringLoop(
    'sidecar-diagnostics-mirror',
    () => {
      refreshDiagnosticPayload();
      schedule();
    },
    15_000,
    { priority: 'normal', runImmediately: true },
  );

  document.addEventListener('cb:analyst-hypotheses', (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    pendingPayload.analyst = ce.detail;
    pendingPayload.accuracy = summarizeAccuracy();
    pendingPayload.threads = summarizeThreads();
    const ent = summarizeEntities();
    pendingPayload.hotEntities = ent.hot;
    pendingPayload.entityCount = ent.total;
    refreshDiagnosticPayload();
    schedule();
  });

  document.addEventListener('cb:mode-advisory', (e: Event) => {
    const ce = e as CustomEvent<ForecastSnapshot>;
    pendingPayload.forecast = ce.detail;
    // Keep metrics fresh on every cycle — useful for watching forecast op
    // latencies from MCP without waiting for the next analyst cycle.
    refreshDiagnosticPayload();
    schedule();
  });

  // Push on any reasoning-debug error so the sidecar (and MCP readers)
  // see failures within the 2s debounce window.
  document.addEventListener('cb:reasoning-debug-event', (e: Event) => {
    const ce = e as CustomEvent<DebugEntry>;
    if (ce.detail?.level !== 'error') return;
    refreshDiagnosticPayload();
    schedule();
  });
}
