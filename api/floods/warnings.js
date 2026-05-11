/**
 * NWS active flood alerts proxy.
 * Fetches flood watches, warnings, and advisories from the NWS alerts API.
 * No API key required — public NWS data.
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 5 * 60 * 1000;

const FLOOD_EVENTS = [
  'Flood Warning',
  'Flood Watch',
  'Flash Flood Warning',
  'Flash Flood Watch',
  'Areal Flood Warning',
  'Areal Flood Watch',
  'Flood Advisory',
  'Flash Flood Statement',
  'Hydrologic Outlook',
].join(',');

const NWS_URL = `https://api.weather.gov/alerts/active?event=${encodeURIComponent(FLOOD_EVENTS)}&status=actual`;

export const cache = new Map();

const j = (payload, status, cors) =>
  Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });

const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

function parseAlerts(features) {
  const byState = new Map();
  const alerts = [];

  for (const f of features) {
    const p = f.properties ?? {};
    const event = p.event ?? 'Unknown';
    const severity = p.severity ?? 'Unknown';
    const headline = p.headline ?? '';
    const areaDesc = p.areaDesc ?? '';
    const effective = p.effective ?? null;
    const expires = p.expires ?? null;
    const id = f.id ?? '';
    const polygon = f.geometry ?? null;

    // Extract state codes from areaDesc (e.g. "Lamar County; TX")
    const stateMatches = [...areaDesc.matchAll(/;\s*([A-Z]{2})\b/g)].map(m => m[1]);
    const states = stateMatches.length > 0 ? [...new Set(stateMatches)] : ['XX'];

    for (const state of states) {
      if (!byState.has(state)) byState.set(state, { state, count: 0, maxSeverityRank: 0, maxSeverity: 'Unknown', events: [] });
      const st = byState.get(state);
      st.count++;
      const rank = SEVERITY_RANK[severity] ?? 0;
      if (rank > st.maxSeverityRank) {
        st.maxSeverityRank = rank;
        st.maxSeverity = severity;
      }
      if (!st.events.includes(event)) st.events.push(event);
    }

    alerts.push({ id, event, severity, headline, areaDesc, effective, expires, polygon, states });
  }

  return {
    total: features.length,
    byState: [...byState.values()]
      .sort((a, b) => b.maxSeverityRank - a.maxSeverityRank || b.count - a.count),
    alerts,
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const cached = cache.get('warnings');
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    const r = await fetch(NWS_URL, {
      headers: {
        'User-Agent': 'CrystalBall/2 (flood-warnings) bradley_bond@me.com',
        Accept: 'application/geo+json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      return j({ error: `NWS returned HTTP ${r.status}`, degraded: true, generatedAt: new Date().toISOString() }, 200, cors);
    }
    const data = await r.json();
    const features = data?.features ?? [];
    const parsed = parseAlerts(features);
    const payload = { ...parsed, source: 'api.weather.gov', generatedAt: new Date().toISOString() };
    cache.set('warnings', { at: Date.now(), payload });
    return j(payload, 200, cors);
  } catch (error) {
    return j({ error: `NWS fetch failed: ${error?.message ?? error}`, degraded: true, generatedAt: new Date().toISOString() }, 200, cors);
  }
}
