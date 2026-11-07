/**
 * FAA NAS Status airport delay program proxy.
 *
 * Upstream candidates (one will respond JSON, others may 404 — we try
 * in order):
 *   - https://nasstatus.faa.gov/api/airport-conditions
 *   - https://nasstatus.faa.gov/api/airport-events
 *   - https://nasstatus.faa.gov/api/airport-volume   (XML; not parsed)
 */

import { nestedGroundStop } from './_faa-ground-stop.js';
import {
  degraded,
  envelope,
  fetchUpstream,
  jsonResponse,
  parseTimestamp,
  pickFinite,
  pickString,
  preflight,
  withCache,
} from './_aviation-helpers.js';

export const config = { runtime: 'edge' };

const SOURCE = 'nasstatus.faa.gov';
const CACHE_KEY = 'aviation:delays';

const UPSTREAMS = [
  'https://nasstatus.faa.gov/api/airport-conditions',
  'https://nasstatus.faa.gov/api/airport-events',
];

function classifyProgram(raw) {
  const u = (raw ?? '').toUpperCase();
  if (/^(?:GROUND[ _-]STOP|STOP)$/.test(u)) return 'ground_stop';
  if (u.includes('GROUND') || u.includes('GDP')) return 'ground_delay';
  if (u.includes('ARRIVAL') || u.includes('AAR')) return 'arrival_delay';
  return 'other';
}

function normalizeDelay(item, idx) {
  if (!item || typeof item !== 'object') return null;
  if ('airportId' in item && 'groundStop' in item) {
    const stop = nestedGroundStop(item);
    return stop ? { ...stop, id: `delay-${stop.airport}-${idx}` } : null;
  }
  const airport = (pickString(item.airport, item.iata, item.icao, item.location) ?? '').toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(airport)) return null;
  const start = item.startTime ?? item.startedAt;
  const end = item.endTime ?? item.endsAt;
  const startedAt = parseTimestamp(start);
  const endsAt = parseTimestamp(end);
  if ((start != null && startedAt === null) || (end != null && endsAt === null)
    || (startedAt !== null && endsAt !== null && endsAt <= startedAt)) return null;
  return {
    id: `delay-${airport}-${idx}`,
    airport,
    reason: pickString(item.reason, item.cause, item.eventType) ?? 'unspecified',
    avgDelayMinutes: pickFinite(item.avgDelay, item.avg_delay_minutes, item.average_delay_minutes),
    maxDelayMinutes: pickFinite(item.maxDelay, item.max_delay_minutes),
    programType: classifyProgram(pickString(item.eventType, item.programType, item.type)),
    startedAt,
    endsAt,
  };
}

function parseFeed(payload) {
  const items = Array.isArray(payload) ? payload : ['delays', 'events', 'data', 'airports']
    .map(key => payload?.[key]).find(value => Array.isArray(value));
  if (!items) return null;

  const data = [];
  let malformed = 0;
  for (const [idx, item] of items.entries()) {
    if (typeof item?.airportId === 'string' && /^[A-Z0-9]{3,4}$/.test(item.airportId) && item.groundStop === null) continue;
    const row = normalizeDelay(item, idx);
    if (row) data.push(row);
    else malformed++;
  }
  if (!malformed) return envelope(data, SOURCE);
  return data.length ? { ...envelope(data, SOURCE), degraded: true, reason: 'Invalid airport event rows' } : null;
}

async function fetchDelays() {
  let lastError;
  for (const url of UPSTREAMS) {
    try {
      const response = await fetchUpstream(url);
      if (!response.ok) {
        lastError = `HTTP ${response.status} from ${url}`;
        continue;
      }
      const result = parseFeed(await response.json());
      if (result) return result;
      lastError = 'Unrecognized FAA airport-event response';
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
  }
  return degraded(lastError ?? 'all upstreams failed', SOURCE);
}

export default async function handler(req) {
  const { cors, response } = preflight(req, 'GET, OPTIONS');
  if (response) return response;
  const result = await withCache(CACHE_KEY, SOURCE, fetchDelays, (payload) => !payload.degraded);
  return jsonResponse(result, 200, cors);
}
