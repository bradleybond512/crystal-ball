/**
 * ACLED 30-day rolling feeder for the precedent-matcher corpus.
 *
 * GET /api/acled/events
 *   → { events: HistoricalEvent[], updatedAt, source, count, window }
 *
 * Auth: ACLED uses legacy query-param auth (`?key=X&email=Y`); the env var
 * name `ACLED_ACCESS_TOKEN` is historical but the value is passed as `key=`.
 * Mirrors the existing sidecar `/api/acled-events` pattern, broadened from
 * air-strikes-only to the full event taxonomy.
 *
 * Cache: 24 h (matches the spec's daily polling cadence). The 30-day window
 * is recomputed at the start of each fetch so cache misses always pull the
 * fresh window — never a 30-day window centered on a stale "today".
 *
 * The companion ingestion helper merges these into the same corpus that
 * receives GDELT EVENT slices (src/services/synthesis/gdelt-gkg-ingest.ts).
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const ACLED_ENDPOINT = 'https://api.acleddata.com/acled/read';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25_000;

const WINDOW_DAYS = 30;
const MAX_EVENTS = 500;

let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const empty = (reason) => ({
  events: [], updatedAt: Date.now(), source: 'acled',
  count: 0, degraded: true, reason,
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  const key = process.env.ACLED_ACCESS_TOKEN;
  const email = process.env.ACLED_EMAIL;
  if (!key || !email) {
    return j(empty('ACLED_ACCESS_TOKEN and ACLED_EMAIL are required'), 200, cors);
  }

  const since = isoDay(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  try {
    const url = buildAcledUrl(key, email, since);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'CrystalBall (acled)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) return j(empty(`ACLED HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    if (payload?.success === false) {
      // ACLED returns 200 with success:false on auth/quota errors.
      const msg = payload?.error?.message ?? payload?.error ?? 'unknown ACLED error';
      return j(empty(`ACLED rejected: ${msg}`), 200, cors);
    }
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const events = rows.map((row) => toHistoricalEvent(row)).filter(Boolean).slice(0, MAX_EVENTS);
    const result = {
      events, updatedAt: Date.now(),
      source: 'acled', count: events.length,
      window: { since, days: WINDOW_DAYS },
    };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(empty(`ACLED fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}

const FIELDS = [
  'event_id_cnty', 'event_date', 'event_type', 'sub_event_type',
  'actor1', 'actor2', 'country', 'admin1', 'location',
  'latitude', 'longitude', 'fatalities', 'notes',
].join('|');

function buildAcledUrl(key, email, since) {
  const params = new URLSearchParams({
    key, email,
    fields: FIELDS,
    event_date: since,
    event_date_where: '>=',
    limit: String(MAX_EVENTS),
    sort: 'event_date',
    order: 'desc',
    _format: 'json',
  });
  return `${ACLED_ENDPOINT}?${params.toString()}`;
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Map ACLED row → HistoricalEvent (precedent-matcher.ts shape). */
export function toHistoricalEvent(row) {
  if (!row || typeof row !== 'object') return null;
  const id = row.event_id_cnty;
  const date = row.event_date;
  if (!id || !date) return null;
  const actors = [row.actor1, row.actor2]
    .map((s) => (s || '').trim()).filter((s) => s.length > 0);
  const fatalities = Number.parseInt(row.fatalities, 10) || 0;
  const eventType = row.sub_event_type || row.event_type || 'unknown';
  return {
    id: `acled-${id}`,
    date: toIsoDate(date),
    location: [row.location, row.admin1, row.country].filter(Boolean).join(', '),
    country: row.country || '',
    eventType,
    actors,
    intensity: intensityFromAcled(row.event_type, fatalities),
    summary: buildSummary(row, fatalities),
    source: 'acled',
  };
}

function toIsoDate(s) {
  // ACLED returns "YYYY-MM-DD" — normalize to ISO 8601 midnight UTC so
  // mergeIntoCorpus's localeCompare sort works alongside GDELT timestamps.
  if (!s) return '';
  if (s.length === 10) return `${s}T00:00:00Z`;
  return s;
}

/** Intensity bucket derived from event_type taxonomy + fatality count.
 *
 *  Why fatalities-driven: the ACLED taxonomy has 6 top-level types but
 *  intensity within each type spans low (a small protest) to critical
 *  (a battle with mass casualties). Fatalities are the most reliable
 *  numeric proxy for severity; type breaks the tie when fatalities are 0. */
export function intensityFromAcled(eventType, fatalities) {
  if (fatalities >= 50) return 'critical';
  if (fatalities >= 10) return 'high';
  if (fatalities >= 1) return 'medium';
  if (eventType === 'Battles') return 'high';
  if (eventType === 'Violence against civilians' || eventType === 'Explosions/Remote violence') return 'medium';
  // Protests, Riots, Strategic developments, and any unknown type → low
  return 'low';
}

function buildSummary(row, fatalities) {
  const place = [row.location, row.country].filter(Boolean).join(', ') || 'unspecified';
  const subtype = row.sub_event_type || row.event_type || '';
  const fatalityNote = fatalities > 0 ? ` (${fatalities} fatalities)` : '';
  const notes = (row.notes || '').slice(0, 240);
  return `${subtype} at ${place}${fatalityNote}${notes ? ' — ' + notes : ''}`;
}

export function __resetCacheForTests() { _cache = null; }
