/* eslint-disable no-console, unicorn/no-immediate-mutation */
/**
 * API Diagnostic Service
 *
 * Unified health/diagnostic layer that aggregates data freshness state,
 * circuit breaker state, offline-staleness state, and live/dead status
 * for every external data source Crystal Ball consumes. Designed for
 * ops-level troubleshooting: "which feeds are working right now?"
 *
 * Exposed:
 *   - `diagnoseAll(): Promise<DiagnosticReport>` — full report
 *   - `diagnoseSource(id): Promise<SourceDiagnostic>` — one source
 *   - `pingSource(id): Promise<PingResult>` — live HEAD/GET probe
 *   - `window.cbDiag` — console-accessible helper (see bottom)
 *
 * Report shape is JSON-serializable so it can be exported, copy/pasted
 * into issues, or shipped to a log collector. No external dependencies.
 */

import { dataFreshness, type DataSourceState } from './data-freshness';
import { getCircuitBreakerStatus, getCircuitBreakerCooldownInfo } from '@/utils/circuit-breaker';
import { getOfflineState, getSourceAge } from './offline-staleness';

// ── Types ─────────────────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'failing' | 'silent' | 'unknown';

export interface SourceDiagnostic {
  id: string;
  name: string;
  /** Rolled-up health verdict */
  status: HealthStatus;
  /** Unix-ms of last successful update (from dataFreshness) */
  lastUpdateMs: number | null;
  /** Seconds since last update; null if never */
  ageSeconds: number | null;
  /** Most recent error message, if any */
  lastError: string | null;
  /** Total item count ingested from this source so far */
  itemCount: number;
  /** Circuit-breaker state: closed | open | half-open */
  breakerState: string | null;
  /** True if the circuit breaker has tripped and is cooling down */
  onCooldown: boolean;
  cooldownRemainingSeconds: number;
  /** Whether this source feeds into the risk/correlation engines */
  requiredForRisk: boolean;
  /** Human-readable diagnosis */
  notes: string[];
}

export interface DiagnosticReport {
  generatedAt: number;
  isOnline: boolean;
  offlineStatus: string;
  totalSources: number;
  healthy: number;
  degraded: number;
  failing: number;
  silent: number;
  unknown: number;
  requiredSourcesFailing: string[];
  /** Circuit breakers that are currently open (tripped) */
  trippedBreakers: string[];
  sources: SourceDiagnostic[];
  /** Top-5 oldest sources — likely stale */
  oldestSources: { id: string; name: string; ageSeconds: number }[];
  /** Advice for the user/operator */
  recommendations: string[];
}

