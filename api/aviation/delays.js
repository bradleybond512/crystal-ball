/**
 * FAA NAS Status airport delay program proxy.
 *
 * Upstream candidates (one will respond JSON, others may 404 — we try
 * in order):
 *   - https://nasstatus.faa.gov/api/airport-conditions
 *   - https://nasstatus.faa.gov/api/airport-events
 *   - https://nasstatus.faa.gov/api/airport-volume   (XML; not parsed)
 */

import {
  degraded,
  envelope,
  extractItems,
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
  if (u.includes('STOP')) return 'ground_stop';
  if (u.includes('GROUND') || u.includes('GDP')) return 'ground_delay';
  if (u.includes('ARRIVAL') || u.includes('AAR')) return 'arrival_delay';
  return 'other';
}

function normalizeDelay(item, idx) {
  if (!item || typeof item !== 'object') return null;
  const airport = (pickString(item.airport, item.iata, item.icao, item.location) ?? '').toUpperCase();
  if (!airport) return null;
  return {
    id: `delay-${airport}-${idx}`,
    airport,
    reason: pickString(item.reason, item.cause, item.eventType) ?? 'unspecified',
    avgDelayMinutes: pickFinite(item.avgDelay, item.avg_delay_minutes, item.average_delay_minutes),
    maxDelayMinutes: pickFinite(item.maxDelay, item.max_delay_minutes),
    programType: classifyProgram(pickString(item.eventType, item.programType, item.type)),
    startedAt: parseTimestamp(item.startTime, item.startedAt),
    endsAt: parseTimestamp(item.endTime, item.endsAt),
  };
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
      const payload = await response.json();
      const items = extractItems(payload, ['delays', 'events', 'data', 'airports']);
      const data = items
        .map((item, idx) => normalizeDelay(item, idx))
        .filter(Boolean);
      return envelope(data, SOURCE);
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
  }
  return degraded(lastError ?? 'all upstreams failed', SOURCE);
}

export default async function handler(req) {
  const { cors, response } = preflight(req, 'GET, OPTIONS');
  if (response) return response;
  const result = await withCache(CACHE_KEY, SOURCE, fetchDelays);
  return jsonResponse(result, 200, cors);
}
