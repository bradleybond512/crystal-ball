/**
 * Fail-closed fetches for the two internet_outages voters: Georgia Tech's IODA
 * and Cloudflare Radar.
 *
 * Unlike every other fused domain here, an EMPTY result is a success. A quiet
 * internet is a real observation, so zero qualifying rows behind a 200 records
 * ok:true with no observations; only a transport or shape failure records
 * ok:false.
 */

import { getApiBaseUrl } from '@/services/runtime';
import type { OutageEvent } from './outage-fusion-observations';

export interface OutageFetchResult {
  ok: boolean;
  events: OutageEvent[];
}

/** The sidecar's `parseIodaAlerts` projection, narrowed to the fields fusion reads. */
export interface IodaFusionAlert {
  entityType?: unknown;
  entityCode?: unknown;
  datasource?: unknown;
  level?: unknown;
  /** IODA's alert instant, in unix SECONDS. */
  from?: unknown;
}

// Each renderer timeout must OUTLIVE the sidecar deadline it races: aborting
// first means the sidecar's degraded-handling and setCached never run for that
// tick, and a slow-but-successful upstream reads as a hard failure.
/** Races the shared /api/internet-outages route's 15s upstream deadline. */
const IODA_RENDERER_TIMEOUT_MS = 18_000;
/** Races the /api/internet-outages-cf route's 12s upstream deadline. */
const CLOUDFLARE_RENDERER_TIMEOUT_MS = 15_000;

const IODA_WINDOW_SEC = 24 * 60 * 60;

/**
 * 5000, NOT the route's default of 50. IODA returns rows in ASCENDING time
 * order and `limit` truncates the TAIL — it discards the NEWEST rows. Measured
 * 2026-07-30 over a 24 h window holding 1816 rows: limit=1000 cut off at
 * 02:40 UTC while the full window ran to 16:10 UTC, silently discarding the
 * most recent 13.5 hours. For a live outage feed that is the worst possible
 * truncation direction — only day-old recoveries survive — and every layer
 * still reports success. Ordering cannot be fixed instead: order=desc,
 * sort=-time and orderBy=time_desc are all silently ignored upstream.
 *
 * The 24 h window stays: Cloudflare's annotations are day-scale curated events,
 * so a shorter IODA window would systematically fail to overlap and the domain
 * would sit at one vote forever.
 */
const IODA_FUSION_LIMIT = 5000;

function failed(): OutageFetchResult {
  return { ok: false, events: [] };
}

/**
 * IODA `/outages/alerts` is an alert-TRANSITION list, not an outage list: it
 * carries `level: 'normal'` recovery rows alongside `level: 'critical'` onsets
 * (measured 2026-07-30: 891 normal vs 925 critical over 24 h). Counting rows
 * without this filter counts recoveries as outages and fabricates a global
 * outage storm.
 *
 * The filter is an ALLOWLIST of the known alert levels, and must stay one. A
 * denylist (`level !== 'normal'`) rejects only that exact string, so a row
 * whose `level` is undefined, null, or a renamed field passes straight through
 * and becomes a real country outage — and if Cloudflare independently names
 * the same country, that fabricates a corroborated TWO-SOURCE fact out of a
 * malformed body. `level` is untrusted input; only 'critical' and 'warning'
 * are outage ONSETS, everything else is dropped. Do NOT filter on `condition`:
 * it is a THRESHOLD STRING ('< 0.99', '< 0.8', ...), not a status word, so any
 * equality test against it drops everything.
 *
 * Country-only: region/ASN entity codes are not ISO2 and would collide with
 * country keys under matchBy:'key'.
 *
 * Deduped by (entityCode, datasource) because one country can raise a row from
 * each detection method; repeats within the window are the same source
 * re-asserting, not distinct outages.
 */
export function iodaAlertsToEvents(alerts: readonly IodaFusionAlert[]): OutageEvent[] {
  const seen = new Set<string>();
  const events: OutageEvent[] = [];
  for (const alert of alerts) {
    const row = qualifyingAlert(alert);
    if (!row) continue;
    // NUL separator: it cannot occur inside either half, so no pair of
    // (code, datasource) values can collide onto one dedupe key.
    const dedupeKey = `${row.country}\u0000${row.datasource}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    events.push({ country: row.country, startedAt: row.startedAt });
  }
  return events;
}

interface QualifyingAlert {
  country: string;
  startedAt: number;
  datasource: string;
}

/**
 * The alert levels that mean "an outage started". Live IODA emits 'critical'
 * against 'normal' recoveries; 'warning' is carried because the codebase's own
 * IODA mapper (services/internet-outages.ts levelToSeverity) already treats it
 * as a real tier, so allowlisting both rejects malformed rows without
 * narrowing genuine coverage.
 */
const ONSET_LEVELS = new Set(['critical', 'warning']);

/** Country-scoped, onset-level, usably-timestamped rows only — see above. */
function qualifyingAlert(alert: IodaFusionAlert): QualifyingAlert | null {
  if (!alert || typeof alert !== 'object') return null;
  if (alert.entityType !== 'country') return null;
  if (typeof alert.level !== 'string' || !ONSET_LEVELS.has(alert.level.trim().toLowerCase())) return null;
  const country = typeof alert.entityCode === 'string' ? alert.entityCode.trim().toUpperCase() : '';
  if (!country) return null;
  const seconds = typeof alert.from === 'number' ? alert.from : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return {
    country,
    startedAt: seconds * 1000,
    datasource: typeof alert.datasource === 'string' ? alert.datasource : '',
  };
}

/** IODA outage onsets — the primary vote. */
export async function fetchIodaOutageEvents(now: number = Date.now()): Promise<OutageFetchResult> {
  try {
    const untilSec = Math.floor(now / 1000);
    const fromSec = untilSec - IODA_WINDOW_SEC;
    const url = `${getApiBaseUrl()}/api/internet-outages?from=${fromSec}&until=${untilSec}&limit=${IODA_FUSION_LIMIT}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(IODA_RENDERER_TIMEOUT_MS),
    });
    if (!res.ok) return failed();
    const data = (await res.json()) as { alerts?: unknown; degraded?: boolean } | null;
    if (!data || data.degraded) return failed();
    if (!Array.isArray(data.alerts)) return failed();
    return { ok: true, events: iodaAlertsToEvents(data.alerts as IodaFusionAlert[]) };
  } catch {
    return failed();
  }
}

/** Cloudflare Radar outage annotations — the corroborating vote. */
export async function fetchCloudflareRadarOutages(): Promise<OutageFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/internet-outages-cf`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CLOUDFLARE_RENDERER_TIMEOUT_MS),
    });
    if (!res.ok) return failed();
    const data = (await res.json()) as { outages?: unknown; degraded?: boolean } | null;
    if (!data || data.degraded) return failed();
    if (!Array.isArray(data.outages)) return failed();
    const events: OutageEvent[] = [];
    for (const row of data.outages as { country?: unknown; startedAt?: unknown }[]) {
      if (!row || typeof row !== 'object') continue;
      const country = typeof row.country === 'string' ? row.country.trim().toUpperCase() : '';
      const startedAt = typeof row.startedAt === 'number' ? row.startedAt : Number.NaN;
      if (!country || !Number.isFinite(startedAt) || startedAt <= 0) continue;
      events.push({ country, startedAt });
    }
    return { ok: true, events };
  } catch {
    return failed();
  }
}