export interface PingResult {
  sourceId: string;
  url: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  error: string | null;
  fetchedAt: number;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

const STALE_AFTER_SEC = 15 * 60;       // 15 minutes
const VERY_STALE_AFTER_SEC = 60 * 60;  // 1 hour
const SILENT_AFTER_SEC = 6 * 60 * 60;  // 6 hours (likely no longer updating)

// ── Live probe endpoints (stable, HEAD/GET-friendly) ─────────────────────────
// Only includes endpoints that are safe to probe without auth or rate limits.

const PROBE_ENDPOINTS: Record<string, string> = {
  weather: 'https://api.weather.gov/alerts/active?limit=1',
  usgs: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=1',
  gdacs: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=&alertlevel=&country=&fromDate=',
  'open-meteo': 'https://api.open-meteo.com/v1/forecast?latitude=40.7&longitude=-74&current=temperature_2m',
  rainviewer: 'https://api.rainviewer.com/public/weather-maps.json',
  'noaa-swpc': 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
  // add more as needed — omit feeds that require API keys
};

// ── Core diagnosis ────────────────────────────────────────────────────────────

function classifyHealth(
  ageSeconds: number | null,
  hasError: boolean,
  onCooldown: boolean,
): HealthStatus {
  if (onCooldown) return 'failing';
  if (hasError && (ageSeconds === null || ageSeconds > STALE_AFTER_SEC)) return 'failing';
  if (ageSeconds === null) return 'unknown';
  if (ageSeconds > SILENT_AFTER_SEC) return 'silent';
  if (ageSeconds > VERY_STALE_AFTER_SEC) return 'degraded';
  if (ageSeconds > STALE_AFTER_SEC) return 'degraded';
  return 'healthy';
}

function notesForSource(src: SourceDiagnostic): string[] {
  const notes: string[] = [];
  if (src.status === 'silent') {
    notes.push(`Has not reported in ${Math.round((src.ageSeconds ?? 0) / 3600)}h — likely stopped polling or upstream is down.`);
  }
  if (src.status === 'failing' && src.onCooldown) {
    notes.push(`Circuit breaker tripped; will retry in ${src.cooldownRemainingSeconds}s.`);
  }
  if (src.status === 'degraded') {
    notes.push(`Stale — no update in ${Math.round((src.ageSeconds ?? 0) / 60)}min.`);
  }
  if (src.lastError) {
    notes.push(`Last error: ${src.lastError.slice(0, 200)}`);
  }
  if (src.itemCount === 0 && src.status !== 'unknown') {
    notes.push('Zero items ingested — endpoint may be returning empty responses.');
  }
  if (src.requiredForRisk && src.status !== 'healthy') {
    notes.push('This source feeds the risk/correlation engines — degradation reduces signal quality.');
  }
  return notes;
}

function diagnosticForSource(
  source: DataSourceState,
  now: number,
  breakers: Record<string, string>,
): SourceDiagnostic {
  const ageSeconds = source.lastUpdate
    ? Math.floor((now - source.lastUpdate.getTime()) / 1000)
    : null;
  const sourceId = source.id.toLowerCase();
  const breaker = Object.entries(breakers)
    .find(([name]) => name.toLowerCase().includes(sourceId) || sourceId.includes(name.toLowerCase()));
  const breakerState = breaker?.[1] ?? null;
  const cooldownInfo = breaker
    ? getCircuitBreakerCooldownInfo(breaker[0])
    : { onCooldown: false, remainingSeconds: 0 };
  const status = classifyHealth(ageSeconds, Boolean(source.lastError), cooldownInfo.onCooldown);
  const diagnostic: SourceDiagnostic = {
    id: source.id,
    name: source.name,
    status,
    lastUpdateMs: source.lastUpdate?.getTime() ?? null,
    ageSeconds,
    lastError: source.lastError,
    itemCount: source.itemCount,
    breakerState,
    onCooldown: cooldownInfo.onCooldown,
    cooldownRemainingSeconds: cooldownInfo.remainingSeconds,
    requiredForRisk: source.requiredForRisk,
    notes: [],
  };
  diagnostic.notes = notesForSource(diagnostic);
  return diagnostic;
}

interface RecommendationContext {
  isOnline: boolean;
  sourceCount: number;
  healthy: number;
  degraded: number;
  failing: number;
  silent: number;
  unknown: number;
  requiredSourcesFailing: string[];
  trippedBreakers: string[];
}

function recommendationsForReport(context: RecommendationContext): string[] {
  const recommendations: string[] = [];
  if (!context.isOnline) {
    recommendations.push('Network is offline. Restore connectivity before troubleshooting individual sources.');
  }
  if (context.requiredSourcesFailing.length > 0) {
    recommendations.push(`${context.requiredSourcesFailing.length} risk-critical source(s) failing: ${context.requiredSourcesFailing.slice(0, 3).join(', ')}. Risk scores may be degraded.`);
  }
  if (context.trippedBreakers.length >= 3) {
    recommendations.push(`${context.trippedBreakers.length} circuit breakers tripped — likely a broad upstream outage rather than per-feed issues.`);
  }
  if (context.silent > 0) {
    recommendations.push(`${context.silent} source(s) silent for 6h+. Verify the refresh scheduler is running and the panels that use these sources are enabled.`);
  }
  if (context.failing > 0) {
    recommendations.push(`${context.failing} source(s) failing. Inspect per-source errors and retry the affected providers.`);
  }
  if (context.degraded > 0) {
    recommendations.push(`${context.degraded} source(s) degraded. Confirm their refresh cadence and upstream availability.`);
  }
  if (context.unknown > 0) {
    recommendations.push(`${context.unknown} source(s) have unknown health because no successful update has been recorded.`);
  }
  if (recommendations.length === 0 && context.healthy === context.sourceCount && context.sourceCount > 0) {
    recommendations.push('All sources within expected freshness windows.');
  }
  return recommendations;
}

export function diagnoseAll(): DiagnosticReport {
  const now = Date.now();
  const freshness = dataFreshness.getAllSources();
  const breakers = getCircuitBreakerStatus();
  const offline = getOfflineState();

  const sources = freshness.map((source) => diagnosticForSource(source, now, breakers));

  // Offline-staleness supplemental ages (for sources wired via recordSourceUpdate)
  for (const src of sources) {
    if (src.lastUpdateMs === null) {
      const offlineAge = getSourceAge(src.id);
      if (offlineAge !== null) src.ageSeconds = Math.floor(offlineAge / 1000);
    }
  }

  const healthy = sources.filter(s => s.status === 'healthy').length;
  const degraded = sources.filter(s => s.status === 'degraded').length;
  const failing = sources.filter(s => s.status === 'failing').length;
  const silent = sources.filter(s => s.status === 'silent').length;
  const unknown = sources.filter(s => s.status === 'unknown').length;
  const requiredSourcesFailing = sources
    .filter(s => s.requiredForRisk && (s.status === 'failing' || s.status === 'silent'))
    .map(s => s.name);

  const trippedBreakers: string[] = [];
  for (const [name, state] of Object.entries(breakers)) {
    if (state === 'open' || state === 'cooldown') trippedBreakers.push(name);
  }

  const oldestSources = sources
    .filter(s => s.ageSeconds !== null)
    .sort((a, b) => (b.ageSeconds ?? 0) - (a.ageSeconds ?? 0))
    .slice(0, 5)
    .map(s => ({ id: s.id, name: s.name, ageSeconds: s.ageSeconds ?? 0 }));

  const recommendations = recommendationsForReport({
    isOnline: offline.isOnline,
    sourceCount: sources.length,
    healthy,
    degraded,
    failing,
    silent,
    unknown,
    requiredSourcesFailing,
    trippedBreakers,
  });

  return {
    generatedAt: now,
    isOnline: offline.isOnline,
    offlineStatus: offline.status,
    totalSources: sources.length,
    healthy,
    degraded,
    failing,
    silent,
    unknown,
    requiredSourcesFailing,
    trippedBreakers,
    sources,
    oldestSources,
    recommendations,
  };
}

export function diagnoseSource(sourceId: string): SourceDiagnostic | null {
  const report = diagnoseAll();
  return report.sources.find(s => s.id === sourceId) ?? null;
}

/**
 * Issue a live HTTP probe to an upstream endpoint. Only works for the
 * whitelisted PROBE_ENDPOINTS — arbitrary URL probes could be used to
 * exfiltrate data or trigger SSRF so the whitelist is intentional.
 */
export async function pingSource(sourceId: string): Promise<PingResult> {
  const url = PROBE_ENDPOINTS[sourceId];
  const start = Date.now();
  if (!url) {
    return {
      sourceId,
      url: '',
      ok: false,
      status: 0,
      latencyMs: 0,
      error: 'No probe endpoint registered for this source',
      fetchedAt: start,
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal, method: 'GET' });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;
    return {
      sourceId,
      url,
      ok: response.ok,
      status: response.status,
      latencyMs,
      error: response.ok ? null : `HTTP ${response.status}`,
      fetchedAt: start,
    };
  } catch (error) {
    return {
      sourceId,
      url,
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      fetchedAt: start,
    };
  }
}

