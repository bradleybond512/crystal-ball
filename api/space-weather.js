/**
 * NOAA SWPC space weather summary proxy. No API key.
 * https://services.swpc.noaa.gov/
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const ENDPOINTS = [
  { id: 'kp', url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json' },
  { id: 'solar-wind', url: 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json' },
  { id: 'alerts', url: 'https://services.swpc.noaa.gov/products/alerts.json' },
];

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({
  kp: null, solarWind: null, alerts: [], degraded: true, reason,
  source: 'services.swpc.noaa.gov', generatedAt: new Date().toISOString(),
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);
  try {
    const responses = await Promise.allSettled(ENDPOINTS.map((e) =>
      fetch(e.url, {
        headers: { 'User-Agent': 'CrystalBall/2.10.21 (swpc)' },
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.ok ? r.json() : null)
    ));
    const [kpResult, solarWindResult, alertsResult] = responses;
    const result = {
      kp: kpResult.status === 'fulfilled' ? kpResult.value : null,
      solarWind: solarWindResult.status === 'fulfilled' ? solarWindResult.value : null,
      alerts: alertsResult.status === 'fulfilled' && Array.isArray(alertsResult.value) ? alertsResult.value : [],
      source: 'services.swpc.noaa.gov',
      generatedAt: new Date().toISOString(),
    };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`SWPC fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
