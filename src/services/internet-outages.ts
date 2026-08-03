/**
 * Internet outage detection — IODA (Internet Outage Detection and Analysis)
 * Research project by Georgia Tech / CAIDA, public API, no auth required.
 * https://ioda.inetintel.cc.gatech.edu/api/v2/
 *
 * Detects country/AS-level internet blackouts using BGP, active probing,
 * and darknet traffic signals. Used by journalists and human rights orgs
 * to document government-ordered internet shutdowns.
 */

import { dataFreshness } from './data-freshness';
import { getApiBaseUrl } from './runtime';

export interface IodaOutage {
  id: string;
  entityType: 'country' | 'asn' | 'region';
  entityName: string;
  entityCode: string; // ISO country code or ASN
  score: number; // 0–1 outage severity score
  overallScore: number; // IODA composite score
  bgpScore: number | null; // BGP routing signal
  activeScore: number | null; // Active probing signal
  darknetsScore: number | null; // Darknet traffic signal
  startTime: Date;
  endTime: Date | null;
  isOngoing: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

/** Shape of one alert as projected by the sidecar's `parseIodaAlerts`
 * (`/api/internet-outages`). The renderer used to hit IODA directly with a
 * mismatched parser; routing through the sidecar (which handles CORS + the real
 * IODA v2 field names) is the only path that actually returns data. */
interface SidecarIodaAlert {
  entityType: string | null;
  entityCode: string | null;
  entityName: string | null;
  datasource: string | null;
  score: number | null;
  historyValue: number | null;
  from: number | null;
  until: number | null;
  level: string | null; // IODA severity band: 'normal' | 'warning' | 'critical'
  condition: string | null;
  method: string | null;
}

interface SidecarIodaResponse {
  alerts?: SidecarIodaAlert[];
  degraded?: boolean;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let cache: { outages: IodaOutage[]; fetchedAt: number } | null = null;

/** IODA reports a categorical `level`, not a normalized 0–1 score. Map it to the
 * IodaOutage severity + a level-derived score proxy (the sidecar projection
 * doesn't expose the raw sub-signal scores, so `score` here is categorical). */
function levelToSeverity(level: string | null): { severity: IodaOutage['severity']; score: number } {
  switch (level) {
    case 'critical': { return { severity: 'critical', score: 0.9 }; }
    case 'warning': { return { severity: 'high', score: 0.6 }; }
    default: { return { severity: 'low', score: 0.2 }; }
  }
}

function mapSidecarAlert(a: SidecarIodaAlert, i: number): IodaOutage {
  const { severity, score } = levelToSeverity(a.level);
  let entityType: IodaOutage['entityType'];
  if (a.entityType === 'country') entityType = 'country';
  else if (a.entityType === 'asn') entityType = 'asn';
  else entityType = 'region';
  return {
    id: `ioda-${a.entityCode ?? i}-${a.from ?? i}`,
    entityType,
    entityName: a.entityName ?? 'Unknown',
    entityCode: a.entityCode ?? '',
    score,
    overallScore: score,
    // The sidecar projection carries a single `datasource` per alert, not the
    // separate BGP/active/darknet sub-scores, so per-signal corroboration isn't
    // available here — comms confidence lands at 'medium' (see comms-contributor).
    bgpScore: null,
    activeScore: null,
    darknetsScore: null,
    startTime: a.from === null ? new Date() : new Date(a.from * 1000),
    endTime: null,
    // A warning/critical IODA alert is an active outage; 'normal' is not.
    isOngoing: a.level === 'critical' || a.level === 'warning',
    severity,
  };
}

/** Pure projection of the sidecar's alert array into sorted `IodaOutage[]`:
 * keep only real outages (warning/critical), map each, sort ongoing-first then by
 * level-derived score, cap at 50. Exported for testing without the fetch/cache. */
export function parseSidecarOutages(alerts: readonly SidecarIodaAlert[]): IodaOutage[] {
  const outages = alerts
    .filter((a) => a.level === 'warning' || a.level === 'critical')
    .map((a, i) => mapSidecarAlert(a, i));
  outages.sort((a, b) => {
    if (a.isOngoing !== b.isOngoing) return a.isOngoing ? -1 : 1;
    return b.score - a.score;
  });
  return outages.slice(0, 50);
}

/**
 * Fetch current internet outages via the sidecar `/api/internet-outages`
 * endpoint (keyless, CORS-safe, TTL-cached upstream). Warms a module cache read
 * synchronously by `getCachedIodaOutages`. A fetch failure keeps the prior cache
 * (fail-closed) rather than clearing it.
 */
export async function fetchIodaOutages(): Promise<IodaOutage[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.outages;

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const from = nowSec - 24 * 60 * 60;
    const base = getApiBaseUrl();
    const url = `${base}/api/internet-outages?from=${from}&until=${nowSec}&limit=50`;

    // 18s, deliberately ABOVE the sidecar's own 15s IODA upstream deadline
    // (local-api-server.mjs `/api/internet-outages`) — the same ordering
    // geofon-seismic-fetch.ts states explicitly. Racing below it is not a
    // harmless early give-up here: on a slow upstream the sidecar still
    // completes and caches the payload, but this caller has already aborted,
    // and because the key carries an unsnapped second-resolution `until` the
    // retry asks a DIFFERENT key — so it misses that warm entry and starts
    // another 15s upstream fetch, which it abandons again. That starves the
    // comms axis indefinitely while every layer reports a plain timeout.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(18_000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      dataFreshness.recordError('internet-outages', `HTTP ${res.status}`);
      return cache?.outages ?? [];
    }

    const data = await res.json() as SidecarIodaResponse;
    if (!data || typeof data !== 'object') {
      dataFreshness.recordError('internet-outages', 'malformed response');
      return cache?.outages ?? [];
    }
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
    const outages = parseSidecarOutages(alerts);

    cache = { outages, fetchedAt: Date.now() };
    dataFreshness.recordUpdate('internet-outages', cache.outages.length);
    return cache.outages;
  } catch (error) {
    dataFreshness.recordError('internet-outages', String(error));
    return cache?.outages ?? [];
  }
}

/**
 * Synchronous read of the last-fetched outages, or `[]` if nothing has been
 * fetched yet OR the cache has aged past `CACHE_TTL_MS`. Lets the survival
 * comms axis read the warm cache without awaiting a fetch; honors the same
 * freshness window as `fetchIodaOutages` so a sustained loader outage can't keep
 * asserting stale outages forever. `now` is injectable for determinism.
 */
export function getCachedIodaOutages(now = Date.now()): IodaOutage[] {
  if (!cache || now - cache.fetchedAt >= CACHE_TTL_MS) return [];
  return cache.outages;
}

export function outageEntityLabel(outage: IodaOutage): string {
  if (outage.entityType === 'asn') return `AS${outage.entityCode} (${outage.entityName})`;
  return outage.entityName;
}

export function outageSeverityClass(severity: IodaOutage['severity']): string {
  return {
 critical: 'eq-row eq-major',
 high: 'eq-row eq-strong',
 medium: 'eq-row eq-moderate',
 low: 'eq-row',
  }[severity] ?? 'eq-row';
}