/**
 * Probe every whitelisted source in parallel and return the results.
 * Useful for "why is nothing updating?" diagnostics.
 */
export async function pingAllSources(): Promise<PingResult[]> {
  const ids = Object.keys(PROBE_ENDPOINTS);
  return Promise.all(ids.map(id => pingSource(id)));
}

/**
 * Format a report as a plain-text log suitable for pasting into issues.
 */
export function formatReport(report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push(`Crystal Ball Diagnostic — ${new Date(report.generatedAt).toISOString()}`, `Network: ${report.isOnline ? 'online' : 'OFFLINE'} (${report.offlineStatus})`, `Sources: ${report.healthy} healthy, ${report.degraded} degraded, ${report.failing} failing, ${report.silent} silent, ${report.unknown} unknown, ${report.totalSources} total`);
  if (report.requiredSourcesFailing.length > 0) {
    lines.push(`Risk-critical failures: ${report.requiredSourcesFailing.join(', ')}`);
  }
  if (report.trippedBreakers.length > 0) {
    lines.push(`Tripped breakers: ${report.trippedBreakers.join(', ')}`);
  }
  lines.push('', 'Recommendations:');
  for (const r of report.recommendations) lines.push(`  - ${r}`);
  lines.push('', 'Per-source detail:');
  for (const s of report.sources) {
    const age = s.ageSeconds === null ? 'never' : `${s.ageSeconds}s ago`;
    lines.push(`  [${s.status.padEnd(8)}] ${s.name.padEnd(32)} last=${age} items=${s.itemCount}${s.onCooldown ? ' (cooldown)' : ''}`);
    for (const note of s.notes) lines.push(`     > ${note}`);
  }
  return lines.join('\n');
}

// ── Console accessor ────────────────────────────────────────────────────────

/**
 * Exposes the diagnostic API on `window.cbDiag` for browser-devtools
 * troubleshooting. Call `cbDiag.report()` in the console to print a
 * snapshot; `cbDiag.ping()` to issue live probes; `cbDiag.text()` to
 * get a copy-pasteable plain-text dump.
 */
export function attachDiagnosticToWindow(): void {
  if (typeof window === 'undefined') return;
  const diag = {
    report: (): DiagnosticReport => {
      const r = diagnoseAll();
      console.log(formatReport(r));
      return r;
    },
    ping: async (): Promise<PingResult[]> => {
      const results = await pingAllSources();
      console.table(results);
      return results;
    },
    pingOne: async (sourceId: string): Promise<PingResult> => {
      const result = await pingSource(sourceId);
      console.log(result);
      return result;
    },
    source: (sourceId: string): SourceDiagnostic | null => {
      return diagnoseSource(sourceId);
    },
    text: (): string => {
      return formatReport(diagnoseAll());
    },
  };
  (window as unknown as { cbDiag: typeof diag }).cbDiag = diag;
  console.log('[cbDiag] Diagnostic API attached. Try cbDiag.report(), cbDiag.ping(), or cbDiag.text()');
}
